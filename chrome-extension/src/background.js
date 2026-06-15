// Background service worker — handles OAuth, token storage and API calls.
//
// API calls are made HERE (not in the popup) on purpose: an MV3 service worker with
// host_permissions can fetch the API cross-origin without CORS, so the API Gateway
// CORS allow-list (app domain + localhost only) doesn't need a chrome-extension origin.

import { accessToken, signIn, clearTokens, isSignedIn } from "./auth.js";
import { getConfig, getEnvName, setEnvName } from "./config.js";

// ── API ───────────────────────────────────────────────────────────────────────
async function apiFetch(path, init = {}) {
  const cfg = await getConfig();
  const token = await accessToken();
  const res = await fetch(`${cfg.apiBaseURL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
  if (!res.ok) {
    const msg = body?.error || `Request failed (${res.status})`;
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  return body;
}

// Grab the active tab's rendered HTML + URL. The page is already loaded in the real
// browser, so this sails past Cloudflare/bot protection that blocks server fetches —
// we always send `html`, which /extract parses directly (no server-side fetch).
async function capturePage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("No active tab to capture.");
  if (!/^https?:/.test(tab.url)) throw new Error("This page can't be saved (not a web page).");

  const [{ result: html } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => document.documentElement.outerHTML,
  });
  if (!html) throw new Error("Couldn't read the page contents.");
  return { url: tab.url, html };
}

async function saveRecipe() {
  const { url, html } = await capturePage();
  return apiFetch("/extract", { method: "POST", body: JSON.stringify({ url, html }) });
}

// ── Message router (from popup) ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "getStatus":
          sendResponse({ ok: true, signedIn: await isSignedIn(), env: await getEnvName() });
          break;
        case "signIn":
          await signIn();
          sendResponse({ ok: true });
          break;
        case "signOut":
          await clearTokens();
          sendResponse({ ok: true });
          break;
        case "setEnv":
          await setEnvName(msg.env);
          sendResponse({ ok: true });
          break;
        case "saveRecipe":
          sendResponse({ ok: true, recipe: await saveRecipe() });
          break;
        default:
          sendResponse({ ok: false, error: `Unknown message: ${msg.type}` });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e?.message ?? String(e) });
    }
  })();
  return true; // keep the channel open for the async response
});
