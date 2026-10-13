// RECIP-33 — the embed Lambda's unhappy path. Synthesises the real ApiStack (imported
// tables/buckets/zone, no AWS calls) and asserts the async on-failure DLQ, its alarm and
// the SNS wiring.

import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ApiStack } from '../lib/api-stack';

// Synth bundles every Node Lambda with esbuild, which takes a while.
jest.setTimeout(120_000);

function synth(): Template {
  const app = new cdk.App();
  const env = { account: '111111111111', region: 'eu-west-2' };
  const deps = new cdk.Stack(app, 'Deps', { env });
  const table = (name: string) => dynamodb.Table.fromTableName(deps, name, name);
  const bucket = (name: string) => s3.Bucket.fromBucketName(deps, name, name);
  const stack = new ApiStack(app, 'RecipatorApiStack', {
    env,
    deployEnv: 'sandbox',
    recipesTable: table('recipes'),
    recipeVersionsTable: table('versions'),
    failuresTable: table('failures'),
    shoppingTable: table('shopping'),
    categoryCacheTable: table('categories'),
    modelsBucket: bucket('models'),
    avatarsBucket: bucket('avatars'),
    certificate: acm.Certificate.fromCertificateArn(
      deps, 'Cert', 'arn:aws:acm:eu-west-2:111111111111:certificate/test'),
    zone: route53.HostedZone.fromHostedZoneAttributes(deps, 'Zone', {
      hostedZoneId: 'Z123', zoneName: 'sandbox.nakomis.com',
    }),
    appDomain: 'api.recipator.sandbox.nakomis.com',
    webDomain: 'recipator.sandbox.nakomis.com',
  });
  return Template.fromStack(stack);
}

describe('embed Lambda DLQ (RECIP-33)', () => {
  let template: Template;
  beforeAll(() => { template = synth(); });

  const dlqId = () => Object.keys(template.findResources('AWS::SQS::Queue', {
    Properties: { QueueName: 'recipator-embed-dlq-sandbox' },
  }))[0];
  const topicId = () => Object.keys(template.findResources('AWS::SNS::Topic', {
    Properties: { TopicName: 'recipator-alerts-sandbox' },
  }))[0];

  it('creates the DLQ with 14-day retention', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'recipator-embed-dlq-sandbox',
      MessageRetentionPeriod: 14 * 24 * 60 * 60,
      SqsManagedSseEnabled: true,
    });
    expect(dlqId()).toBeDefined();
  });

  it('sends failed async invocations of the embed Lambda to the DLQ', () => {
    const embedFnId = Object.keys(template.findResources('AWS::Lambda::Function', {
      Properties: { FunctionName: 'recipator-embed-sandbox' },
    }))[0];
    expect(embedFnId).toBeDefined();

    template.hasResourceProperties('AWS::Lambda::EventInvokeConfig', {
      FunctionName: { Ref: embedFnId },
      Qualifier: '$LATEST',
      MaximumRetryAttempts: 2,
      MaximumEventAgeInSeconds: 6 * 60 * 60,
      DestinationConfig: {
        OnFailure: { Destination: { 'Fn::GetAtt': [dlqId(), 'Arn'] } },
      },
    });
  });

  it('lets the embed Lambda role send to the DLQ', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['sqs:SendMessage']),
            Resource: { 'Fn::GetAtt': [dlqId(), 'Arn'] },
          }),
        ]),
      },
      Roles: [{ Ref: Match.stringLikeRegexp('^EmbedFnServiceRole') }],
    });
  });

  it('alarms to the alerts topic as soon as a message is visible', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'recipator-embed-dlq-not-empty-sandbox',
      Namespace: 'AWS/SQS',
      MetricName: 'ApproximateNumberOfMessagesVisible',
      Dimensions: [{ Name: 'QueueName', Value: { 'Fn::GetAtt': [dlqId(), 'QueueName'] } }],
      ComparisonOperator: 'GreaterThanThreshold',
      Threshold: 0,
      EvaluationPeriods: 1,
      TreatMissingData: 'notBreaching',
      AlarmActions: [{ Ref: topicId() }],
      OKActions: [{ Ref: topicId() }],
    });
  });

  it('subscribes the AlertEmail parameter to the topic only when it is set', () => {
    template.hasParameter('AlertEmail', { Type: 'String', Default: '' });
    template.hasCondition('HasAlertEmail', {
      'Fn::Not': [{ 'Fn::Equals': [{ Ref: 'AlertEmail' }, ''] }],
    });
    template.hasResource('AWS::SNS::Subscription', {
      Condition: 'HasAlertEmail',
      Properties: { Protocol: 'email', Endpoint: { Ref: 'AlertEmail' }, TopicArn: { Ref: topicId() } },
    });
  });
});
