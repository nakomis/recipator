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
  readonly avatarsBucket: s3.Bucket;
  readonly shoppingTable: dynamodb.Table;
  readonly categoryCacheTable: dynamodb.Table;
  readonly searchEventsTable: dynamodb.Table;

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

    // member avatars (RECP-51): per-member profile pictures shown across household views.
    // Private; objects keyed by user, avatars/{userId}.jpg. GET /config presigns a download
    // URL per member; POST /config/avatar issues a presigned PUT for the caller's own avatar.
    this.avatarsBucket = new s3.Bucket(this, 'AvatarsBucket', {
      bucketName: `recipator-avatars-${deployEnv}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: !isProd,
    });

    // shopping lists (RECP-37): single-table, list-aware from day one.
    //   PK = USER#{userId}
    //   SK = LISTMETA#{listId}            -> list metadata {name, isDefault, sortOrder}
    //   SK = LIST#{listId}#ITEM#{itemId}  -> list item {raw, item, amount, unit, aisle, checked, sortOrder}
    // Query a user's lists: SK begins_with LISTMETA#. A list's items: SK begins_with LIST#{listId}#ITEM#.
    // No TTL — ticked items are cleared explicitly. PAY_PER_REQUEST (pennies at household scale).
    this.shoppingTable = new dynamodb.Table(this, 'ShoppingTable', {
      tableName: `recipator-shopping-${deployEnv}`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });

    // category cache (RECP-35): caches LLM categorisation keyed on the normalised item
    // text, shared across all users (categorisation is user-independent), so the long-tail
    // Haiku call fires at most once per novel item ever. PK = key.
    this.categoryCacheTable = new dynamodb.Table(this, 'CategoryCacheTable', {
      tableName: `recipator-category-cache-${deployEnv}`,
      partitionKey: { name: 'key', type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });

    // search events (RECP-21): implicit relevance feedback for search scoring.
    //   PK = USER#{userId}
    //   SK = SEARCH#{isoTs}#{searchId}
    // One item per search, written when the query settles and updated in place if the user
    // taps a result — so an abandoned search is simply an item with no selection attributes,
    // and counts as reciprocal rank 0 rather than vanishing from the denominator.
    //
    // Each item carries the selected recipe's rank in all three rankings (keyword-only,
    // semantic-only, merged hybrid). Search always runs both strategies, so every real search
    // scores all three counterfactually — no A/B split, no degraded results for anyone.
    //
    // The timestamp is in the SK so a date-range query is a plain SK range on the user's
    // partition; at household volume that beats carrying a GSI. TTL expires raw query text
    // (personal data) after RETENTION_DAYS.
    this.searchEventsTable = new dynamodb.Table(this, 'SearchEventsTable', {
      tableName: `recipator-search-events-${deployEnv}`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
      timeToLiveAttribute: 'ttl',
    });

    new cdk.CfnOutput(this, 'RecipesTableName', { value: this.recipesTable.tableName });
    new cdk.CfnOutput(this, 'FailuresTableName', { value: this.failuresTable.tableName });
    new cdk.CfnOutput(this, 'ModelsBucketName', { value: this.modelsBucket.bucketName });
    new cdk.CfnOutput(this, 'AvatarsBucketName', { value: this.avatarsBucket.bucketName });
    new cdk.CfnOutput(this, 'ShoppingTableName', { value: this.shoppingTable.tableName });
    new cdk.CfnOutput(this, 'CategoryCacheTableName', { value: this.categoryCacheTable.tableName });
    new cdk.CfnOutput(this, 'SearchEventsTableName', { value: this.searchEventsTable.tableName });
  }
}
