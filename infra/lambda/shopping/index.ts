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
import { CategorisationSource, cacheKey, categorise } from '../shared/categorise';
import { makeBedrockCategoriser } from '../shared/bedrock-categorise';
import { log } from '../shared/logger';
import { cacheGet, cachePut } from './category-cache';
import {
  DEFAULT_LIST_ID,
  ShoppingItem,
  clearAll,
  clearTicked,
  deleteItem,
  ensureDefaultList,
  getItem,
  listItems,
  listLists,
  putItem,
  recordCorrection,
  updateItem,
} from './store';

const bedrock = new BedrockRuntimeClient({});
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID!;
const llmCategorise = makeBedrockCategoriser(bedrock, BEDROCK_MODEL_ID);

// Sources a client may claim when it resolved an item on-device (RECP-49). 'fallback' is
// never accepted from a client — an unplaced item must reach the server's own cascade.
const DEVICE_SOURCES = new Set<string>(['rules', 'cache', 'device', 'llm']);

// A client may supply the item's id so an offline-created item keeps its id when the background
// sync pushes it, making the create idempotent (re-pushing overwrites the same row). RECP-49 B3.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ok(body: unknown, statusCode = 200): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
// Every 4xx is logged. Without this a client stuck in a rejection loop is invisible: the Lambda
// runs, returns, and leaves nothing behind but an API Gateway 4xx count with no route or reason
// attached — which is exactly what made the 2026-07-28 sync stall so hard to diagnose (RECP-58).
function err(status: number, message: string, ctx: Record<string, unknown> = {}): APIGatewayProxyResultV2 {
  log.warn('shopping:rejected', { status, message, ...ctx });
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: message }) };
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const userId = event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;
  if (!userId) {
    return err(401, 'Unauthorised', { routeKey: event.routeKey });
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
        if (!text) return err(400, 'text is required', { routeKey, userId });
        await ensureDefaultList(userId);

        // An on-device categorisation (RECP-35/RECP-49) may accompany the add; honoured only
        // if it's a valid aisle id, otherwise ignored. `source` (when the device ran the full
        // on-device cascade) is stored verbatim. `noLlm` (offline-only) tells the server not
        // to fall back to the cloud LLM.
        const deviceAisle = typeof body.aisle === 'string' && isAisleId(body.aisle) ? body.aisle : null;
        const deviceSource = DEVICE_SOURCES.has(body.source as string) ? (body.source as CategorisationSource) : null;
        const allowLlm = body.noLlm !== true;
        const cat = await categorise(text, { llmCategorise, cacheGet, cachePut }, deviceAisle, allowLlm, deviceSource);
        const now = new Date().toISOString();
        // Honour a valid client-supplied id (idempotent sync push); otherwise mint one.
        const itemId = typeof body.itemId === 'string' && UUID_RE.test(body.itemId) ? body.itemId : randomUUID();
        const item: ShoppingItem = {
          itemId,
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
          source: cat.source,
        };
        await putItem(userId, item);
        log.info('shopping:add', { userId, listId, aisle: cat.aisle, source: cat.source });
        return ok({ item }, 201);
      }

      case 'PATCH /shopping/items/{itemId}': {
        if (!itemId) return err(400, 'itemId is required', { routeKey, userId });
        const patch = buildPatch(body);
        if (patch === null) return err(400, 'Invalid aisle', { routeKey, userId, itemId });
        if (Object.keys(patch).length === 0) {
          const current = await getItem(userId, listId, itemId);
          return current ? ok({ item: current }) : err(404, 'Item not found', { routeKey, userId, listId, itemId });
        }
        // If the user is moving the item to a different aisle, capture the before-state
        // so we can record the correction as a training signal (RECP-34; mined later).
        const before = patch.aisle !== undefined ? await getItem(userId, listId, itemId) : null;
        const updated = await updateItem(userId, listId, itemId, patch);
        if (!updated) return err(404, 'Item not found', { routeKey, userId, listId, itemId });
        if (before && patch.aisle && before.aisle !== patch.aisle) {
          await recordCorrection(userId, listId, itemId, {
            itemText: before.item,
            cacheKey: cacheKey(before.item),
            fromAisle: before.aisle,
            toAisle: patch.aisle,
            source: before.source,
          });
          log.info('shopping:aisle_correction', {
            userId, itemId, from: before.aisle, to: patch.aisle, source: before.source,
          });
        }
        return ok({ item: updated });
      }

      case 'DELETE /shopping/items/{itemId}': {
        if (!itemId) return err(400, 'itemId is required', { routeKey, userId });
        await deleteItem(userId, listId, itemId);
        return { statusCode: 204, body: '' };
      }

      case 'POST /shopping/clear-ticked': {
        const removed = await clearTicked(userId, listId);
        log.info('shopping:clear_ticked', { userId, listId, removed });
        return ok({ removed });
      }

      case 'POST /shopping/clear-all': {
        const removed = await clearAll(userId, listId);
        log.info('shopping:clear_all', { userId, listId, removed });
        return ok({ removed });
      }

      default:
        return err(404, `Unknown route: ${routeKey}`, { routeKey, userId });
    }
  } catch (e) {
    log.error('shopping:error', { userId, routeKey, error: String(e) });
    return err(500, 'Internal error', { routeKey, userId });
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
