import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { randomUUID } from 'crypto';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ssmClient = new SSMClient({});

const RECIPES_TABLE   = process.env.RECIPES_TABLE!;
const ANTHROPIC_PARAM = process.env.ANTHROPIC_KEY_PARAM!;

let cachedAnthropicKey: string | undefined;

async function getAnthropicKey(): Promise<string> {
  if (cachedAnthropicKey) return cachedAnthropicKey;
  const res = await ssmClient.send(new GetParameterCommand({ Name: ANTHROPIC_PARAM }));
  cachedAnthropicKey = res.Parameter!.Value!;
  return cachedAnthropicKey;
}

function ok(body: unknown): APIGatewayProxyResultV2 {
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function err(status: number, message: string): APIGatewayProxyResultV2 {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: message }) };
}

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const userId    = claims['sub'] as string | undefined;
  const userEmail = (claims['email'] ?? claims['username'] ?? '') as string;
  if (!userId) return err(401, 'Unauthorised');

  const body = JSON.parse(event.body ?? '{}') as { url?: string };
  if (!body.url) return err(400, 'url is required');

  let url: URL;
  try { url = new URL(body.url); } catch { return err(400, 'Invalid URL'); }

  // Fetch page
  const pageRes = await fetch(url.toString(), {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' },
  });
  if (!pageRes.ok) return err(502, `Failed to fetch page: ${pageRes.status}`);
  const html = await pageRes.text();

  // Try JSON-LD first
  let extracted = extractFromJSONLD(html, url.toString());

  // Fall back to Claude Haiku
  if (!extracted || extracted.ingredients.length === 0) {
    const apiKey = await getAnthropicKey();
    extracted = await extractWithClaude(html, url.toString(), apiKey);
  }

  if (!extracted) return err(422, 'Could not extract a recipe from this page');

  const recipeId       = randomUUID();
  const savedAt        = new Date().toISOString();
  const markdown       = buildMarkdown(extracted, url.toString());
  const imageCandidates = extractImageCandidates(html, url.toString());

  const item = {
    userId,
    userEmail,
    recipeId,
    title:       extracted.title,
    url:         url.toString(),
    savedAt,
    ingredients: extracted.ingredients,
    method:      extracted.method,
    markdown,
  };

  await dynamo.send(new PutCommand({ TableName: RECIPES_TABLE, Item: item }));
  return ok({ ...item, imageCandidates });
}

// ── Image candidate extraction ────────────────────────────────────────────────

function extractAttr(tag: string, attr: string): string | null {
  const m = tag.match(new RegExp(`${attr}=["']([^"'\\s>]+)["']`, 'i'));
  return m?.[1] ?? null;
}

function extractImageCandidates(html: string, baseUrl: string): string[] {
  const candidates: string[] = [];
  const base = new URL(baseUrl);

  // og:image first — typically the hero
  const ogMatch =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (ogMatch?.[1]) {
    try { candidates.push(new URL(ogMatch[1], base).toString()); } catch { /* skip */ }
  }

  // <img> tags with explicit width/height >= 300, or no size info (unknown = possibly large)
  const imgRe = /<img[^>]+>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null && candidates.length < 10) {
    const tag = m[0];
    const src = extractAttr(tag, 'src') || extractAttr(tag, 'data-src') || extractAttr(tag, 'data-lazy-src');
    if (!src) continue;
    if (src.startsWith('data:') || /\.svg(\?|$)/i.test(src)) continue;

    const w = parseInt(extractAttr(tag, 'width') ?? '0', 10);
    const h = parseInt(extractAttr(tag, 'height') ?? '0', 10);
    // Skip images that are explicitly declared small
    if (w > 0 && w < 200 && h > 0 && h < 200) continue;

    let abs: string;
    try { abs = new URL(src, base).toString(); } catch { continue; }

    if (!candidates.includes(abs)) candidates.push(abs);
  }

  return candidates.slice(0, 5);
}

// ── JSON-LD extraction ────────────────────────────────────────────────────────

interface ExtractedRecipe { title: string; ingredients: string[]; method: string[] }

function extractFromJSONLD(html: string, _url: string): ExtractedRecipe | null {
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    try {
      const json = JSON.parse(match[1]);
      const recipe = findRecipe(json);
      if (recipe) return recipe;
    } catch { /* malformed JSON-LD, skip */ }
  }
  return null;
}

function findRecipe(json: unknown): ExtractedRecipe | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
  if (types.includes('Recipe')) return parseRecipeSchema(obj);
  if (Array.isArray(obj['@graph'])) {
    for (const item of obj['@graph']) {
      const found = findRecipe(item);
      if (found) return found;
    }
  }
  if (Array.isArray(json)) {
    for (const item of json) {
      const found = findRecipe(item);
      if (found) return found;
    }
  }
  return null;
}

function parseRecipeSchema(obj: Record<string, unknown>): ExtractedRecipe | null {
  const name = typeof obj['name'] === 'string' ? obj['name'] : null;
  if (!name) return null;

  const ingredients = Array.isArray(obj['recipeIngredient'])
    ? (obj['recipeIngredient'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];

  let method: string[] = [];
  if (Array.isArray(obj['recipeInstructions'])) {
    method = (obj['recipeInstructions'] as unknown[]).map(step => {
      if (typeof step === 'string') return step;
      if (step && typeof step === 'object') {
        const s = step as Record<string, unknown>;
        return typeof s['text'] === 'string' ? s['text'] : typeof s['name'] === 'string' ? s['name'] : '';
      }
      return '';
    }).filter(Boolean);
  }

  if (!ingredients.length && !method.length) return null;
  return { title: name, ingredients, method };
}

// ── Claude Haiku fallback ─────────────────────────────────────────────────────

async function extractWithClaude(html: string, url: string, apiKey: string): Promise<ExtractedRecipe | null> {
  const truncated = html.length > 40_000 ? html.slice(0, 40_000) : html;
  const prompt = `Extract the recipe from this HTML. Return ONLY valid JSON: {"title":"…","ingredients":["…"],"method":["…"]}. If no recipe found, return {"error":"no recipe"}.\n\nURL: ${url}\n\nHTML:\n${truncated}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) return null;
  const data = await res.json() as { content?: Array<{ text?: string }> };
  const text = data.content?.[0]?.text ?? '';

  try {
    const result = JSON.parse(text) as { title?: string; ingredients?: string[]; method?: string[]; error?: string };
    if (result.error || !result.title || !result.ingredients || !result.method) return null;
    return { title: result.title, ingredients: result.ingredients, method: result.method };
  } catch {
    return null;
  }
}

// ── Markdown builder ──────────────────────────────────────────────────────────

function buildMarkdown(recipe: ExtractedRecipe, url: string): string {
  let md = `# ${recipe.title}\n\nSource: ${url}\n\n## Ingredients\n\n`;
  for (const i of recipe.ingredients) md += `- ${i}\n`;
  md += '\n## Method\n\n';
  for (let i = 0; i < recipe.method.length; i++) md += `${i + 1}. ${recipe.method[i]}\n`;
  return md;
}
