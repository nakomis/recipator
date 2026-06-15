import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth } from 'react-oidc-context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDeleteRecipe, useRecipe } from '@/api/client';
import RecipeDetail from './RecipeDetail';

const { navigate, deleteMutate } = vi.hoisted(() => ({ navigate: vi.fn(), deleteMutate: vi.fn() }));

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  Link: ({ children }: any) => <a href="#stub">{children}</a>,
  useParams: () => ({ recipeId: 'r1' }),
  useNavigate: () => navigate,
}));
vi.mock('@/api/client', () => ({ useRecipe: vi.fn(), useDeleteRecipe: vi.fn() }));
vi.mock('@/components/SignInScreen', () => ({ default: () => <div>Sign in</div> }));

const mockUseAuth = vi.mocked(useAuth);
const mockUseRecipe = vi.mocked(useRecipe);
const mockUseDelete = vi.mocked(useDeleteRecipe);
// biome-ignore lint/suspicious/noExplicitAny: partial states for tests
const any = (o: Record<string, unknown>) => o as any;

afterEach(() => vi.clearAllMocks());

describe('RecipeDetail', () => {
  it('shows sign-in when unauthenticated', () => {
    mockUseAuth.mockReturnValue(any({ isLoading: false, isAuthenticated: false }));
    mockUseRecipe.mockReturnValue(any({ isLoading: false }));
    mockUseDelete.mockReturnValue(any({ mutate: deleteMutate }));
    render(<RecipeDetail />);
    expect(screen.getByText('Sign in')).toBeInTheDocument();
  });

  it('renders title, ingredients and method', () => {
    mockUseAuth.mockReturnValue(any({ isLoading: false, isAuthenticated: true }));
    mockUseRecipe.mockReturnValue(
      any({
        isLoading: false,
        isError: false,
        data: {
          recipeId: 'r1',
          title: 'Keema',
          url: 'https://x',
          ingredients: ['lamb', 'peas'],
          method: ['fry', 'serve'],
        },
      }),
    );
    mockUseDelete.mockReturnValue(any({ mutate: deleteMutate, isPending: false }));
    render(<RecipeDetail />);
    expect(screen.getByRole('heading', { name: 'Keema' })).toBeInTheDocument();
    expect(screen.getByText('lamb')).toBeInTheDocument();
    expect(screen.getByText('serve')).toBeInTheDocument();
  });

  it('deletes after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockUseAuth.mockReturnValue(any({ isLoading: false, isAuthenticated: true }));
    mockUseRecipe.mockReturnValue(
      any({
        isLoading: false,
        isError: false,
        data: { recipeId: 'r1', title: 'Keema', ingredients: [], method: [] },
      }),
    );
    mockUseDelete.mockReturnValue(any({ mutate: deleteMutate, isPending: false }));
    render(<RecipeDetail />);
    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(deleteMutate).toHaveBeenCalledWith('r1', expect.anything());
  });
});
