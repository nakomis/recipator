import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const RECIPES_TABLE = process.env.RECIPES_TABLE!;

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const userId = event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;
  if (!userId) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorised' }) };

  const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';

  const res = await dynamo.send(new QueryCommand({
    TableName: RECIPES_TABLE,
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: { ':uid': userId },
    // Exclude soft-deleted recipes unless explicitly requested
    ...(includeDeleted ? {} : {
      FilterExpression: 'attribute_not_exists(deletedAt)',
    }),
    ProjectionExpression: 'recipeId, title, #url, savedAt, deletedAt',
    ExpressionAttributeNames: { '#url': 'url' },
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipes: res.Items ?? [] }),
  };
}
