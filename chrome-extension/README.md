# Recipator — Chrome extension

A Manifest V3 browser extension that extracts and saves the recipe on the page you're
viewing, using the same `/extract` backend as the iOS app. It's the companion to the
Recipator iOS app (RECP-13 / RECP-14).

## How it works

1. You sign in once with your Cognito account (the same login as the iOS app), via
   `chrome.identity.launchWebAuthFlow` using PKCE (no client secret).
2. On a recipe page, open the popup and hit **Save this recipe**.
3. The extension grabs the page's already-rendered HTML (so it sails past Cloudflare
   bot protection that blocks server-side fetches) and POSTs `{ url, html }` to
   `POST /extract` with `Authorization: Bearer <accessToken>`.
4. The backend extracts the recipe (schema.org JSON-LD → Claude Haiku fallback), saves
   it to DynamoDB, and kicks off embedding — exactly as the iOS share extension does.

API calls are made from the **background service worker**, where an MV3 extension with
`host_permissions` can fetch cross-origin without CORS — so the API Gateway CORS
allow-list doesn't need a `chrome-extension://` origin.

## Architecture

```
popup.html/js  ──messages──▶  background.js (service worker)
                                  ├─ auth.js   → Cognito hosted UI (PKCE) → token storage
                                  └─ /extract  → Recipator API (Bearer access token)
```

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest; pins the extension ID via `key` |
| `src/config.js` | Per-environment API/Cognito config (sandbox + production) |
| `src/auth.js` | Cognito PKCE sign-in, token storage + silent refresh |
| `src/background.js` | Service worker: message router, page capture, API calls |
| `src/popup.{html,css,js}` | Popup UI |

## Load it (unpacked, for development)

```
chrome://extensions  →  enable Developer mode  →  Load unpacked  →  select chrome-extension/
```

The `key` in `manifest.json` pins the extension ID to
`nhndabjfclafpajdlcgbkkepckdaljll`, so the OAuth redirect URL
(`https://nhndabjfclafpajdlcgbkkepckdaljll.chromiumapp.org/`) is stable across machines
and is the one registered on the Cognito app client in `infra/lib/api-stack.ts`.

## Environments

Defaults to **production**. Click the environment badge in the popup header to toggle
sandbox ↔ production (each keeps its own session). Or change `DEFAULT_ENV` in
`src/config.js`.

## Cognito callback URL

The extension's redirect URL must be registered as a callback URL on the Recipator
Cognito app client. This is done in `infra/lib/api-stack.ts` (the `RecipatorClient`
`callbackUrls`). If the extension ID changes (e.g. a new `key`), update that list and
redeploy the API stack.

## Signing key

The extension ID is derived from the public `key` in `manifest.json`. The matching
private key is **not** committed — it's only needed to self-pack a `.crx`. When
publishing via the Chrome Web Store, Google manages signing and you can drop the `key`
field (the Web Store assigns its own ID; re-register that redirect URL with Cognito).
