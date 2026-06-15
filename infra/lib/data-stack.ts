import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface DataStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
}

export class DataStack extends cdk.Stack {
  readonly recipesTable: dynamodb.Table;
  readonly failuresTable: dynamodb.Table;
  readonly modelsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { deployEnv } = props;
    const isProd = deployEnv === 'prod';
    const removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // recipes: userId (PK) + recipeId (SK)
    // deletedAt is set on soft-delete; TTL deletes the item 6 months later.
    this.recipesTable = new dynamodb.Table(this, 'RecipesTable', {
      tableName: `recipator-recipes-${deployEnv}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'recipeId', type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
      timeToLiveAttribute: 'ttl',
    });

    // capture_failures: failureId (PK). Martin triages these to improve parsers.
    this.failuresTable = new dynamodb.Table(this, 'FailuresTable', {
      tableName: `recipator-failures-${deployEnv}`,
      partitionKey: { name: 'failureId', type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });

    // models: hosts the on-device embedding model (bge-base) downloaded by the app on
    // first launch via a presigned URL. Private; objects keyed by version, e.g.
    // bge-base/v1/model.mlpackage.zip plus bge-base/v1/manifest.json.
    this.modelsBucket = new s3.Bucket(this, 'ModelsBucket', {
      bucketName: `recipator-models-${deployEnv}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: !isProd,
    });

    new cdk.CfnOutput(this, 'RecipesTableName', { value: this.recipesTable.tableName });
    new cdk.CfnOutput(this, 'FailuresTableName', { value: this.failuresTable.tableName });
    new cdk.CfnOutput(this, 'ModelsBucketName', { value: this.modelsBucket.bucketName });
  }
}
