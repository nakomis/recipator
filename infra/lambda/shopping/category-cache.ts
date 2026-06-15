// DynamoDB-backed categorisation cache (RECP-35), keyed on the normalised item text.
// Shared across all users — categorisation is user-independent — so a novel item costs
// at most one Haiku call ever. Plugs into categorise() as cacheGet/cachePut.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.CATEGORY_CACHE_TABLE!;

export async function cacheGet(key: string): Promise<{ aisle: string; item: string } | null> {
  const res = await dynamo.send(new GetCommand({ TableName: TABLE, Key: { key } }));
  if (!res.Item) return null;
  return { aisle: res.Item.aisle as string, item: res.Item.item as string };
}

export async function cachePut(key: string, value: { aisle: string; item: string }): Promise<void> {
  await dynamo.send(
    new PutCommand({
      TableName: TABLE,
      Item: { key, aisle: value.aisle, item: value.item, updatedAt: new Date().toISOString() },
    }),
  );
}
