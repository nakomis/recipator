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

import { apiFetch, extract, setRecipeImage } from "./api.js";
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

// BBC Good Food drops common stop-words from slugs (e.g. "Swedish meatballs WITH
// beetroot & apple salad" → swedish-meatballs-beetroot-apple-salad). We can't know
// per-title whether a word is kept, so we try the full slug first (handles titles
// that keep the word, e.g. "toad-in-the-hole") then a stop-word-stripped slug.
const STOPWORDS = new Set(["with", "and", "the", "of", "a", "an", "to", "in", "on", "for", "or"]);
function stripStopwords(title) {
  return title.split(/\s+/).filter((w) => !STOPWORDS.has(w.toLowerCase())).join(" ");
}

// Manual overrides for titles BBC Good Food renamed enough that no slug heuristic
// finds them — Amazon stores a paraphrased title (e.g. its "Lamb keema curry" is
// BBC's "Keema with peas", /recipes/keema-peas). Keyed by lower-cased saved title.
const TITLE_OVERRIDES = {
  "lamb keema curry": "https://www.bbcgoodfood.com/recipes/keema-peas",
  "chinese-style braised beef one-pot": "https://www.bbcgoodfood.com/recipes/braised-beef-onepot",
  "lentil bolognese": "https://www.bbcgoodfood.com/recipes/lentil-ragu",
};

// Candidate source URLs for a saved recipe, most-likely first.
function candidateUrls({ provider, title }) {
  const override = TITLE_OVERRIDES[title.trim().toLowerCase()];
  if (override) return [override];
  if (provider !== "bbcgoodfood") return []; // unknown provider — reported, not imported
  const base = "https://www.bbcgoodfood.com/recipes/";
  const slugs = [bbcSlug(title), bbcSlug(stripStopwords(title))];
  return [...new Set(slugs)].filter(Boolean).map((s) => base + s);
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
    const titlem = block.match(/<img alt="([^"]*)"\s+src="([^"]*)"/);
    if (!idm || !titlem) continue;
    const recipeId = idm[1];
    const provider = recipeId.match(/\.document\.([a-z0-9]+)\.pdid/)?.[1] ?? "";
    if (!out.has(recipeId)) {
      out.set(recipeId, {
        recipeId,
        provider,
        title: decodeEntities(titlem[1]).trim(),
        image: decodeEntities(titlem[2]).trim() || null, // Amazon CDN photo — fallback if source has no og:image
      });
    }
  }
  return [...out.values()];
}

function nextPageToken(html) {
  // nextpage responses carry the next token in a data-page-token attribute…
  const dpt = html.match(/data-page-token="([^"]+)"/);
  if (dpt) return decodeEntities(dpt[1]);
  // …the initial widget carries it inside the carousel options JSON.
  const opts = html.match(/data-a-carousel-options="([^"]+)"/);
  if (!opts) return null;
  try {
    const json = JSON.parse(decodeEntities(opts[1]));
    return json?.ajax?.params?.pageToken ?? null;
  } catch { return null; }
}

const PAGE_SIZE = 3; // matches the carousel's known-good nextpage request

async function fetchSavedRecipes() {
  const brandId = await discoverBrandId();
  const q = brandId ? `?almBrandId=${encodeURIComponent(brandId)}` : "";
  const seen = new Map();
  let html = await amazonGet(`${WIDGET}${q}`);

  for (let page = 0; page < MAX_PAGES; page++) {
    const before = seen.size;
    for (const tile of parseTiles(html)) if (!seen.has(tile.recipeId)) seen.set(tile.recipeId, tile);
    const token = nextPageToken(html);
    // Stop when there's no next page, or the last fetch added nothing new.
    if (!token || (page > 0 && seen.size === before)) break;
    // Pagination is best-effort: if the nextpage endpoint fails, import what we
    // already have rather than aborting the whole run.
    try {
      // The carousel's "load more" needs offset (items already shown), pageSize
      // and count alongside the pageToken — omitting them 500s.
      const params = new URLSearchParams({
        pageToken: token,
        count: "1",
        offset: String(seen.size),
        pageSize: String(PAGE_SIZE),
      });
      if (brandId) params.set("almBrandId", brandId);
      const next = await amazonGet(`/afx/ingredients/recipes/collection/saved/nextpage?${params}`);
      if (next === html) break; // no progress, stop
      html = next;
    } catch (e) {
      console.warn("saved-recipes pagination stopped:", e?.message);
      break;
    }
  }
  return [...seen.values()];
}

