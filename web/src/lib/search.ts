import type { EmbeddingItem } from '@/api/client';

export interface SearchHit {
  recipeId: string;
  score: number;
}

/**
 * Client-side keyword search across title + ingredients + method — mirrors the
 * iOS FTS keyword index. AND semantics: every query token must appear somewhere;
 * title matches are weighted more heavily so the most relevant recipes rank first.
 *
 * (Semantic/vector search is deferred — it needs an on-device embedding model or
 * a server-side query-embed endpoint.)
 */
export function searchRecipes(corpus: EmbeddingItem[], query: string): SearchHit[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const item of corpus) {
    const title = item.title.toLowerCase();
    const body = [item.title, ...item.ingredients, ...item.method].join(' ').toLowerCase();

    if (!tokens.every((t) => body.includes(t))) continue; // require all tokens

    let score = 0;
    for (const t of tokens) {
      if (title.includes(t)) score += 3;
      else score += 1;
    }
    hits.push({ recipeId: item.recipeId, score });
  }

  return hits.sort((a, b) => b.score - a.score);
}
