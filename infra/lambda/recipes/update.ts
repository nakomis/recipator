// PATCH /recipes/{id} — edit a saved recipe (RECP-59).
//
// Started life as an imageUrl-only patch (choosing a cover image from the capture's
// candidates) and now also carries hand edits to the recipe itself: title, source url,
// ingredients, method, and free-text notes.
//
// Two things happen around a content edit:
//   • the *previous* version is snapshotted into the versions table (PK recipeId,
//     SK changedAt) before it's overwritten, so nothing is ever lost to a bad edit;
//   • the embedding is recomputed (async) when the embedded text changed, so semantic
//     search reflects what the recipe now says.
//
// Any group member may edit any household recipe — pass the owner as ?userId= exactly
// as GET /recipes/{id} does. The version row records who actually made the change.
import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand, InvocationType } from '@aws-sdk/client-lambda';
import { log } from '../shared/logger';
import { visibleOwnerIds } from '../shared/group';
import { buildMarkdown } from '../shared/markdown';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambdaClient = new LambdaClient({});
const RECIPES_TABLE  = process.env.RECIPES_TABLE!;
const VERSIONS_TABLE = process.env.RECIPE_VERSIONS_TABLE!;
const EMBED_FUNCTION = process.env.EMBED_FUNCTION_NAME; // optional; async enrichment

/// Fields a client may patch. imageUrl is cover-image selection (no version snapshot);
/// the rest are recipe content (snapshotted, and markdown is rebuilt).
interface PatchBody {
  title?: string;
  url?: string;
  ingredients?: string[];
  method?: string[];
  notes?: string;
  imageUrl?: string;
}

const CONTENT_FIELDS = ['title', 'url', 'ingredients', 'method', 'notes'] as const;
/// Copied into a version row so a snapshot is a complete, self-contained recipe.
const SNAPSHOT_FIELDS = [...CONTENT_FIELDS, 'markdown', 'imageUrl', 'savedAt'] as const;

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  return a === b;
}

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const authUserId = event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;
  const recipeId   = event.pathParameters?.id;
  // The recipe's owner. Defaults to the caller; a group member may edit another
  // member's recipe by passing it, mirroring GET /recipes/{id}.
  const userId     = event.queryStringParameters?.userId ?? authUserId;

  if (!authUserId) { log.warn('recipes:update_unauthorised'); return json(401, { error: 'Unauthorised' }); }
  if (!recipeId)   return json(400, { error: 'Missing recipe id' });

  if (userId !== authUserId) {
    const allowed = await visibleOwnerIds(authUserId);
    if (!allowed.has(userId!)) {
      log.warn('recipes:update_forbidden', { recipeId, userId, authUserId });
      return json(403, { error: 'Not your household' });
    }
  }

  let body: PatchBody;
  try {
    body = JSON.parse(event.body ?? '{}') as PatchBody;
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  // Validate before touching the table: an empty title or a non-string list would
  // otherwise be written and then have to be un-edited by hand.
  if (body.title !== undefined && !body.title.trim()) return json(400, { error: 'title cannot be empty' });
  if (body.url !== undefined) {
    try { new URL(body.url); } catch { return json(400, { error: 'url must be a valid URL' }); }
  }
  for (const field of ['ingredients', 'method'] as const) {
    const value = body[field];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) {
      return json(400, { error: `${field} must be an array of strings` });
    }
  }
  if (body.notes !== undefined && typeof body.notes !== 'string') return json(400, { error: 'notes must be a string' });

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined)       patch.title       = body.title.trim();
  if (body.url !== undefined)         patch.url         = body.url;
  if (body.ingredients !== undefined) patch.ingredients = body.ingredients.map(s => s.trim()).filter(Boolean);
  if (body.method !== undefined)      patch.method      = body.method.map(s => s.trim()).filter(Boolean);
  if (body.notes !== undefined)       patch.notes       = body.notes.trim();
  if (body.imageUrl !== undefined)    patch.imageUrl    = body.imageUrl;

  if (Object.keys(patch).length === 0) return json(400, { error: 'No editable fields supplied' });

  const existing = (await dynamo.send(new GetCommand({
    TableName: RECIPES_TABLE,
    Key: { userId, recipeId },
    ConsistentRead: true,
  }))).Item;

  if (!existing || existing.deletedAt) {
    log.info('recipes:update_not_found', { recipeId, userId });
    return json(404, { error: 'Recipe not found' });
  }

  const changed = Object.keys(patch).filter(f => !sameValue(patch[f], existing[f]));
  if (changed.length === 0) {
    log.info('recipes:update_noop', { recipeId, userId });
    return json(200, { ok: true, recipe: existing });
  }

  const contentChanged = changed.some(f => (CONTENT_FIELDS as readonly string[]).includes(f));
  const changedAt = new Date().toISOString();

  // Snapshot first: if the version write fails the recipe is left untouched, which is
  // the safe way round — better to reject an edit than to lose the version before it.
  if (contentChanged) {
    const snapshot: Record<string, unknown> = {
      recipeId, changedAt, userId,
      changedBy: authUserId,
      changedByEmail: event.requestContext.authorizer?.jwt?.claims?.email as string | undefined,
      changedFields: changed,
    };
    for (const f of SNAPSHOT_FIELDS) {
      if (existing[f] !== undefined) snapshot[f] = existing[f];
    }
    await dynamo.send(new PutCommand({ TableName: VERSIONS_TABLE, Item: snapshot }));
  }

  const merged = { ...existing, ...patch };
  const updates: Record<string, unknown> = { ...patch, updatedAt: changedAt, updatedBy: authUserId };
  // Markdown is derived, not edited: rebuild it whenever the content behind it moves.
  if (contentChanged) {
    updates.markdown = buildMarkdown(
      { title: merged.title as string, ingredients: (merged.ingredients as string[]) ?? [],
        method: (merged.method as string[]) ?? [], notes: merged.notes as string | undefined },
      merged.url as string,
    );
  }

  // Alias every attribute name — `method` is a DynamoDB reserved word, and a bare
  // name would fail the whole update.
  const names  = Object.fromEntries(Object.keys(updates).map(f => [`#${f}`, f]));
  const values = Object.fromEntries(Object.entries(updates).map(([f, v]) => [`:${f}`, v]));

  await dynamo.send(new UpdateCommand({
    TableName: RECIPES_TABLE,
    Key: { userId, recipeId },
    UpdateExpression: 'SET ' + Object.keys(updates).map(f => `#${f} = :${f}`).join(', '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ConditionExpression: 'attribute_exists(recipeId)',
  }));

  log.info('recipes:update', {
    recipeId, userId, changedBy: authUserId, fields: changed, versioned: contentChanged,
  });

  // The embedding covers title + ingredients only (see the embed Lambda), so only
  // those two are worth the recompute. Fire-and-forget: search catches up shortly.
  const embeddedTextChanged = changed.includes('title') || changed.includes('ingredients');
  if (embeddedTextChanged && EMBED_FUNCTION) {
    try {
      await lambdaClient.send(new InvokeCommand({
        FunctionName: EMBED_FUNCTION,
        InvocationType: InvocationType.Event,
        Payload: Buffer.from(JSON.stringify({
          recipeId, userId, title: merged.title, ingredients: merged.ingredients,
        })),
      }));
    } catch (e) {
      log.warn('recipes:update_embed_invoke_failed', { recipeId, error: String(e) });
    }
  }

  return json(200, { ok: true, recipe: { ...merged, ...updates } });
}
