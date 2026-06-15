// Cognito hosted-UI OAuth (PKCE authorization-code flow) for the extension.
// Mirrors ios/Shared/Auth/AuthService.swift.
//
// We use chrome.identity.launchWebAuthFlow (NOT getAuthToken — that is Google-only).
// The redirect lands on https://<extension-id>.chromiumapp.org/, which is registered
// as a callback URL on the Cognito app client (see infra/lib/api-stack.ts).

import { getConfig, getEnvName, OAUTH_SCOPE } from "./config.js";

const tokenKey = (env) => `tokens:${env}`;

// ── PKCE helpers ────────────────────────────────────────────────────────────
function base64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomVerifier() {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

// ── Token storage ───────────────────────────────────────────────────────────
async function loadTokens(env) {
  const key = tokenKey(env);
  const stored = await chrome.storage.local.get(key);
  return stored[key] ?? null;
}

async function saveTokens(env, raw) {
  // Cognito returns expires_in (seconds). Persist an absolute expiry with a margin.
  const expiresAt = Date.now() + (raw.expires_in - 60) * 1000;
  const tokens = {
    accessToken: raw.access_token,
    idToken: raw.id_token,
    // refresh_token is omitted on a refresh response — keep the existing one.
    refreshToken: raw.refresh_token ?? (await loadTokens(env))?.refreshToken,
    expiresAt,
  };
  await chrome.storage.local.set({ [tokenKey(env)]: tokens });
  return tokens;
}

export async function clearTokens() {
  const env = await getEnvName();
  await chrome.storage.local.remove(tokenKey(env));
}

export async function isSignedIn() {
  const env = await getEnvName();
  return (await loadTokens(env)) != null;
}

// ── Sign in (interactive) ─────────────────────────────────────────────────────
export async function signIn() {
  const cfg = await getConfig();
  const env = await getEnvName();
  const redirectUri = chrome.identity.getRedirectURL();

  const verifier = randomVerifier();
  const challenge = await challengeFor(verifier);

  const authUrl = new URL(`https://${cfg.cognitoLoginDomain}/oauth2/authorize`);
  authUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: cfg.cognitoClientID,
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  const redirected = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });

  const code = new URL(redirected).searchParams.get("code");
  if (!code) throw new Error("No authorization code returned from Cognito.");

  const raw = await exchange(cfg, {
    grant_type: "authorization_code",
    client_id: cfg.cognitoClientID,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  return saveTokens(env, raw);
}

// ── Access token (silent refresh) ─────────────────────────────────────────────
export async function accessToken() {
  const cfg = await getConfig();
  const env = await getEnvName();
  const tokens = await loadTokens(env);
  if (!tokens) throw new Error("Not signed in.");
  if (Date.now() < tokens.expiresAt) return tokens.accessToken;

  if (!tokens.refreshToken) {
    await clearTokens();
    throw new Error("Session expired — please sign in again.");
  }
  const raw = await exchange(cfg, {
    grant_type: "refresh_token",
    client_id: cfg.cognitoClientID,
    refresh_token: tokens.refreshToken,
  });
  return (await saveTokens(env, raw)).accessToken;
}

async function exchange(cfg, params) {
  const res = await fetch(`https://${cfg.cognitoLoginDomain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token endpoint ${res.status}: ${text}`);
  }
  return res.json();
}
