import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EmbeddingItem, RecipeSummary } from '@/api/client';
import RecipeBrowser from './RecipeBrowser';

const { useRecipesMock, useSearchCorpusMock } = vi.hoisted(() => ({
  useRecipesMock: vi.fn(),
  useSearchCorpusMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  useRecipes: useRecipesMock,
  useSearchCorpus: useSearchCorpusMock,
}));

vi.mock('@/components/RecipeGrid', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  default: ({ recipes }: any) => (
    <div data-testid="grid">{recipes.map((r: RecipeSummary) => r.title).join(',')}</div>
  ),
}));

function summary(over: Partial<RecipeSummary>): RecipeSummary {
  return { recipeId: 'r', userId: 'u', title: 'T', url: 'https://x', savedAt: '2026', ...over };
}
function emb(over: Partial<EmbeddingItem>): EmbeddingItem {
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

describe('RecipeBrowser', () => {
  it('shows an error when the list fails', () => {
    useRecipesMock.mockReturnValue({ isLoading: false, isError: true, error: new Error('down') });
    useSearchCorpusMock.mockReturnValue({ isLoading: false });
    render(<RecipeBrowser query="" />);
    expect(screen.getByText(/down/)).toBeInTheDocument();
  });

  it('prompts to add when there are no recipes', () => {
    useRecipesMock.mockReturnValue({ isLoading: false, isError: false, data: [] });
    useSearchCorpusMock.mockReturnValue({ isLoading: false });
    render(<RecipeBrowser query="" />);
    expect(screen.getByText(/No recipes yet/)).toBeInTheDocument();
  });

  it('lists all recipes when not searching', () => {
    useRecipesMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [summary({ recipeId: 'a', title: 'Keema' }), summary({ recipeId: 'b', title: 'Ragu' })],
    });
    useSearchCorpusMock.mockReturnValue({ isLoading: false });
    render(<RecipeBrowser query="" />);
    expect(screen.getByTestId('grid')).toHaveTextContent('Keema,Ragu');
  });

  it('filters by the search query', () => {
    useRecipesMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [summary({ recipeId: 'a', title: 'Keema' }), summary({ recipeId: 'b', title: 'Ragu' })],
    });
    useSearchCorpusMock.mockReturnValue({
      isLoading: false,
      data: [emb({ recipeId: 'a', title: 'Keema' }), emb({ recipeId: 'b', title: 'Ragu' })],
    });
    render(<RecipeBrowser query="keema" />);
    expect(screen.getByTestId('grid')).toHaveTextContent('Keema');
    expect(screen.getByTestId('grid')).not.toHaveTextContent('Ragu');
  });

  it('reports no matches', () => {
    useRecipesMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [summary({ recipeId: 'a', title: 'Keema' })],
    });
    useSearchCorpusMock.mockReturnValue({
      isLoading: false,
      data: [emb({ recipeId: 'a', title: 'Keema' })],
    });
    render(<RecipeBrowser query="zzz" />);
    expect(screen.getByText(/No recipes match/)).toBeInTheDocument();
  });
});
