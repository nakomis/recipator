import { render, screen } from '@testing-library/react';
import { useAuth } from 'react-oidc-context';
import { describe, expect, it, vi } from 'vitest';
import Home from './Home';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/auth', () => ({ signOut: vi.fn() }));
vi.mock('@/components/AppHeader', () => ({ default: () => <div data-testid="header" /> }));
vi.mock('@/components/SearchBar', () => ({ default: () => <div data-testid="search" /> }));
vi.mock('@/components/RecipeBrowser', () => ({ default: () => <div data-testid="browser" /> }));
vi.mock('@/components/Footer', () => ({ default: () => <div data-testid="footer" /> }));
vi.mock('@/components/SignInScreen', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  default: ({ onSignIn }: any) => (
    <button type="button" onClick={onSignIn}>
      Sign in
    </button>
  ),
}));

const mockUseAuth = vi.mocked(useAuth);
// biome-ignore lint/suspicious/noExplicitAny: partial auth state for tests
const auth = (o: Record<string, unknown>) => o as any;

describe('Home', () => {
  it('shows a loading state', () => {
    mockUseAuth.mockReturnValue(auth({ isLoading: true }));
    render(<Home />);
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it('shows an auth error', () => {
    mockUseAuth.mockReturnValue(auth({ isLoading: false, error: { message: 'bad' } }));
    render(<Home />);
    expect(screen.getByText(/bad/)).toBeInTheDocument();
  });

  it('shows the sign-in screen when unauthenticated', () => {
    mockUseAuth.mockReturnValue(auth({ isLoading: false, isAuthenticated: false }));
    render(<Home />);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows the app when authenticated', () => {
    mockUseAuth.mockReturnValue(auth({ isLoading: false, isAuthenticated: true }));
    render(<Home />);
    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getByTestId('browser')).toBeInTheDocument();
  });
});
