// GET /search-events/stats?days=30 (RECP-21) — search scoring for the dashboard.
//
// Returns MRR, rank-1 rate, coverage and latency percentiles for each of the three ranking
// strategies. The arithmetic lives in aggregate.ts so it can be tested without DynamoDB.
import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { visibleOwnerIds } from '../shared/group';
import { aggregate } from './aggregate';
import { fetchEvents } from './query';
import { log } from '../shared/logger';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const userId = event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;
  if (!userId) { log.warn('search-stats:unauthorised'); return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorised' }) }; }

  const requested = Number(event.queryStringParameters?.days ?? DEFAULT_DAYS);
  const days = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), MAX_DAYS) : DEFAULT_DAYS;

  // Household members share a view; a non-member sees only their own searches.
  const owners = [...(await visibleOwnerIds(userId))];
  const events = await fetchEvents(owners, days);
  const stats = aggregate(events, days);

  log.info('search-stats:computed', {
    userId, days, owners: owners.length, totalSearches: stats.totalSearches,
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(stats),
  };
}
