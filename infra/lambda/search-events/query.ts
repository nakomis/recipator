// Shared read path for the two search-events read handlers (RECP-21).
//
// Events are partitioned per user with a time-ordered sort key, so a date range is a plain
// SK BETWEEN on each visible owner's partition — no GSI, no scan.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { StoredSearchEvent } from './aggregate';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const SEARCH_EVENTS_TABLE = process.env.SEARCH_EVENTS_TABLE!;

/** Safety valve: stop paginating a single partition well before a runaway read. */
const MAX_PAGES_PER_USER = 20;

export function windowFor(days: number): { fromIso: string; toIso: string } {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

/** Every event for one user within [fromIso, toIso], oldest first. */
async function queryUser(userId: string, fromIso: string, toIso: string): Promise<StoredSearchEvent[]> {
  const out: StoredSearchEvent[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  let pages = 0;

  do {
    const res = await dynamo.send(new QueryCommand({
      TableName: SEARCH_EVENTS_TABLE,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':from': `SEARCH#${fromIso}`,
        // ￿ sorts after any searchId suffix, so the upper bound is inclusive of the
        // whole final second rather than clipping events that share a timestamp.
        ':to': `SEARCH#${toIso}#￿`,
      },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    out.push(...((res.Items ?? []) as StoredSearchEvent[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey && ++pages < MAX_PAGES_PER_USER);

  return out;
}

/** Events for every supplied owner across the window, newest first. */
export async function fetchEvents(userIds: string[], days: number): Promise<StoredSearchEvent[]> {
  const { fromIso, toIso } = windowFor(days);
  const perUser = await Promise.all(userIds.map(id => queryUser(id, fromIso, toIso)));
  return perUser.flat().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
