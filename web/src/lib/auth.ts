import type { AuthContextProps } from 'react-oidc-context';
import Config from '@/config/config';

/** OIDC config for the Cognito user pool, passed to <AuthProvider>. */
export const oidcConfig = {
  authority: Config.cognito.authority,
  client_id: Config.cognito.userPoolClientId,
  redirect_uri: Config.cognito.redirectUri,
  post_logout_redirect_uri: Config.cognito.logoutUri,
  response_type: 'code',
  scope: 'email openid profile',
  // Strip the ?code=…&state=… query the IdP appends, leaving a clean URL.
  onSigninCallback: () => {
    window.history.replaceState({}, document.title, '/');
  },
};

/**
 * Sign out: clear the local session, then redirect to Cognito's hosted logout
 * endpoint so the IdP session is cleared too.
 */
export function signOut(auth: AuthContextProps) {
  const logoutUrl =
    `https://${Config.cognito.cognitoDomain}/logout` +
    `?client_id=${Config.cognito.userPoolClientId}` +
    `&logout_uri=${encodeURIComponent(Config.cognito.logoutUri)}`;
  void auth.removeUser();
  window.location.href = logoutUrl;
}
