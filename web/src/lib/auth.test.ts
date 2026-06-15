import type { AuthContextProps } from 'react-oidc-context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Config from '@/config/config';
import { oidcConfig, signOut } from './auth';

describe('oidcConfig', () => {
  it('maps the Cognito config onto OIDC parameters', () => {
    expect(oidcConfig.authority).toBe(Config.cognito.authority);
    expect(oidcConfig.client_id).toBe(Config.cognito.userPoolClientId);
    expect(oidcConfig.redirect_uri).toBe(Config.cognito.redirectUri);
    expect(oidcConfig.post_logout_redirect_uri).toBe(Config.cognito.logoutUri);
    expect(oidcConfig.response_type).toBe('code');
  });

  it('clears the IdP query string in onSigninCallback', () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    oidcConfig.onSigninCallback();
    expect(replaceState).toHaveBeenCalledWith({}, document.title, '/');
    replaceState.mockRestore();
  });
});

describe('signOut', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  it('removes the user and redirects to the hosted logout endpoint', () => {
    const removeUser = vi.fn().mockResolvedValue(undefined);
    signOut({ removeUser } as unknown as AuthContextProps);

    expect(removeUser).toHaveBeenCalledOnce();
    expect(window.location.href).toContain(`https://${Config.cognito.cognitoDomain}/logout`);
    expect(window.location.href).toContain(`client_id=${Config.cognito.userPoolClientId}`);
    expect(window.location.href).toContain(
      `logout_uri=${encodeURIComponent(Config.cognito.logoutUri)}`,
    );
  });
});
