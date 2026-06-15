// Recipator API helper, shared by the service worker and the Alexa importer.
//
// Calls run in the background service worker, where an MV3 extension with
// host_permissions can fetch cross-origin without CORS.

import { accessToken } from "./auth.js";
import { getConfig } from "./config.js";

export async function apiFetch(path, init = {}) {
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
    const e = new Error(body?.error || `Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return body;
}

// Extract + save a recipe from a URL (optionally with client-fetched HTML, which
// bypasses bot protection on the source site).
export function extract({ url, html }) {
  return apiFetch("/extract", { method: "POST", body: JSON.stringify({ url, html }) });
}
