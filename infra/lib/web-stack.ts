import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface WebStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
  certificate: acm.ICertificate; // us-east-1 cert from WebCertStack
}

// Hosted zone IDs shared across all nakomis projects (matches cert-stack.ts).
const HOSTED_ZONES = {
  sandbox: { hostedZoneId: 'Z03586633NXU18LFL0JTL', zoneName: 'sandbox.nakomis.com' },
  prod:    { hostedZoneId: 'Z019437529YGFB53BDUGR', zoneName: 'nakomis.com' },
};

/**
 * CloudFront + S3 hosting for the Recipator web SPA at recipator.{zone}.
 *
 * The SPA bundle is uploaded by CI (`aws s3 sync` + invalidation), not by a CDK
 * BucketDeployment — the bucket name and distribution id are published to SSM for
 * the CI job to read. The Cognito app client is reused from ApiStack (the SPA's
 * callback/logout URLs are added there), so this stack provisions no auth.
 */
export class WebStack extends cdk.Stack {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    const { deployEnv, certificate } = props;
    const isProd = deployEnv === 'prod';
    const removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;
    const { hostedZoneId, zoneName } = HOSTED_ZONES[deployEnv];
    const webDomain = `recipator.${zoneName}`;

    this.bucket = new s3.Bucket(this, 'SpaBucket', {
      bucketName: `recipator-web-${this.account}-${deployEnv}`,
      removalPolicy,
      autoDeleteObjects: !isProd,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const oac = new cloudfront.S3OriginAccessControl(this, 'OAC', {
      originAccessControlName: `recipator-${deployEnv}`,
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket, { originAccessControl: oac }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      // SPA client-side routing: serve index.html for any unknown path so deep
      // links (e.g. /recipes/{id}) resolve to the app rather than an S3 404/403.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
      domainNames: [webDomain],
      certificate,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId,
      zoneName,
    });

    new route53.ARecord(this, 'WebAliasA', {
      recordName: webDomain,
      zone,
      target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(this.distribution)),
    });

    new route53.AaaaRecord(this, 'WebAliasAaaa', {
      recordName: webDomain,
      zone,
      target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(this.distribution)),
    });

    // Consumed by CI to sync the build output and invalidate the cache.
    new ssm.StringParameter(this, 'BucketNameParam', {
      parameterName: `/recipator/${deployEnv}/web/bucket-name`,
      stringValue: this.bucket.bucketName,
      description: `Recipator web S3 bucket name (${deployEnv})`,
    });

    new ssm.StringParameter(this, 'DistributionIdParam', {
      parameterName: `/recipator/${deployEnv}/web/distribution-id`,
      stringValue: this.distribution.distributionId,
      description: `Recipator CloudFront distribution ID (${deployEnv})`,
    });

    new cdk.CfnOutput(this, 'WebDomain', { value: `https://${webDomain}` });
    new cdk.CfnOutput(this, 'DistributionDomainName', { value: this.distribution.domainName });
    new cdk.CfnOutput(this, 'BucketName', { value: this.bucket.bucketName });
  }
}
