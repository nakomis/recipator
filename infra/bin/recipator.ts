#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CertStack } from '../lib/cert-stack';
import { DataStack } from '../lib/data-stack';
import { ApiStack } from '../lib/api-stack';
import { GithubCiStack } from '../lib/github-ci-stack';

const npmEnvironment = process.env.NPM_ENVIRONMENT;
if (!npmEnvironment) {
  throw new Error('NPM_ENVIRONMENT is not set. Use `npm run deploy-sandbox` or `npm run deploy-prod`.');
}
if (npmEnvironment !== 'sandbox' && npmEnvironment !== 'prod') {
  throw new Error(`Unknown NPM_ENVIRONMENT "${npmEnvironment}". Must be "sandbox" or "prod".`);
}

const deployEnv = npmEnvironment as 'sandbox' | 'prod';
const isProd = deployEnv === 'prod';

const sandboxAccountId = '975050268859';
const prodAccountId    = '637423226886';
const accountId        = isProd ? prodAccountId : sandboxAccountId;

const londonEnv = { env: { account: accountId, region: 'eu-west-2' } };
const githubOidcProviderArn = `arn:aws:iam::${accountId}:oidc-provider/token.actions.githubusercontent.com`;

const app = new cdk.App();

const certStack = new CertStack(app, 'RecipatorCertStack', {
  ...londonEnv,
  deployEnv,
  description: `ACM certificate for api.recipator.${isProd ? 'nakomis.com' : 'sandbox.nakomis.com'} (${deployEnv})`,
});

const dataStack = new DataStack(app, 'RecipatorDataStack', {
  ...londonEnv,
  deployEnv,
  description: `Recipator DynamoDB tables (${deployEnv})`,
});

const apiStack = new ApiStack(app, 'RecipatorApiStack', {
  ...londonEnv,
  deployEnv,
  recipesTable: dataStack.recipesTable,
  failuresTable: dataStack.failuresTable,
  certificate: certStack.certificate,
  zone: certStack.zone,
  appDomain: certStack.appDomain,
  description: `Recipator API Gateway, Lambda functions, and Cognito client (${deployEnv})`,
});
apiStack.addDependency(certStack);
apiStack.addDependency(dataStack);

new GithubCiStack(app, 'RecipatorGithubCiStack', {
  ...londonEnv,
  deployEnv,
  githubOidcProviderArn,
  description: `GitHub Actions OIDC role for recipator CI (${deployEnv})`,
});

cdk.Tags.of(app).add('MH-Project', 'recipator');
cdk.Tags.of(app).add('MH-Environment', deployEnv);
