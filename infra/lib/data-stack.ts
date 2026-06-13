import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface DataStackProps extends cdk.StackProps {
  deployEnv: 'sandbox' | 'prod';
}

export class DataStack extends cdk.Stack {
  readonly recipesTable: dynamodb.Table;
  readonly failuresTable: dynamodb.Table;

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

    new cdk.CfnOutput(this, 'RecipesTableName', { value: this.recipesTable.tableName });
    new cdk.CfnOutput(this, 'FailuresTableName', { value: this.failuresTable.tableName });
  }
}
