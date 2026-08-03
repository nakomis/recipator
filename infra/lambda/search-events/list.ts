// GET /search-events?days=30&limit=100&userId=... (RECP-21) — raw event log for the dashboard.
//
// Household-scoped like the stats endpoint. `userId` narrows to a single member and is
// rejected if it falls outside the caller's visible set, so the filter can't be used to read
// another household's searches.
import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { visibleOwnerIds } from '../shared/group';
import { fetchEvents } from './query';
import { log } from '../shared/logger';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function clamp(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : fallback;
}

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const userId = event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;
  if (!userId) { log.warn('search-list:unauthorised'); return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorised' }) }; }

  const params = event.queryStringParameters ?? {};
  const days = clamp(params.days, DEFAULT_DAYS, MAX_DAYS);
  const limit = clamp(params.limit, DEFAULT_LIMIT, MAX_LIMIT);

  const visible = await visibleOwnerIds(userId);
  let owners = [...visible];

  if (params.userId) {
    if (!visible.has(params.userId)) {
      log.warn('search-list:forbidden-filter', { userId, requested: params.userId });
      return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted to view that user' }) };
    }
    owners = [params.userId];
  }

  const events = await fetchEvents(owners, days);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      events: events.slice(0, limit),
      total: events.length,
      truncated: events.length > limit,
    }),
  };
}
