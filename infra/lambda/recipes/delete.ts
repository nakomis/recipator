import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const RECIPES_TABLE = process.env.RECIPES_TABLE!;

// 6 months in seconds
const SIX_MONTHS_S = 60 * 60 * 24 * 30 * 6;

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const userId   = event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;
  const recipeId = event.pathParameters?.id;

  if (!userId)   return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorised' }) };
  if (!recipeId) return { statusCode: 400, body: JSON.stringify({ error: 'Missing recipe id' }) };

  const now    = new Date();
  const ttl    = Math.floor(now.getTime() / 1000) + SIX_MONTHS_S;

  // Soft delete: set deletedAt + ttl. DynamoDB TTL hard-deletes the item after 6 months.
  await dynamo.send(new UpdateCommand({
    TableName: RECIPES_TABLE,
    Key: { userId, recipeId },
    UpdateExpression: 'SET deletedAt = :da, #ttl = :ttl',
    ExpressionAttributeNames: { '#ttl': 'ttl' },
    ExpressionAttributeValues: {
      ':da':  now.toISOString(),
      ':ttl': ttl,
    },
    ConditionExpression: 'attribute_exists(recipeId)',
  }));

  return { statusCode: 204, body: '' };
}
