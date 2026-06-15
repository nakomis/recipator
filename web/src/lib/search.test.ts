import { describe, expect, it } from 'vitest';
import type { EmbeddingItem } from '@/api/client';
import { searchRecipes } from './search';

function item(over: Partial<EmbeddingItem>): EmbeddingItem {
  return {
    recipeId: 'r',
    userId: 'u',
    title: '',
    ingredients: [],
    method: [],
    model: null,
    embeddedAt: null,
    embedding: null,
    ...over,
  };
}

const corpus: EmbeddingItem[] = [
  item({
    recipeId: 'keema',
    title: 'Keema with peas',
    ingredients: ['lamb mince', 'peas'],
    method: ['fry the lamb'],
  }),
  item({
    recipeId: 'ragu',
    title: 'Lentil ragu',
    ingredients: ['red lentils', 'tomatoes'],
    method: ['simmer'],
  }),
  item({
    recipeId: 'cake',
    title: 'Chocolate cake',
    ingredients: ['cocoa', 'flour'],
    method: ['bake'],
  }),
];

describe('searchRecipes', () => {
  it('returns nothing for an empty query', () => {
    expect(searchRecipes(corpus, '')).toEqual([]);
    expect(searchRecipes(corpus, '   ')).toEqual([]);
  });

  it('matches on the title', () => {
    const hits = searchRecipes(corpus, 'keema');
    expect(hits.map((h) => h.recipeId)).toEqual(['keema']);
  });

  it('matches on ingredients and method text', () => {
    expect(searchRecipes(corpus, 'lamb').map((h) => h.recipeId)).toEqual(['keema']);
    expect(searchRecipes(corpus, 'simmer').map((h) => h.recipeId)).toEqual(['ragu']);
  });

  it('requires every token to match (AND semantics)', () => {
    expect(searchRecipes(corpus, 'lentil tomatoes').map((h) => h.recipeId)).toEqual(['ragu']);
    expect(searchRecipes(corpus, 'lentil chocolate')).toEqual([]);
  });

  it('ranks title matches above body-only matches', () => {
    const corpus2: EmbeddingItem[] = [
      item({
        recipeId: 'body',
        title: 'Pasta bake',
        ingredients: ['cheese'],
        method: ['add lemon zest'],
      }),
      item({ recipeId: 'title', title: 'Lemon tart', ingredients: ['lemon'], method: ['chill'] }),
    ];
    const hits = searchRecipes(corpus2, 'lemon');
    expect(hits[0].recipeId).toBe('title');
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it('is case-insensitive', () => {
    expect(searchRecipes(corpus, 'KEEMA').map((h) => h.recipeId)).toEqual(['keema']);
  });
});
