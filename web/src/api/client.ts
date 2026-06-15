// Recipator REST client + TanStack Query hooks.
//
// The API is a plain HTTP API (API Gateway) guarded by a Cognito JWT authoriser.
// We attach the current access token via authHeaders() (kept fresh by
// <AuthTokenSync>), so these hooks work from anywhere under <AuthProvider>.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Config from '@/config/config';
import { authHeaders } from './auth-token';

/** A recipe as returned by GET /recipes (list projection). */
export interface RecipeSummary {
  recipeId: string;
  userId: string;
  userEmail?: string;
  title: string;
  url: string;
  savedAt: string;
  imageUrl?: string;
  deletedAt?: string;
}

/** A full recipe as returned by GET /recipes/{id}. */
export interface RecipeDetail extends RecipeSummary {
  ingredients: string[];
  method: string[];
  markdown?: string;
}

/** POST /extract response — a saved recipe plus image candidates to choose from. */
export interface ExtractResult extends RecipeDetail {
  imageCandidates?: string[];
}

/** A household group member as returned by GET /config. */
export interface GroupMember {
  userId: string;
  displayName?: string;
}

/** An item from GET /embeddings — full search text for every recipe. */
export interface EmbeddingItem {
  recipeId: string;
  userId: string;
  title: string;
  ingredients: string[];
  method: string[];
  model: string | null;
  embeddedAt: string | null;
  embedding: string | null;
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${Config.api.apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const recipesKey = ['recipes'] as const;
export const embeddingsKey = ['embeddings'] as const;
export const configKey = ['config'] as const;

/**
 * Owner's first name, derived from their email (or Cognito username) — e.g.
 * "martin@nakomis.com" → "Martin". Mirrors the iOS RecipeListItem helper so the
 * household picker labels match across clients.
 */
export function ownerFirstName(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const local = email.split('@')[0] ?? email;
  const first = local.split('.')[0] ?? local;
  if (!first) return undefined;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/**
 * GET /recipes — the recipe grid (newest first; images included). Always fetches
 * the household view (?all=true); the server scopes it to the caller's group
 * (SSM group-members), so a non-member just gets their own recipes back. The
 * owner picker then filters this set client-side, mirroring the iOS app.
 */
export function useRecipes() {
  return useQuery({
    queryKey: recipesKey,
    queryFn: () =>
      request<{ recipes: RecipeSummary[] }>('/recipes?all=true').then((r) => r.recipes),
  });
}

/** GET /config — the household group members (used to decide whether to show the owner picker). */
export function useConfig() {
  return useQuery({
    queryKey: configKey,
    queryFn: () => request<{ groupMembers: GroupMember[] }>('/config').then((r) => r.groupMembers),
    staleTime: 10 * 60 * 1000,
  });
}

/** GET /recipes/{id} — full detail. */
export function useRecipe(id: string) {
  return useQuery({
    queryKey: ['recipe', id],
    queryFn: () => request<RecipeDetail>(`/recipes/${id}`),
    enabled: !!id,
  });
}

/**
 * GET /embeddings — the search corpus (title + ingredients + method for every
 * recipe). Loaded lazily (only once the user starts typing) and cached.
 */
export function useSearchCorpus(enabled: boolean) {
  return useQuery({
    queryKey: embeddingsKey,
    queryFn: () => request<{ items: EmbeddingItem[] }>('/embeddings?all=true').then((r) => r.items),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * POST /extract — fetch, extract and save a recipe from a URL. Mirrors the iOS
 * app and Chrome extension: /extract returns imageCandidates but doesn't persist
 * one, so we PATCH the first candidate as the image (best-effort).
 */
export function useExtract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (url: string) => {
      const result = await request<ExtractResult>('/extract', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      const imageUrl = result.imageCandidates?.[0];
      if (result.recipeId && imageUrl) {
        try {
          await request(`/recipes/${result.recipeId}`, {
            method: 'PATCH',
            body: JSON.stringify({ imageUrl }),
          });
        } catch {
          /* image is best-effort */
        }
      }
      return result;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: recipesKey });
      void qc.invalidateQueries({ queryKey: embeddingsKey });
    },
  });
}

/** DELETE /recipes/{id} — soft delete. */
export function useDeleteRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<void>(`/recipes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: recipesKey });
      void qc.invalidateQueries({ queryKey: embeddingsKey });
    },
  });
}
