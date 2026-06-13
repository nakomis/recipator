import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
  recipesTable: dynamodb.ITable;
  failuresTable: dynamodb.ITable;
  certificate: acm.ICertificate;
  zone: route53.IHostedZone;
  appDomain: string;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { deployEnv, recipesTable, failuresTable, certificate, zone, appDomain } = props;

    // ── Shared Cognito user pool ──────────────────────────────────────────────
    const userPoolId = ssm.StringParameter.valueForStringParameter(
      this, `/nakomis-infra/${deployEnv}/cognito/user-pool-id`,
    );
    const userPool = cognito.UserPool.fromUserPoolId(this, 'SharedPool', userPoolId);

    // Recipator app client. iOS uses PKCE (no client secret).
    const client = new cognito.UserPoolClient(this, 'RecipatorClient', {
      userPoolClientName: `recipator-${deployEnv}`,
      userPool,
      authFlows: { userSrp: true },
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        callbackUrls: [
          `com.nakomis.recipator://callback`,
          'http://localhost:3000/callback',
        ],
        logoutUrls: [
          `com.nakomis.recipator://logout`,
          'http://localhost:3000/logout',
        ],
      },
    });

    // Managed Login v2 requires an explicit branding resource per client.
    // Without it the hosted UI returns "Login pages unavailable".
    new cognito.CfnManagedLoginBranding(this, 'ManagedLoginBranding', {
      userPoolId: userPool.userPoolId,
      clientId: client.userPoolClientId,
      useCognitoProvidedValues: true,
    });

    new ssm.StringParameter(this, 'CognitoClientIdParam', {
      parameterName: `/recipator/${deployEnv}/cognito/client-id`,
      stringValue: client.userPoolClientId,
      description: `Recipator Cognito app client ID (${deployEnv})`,
    });

    // ── Anthropic API key (placeholder; overwrite after first deploy) ─────────
    // Deploy first, then: aws ssm put-parameter --overwrite --name /recipator/{env}/anthropic-api-key --value "sk-ant-..."
    const anthropicKeyParam = new ssm.StringParameter(this, 'AnthropicKeyParam', {
      parameterName: `/recipator/${deployEnv}/anthropic-api-key`,
      stringValue: 'PLACEHOLDER',
      description: 'Anthropic API key for recipe extraction (overwrite after deploy)',
    });

    // ── Lambda shared config ──────────────────────────────────────────────────
    const runtime = lambda.Runtime.NODEJS_22_X;
    const bundling: nodejs.BundlingOptions = {
      externalModules: [],
      format: nodejs.OutputFormat.CJS,
    };
    const commonEnv = {
      RECIPES_TABLE: recipesTable.tableName,
      FAILURES_TABLE: failuresTable.tableName,
      DEPLOY_ENV: deployEnv,
    };

    // ── Lambda: POST /extract ─────────────────────────────────────────────────
    const extractFn = new nodejs.NodejsFunction(this, 'ExtractFn', {
      functionName: `recipator-extract-${deployEnv}`,
      entry: path.join(__dirname, '../lambda/extract/index.ts'),
      handler: 'handler',
      runtime,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        ...commonEnv,
        ANTHROPIC_KEY_PARAM: anthropicKeyParam.parameterName,
      },
      bundling,
    });
    recipesTable.grantWriteData(extractFn);
    extractFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [anthropicKeyParam.parameterArn],
    }));

    // ── Lambda: GET /recipes ──────────────────────────────────────────────────
    const listFn = new nodejs.NodejsFunction(this, 'ListFn', {
      functionName: `recipator-list-${deployEnv}`,
      entry: path.join(__dirname, '../lambda/recipes/list.ts'),
      handler: 'handler',
      runtime,
      environment: commonEnv,
      bundling,
    });
    recipesTable.grantReadData(listFn);

    // ── Lambda: GET /recipes/{id} ─────────────────────────────────────────────
    const getFn = new nodejs.NodejsFunction(this, 'GetFn', {
      functionName: `recipator-get-${deployEnv}`,
      entry: path.join(__dirname, '../lambda/recipes/get.ts'),
      handler: 'handler',
      runtime,
      environment: commonEnv,
      bundling,
    });
    recipesTable.grantReadData(getFn);

    // ── Lambda: DELETE /recipes/{id} ──────────────────────────────────────────
    const deleteFn = new nodejs.NodejsFunction(this, 'DeleteFn', {
      functionName: `recipator-delete-${deployEnv}`,
      entry: path.join(__dirname, '../lambda/recipes/delete.ts'),
      handler: 'handler',
      runtime,
      environment: commonEnv,
      bundling,
    });
    recipesTable.grantWriteData(deleteFn);

    // ── Lambda: POST /failures ────────────────────────────────────────────────
    const reportFailureFn = new nodejs.NodejsFunction(this, 'ReportFailureFn', {
      functionName: `recipator-report-failure-${deployEnv}`,
      entry: path.join(__dirname, '../lambda/failures/report.ts'),
      handler: 'handler',
      runtime,
      environment: commonEnv,
      bundling,
    });
    failuresTable.grantWriteData(reportFailureFn);

    // ── JWT authoriser ────────────────────────────────────────────────────────
    const authorizer = new HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPoolId}`,
      {
        authorizerName: `recipator-cognito-${deployEnv}`,
        identitySource: ['$request.header.Authorization'],
        jwtAudience: [client.userPoolClientId],
      },
    );

    // ── Custom domain ─────────────────────────────────────────────────────────
    const domainName = new apigwv2.DomainName(this, 'ApiDomain', {
      domainName: appDomain,
      certificate,
    });

    // ── HTTP API ──────────────────────────────────────────────────────────────
    const api = new apigwv2.HttpApi(this, 'Api', {
      apiName: `recipator-api-${deployEnv}`,
      defaultAuthorizer: authorizer,
      defaultDomainMapping: { domainName },
      corsPreflight: {
        allowOrigins: [`https://${appDomain}`, 'http://localhost:3000'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    api.addRoutes({ path: '/extract',        methods: [apigwv2.HttpMethod.POST],   integration: new HttpLambdaIntegration('ExtractInt',  extractFn) });
    api.addRoutes({ path: '/recipes',        methods: [apigwv2.HttpMethod.GET],    integration: new HttpLambdaIntegration('ListInt',     listFn) });
    api.addRoutes({ path: '/recipes/{id}',   methods: [apigwv2.HttpMethod.GET],    integration: new HttpLambdaIntegration('GetInt',      getFn) });
    api.addRoutes({ path: '/recipes/{id}',   methods: [apigwv2.HttpMethod.DELETE], integration: new HttpLambdaIntegration('DeleteInt',   deleteFn) });
    api.addRoutes({ path: '/failures',       methods: [apigwv2.HttpMethod.POST],   integration: new HttpLambdaIntegration('FailureInt',  reportFailureFn) });

    // ── Route53 alias → API Gateway custom domain ─────────────────────────────
    new route53.ARecord(this, 'ApiDnsRecord', {
      zone,
      recordName: 'api.recipator',
      target: route53.RecordTarget.fromAlias(
        new route53Targets.ApiGatewayv2DomainProperties(
          domainName.regionalDomainName,
          domainName.regionalHostedZoneId,
        ),
      ),
    });

    new ssm.StringParameter(this, 'ApiUrlParam', {
      parameterName: `/recipator/${deployEnv}/api/url`,
      stringValue: `https://${appDomain}`,
      description: `Recipator API base URL (${deployEnv})`,
    });

    new cdk.CfnOutput(this, 'ApiUrl', { value: `https://${appDomain}` });
    new cdk.CfnOutput(this, 'CognitoClientId', { value: client.userPoolClientId });
  }
}
