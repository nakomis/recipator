// POST /search-events (RECP-21) — batch ingest of search and selection events.
//
// One DynamoDB item per search. The search event creates it; the selection event updates it
// in place, so an abandoned search is simply an item with no selection attributes and scores
// reciprocal rank 0 rather than disappearing from the denominator.
//
// The client generates searchId and sends the search's own timestamp back on the selection
// event, so the sort key is reconstructible without a lookup.
import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { log } from '../shared/logger';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const SEARCH_EVENTS_TABLE = process.env.SEARCH_EVENTS_TABLE!;
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? '90');

const MAX_EVENTS_PER_BATCH = 100;
const MAX_QUERY_LENGTH = 500;

interface SearchEventBody {
  type: 'search';
  searchId: string;
  at: string;
  query: string;
  resultCount: number;
  keywordCount: number;
  semanticCount: number;
  semanticAvailable: boolean;
  latencyMs: number;
  keywordMs: number;
  semanticMs: number;
  modelVersion?: string;
  appVersion?: string;
}

interface SelectionEventBody {
  type: 'selection';
  searchId: string;
  /** The parent search's `at` — needed to rebuild the sort key. */
  searchAt: string;
  selectedRecipeId: string;
  selectedAt: string;
  msToSelect: number;
  hybridRank: number | null;
  keywordRank: number | null;
  semanticRank: number | null;
}

type ClientEvent = SearchEventBody | SelectionEventBody;

const keyFor = (userId: string, at: string, searchId: string) => ({
  pk: `USER#${userId}`,
  sk: `SEARCH#${at}#${searchId}`,
});

/** Coerce to a finite non-negative number, else 0 — never let a bad client value poison stats. */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
}

/** 1-based rank, or null when the strategy did not return the selected recipe. */
function rank(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
}

function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

async function recordSearch(userId: string, ev: SearchEventBody): Promise<'written' | 'duplicate'> {
  const query = String(ev.query ?? '').slice(0, MAX_QUERY_LENGTH);
  const item = {
    ...keyFor(userId, ev.at, ev.searchId),
    searchId: ev.searchId,
    userId,
    at: ev.at,
    query,
    queryLength: query.length,
    resultCount: num(ev.resultCount),
    keywordCount: num(ev.keywordCount),
    semanticCount: num(ev.semanticCount),
    semanticAvailable: ev.semanticAvailable === true,
    latencyMs: num(ev.latencyMs),
    keywordMs: num(ev.keywordMs),
    semanticMs: num(ev.semanticMs),
    modelVersion: ev.modelVersion ?? '',
    appVersion: ev.appVersion ?? '',
    ttl: Math.floor(Date.parse(ev.at) / 1000) + RETENTION_DAYS * 24 * 60 * 60,
  };

  try {
    // attribute_not_exists guards the retry path: the client queues events and re-flushes on
    // failure, and a naive Put would clobber a selection that had already been applied.
    await dynamo.send(new PutCommand({
      TableName: SEARCH_EVENTS_TABLE,
      Item: item,
      ConditionExpression: 'attribute_not_exists(pk)',
    }));
    return 'written';
  } catch (err) {
    if ((err as Error).name === 'ConditionalCheckFailedException') return 'duplicate';
    throw err;
  }
}

async function recordSelection(userId: string, ev: SelectionEventBody): Promise<'written' | 'orphaned'> {
  try {
    await dynamo.send(new UpdateCommand({
      TableName: SEARCH_EVENTS_TABLE,
      Key: keyFor(userId, ev.searchAt, ev.searchId),
      UpdateExpression:
        'SET selectedRecipeId = :rid, selectedAt = :sat, msToSelect = :mts, ' +
        'hybridRank = :hr, keywordRank = :kr, semanticRank = :sr',
      ExpressionAttributeValues: {
        ':rid': String(ev.selectedRecipeId),
        ':sat': ev.selectedAt,
        ':mts': num(ev.msToSelect),
        ':hr': rank(ev.hybridRank),
        ':kr': rank(ev.keywordRank),
        ':sr': rank(ev.semanticRank),
      },
      // Never conjure a headless item from a selection whose search event was lost.
      ConditionExpression: 'attribute_exists(pk)',
    }));
    return 'written';
  } catch (err) {
    if ((err as Error).name === 'ConditionalCheckFailedException') return 'orphaned';
    throw err;
  }
}

function isValid(ev: ClientEvent): boolean {
  if (!ev || typeof ev !== 'object' || typeof ev.searchId !== 'string' || !ev.searchId) return false;
  if (ev.type === 'search') return isIsoDate(ev.at);
  if (ev.type === 'selection') {
    return isIsoDate(ev.searchAt) && isIsoDate(ev.selectedAt) && typeof ev.selectedRecipeId === 'string';
  }
  return false;
}

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const userId = event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;
  if (!userId) { log.warn('search-events:unauthorised'); return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorised' }) }; }

  const body = JSON.parse(event.body ?? '{}') as { events?: ClientEvent[] };
  const events = Array.isArray(body.events) ? body.events : [];
  if (!events.length) return { statusCode: 400, body: JSON.stringify({ error: 'events[] is required' }) };
  if (events.length > MAX_EVENTS_PER_BATCH) {
    return { statusCode: 400, body: JSON.stringify({ error: `at most ${MAX_EVENTS_PER_BATCH} events per batch` }) };
  }

  const counts = { written: 0, duplicate: 0, orphaned: 0, invalid: 0, failed: 0 };

  // Per-event isolation: one malformed event must not fail the batch, or the client requeues
  // the whole flush and the bad event blocks the queue forever.
  for (const ev of events) {
    if (!isValid(ev)) { counts.invalid++; continue; }
    try {
      const outcome = ev.type === 'search'
        ? await recordSearch(userId, ev)
        : await recordSelection(userId, ev);
      counts[outcome]++;
    } catch (err) {
      counts.failed++;
      log.error('search-events:write-failed', {
        searchId: ev.searchId, type: ev.type, error: (err as Error).message,
      });
    }
  }

  if (counts.orphaned || counts.invalid || counts.failed) {
    log.warn('search-events:partial', { userId, ...counts });
  } else {
    log.info('search-events:recorded', { userId, ...counts });
  }

  // 202: accepted for processing. Anything the client should stop retrying is already
  // reflected in the counts rather than as a status code.
  return {
    statusCode: 202,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(counts),
  };
}
