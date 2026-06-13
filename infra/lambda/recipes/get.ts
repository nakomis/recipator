import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const RECIPES_TABLE = process.env.RECIPES_TABLE!;

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const authUserId = event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;
  const recipeId   = event.pathParameters?.id;
  // Allow fetching another user's recipe (e.g. shared household view) by passing ?userId=
  const userId     = event.queryStringParameters?.userId ?? authUserId;

  if (!authUserId) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorised' }) };
  if (!recipeId)   return { statusCode: 400, body: JSON.stringify({ error: 'Missing recipe id' }) };

  const res = await dynamo.send(new GetCommand({
    TableName: RECIPES_TABLE,
    Key: { userId, recipeId },
  }));

  if (!res.Item) return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(res.Item),
  };
}
