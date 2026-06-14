import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const RECIPES_TABLE = process.env.RECIPES_TABLE!;

// Returns recipe embeddings for syncing into the on-device store.
// embedding is a DynamoDB Binary (1024 float32 LE) returned here as base64.
// ?all=true scans the household; ?since=<iso> returns only those embedded since.
export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const userId = event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;
  if (!userId) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorised' }) };

  const all   = event.queryStringParameters?.all === 'true';
  const since = event.queryStringParameters?.since;

  // Only items that actually have an embedding, not soft-deleted.
  const filters = ['attribute_exists(embedding)', 'attribute_not_exists(deletedAt)'];
  const values: Record<string, unknown> = {};
  if (since) { filters.push('embeddedAt > :since'); values[':since'] = since; }
  const projection = 'recipeId, userId, embedding, embeddingModel, embeddedAt';

  let items: Record<string, unknown>[];
  if (all) {
    const res = await dynamo.send(new ScanCommand({
      TableName: RECIPES_TABLE,
      FilterExpression: filters.join(' AND '),
      ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
      ProjectionExpression: projection,
    }));
    items = (res.Items ?? []) as Record<string, unknown>[];
  } else {
    const res = await dynamo.send(new QueryCommand({
      TableName: RECIPES_TABLE,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId, ...values },
      FilterExpression: filters.join(' AND '),
      ProjectionExpression: projection,
    }));
    items = (res.Items ?? []) as Record<string, unknown>[];
  }

  const embeddings = items.map(it => ({
    recipeId: it.recipeId as string,
    userId: it.userId as string,
    model: it.embeddingModel as string,
    embeddedAt: it.embeddedAt as string,
    // lib-dynamodb unmarshalls Binary to Uint8Array
    embedding: Buffer.from(it.embedding as Uint8Array).toString('base64'),
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeddings }),
  };
}
