import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddingItem, RecipeSummary } from '@/api/client';
import RecipeBrowser from './RecipeBrowser';

const { useRecipesMock, useSearchCorpusMock, useConfigMock, useAuthMock } = vi.hoisted(() => ({
  useRecipesMock: vi.fn(),
  useSearchCorpusMock: vi.fn(),
  useConfigMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

// Keep ownerFirstName real; only override the data hooks.
vi.mock('@/api/client', async (importActual) => ({
  ...(await importActual<typeof import('@/api/client')>()),
  useRecipes: useRecipesMock,
  useSearchCorpus: useSearchCorpusMock,
  useConfig: useConfigMock,
}));

vi.mock('react-oidc-context', () => ({ useAuth: useAuthMock }));

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

beforeEach(() => {
  // Default: signed in as a non-group user — no owner picker.
  useAuthMock.mockReturnValue({ user: { profile: { sub: 'me', email: 'martin@nakomis.com' } } });
  useConfigMock.mockReturnValue({ data: [] });
  useSearchCorpusMock.mockReturnValue({ isLoading: false });
});

describe('RecipeBrowser', () => {
  it('shows an error when the list fails', () => {
    useRecipesMock.mockReturnValue({ isLoading: false, isError: true, error: new Error('down') });
    render(<RecipeBrowser query="" />);
    expect(screen.getByText(/down/)).toBeInTheDocument();
  });

  it('prompts when there are no recipes', () => {
    useRecipesMock.mockReturnValue({ isLoading: false, isError: false, data: [] });
    render(<RecipeBrowser query="" />);
    expect(screen.getByText(/No recipes here yet/)).toBeInTheDocument();
  });

  it('lists all recipes when not searching', () => {
    useRecipesMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [summary({ recipeId: 'a', title: 'Keema' }), summary({ recipeId: 'b', title: 'Ragu' })],
    });
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

  it('hides the owner picker for non-group users', () => {
    useRecipesMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [summary({ recipeId: 'a', title: 'Keema' })],
    });
    render(<RecipeBrowser query="" />);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('scopes to my own recipes by default and shows everyone when picked', async () => {
    useConfigMock.mockReturnValue({ data: [{ userId: 'me' }, { userId: 'mum' }] });
    useRecipesMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [
        summary({ recipeId: 'a', userId: 'me', userEmail: 'martin@nakomis.com', title: 'Mine' }),
        summary({ recipeId: 'b', userId: 'mum', userEmail: 'jane@nakomis.com', title: 'Hers' }),
      ],
    });
    render(<RecipeBrowser query="" />);

    // Default selection is the current user — only their recipe shows.
    const grid = screen.getByTestId('grid');
    expect(grid).toHaveTextContent('Mine');
    expect(grid).not.toHaveTextContent('Hers');

    // The picker is present with an Everyone option and an owner-named tab.
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Everyone' }));
    expect(screen.getByTestId('grid')).toHaveTextContent('Mine');
    expect(screen.getByTestId('grid')).toHaveTextContent('Hers');
  });
});
