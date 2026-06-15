import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from './auth-token';
import {
  request,
  useDeleteRecipe,
  useExtract,
  useRecipe,
  useRecipes,
  useSearchCorpus,
} from './client';

function makeRes(
  body: unknown,
  { ok = true, status = 200 }: { ok?: boolean; status?: number } = {},
) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken('test-token');
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(undefined);
});

describe('request', () => {
  it('attaches the bearer token and parses JSON', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({ hello: 'world' }));
    const body = await request<{ hello: string }>('/thing');
    expect(body.hello).toBe('world');
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.authorization).toBe('Bearer test-token');
  });

  it('throws the server error message on a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({ error: 'nope' }, { ok: false, status: 400 }));
    await expect(request('/thing')).rejects.toThrow('nope');
  });

  it('returns undefined for 204 No Content', async () => {
    fetchMock.mockResolvedValueOnce(makeRes('', { status: 204 }));
    await expect(request('/thing', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});

describe('useRecipes', () => {
  it('unwraps the recipes array', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({ recipes: [{ recipeId: 'a', title: 'A' }] }));
    const { result } = renderHook(() => useRecipes(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ recipeId: 'a', title: 'A' }]);
  });
});

describe('useRecipe', () => {
  it('fetches a single recipe by id', async () => {
    fetchMock.mockResolvedValueOnce(
      makeRes({ recipeId: 'a', title: 'A', ingredients: [], method: [] }),
    );
    const { result } = renderHook(() => useRecipe('a'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.title).toBe('A');
    expect(fetchMock.mock.calls[0][0]).toContain('/recipes/a');
  });
});

describe('useSearchCorpus', () => {
  it('does not fetch when disabled', () => {
    renderHook(() => useSearchCorpus(false), { wrapper: wrapper() });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('unwraps the items array when enabled', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({ items: [{ recipeId: 'a' }] }));
    const { result } = renderHook(() => useSearchCorpus(true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ recipeId: 'a' }]);
  });
});

describe('useExtract', () => {
  it('extracts then PATCHes the first image candidate', async () => {
    fetchMock
      .mockResolvedValueOnce(
        makeRes({
          recipeId: 'x',
          title: 'X',
          imageCandidates: ['https://img/1.jpg', 'https://img/2.jpg'],
        }),
      )
      .mockResolvedValueOnce(makeRes({ ok: true }));
    const { result } = renderHook(() => useExtract(), { wrapper: wrapper() });
    result.current.mutate('https://recipe.example/x');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [extractUrl, extractInit] = fetchMock.mock.calls[0];
    expect(extractUrl).toContain('/extract');
    expect(extractInit.method).toBe('POST');
    const [patchUrl, patchInit] = fetchMock.mock.calls[1];
    expect(patchUrl).toContain('/recipes/x');
    expect(patchInit.method).toBe('PATCH');
    expect(JSON.parse(patchInit.body).imageUrl).toBe('https://img/1.jpg');
  });

  it('skips the image PATCH when there are no candidates', async () => {
    fetchMock.mockResolvedValueOnce(makeRes({ recipeId: 'x', title: 'X' }));
    const { result } = renderHook(() => useExtract(), { wrapper: wrapper() });
    result.current.mutate('https://recipe.example/x');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('useDeleteRecipe', () => {
  it('issues a DELETE', async () => {
    fetchMock.mockResolvedValueOnce(makeRes('', { status: 204 }));
    const { result } = renderHook(() => useDeleteRecipe(), { wrapper: wrapper() });
    result.current.mutate('a');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });
});
