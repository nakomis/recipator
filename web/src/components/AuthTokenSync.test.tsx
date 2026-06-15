import { render } from '@testing-library/react';
import { useAuth } from 'react-oidc-context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken, setAccessToken } from '@/api/auth-token';
import AuthTokenSync from './AuthTokenSync';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));
const mockUseAuth = vi.mocked(useAuth);

function authState(overrides: Record<string, unknown>) {
  return overrides as unknown as ReturnType<typeof useAuth>;
}

describe('AuthTokenSync', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => setAccessToken(undefined));

  it('pushes the access token into the holder', () => {
    mockUseAuth.mockReturnValue(authState({ user: { access_token: 'tok-1' } }));
    render(<AuthTokenSync />);
    expect(getAccessToken()).toBe('tok-1');
  });

  it('clears the holder when there is no user', () => {
    setAccessToken('stale');
    mockUseAuth.mockReturnValue(authState({ user: null }));
    render(<AuthTokenSync />);
    expect(getAccessToken()).toBeUndefined();
  });
});
