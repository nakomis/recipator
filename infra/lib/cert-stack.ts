import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';

export interface CertStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
}

// Hosted zone IDs shared across all nakomis projects.
const HOSTED_ZONES = {
  sandbox: { hostedZoneId: 'Z03586633NXU18LFL0JTL', zoneName: 'sandbox.nakomis.com' },
  prod:    { hostedZoneId: 'Z019437529YGFB53BDUGR', zoneName: 'nakomis.com' },
};

export class CertStack extends cdk.Stack {
  readonly certificate: acm.Certificate;
  readonly zone: route53.IHostedZone;
  readonly appDomain: string;
  readonly webDomain: string;

  constructor(scope: Construct, id: string, props: CertStackProps) {
    super(scope, id, props);

    const { deployEnv } = props;
    const { hostedZoneId, zoneName } = HOSTED_ZONES[deployEnv];

    // api.recipator.{zoneName} — the web SPA lives at the bare recipator.{zoneName}.
    this.appDomain = `api.recipator.${zoneName}`;
    this.webDomain = `recipator.${zoneName}`;

    this.zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId,
      zoneName,
    });

    // API Gateway regional custom domains need a cert in the same region (eu-west-2).
    // No us-east-1 cert needed here — that is only required when fronting with CloudFront.
    this.certificate = new acm.Certificate(this, 'Cert', {
      domainName: this.appDomain,
      validation: acm.CertificateValidation.fromDns(this.zone),
    });

    new cdk.CfnOutput(this, 'AppDomain', { value: this.appDomain });
  }
}
