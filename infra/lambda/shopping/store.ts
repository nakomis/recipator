// DynamoDB access for shopping lists (RECP-37). Single-table, list-aware:
//   PK = USER#{userId}
//   SK = LISTMETA#{listId}            -> list metadata
//   SK = LIST#{listId}#ITEM#{itemId}  -> list item
// v1 operates against an auto-created default list; the schema is list-aware so the
// multi-list UI (a later story) needs no migration.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.SHOPPING_TABLE!;

export const DEFAULT_LIST_ID = 'default';

const pk = (userId: string) => `USER#${userId}`;
const listMetaSk = (listId: string) => `LISTMETA#${listId}`;
const itemSkPrefix = (listId: string) => `LIST#${listId}#ITEM#`;
const itemSk = (listId: string, itemId: string) => `LIST#${listId}#ITEM#${itemId}`;

export interface ShoppingItem {
  itemId: string;
  listId: string;
  raw: string;
  item: string;
  amount: string | null;
  unit: string | null;
  aisle: string;
  checked: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /** How the item was categorised (rules/cache/llm/fallback) — surfaced in the sandbox UI. */
  source: string | null;
}

export interface ShoppingList {
  listId: string;
  name: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: string;
}

/** Create the user's default list if it doesn't exist yet. Idempotent. */
export async function ensureDefaultList(userId: string): Promise<void> {
  const now = new Date().toISOString();
  try {
    await dynamo.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          pk: pk(userId),
          sk: listMetaSk(DEFAULT_LIST_ID),
          listId: DEFAULT_LIST_ID,
          name: 'Shopping',
          isDefault: true,
          sortOrder: 0,
          createdAt: now,
        },
        ConditionExpression: 'attribute_not_exists(sk)',
      }),
    );
  } catch (e) {
    // ConditionalCheckFailed = it already exists; anything else rethrows.
    if ((e as { name?: string }).name !== 'ConditionalCheckFailedException') throw e;
  }
}

export async function listLists(userId: string): Promise<ShoppingList[]> {
  const res = await dynamo.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
      ExpressionAttributeValues: { ':pk': pk(userId), ':p': 'LISTMETA#' },
    }),
  );
  return ((res.Items ?? []) as ShoppingList[])
    .map((l) => ({
      listId: l.listId,
      name: l.name,
      isDefault: !!l.isDefault,
      sortOrder: l.sortOrder ?? 0,
      createdAt: l.createdAt,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function listItems(userId: string, listId: string): Promise<ShoppingItem[]> {
  const res = await dynamo.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
      ExpressionAttributeValues: { ':pk': pk(userId), ':p': itemSkPrefix(listId) },
    }),
  );
  return (res.Items ?? []).map(toItem);
}

export async function putItem(userId: string, item: ShoppingItem): Promise<void> {
  await dynamo.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: pk(userId), sk: itemSk(item.listId, item.itemId), ...item },
    }),
  );
}

export async function getItem(
  userId: string,
  listId: string,
  itemId: string,
): Promise<ShoppingItem | null> {
  const res = await dynamo.send(
    new GetCommand({ TableName: TABLE, Key: { pk: pk(userId), sk: itemSk(listId, itemId) } }),
  );
  return res.Item ? toItem(res.Item) : null;
}

const MUTABLE_FIELDS = ['item', 'amount', 'unit', 'aisle', 'checked', 'sortOrder'] as const;
type MutableField = (typeof MUTABLE_FIELDS)[number];

/** Apply a partial update to an item. Returns the updated item, or null if it doesn't exist. */
export async function updateItem(
  userId: string,
  listId: string,
  itemId: string,
  patch: Partial<Pick<ShoppingItem, MutableField>>,
): Promise<ShoppingItem | null> {
  const sets: string[] = ['#updatedAt = :updatedAt'];
  const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const values: Record<string, unknown> = { ':updatedAt': new Date().toISOString() };

  for (const field of MUTABLE_FIELDS) {
    if (patch[field] !== undefined) {
      sets.push(`#${field} = :${field}`);
      names[`#${field}`] = field;
      values[`:${field}`] = patch[field];
    }
  }

  try {
    const res = await dynamo.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { pk: pk(userId), sk: itemSk(listId, itemId) },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: 'attribute_exists(sk)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    return res.Attributes ? toItem(res.Attributes) : null;
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return null;
    throw e;
  }
}

export async function deleteItem(userId: string, listId: string, itemId: string): Promise<void> {
  await dynamo.send(
    new DeleteCommand({ TableName: TABLE, Key: { pk: pk(userId), sk: itemSk(listId, itemId) } }),
  );
}

/** Delete every ticked item in a list. Returns the number removed. */
export async function clearTicked(userId: string, listId: string): Promise<number> {
  const ticked = (await listItems(userId, listId)).filter((i) => i.checked);
  for (let i = 0; i < ticked.length; i += 25) {
    const batch = ticked.slice(i, i + 25);
    await dynamo.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE]: batch.map((it) => ({
            DeleteRequest: { Key: { pk: pk(userId), sk: itemSk(listId, it.itemId) } },
          })),
        },
      }),
    );
  }
  return ticked.length;
}

function toItem(raw: Record<string, unknown>): ShoppingItem {
  return {
    itemId: raw.itemId as string,
    listId: raw.listId as string,
    raw: (raw.raw as string) ?? '',
    item: (raw.item as string) ?? '',
    amount: (raw.amount as string) ?? null,
    unit: (raw.unit as string) ?? null,
    aisle: (raw.aisle as string) ?? 'other',
    checked: !!raw.checked,
    sortOrder: (raw.sortOrder as number) ?? 0,
    createdAt: (raw.createdAt as string) ?? '',
    updatedAt: (raw.updatedAt as string) ?? '',
    source: (raw.source as string) ?? null,
  };
}
