// Shopping list API (RECP-37) — a single Lambda routing all /shopping/* routes
// (cheaper and simpler than one function per route). Cognito-JWT authorised like the
// rest of the API; everything is scoped to the caller's own lists.
//
//   GET    /shopping/lists                 list the user's lists (auto-creates default)
//   GET    /shopping/items?listId=         items in a list (default list if omitted)
//   POST   /shopping/items                 {text, listId?} -> categorise + add
//   PATCH  /shopping/items/{itemId}        {checked?,item?,amount?,unit?,aisle?,sortOrder?,listId?}
//   DELETE /shopping/items/{itemId}?listId=
//   POST   /shopping/clear-ticked          {listId?} -> remove ticked items

import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { randomUUID } from 'crypto';
import { isAisleId } from '../shared/aisles';
import { categorise } from '../shared/categorise';
import { makeBedrockCategoriser } from '../shared/bedrock-categorise';
import { log } from '../shared/logger';
import { cacheGet, cachePut } from './category-cache';
import {
  DEFAULT_LIST_ID,
  ShoppingItem,
  clearTicked,
  deleteItem,
  ensureDefaultList,
  getItem,
  listItems,
  listLists,
  putItem,
  updateItem,
} from './store';

const bedrock = new BedrockRuntimeClient({});
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID!;
const llmCategorise = makeBedrockCategoriser(bedrock, BEDROCK_MODEL_ID);

function ok(body: unknown, statusCode = 200): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function err(status: number, message: string): APIGatewayProxyResultV2 {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: message }) };
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const userId = event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;
  if (!userId) {
    log.warn('shopping:unauthorised');
    return err(401, 'Unauthorised');
  }

  const routeKey = event.routeKey; // e.g. "POST /shopping/items"
  const body = parseBody(event.body);
  const qs = event.queryStringParameters ?? {};
  const listId = (body.listId as string) || qs.listId || DEFAULT_LIST_ID;
  const itemId = event.pathParameters?.itemId;

  try {
    switch (routeKey) {
      case 'GET /shopping/lists': {
        await ensureDefaultList(userId);
        return ok({ lists: await listLists(userId) });
      }

      case 'GET /shopping/items': {
        await ensureDefaultList(userId);
        const items = await listItems(userId, listId);
        log.info('shopping:list_items', { userId, listId, count: items.length });
        return ok({ items });
      }

      case 'POST /shopping/items': {
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text) return err(400, 'text is required');
        await ensureDefaultList(userId);

        const cat = await categorise(text, { llmCategorise, cacheGet, cachePut });
        const now = new Date().toISOString();
        const item: ShoppingItem = {
          itemId: randomUUID(),
          listId,
          raw: text,
          item: cat.item,
          amount: cat.amount,
          unit: cat.unit,
          aisle: cat.aisle,
          checked: false,
          sortOrder: Date.now(),
          createdAt: now,
          updatedAt: now,
        };
        await putItem(userId, item);
        log.info('shopping:add', { userId, listId, aisle: cat.aisle, source: cat.source });
        return ok({ item }, 201);
      }

      case 'PATCH /shopping/items/{itemId}': {
        if (!itemId) return err(400, 'itemId is required');
        const patch = buildPatch(body);
        if (patch === null) return err(400, 'Invalid aisle');
        if (Object.keys(patch).length === 0) {
          const current = await getItem(userId, listId, itemId);
          return current ? ok({ item: current }) : err(404, 'Item not found');
        }
        const updated = await updateItem(userId, listId, itemId, patch);
        return updated ? ok({ item: updated }) : err(404, 'Item not found');
      }

      case 'DELETE /shopping/items/{itemId}': {
        if (!itemId) return err(400, 'itemId is required');
        await deleteItem(userId, listId, itemId);
        return { statusCode: 204, body: '' };
      }

      case 'POST /shopping/clear-ticked': {
        const removed = await clearTicked(userId, listId);
        log.info('shopping:clear_ticked', { userId, listId, removed });
        return ok({ removed });
      }

      default:
        return err(404, `Unknown route: ${routeKey}`);
    }
  } catch (e) {
    log.error('shopping:error', { userId, routeKey, error: String(e) });
    return err(500, 'Internal error');
  }
}

function parseBody(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Build a validated update patch from a PATCH body. Returns null if the aisle is invalid. */
function buildPatch(body: Record<string, unknown>): Partial<ShoppingItem> | null {
  const patch: Partial<ShoppingItem> = {};
  if (typeof body.checked === 'boolean') patch.checked = body.checked;
  if (typeof body.item === 'string') patch.item = body.item.trim();
  if (typeof body.amount === 'string' || body.amount === null) patch.amount = body.amount as string | null;
  if (typeof body.unit === 'string' || body.unit === null) patch.unit = body.unit as string | null;
  if (typeof body.sortOrder === 'number') patch.sortOrder = body.sortOrder;
  if (typeof body.aisle === 'string') {
    if (!isAisleId(body.aisle)) return null;
    patch.aisle = body.aisle;
  }
  return patch;
}
