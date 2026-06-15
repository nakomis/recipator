// Import recipes saved on an Echo Show ("Alexa, save this recipe") into Recipator.
//
// Echo Show saves land in Amazon's "Saved recipes" widget. We can't read the
// device screen (Alexa skills are sandboxed), but the saves live on a page the
// user is logged into. This runs entirely in the background service worker:
//   1. fetch the saved-recipes widget with the user's Amazon session cookies
//   2. parse the tiles (title + recipeId, which encodes the provider)
//   3. map each to its original source URL (BBC Good Food) and run it through
//      the existing /extract pipeline — fetched from the user's residential IP,
//      which gets past the Cloudflare block that stops server-side fetches.
//
// Idempotent: skips recipes already in Recipator (by URL) and caches imported
// Amazon recipeIds locally.

import { apiFetch, extract } from "./api.js";
import { getEnvName } from "./config.js";

const AMAZON = "https://www.amazon.co.uk";
const SEARCH_PAGE = "/afx/ingredients/recipe/search";
const WIDGET = "/afx/ingredients/savedrecipeswidget";
const MAX_PAGES = 20;

// ── helpers ───────────────────────────────────────────────────────────────────
const ENTITIES = { amp: "&", quot: '"', "#39": "'", apos: "'", lt: "<", gt: ">", hellip: "…", nbsp: " " };
function decodeEntities(s) {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// Confirmed against bbcgoodfood.com: "&" and punctuation drop, accents strip to
// ASCII, spaces → hyphens. e.g. "Rhubarb & ginger crème brûlée" → rhubarb-ginger-creme-brulee
export function bbcSlug(title) {
  return title
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normaliseUrl(u) {
  try {
    const url = new URL(u);
    return `${url.host.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch { return (u || "").toLowerCase(); }
}

// Map a saved-recipe provider + title to its original source URL.
function sourceUrl({ provider, title }) {
  if (provider === "bbcgoodfood") return `https://www.bbcgoodfood.com/recipes/${bbcSlug(title)}`;
  return null; // unknown provider — reported, not imported
}

async function amazonGet(path) {
  const res = await fetch(`${AMAZON}${path}`, {
    credentials: "include",
    headers: { accept: "*/*", "x-requested-with": "XMLHttpRequest" },
  });
  if (!res.ok) throw new Error(`Amazon ${path} → ${res.status}`);
  return res.text();
}

// almBrandId is the Amazon Fresh partner brand (e.g. Morrisons). Discover it from
// the saves page so this works for any account, not just one brand.
async function discoverBrandId() {
  try {
    const html = await amazonGet(SEARCH_PAGE);
    const m = html.match(/almBrandId(?:=|&quot;:&quot;)([A-Za-z0-9%+/=]+)/);
    if (m) return decodeURIComponent(m[1]);
  } catch { /* fall through */ }
  return null;
}

// Parse recipe tiles out of widget/carousel HTML. Each tile's anchor carries the
// recipeId (which embeds the provider); the tile image alt carries the title.
function parseTiles(html) {
  // Split on tile boundaries first so the repeated recipeId inside each tile's
  // save-button JSON can't mis-pair a recipeId with the next tile's title.
  const out = new Map();
  for (const block of html.split('class="alm-recipe-tile"').slice(1)) {
    const idm = block.match(/recipeId=(amzn1\.alexa\.kitchen\.document\.[a-z0-9]+\.pdid\.[^"&]+)/);
    const titlem = block.match(/<img alt="([^"]*)"/);
    if (!idm || !titlem) continue;
    const recipeId = idm[1];
    const provider = recipeId.match(/\.document\.([a-z0-9]+)\.pdid/)?.[1] ?? "";
    if (!out.has(recipeId)) out.set(recipeId, { recipeId, provider, title: decodeEntities(titlem[1]).trim() });
  }
  return [...out.values()];
}

function nextPageToken(html) {
  const opts = html.match(/data-a-carousel-options="([^"]+)"/);
  if (!opts) return null;
  try {
    const json = JSON.parse(decodeEntities(opts[1]));
    return json?.ajax?.params?.pageToken ?? null;
  } catch { return null; }
}

async function fetchSavedRecipes() {
  const brandId = await discoverBrandId();
  const q = brandId ? `?almBrandId=${encodeURIComponent(brandId)}` : "";
  const seen = new Map();
  let html = await amazonGet(`${WIDGET}${q}`);

  for (let page = 0; page < MAX_PAGES; page++) {
    for (const tile of parseTiles(html)) if (!seen.has(tile.recipeId)) seen.set(tile.recipeId, tile);
    const token = nextPageToken(html);
    if (!token) break;
    const params = new URLSearchParams({ pageToken: token });
    if (brandId) params.set("almBrandId", brandId);
    const next = await amazonGet(`/afx/ingredients/recipes/collection/saved/nextpage?${params}`);
    if (next === html) break; // no progress, stop
    html = next;
  }
  return [...seen.values()];
}

// ── local cache of imported recipeIds (fast-path; DB is source of truth) ───────
async function importedCacheKey() { return `alexaImported:${await getEnvName()}`; }
async function loadImportedCache() {
  const key = await importedCacheKey();
  return new Set((await chrome.storage.local.get(key))[key] ?? []);
}
async function saveImportedCache(set) {
  const key = await importedCacheKey();
  await chrome.storage.local.set({ [key]: [...set] });
}

// Fetch the source recipe page from the user's residential IP (gets past
// Cloudflare). Returns HTML if it looks like a recipe, else null.
async function fetchRecipeHtml(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    if (/"@type"\s*:\s*"Recipe"/.test(html) || /application\/ld\+json/.test(html)) return html;
    return null;
  } catch { return null; }
}

// Fallback: search BBC Good Food's own site (same host permission) for the title
// and take the first recipe result.
async function searchBbc(title) {
  try {
    const res = await fetch(`https://www.bbcgoodfood.com/search?q=${encodeURIComponent(title)}`);
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/href="(\/recipes\/[a-z0-9-]+)"/i);
    if (!m) return null;
    const url = `https://www.bbcgoodfood.com${m[1]}`;
    const recipeHtml = await fetchRecipeHtml(url);
    return recipeHtml ? { url, html: recipeHtml } : null;
  } catch { return null; }
}

// ── main entry point ───────────────────────────────────────────────────────────
export async function importFromAmazon(onProgress = () => {}) {
  const report = (ev) => { try { onProgress(ev); } catch { /* popup gone */ } };

  report({ phase: "reading" });
  const saved = await fetchSavedRecipes();

  // Existing Recipator recipes — dedup by normalised URL (true idempotency).
  let existing = new Set();
  try {
    const recipes = await apiFetch("/recipes");
    const list = Array.isArray(recipes) ? recipes : recipes?.recipes ?? [];
    existing = new Set(list.map((r) => normaliseUrl(r.url)).filter(Boolean));
  } catch { /* if listing fails, fall back to local cache only */ }

  const cache = await loadImportedCache();
  const summary = { total: saved.length, imported: [], skipped: [], failed: [] };
  report({ phase: "start", total: saved.length });

  for (let i = 0; i < saved.length; i++) {
    const rec = saved[i];
    const url = sourceUrl(rec);
    const base = { title: rec.title, index: i + 1, total: saved.length };

    if (!url) { summary.failed.push({ ...rec, reason: `unsupported provider: ${rec.provider}` }); report({ phase: "item", status: "failed", ...base }); continue; }

    if (cache.has(rec.recipeId) || existing.has(normaliseUrl(url))) {
      summary.skipped.push(rec); report({ phase: "item", status: "skipped", ...base }); continue;
    }

    report({ phase: "item", status: "importing", ...base });
    let payload = null;
    const html = await fetchRecipeHtml(url);
    if (html) payload = { url, html };
    else payload = await searchBbc(rec.title); // slug miss → on-site search

    if (!payload) { summary.failed.push({ ...rec, reason: "could not resolve source recipe" }); report({ phase: "item", status: "failed", ...base }); continue; }

    try {
      const saved = await extract(payload);
      cache.add(rec.recipeId);
      existing.add(normaliseUrl(payload.url));
      summary.imported.push({ ...rec, savedTitle: saved?.title });
      report({ phase: "item", status: "imported", ...base });
    } catch (e) {
      summary.failed.push({ ...rec, reason: e?.message ?? "extract failed" });
      report({ phase: "item", status: "failed", ...base });
    }
  }

  await saveImportedCache(cache);
  report({ phase: "done", summary });
  return summary;
}
