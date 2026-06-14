import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface GithubCiStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
  githubOidcProviderArn: string;
}

export class GithubCiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GithubCiStackProps) {
    super(scope, id, props);

    const { deployEnv, githubOidcProviderArn } = props;

    const githubOidc = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this, 'GithubOidc', githubOidcProviderArn,
    );

    const role = new iam.Role(this, 'RecipatorCiRole', {
      roleName: `nakomis-recipator-github-ci-${deployEnv}`,
      assumedBy: new iam.WebIdentityPrincipal(
        githubOidc.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': 'repo:nakomis/recipator:*',
          },
        },
      ),
      description: `Assumed by recipator GitHub Actions CI (${deployEnv})`,
      inlinePolicies: {
        CdkDeploy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['sts:AssumeRole'],
              resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`],
            }),
          ],
        }),
        // The deploy job runs publish-embed-image.sh, which builds + pushes the embed
        // container image to the shared nakomis-lambda-images repo directly as this role
        // (not via the CDK bootstrap image-publishing role, since we no longer use
        // fromImageAsset).
        //
        // These push/describe actions MUST be granted here, on the role's identity — NOT
        // by the repo's resource policy. Same-account ECR access is not granted by a
        // repository policy alone (that's the cross-account mechanism, and is why the
        // Lambda *service* pull works via the repo policy but an in-account IAM role's
        // push does not). GetAuthorizationToken is account-global so it's on "*".
        EcrPublish: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['ecr:GetAuthorizationToken'],
              resources: ['*'],
            }),
            new iam.PolicyStatement({
              actions: [
                'ecr:DescribeImages',
                'ecr:BatchCheckLayerAvailability',
                'ecr:InitiateLayerUpload',
                'ecr:UploadLayerPart',
                'ecr:CompleteLayerUpload',
                'ecr:PutImage',
              ],
              resources: [
                `arn:aws:ecr:${this.region}:${this.account}:repository/nakomis-lambda-images`,
              ],
            }),
          ],
        }),
      },
    });

    new cdk.CfnOutput(this, 'CiRoleArn', {
      value: role.roleArn,
      description: `IAM role for recipator GitHub Actions CI (${deployEnv})`,
    });
  }
}
