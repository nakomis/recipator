import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { log } from '../shared/logger';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const RECIPES_TABLE = process.env.RECIPES_TABLE!;

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const userId   = event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;
  const recipeId = event.pathParameters?.id;

  if (!userId)   { log.warn('recipes:update_unauthorised'); return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorised' }) }; }
  if (!recipeId) return { statusCode: 400, body: JSON.stringify({ error: 'Missing recipe id' }) };

  const body = JSON.parse(event.body ?? '{}') as { imageUrl?: string };
  if (!body.imageUrl) return { statusCode: 400, body: JSON.stringify({ error: 'imageUrl is required' }) };

  try {
    await dynamo.send(new UpdateCommand({
      TableName: RECIPES_TABLE,
      Key: { userId, recipeId },
      UpdateExpression: 'SET imageUrl = :imageUrl',
      ExpressionAttributeValues: { ':imageUrl': body.imageUrl },
      ConditionExpression: 'attribute_exists(recipeId)',
    }));
  } catch (e: any) {
    if (e.name === 'ConditionalCheckFailedException') {
      log.info('recipes:update_not_found', { recipeId, userId });
      return { statusCode: 404, body: JSON.stringify({ error: 'Recipe not found' }) };
    }
    log.error('recipes:update_failed', { recipeId, userId, error: String(e) });
    throw e;
  }

  log.info('recipes:update', { recipeId, userId, field: 'imageUrl' });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  };
}