// ── local cache: imported Amazon recipeId → normalised saved URL ────────────────
// The DB (GET /recipes) is the source of truth for dedup. This cache only (a) lets
// us recognise recipes whose resolved URL isn't one of the guessed candidate URLs
// (e.g. one resolved via on-site search), and (b) provides a fallback when the
// listing call fails. A recipe deleted from Recipator drops out of the listing and
// is re-imported (its stale cache entry is cleared).
async function importedCacheKey() { return `alexaImported:${await getEnvName()}`; }
async function loadImportedCache() {
  const key = await importedCacheKey();
  const raw = (await chrome.storage.local.get(key))[key];
  // Legacy format was an array of recipeIds (no URL); migrate to a map.
  if (Array.isArray(raw)) return new Map(raw.map((id) => [id, null]));
  return new Map(Object.entries(raw ?? {}));
}
async function saveImportedCache(map) {
  const key = await importedCacheKey();
  await chrome.storage.local.set({ [key]: Object.fromEntries(map) });
}

// ── recipeIds the user has resolved by hand ─────────────────────────────────────
// Some recipes never resolve via slug-guessing (Amazon's title differs too much).
// Once the user finds and saves one manually, ticking it in the popup records its
// recipeId here so the importer skips it on every future run instead of reporting
// it as a failure again.
async function resolvedKey() { return `alexaResolved:${await getEnvName()}`; }
async function loadResolved() {
  const key = await resolvedKey();
  return new Set((await chrome.storage.local.get(key))[key] ?? []);
}
export async function markResolved(recipeId) {
  const key = await resolvedKey();
  const set = await loadResolved();
  set.add(recipeId);
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
  // Soft-deleted recipes are excluded by GET /recipes, so deleting one lets it
  // be re-imported. dbListingOk tells us whether to trust the DB or the cache.
  let existing = new Set();
  let dbListingOk = false;
  try {
    const recipes = await apiFetch("/recipes");
    const list = Array.isArray(recipes) ? recipes : recipes?.recipes ?? [];
    existing = new Set(list.map((r) => normaliseUrl(r.url)).filter(Boolean));
    dbListingOk = true;
  } catch { /* if listing fails, fall back to local cache only */ }

  const cache = await loadImportedCache();
  const resolved = await loadResolved();
  const summary = { total: saved.length, imported: [], skipped: [], failed: [] };
  report({ phase: "start", total: saved.length });

  for (let i = 0; i < saved.length; i++) {
    const rec = saved[i];
    const candidates = candidateUrls(rec);
    const base = { title: rec.title, index: i + 1, total: saved.length };

    // User ticked this one as handled by hand — never resurface it.
    if (resolved.has(rec.recipeId)) { summary.skipped.push(rec); report({ phase: "item", status: "skipped", ...base }); continue; }

    if (candidates.length === 0) { summary.failed.push({ ...rec, reason: `unsupported provider: ${rec.provider}` }); report({ phase: "item", status: "failed", ...base }); continue; }

    // Dedup. With a good DB listing it's authoritative: skip if present by any
    // candidate URL or the URL we recorded at import time; a recipe that's been
    // deleted drops out of the listing and is re-imported (clearing its stale
    // cache entry). Only when the listing call failed do we trust the cache alone.
    const cachedUrl = cache.get(rec.recipeId);
    const urls = candidates.map(normaliseUrl);
    if (cachedUrl) urls.push(cachedUrl);

    if (dbListingOk) {
      if (urls.some((u) => existing.has(u))) {
        summary.skipped.push(rec); report({ phase: "item", status: "skipped", ...base }); continue;
      }
      cache.delete(rec.recipeId); // not in Recipator → allow (re-)import
    } else if (cache.has(rec.recipeId)) {
      summary.skipped.push(rec); report({ phase: "item", status: "skipped", ...base }); continue;
    }

    report({ phase: "item", status: "importing", ...base });
    let payload = null;
    for (const url of candidates) {
      const html = await fetchRecipeHtml(url);
      if (html) { payload = { url, html }; break; }
    }
    if (!payload) payload = await searchBbc(rec.title); // all slugs missed → on-site search

    if (!payload) { summary.failed.push({ ...rec, reason: "could not resolve source recipe" }); report({ phase: "item", status: "failed", ...base }); continue; }

    try {
      const saved = await extract(payload);
      // /extract returns imageCandidates but doesn't persist one. Prefer the
      // source page's og:image; fall back to the Amazon tile photo.
      const imageUrl = saved?.imageCandidates?.[0] || rec.image;
      if (saved?.recipeId && imageUrl) {
        try { await setRecipeImage(saved.recipeId, imageUrl); } catch { /* image is best-effort */ }
      }
      cache.set(rec.recipeId, normaliseUrl(payload.url));
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
