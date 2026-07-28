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
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';
import { Construct } from 'constructs';
import { embedImageTag } from './embed-image-tag';

export interface ApiStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
  recipesTable: dynamodb.ITable;
  failuresTable: dynamodb.ITable;
  shoppingTable: dynamodb.ITable;
  categoryCacheTable: dynamodb.ITable;
  modelsBucket: s3.IBucket;
  avatarsBucket: s3.IBucket;
  certificate: acm.ICertificate;
  zone: route53.IHostedZone;
  appDomain: string;
  webDomain: string;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { deployEnv, recipesTable, failuresTable, shoppingTable, categoryCacheTable, modelsBucket, avatarsBucket, certificate, zone, appDomain, webDomain } = props;

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
      // Explicitly the Cognito default. RECP-58 briefly set sandbox to 5 minutes to make the
      // offline-expiry tests practical; removing that property again does NOT reset the live
      // client (Cognito keeps the last value CloudFormation set, and an absent property is not
      // an instruction to clear it), so the default has to be asserted rather than implied.
      accessTokenValidity: cdk.Duration.hours(1),
      oAuth: {
        flows: { authorizationCodeGrant: true },
        callbackUrls: [
          `com.nakomis.recipator://callback`,
          'http://localhost:3000/callback',
          // Chrome extension (chrome-extension/) — chrome.identity.launchWebAuthFlow
          // redirects to https://<extension-id>.chromiumapp.org/.
          // Dev (unpacked): ID pinned by the "key" in chrome-extension/manifest.json.
          'https://nhndabjfclafpajdlcgbkkepckdaljll.chromiumapp.org/',
          // Published (unlisted Chrome Web Store): store-assigned ID.
          'https://blcjeenbfhceoebinmglcokmbaleclop.chromiumapp.org/',
          // Web SPA (web/) — react-oidc-context auth-code/PKCE.
          `https://${webDomain}/loggedin`,
          'http://localhost:3000/loggedin',
        ],
        logoutUrls: [
          `com.nakomis.recipator://logout`,
          'http://localhost:3000/logout',
          `https://${webDomain}/logout`,
        ],
      },
    });

    // Managed Login v2 requires an explicit branding resource per client.
    // Without it the hosted UI returns "Login pages unavailable".
    // Colour scheme matches nakostat (One Dark palette).
    new cognito.CfnManagedLoginBranding(this, 'ManagedLoginBranding', {
      userPoolId: userPool.userPoolId,
      clientId: client.userPoolClientId,
      useCognitoProvidedValues: false,
      settings: {
        components: {
          // Colours are defined under `darkMode` only — the Managed Login schema has
          // no light-mode colour properties (setting them fails validation with
          // UnknownProperty). To make the page always appear dark regardless of the
          // device's light/dark setting, `categories.global.colorSchemeMode` is set
          // to DARK below, so this palette is used in all conditions.
          pageBackground: {
            image: { enabled: false },
            darkMode: { color: '282c34ff' },
          },
          pageHeader: {
            backgroundImage: { enabled: false },
            logo: { location: 'START', enabled: false },
            darkMode: { background: { color: '21252bff' }, borderColor: '3e4451ff' },
          },
          pageFooter: {
            backgroundImage: { enabled: false },
            logo: { location: 'START', enabled: false },
            darkMode: { background: { color: '21252bff' }, borderColor: '3e4451ff' },
          },
          form: {
            borderRadius: 8,
            backgroundImage: { enabled: false },
            logo: { location: 'CENTER', position: 'TOP', enabled: false, formInclusion: 'IN' },
            darkMode: { backgroundColor: '2c313aff', borderColor: '3e4451ff' },
          },
          pageText: {
            darkMode: { bodyColor: 'abb2bfff', headingColor: 'ffffffff', descriptionColor: '5c6370ff' },
          },
          primaryButton: {
            darkMode: {
              defaults: { backgroundColor: '2563ebff', textColor: 'ffffffff' },
              hover:    { backgroundColor: '1d4ed8ff', textColor: 'ffffffff' },
              active:   { backgroundColor: '1e40afff', textColor: 'ffffffff' },
              disabled: { backgroundColor: '2c313aff', borderColor: '3e4451ff' },
            },
          },
          secondaryButton: {
            darkMode: {
              defaults: { backgroundColor: '2c313aff', borderColor: '3e4451ff', textColor: 'abb2bfff' },
              hover:    { backgroundColor: '353b45ff', borderColor: '528bffff', textColor: 'ffffffff' },
              active:   { backgroundColor: '21252bff', borderColor: '3e4451ff', textColor: 'ffffffff' },
            },
          },
          alert: {
            borderRadius: 4,
            darkMode: { error: { backgroundColor: '3a1515ff', borderColor: 'e06c75ff' } },
          },
          idpButton: {
            standard: {
              darkMode: {
                defaults: { backgroundColor: '2c313aff', borderColor: '3e4451ff', textColor: 'abb2bfff' },
                hover:    { backgroundColor: '353b45ff', borderColor: '528bffff', textColor: 'ffffffff' },
                active:   { backgroundColor: '21252bff', borderColor: '3e4451ff', textColor: 'ffffffff' },
              },
            },
            custom: {},
          },
          phoneNumberSelector: { displayType: 'TEXT' },
          favicon: { enabledTypes: ['ICO', 'SVG'] },
        },
        // Force the dark colour scheme so the login page is dark even when the
        // device is in light mode (mirrors nakostat). Without this the page falls
        // back to Cognito's default light theme and renders white.
        categories: {
          global: {
            colorSchemeMode: 'DARK',
            spacingDensity: 'REGULAR',
          },
        },
      },
    });

    new ssm.StringParameter(this, 'CognitoClientIdParam', {
      parameterName: `/recipator/${deployEnv}/cognito/client-id`,
      stringValue: client.userPoolClientId,
      description: `Recipator Cognito app client ID (${deployEnv})`,
    });

    // ── Group members config ──────────────────────────────────────────────────
    // Managed out-of-band (not by CDK) so group membership can be updated without a deploy.
    const groupMembersParam = ssm.StringParameter.fromStringParameterName(
      this, 'GroupMembersParam', `/recipator/${deployEnv}/group-members`,
    );

    // ── Bedrock model for the Claude extraction fallback ──────────────────────
    // Cross-region inference profile (eu-west-2 → `eu.` prefix). Requires model
    // access to be enabled for Anthropic Claude in the Bedrock console once.
    const bedrockModelId = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';

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

    // Explicit, predictably-named log group per function (so they're easy to find
    // in the console) with 6-month retention. Without this, Lambda auto-creates a
    // `/aws/lambda/<fn>` group that never expires. Retained on prod, torn down on
    // sandbox alongside the function.
    const logRemoval = deployEnv === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;
    const logGroupFor = (id: string, functionName: string) =>
      new logs.LogGroup(this, id, {
        logGroupName: `/aws/lambda/${functionName}`,
        retention: logs.RetentionDays.SIX_MONTHS,
        removalPolicy: logRemoval,
      });

    // ── Lambda: GET /config ───────────────────────────────────────────────────
    const configFn = new nodejs.NodejsFunction(this, 'ConfigFn', {
      functionName: `recipator-config-${deployEnv}`,
      entry: path.join(__dirname, '../lambda/config/get.ts'),
      handler: 'handler',
      runtime,
      environment: {
        ...commonEnv,
        GROUP_MEMBERS_PARAM: groupMembersParam.parameterName,
        AVATARS_BUCKET: avatarsBucket.bucketName,
      },
      bundling,
      logGroup: logGroupFor('ConfigFnLogs', `recipator-config-${deployEnv}`),
    });
    groupMembersParam.grantRead(configFn);
    // Head + presign a download URL for each member's avatar (RECP-51).
    avatarsBucket.grantRead(configFn);

    // ── Lambda: POST /config/avatar (presigned PUT for the caller's own avatar) ──
    const avatarPutFn = new nodejs.NodejsFunction(this, 'AvatarPutFn', {
      functionName: `recipator-avatar-put-${deployEnv}`,
      entry: path.join(__dirname, '../lambda/config/avatar-put.ts'),
      handler: 'handler',
      runtime,
      environment: { ...commonEnv, AVATARS_BUCKET: avatarsBucket.bucketName },
      bundling,
      logGroup: logGroupFor('AvatarPutFnLogs', `recipator-avatar-put-${deployEnv}`),
    });
    avatarsBucket.grantPut(avatarPutFn);

    // ── Lambda: embed (Python container, mxbai) ───────────────────────────────
    // Async enrichment: computes a recipe's semantic-search vector and stores it
    // on the item. Container image bakes in the ~640MB model.
    // The image is built + pushed to the shared nakomis-lambda-images ECR repo by
    // publish-embed-image.sh (idempotent, content-hashed tag), not by `cdk deploy`.
    // We reference it by tag here, so synth/deploy needs no Docker.
    const embedImageRepo = ecr.Repository.fromRepositoryName(
      this, 'EmbedImageRepo', 'nakomis-lambda-images',
    );
    const embedFn = new lambda.DockerImageFunction(this, 'EmbedFn', {
      functionName: `recipator-embed-${deployEnv}`,
      // x86_64 (the Lambda default): the image is built + pushed by CI on x86 runners,
      // so a native amd64 build needs no emulation. The function architecture and the
      // published image platform must agree, or the Lambda fails at invoke with an
      // exec-format error — publish-embed-image.sh builds --platform linux/amd64.
      code: lambda.DockerImageCode.fromEcr(embedImageRepo, { tagOrDigest: embedImageTag() }),
      // 3008 is the account's current Lambda memory ceiling (the pre-2020 default — the
      // 10240 quota hasn't been raised). Ample for a single-recipe embed: the mxbai model
      // is ~1.3GB. Bump this once the Lambda memory quota is increased if more is wanted.
      memorySize: 3008,
      timeout: cdk.Duration.seconds(120),
      environment: { RECIPES_TABLE: recipesTable.tableName, DEPLOY_ENV: deployEnv },
      logGroup: logGroupFor('EmbedFnLogs', `recipator-embed-${deployEnv}`),
    });
    // Read + write: writes the embedding, and reads title/ingredients when invoked with
    // keys only (the backfill path; /extract passes them in the payload).
    recipesTable.grantReadWriteData(embedFn);

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
        BEDROCK_MODEL_ID: bedrockModelId,
        EMBED_FUNCTION_NAME: embedFn.functionName,
      },
      bundling,
      logGroup: logGroupFor('ExtractFnLogs', `recipator-extract-${deployEnv}`),
    });
    recipesTable.grantWriteData(extractFn);
    // Invoke Anthropic models on Bedrock, both directly and via inference profiles
    // (the `eu.` profile fans out to the underlying foundation models in-region).
    extractFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:*::foundation-model/anthropic.*`,
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
      ],
    }));
    embedFn.grantInvoke(extractFn);

    // ── Lambda: GET /recipes ──────────────────────────────────────────────────
    const listFn = new nodejs.NodejsFunction(this, 'ListFn', {
      functionName: `recipator-list-${deployEnv}`,
      entry: path.join(__dirname, '../lambda/recipes/list.ts'),
      handler: 'handler',
      runtime,
      environment: { ...commonEnv, GROUP_MEMBERS_PARAM: groupMembersParam.parameterName },
      bundling,
      logGroup: logGroupFor('ListFnLogs', `recipator-list-${deployEnv}`),
    });
    recipesTable.grantReadData(listFn);
    groupMembersParam.grantRead(listFn);

    // ── Lambda: GET /recipes/{id} ─────────────────────────────────────────────
    const getFn = new nodejs.NodejsFunction(this, 'GetFn', {
      functionName: `recipator-get-${deployEnv}`,
      entry: path.join(__dirname, '../lambda/recipes/get.ts'),
      handler: 'handler',
      runtime,
      environment: commonEnv,
      bundling,
      logGroup: logGroupFor('GetFnLogs', `recipator-get-${deployEnv}`),
    });
    recipesTable.grantReadData(getFn);

    // ── Lambda: PATCH /recipes/{id} ───────────────────────────────────────────
    const updateFn = new nodejs.NodejsFunction(this, 'UpdateFn', {
      functionName: `recipator-update-${deployEnv}`,
      entry: path.join(__dirname, '../lambda/recipes/update.ts'),
      handler: 'handler',
      runtime,
      environment: commonEnv,
      bundling,
      logGroup: logGroupFor('UpdateFnLogs', `recipator-update-${deployEnv}`),
    });
    recipesTable.grantWriteData(updateFn);

    // ── Lambda: DELETE /recipes/{id} ──────────────────────────────────────────
    const deleteFn = new nodejs.NodejsFunction(this, 'DeleteFn', {
      functionName: `recipator-delete-${deployEnv}`,
      entry: path.join(__dirname, '../lambda/recipes/delete.ts'),
      handler: 'handler',
      runtime,
      environment: commonEnv,
      bundling,
      logGroup: logGroupFor('DeleteFnLogs', `recipator-delete-${deployEnv}`),
    });
    recipesTable.grantWriteData(deleteFn);

    // ── Lambda: GET /embeddings ───────────────────────────────────────────────
    const embeddingsFn = new nodejs.NodejsFunction(this, 'EmbeddingsFn', {
      functionName: `recipator-embeddings-${deployEnv}`,
      entry: path.join(__dirname, '../lambda/recipes/embeddings.ts'),
      handler: 'handler',
      runtime,
      environment: { ...commonEnv, GROUP_MEMBERS_PARAM: groupMembersParam.parameterName },
      bundling,
      logGroup: logGroupFor('EmbeddingsFnLogs', `recipator-embeddings-${deployEnv}`),
    });
    recipesTable.grantReadData(embeddingsFn);
    groupMembersParam.grantRead(embeddingsFn);

    // ── Lambda: GET /model (presigned model download) ─────────────────────────
    const modelFn = new nodejs.NodejsFunction(this, 'ModelFn', {
      functionName: `recipator-model-${deployEnv}`,
      entry: path.join(__dirname, '../lambda/model/get.ts'),
      handler: 'handler',
      runtime,
      environment: {
        ...commonEnv,
        MODELS_BUCKET: modelsBucket.bucketName,
        MODEL_MANIFEST_KEY: 'bge-base/v1/manifest.json',
      },
      bundling,
      logGroup: logGroupFor('ModelFnLogs', `recipator-model-${deployEnv}`),
    });
    modelsBucket.grantRead(modelFn);

    // ── Lambda: POST /failures ────────────────────────────────────────────────
    const reportFailureFn = new nodejs.NodejsFunction(this, 'ReportFailureFn', {
      functionName: `recipator-report-failure-${deployEnv}`,
      entry: path.join(__dirname, '../lambda/failures/report.ts'),
      handler: 'handler',
      runtime,
      environment: commonEnv,
      bundling,
      logGroup: logGroupFor('ReportFailureFnLogs', `recipator-report-failure-${deployEnv}`),
    });
    failuresTable.grantWriteData(reportFailureFn);

    // ── Lambda: /shopping/* (single routing handler, RECP-37) ─────────────────
    // One function serves all shopping routes. Adds categorise items via the same
    // Bedrock/Haiku path as /extract, with a deterministic rules lookup + cache so
    // the LLM only fires on the long tail.
    const shoppingFn = new nodejs.NodejsFunction(this, 'ShoppingFn', {
      functionName: `recipator-shopping-${deployEnv}`,
      entry: path.join(__dirname, '../lambda/shopping/index.ts'),
      handler: 'handler',
      runtime,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        ...commonEnv,
        SHOPPING_TABLE: shoppingTable.tableName,
        CATEGORY_CACHE_TABLE: categoryCacheTable.tableName,
        BEDROCK_MODEL_ID: bedrockModelId,
      },
      bundling,
      logGroup: logGroupFor('ShoppingFnLogs', `recipator-shopping-${deployEnv}`),
    });
    shoppingTable.grantReadWriteData(shoppingFn);
    categoryCacheTable.grantReadWriteData(shoppingFn);
    shoppingFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:*::foundation-model/anthropic.*`,
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
      ],
    }));

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
        allowOrigins: [`https://${appDomain}`, `https://${webDomain}`, 'http://localhost:3000'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    api.addRoutes({ path: '/config',         methods: [apigwv2.HttpMethod.GET],    integration: new HttpLambdaIntegration('ConfigInt',   configFn) });
    api.addRoutes({ path: '/config/avatar',  methods: [apigwv2.HttpMethod.POST],   integration: new HttpLambdaIntegration('AvatarPutInt', avatarPutFn) });
    api.addRoutes({ path: '/extract',        methods: [apigwv2.HttpMethod.POST],   integration: new HttpLambdaIntegration('ExtractInt',  extractFn) });
    api.addRoutes({ path: '/recipes',        methods: [apigwv2.HttpMethod.GET],    integration: new HttpLambdaIntegration('ListInt',     listFn) });
    api.addRoutes({ path: '/embeddings',     methods: [apigwv2.HttpMethod.GET],    integration: new HttpLambdaIntegration('EmbeddingsInt', embeddingsFn) });
    api.addRoutes({ path: '/model',          methods: [apigwv2.HttpMethod.GET],    integration: new HttpLambdaIntegration('ModelInt',    modelFn) });
    api.addRoutes({ path: '/recipes/{id}',   methods: [apigwv2.HttpMethod.GET],    integration: new HttpLambdaIntegration('GetInt',      getFn) });
    api.addRoutes({ path: '/recipes/{id}',   methods: [apigwv2.HttpMethod.PATCH],  integration: new HttpLambdaIntegration('UpdateInt',   updateFn) });
    api.addRoutes({ path: '/recipes/{id}',   methods: [apigwv2.HttpMethod.DELETE], integration: new HttpLambdaIntegration('DeleteInt',   deleteFn) });
    api.addRoutes({ path: '/failures',       methods: [apigwv2.HttpMethod.POST],   integration: new HttpLambdaIntegration('FailureInt',  reportFailureFn) });

    // Shopping list (RECP-37) — all routes share the one ShoppingFn integration.
    const shoppingInt = new HttpLambdaIntegration('ShoppingInt', shoppingFn);
    api.addRoutes({ path: '/shopping/lists',         methods: [apigwv2.HttpMethod.GET],    integration: shoppingInt });
    api.addRoutes({ path: '/shopping/items',         methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST], integration: shoppingInt });
    api.addRoutes({ path: '/shopping/items/{itemId}', methods: [apigwv2.HttpMethod.PATCH, apigwv2.HttpMethod.DELETE], integration: shoppingInt });
    api.addRoutes({ path: '/shopping/clear-ticked',  methods: [apigwv2.HttpMethod.POST],   integration: shoppingInt });
    api.addRoutes({ path: '/shopping/clear-all',     methods: [apigwv2.HttpMethod.POST],   integration: shoppingInt });

    // ── Access logging (RECP-58) ──────────────────────────────────────────────
    // The default stage had no access log. When a client wedged itself in a 4xx retry loop, all
    // that survived was a CloudWatch 4xx *count* — no route, no status, no caller — which made a
    // silent sync failure very expensive to diagnose. Log every request with enough to identify
    // the route, the status and the caller.
    const accessLogGroup = new logs.LogGroup(this, 'ApiAccessLogs', {
      logGroupName: `/aws/apigateway/recipator-api-${deployEnv}`,
      retention: logs.RetentionDays.SIX_MONTHS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const defaultStage = api.defaultStage!.node.defaultChild as apigwv2.CfnStage;
    defaultStage.accessLogSettings = {
      destinationArn: accessLogGroup.logGroupArn,
      format: JSON.stringify({
        requestId: '$context.requestId',
        time: '$context.requestTime',
        routeKey: '$context.routeKey',
        method: '$context.httpMethod',
        path: '$context.path',
        status: '$context.status',
        integrationStatus: '$context.integrationStatus',
        integrationError: '$context.integrationErrorMessage',
        authorizerError: '$context.authorizer.error',
        userId: '$context.authorizer.claims.sub',
        userAgent: '$context.identity.userAgent',
        responseLatency: '$context.responseLatency',
      }),
    };

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
