import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { log } from '../shared/logger';
import { visibleOwnerIds } from '../shared/group';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const RECIPES_TABLE = process.env.RECIPES_TABLE!;

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const userId         = event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;
  if (!userId) { log.warn('recipes:list_unauthorised'); return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorised' }) }; }

  const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';
  const all            = event.queryStringParameters?.all === 'true';

  const notDeleted = 'attribute_not_exists(deletedAt)';

  let items: Record<string, unknown>[];

  if (all) {
    // Scan the full table — fine at household scale (2 users, hundreds of recipes).
    const res = await dynamo.send(new ScanCommand({
      TableName: RECIPES_TABLE,
      ...(includeDeleted ? {} : {
        FilterExpression: notDeleted,
      }),
      ProjectionExpression: 'recipeId, userId, userEmail, title, #url, savedAt, deletedAt, imageUrl',
      ExpressionAttributeNames: { '#url': 'url' },
    }));
    // Scope the household view to the caller's group — keeps non-members' recipes
    // (e.g. the App Store review account) out of a member's list, and vice versa.
    const allowed = await visibleOwnerIds(userId);
    items = ((res.Items ?? []) as Record<string, unknown>[])
      .filter(it => allowed.has(it.userId as string));
  } else {
    const res = await dynamo.send(new QueryCommand({
      TableName: RECIPES_TABLE,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      ...(includeDeleted ? {} : {
        FilterExpression: notDeleted,
      }),
      ProjectionExpression: 'recipeId, userId, userEmail, title, #url, savedAt, deletedAt, imageUrl',
      ExpressionAttributeNames: { '#url': 'url' },
    }));
    items = (res.Items ?? []) as Record<string, unknown>[];
  }

  // Sort by savedAt descending (newest first).
  items.sort((a, b) => ((b.savedAt as string) ?? '').localeCompare((a.savedAt as string) ?? ''));

  log.info('recipes:list', { userId, scope: all ? 'all' : 'own', includeDeleted, count: items.length });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipes: items }),
  };
}
