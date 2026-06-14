import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { log } from '../shared/logger';
import { visibleOwnerIds } from '../shared/group';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const RECIPES_TABLE = process.env.RECIPES_TABLE!;

// Search-index sync: returns each recipe's text (title/ingredients/method) for the
// on-device FTS index, plus its embedding vector (base64 float32 LE) when one exists.
// Text is returned even before a vector is computed, so keyword search works
// immediately and semantic search fills in as embeddings land. ?all=true scans
// the household. Full sync (no incremental cursor) — fine at household scale.
export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const userId = event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;
  if (!userId) { log.warn('embeddings:unauthorised'); return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorised' }) }; }

  const all = event.queryStringParameters?.all === 'true';
  // Alias every projected attribute via ExpressionAttributeNames — `method` is a DynamoDB
  // reserved keyword (others may be added later), and a bare name fails the whole query.
  const attrs = ['recipeId', 'userId', 'title', 'ingredients', 'method', 'embedding', 'embeddingModel', 'embeddedAt'];
  const names = Object.fromEntries(attrs.map(a => [`#${a}`, a]));
  const projection = attrs.map(a => `#${a}`).join(', ');
  const notDeleted = 'attribute_not_exists(deletedAt)';

  let items: Record<string, unknown>[];
  if (all) {
    const res = await dynamo.send(new ScanCommand({
      TableName: RECIPES_TABLE,
      FilterExpression: notDeleted,
      ProjectionExpression: projection,
      ExpressionAttributeNames: names,
    }));
    // Scope the household search index to the caller's group, matching GET /recipes?all.
    const allowed = await visibleOwnerIds(userId);
    items = ((res.Items ?? []) as Record<string, unknown>[])
      .filter(it => allowed.has(it.userId as string));
  } else {
    const res = await dynamo.send(new QueryCommand({
      TableName: RECIPES_TABLE,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      FilterExpression: notDeleted,
      ProjectionExpression: projection,
      ExpressionAttributeNames: names,
    }));
    items = (res.Items ?? []) as Record<string, unknown>[];
  }

  const rows = items.map(it => {
    const emb = it.embedding as Uint8Array | undefined;
    return {
      recipeId: it.recipeId as string,
      userId: it.userId as string,
      title: (it.title as string) ?? '',
      ingredients: (it.ingredients as string[]) ?? [],
      method: (it.method as string[]) ?? [],
      model: (it.embeddingModel as string) ?? null,
      embeddedAt: (it.embeddedAt as string) ?? null,
      // lib-dynamodb unmarshalls Binary to Uint8Array; null until embedded.
      embedding: emb ? Buffer.from(emb).toString('base64') : null,
    };
  });

  const embedded = rows.filter(r => r.embedding !== null).length;
  log.info('embeddings:sync', { userId, scope: all ? 'all' : 'own', count: rows.length, embedded });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: rows }),
  };
}
