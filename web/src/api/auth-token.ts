/**
 * Module-scoped holder for the current OIDC access token.
 *
 * The oRPC link's `headers` callback runs per request, outside React, so it
 * cannot call `useAuth()`. Instead the <AuthTokenSync> component pushes the
 * latest access token in here whenever the Cognito session changes, and the
 * link reads it back out when building each request's Authorization header.
 */
let accessToken: string | undefined;

export function setAccessToken(token: string | undefined): void {
  accessToken = token;
}

export function getAccessToken(): string | undefined {
  return accessToken;
}

/** Authorization header for an API request, or `{}` when there's no session. */
export function authHeaders(): Record<string, string> {
  return accessToken ? { authorization: `Bearer ${accessToken}` } : {};
}
