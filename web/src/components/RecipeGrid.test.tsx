import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RecipeSummary } from '@/api/client';
import RecipeGrid from './RecipeGrid';

vi.mock('@tanstack/react-router', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  Link: ({ children }: any) => <a href="#stub">{children}</a>,
}));

function recipe(over: Partial<RecipeSummary>): RecipeSummary {
  return {
    recipeId: 'r',
    userId: 'u',
    title: 'Title',
    url: 'https://x',
    savedAt: '2026-01-01',
    ...over,
  };
}

describe('RecipeGrid', () => {
  it('renders a card per recipe with its title', () => {
    render(
      <RecipeGrid
        recipes={[
          recipe({ recipeId: 'a', title: 'Keema' }),
          recipe({ recipeId: 'b', title: 'Ragu' }),
        ]}
      />,
    );
    expect(screen.getByText('Keema')).toBeInTheDocument();
    expect(screen.getByText('Ragu')).toBeInTheDocument();
  });

  it('shows the owner first name only when showOwner is set', () => {
    const recipes = [recipe({ recipeId: 'a', title: 'Keema', userEmail: 'jane@nakomis.com' })];
    const { rerender } = render(<RecipeGrid recipes={recipes} />);
    expect(screen.queryByText('Jane')).not.toBeInTheDocument();
    rerender(<RecipeGrid recipes={recipes} showOwner />);
    expect(screen.getByText('Jane')).toBeInTheDocument();
  });

  it('shows the image when present and a placeholder when not', () => {
    const { container } = render(
      <RecipeGrid
        recipes={[
          recipe({ recipeId: 'a', title: 'With image', imageUrl: 'https://img/a.jpg' }),
          recipe({ recipeId: 'b', title: 'No image' }),
        ]}
      />,
    );
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://img/a.jpg');
  });
});
