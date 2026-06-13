import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const FAILURES_TABLE = process.env.FAILURES_TABLE!;

interface FailureReport {
  url: string;
  errorType: 'wrong_data' | 'no_recipe' | 'parse_error';
  htmlSnippet?: string;
  userAgent?: string;
}

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const userId = event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;
  if (!userId) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorised' }) };

  const body = JSON.parse(event.body ?? '{}') as FailureReport;
  if (!body.url || !body.errorType) {
    return { statusCode: 400, body: JSON.stringify({ error: 'url and errorType are required' }) };
  }

  const item = {
    failureId:   randomUUID(),
    userId,
    url:         body.url,
    hostname:    new URL(body.url).hostname,
    errorType:   body.errorType,
    htmlSnippet: body.htmlSnippet?.slice(0, 5000) ?? '',
    userAgent:   body.userAgent ?? '',
    reportedAt:  new Date().toISOString(),
    resolved:    false,
  };

  await dynamo.send(new PutCommand({ TableName: FAILURES_TABLE, Item: item }));

  return {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ failureId: item.failureId }),
  };
}
