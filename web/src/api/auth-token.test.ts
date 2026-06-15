import { afterEach, describe, expect, it } from 'vitest';
import { authHeaders, getAccessToken, setAccessToken } from './auth-token';

afterEach(() => {
  setAccessToken(undefined);
});

describe('access token holder', () => {
  it('starts undefined', () => {
    expect(getAccessToken()).toBeUndefined();
  });

  it('stores and returns a token', () => {
    setAccessToken('abc123');
    expect(getAccessToken()).toBe('abc123');
  });

  it('clears the token when set to undefined', () => {
    setAccessToken('abc123');
    setAccessToken(undefined);
    expect(getAccessToken()).toBeUndefined();
  });
});

describe('authHeaders', () => {
  it('returns a Bearer header when a token is set', () => {
    setAccessToken('abc123');
    expect(authHeaders()).toEqual({ authorization: 'Bearer abc123' });
  });

  it('returns an empty object when there is no token', () => {
    setAccessToken(undefined);
    expect(authHeaders()).toEqual({});
  });
});
