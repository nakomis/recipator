import { render, screen } from '@testing-library/react';
import { useAuth } from 'react-oidc-context';
import { describe, expect, it, vi } from 'vitest';
import { useSearchEvents, useSearchStats } from '@/api/client';
import SearchInsights from './SearchInsights';

vi.mock('react-oidc-context', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/auth', () => ({ signOut: vi.fn() }));
vi.mock('@/components/AppHeader', () => ({ default: () => <div data-testid="header" /> }));
vi.mock('@/components/Footer', () => ({ default: () => <div data-testid="footer" /> }));
vi.mock('@/components/SignInScreen', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  default: ({ onSignIn }: any) => (
    <button type="button" onClick={onSignIn}>
      Sign in
    </button>
  ),
}));
vi.mock('@/api/client', () => ({ useSearchStats: vi.fn(), useSearchEvents: vi.fn() }));

const mockUseAuth = vi.mocked(useAuth);
const mockUseStats = vi.mocked(useSearchStats);
const mockUseEvents = vi.mocked(useSearchEvents);

// biome-ignore lint/suspicious/noExplicitAny: partial auth state for tests
const auth = (o: Record<string, unknown>) => o as any;
// biome-ignore lint/suspicious/noExplicitAny: partial query result for tests
const query = (o: Record<string, unknown>) => o as any;

const stats = (over: Record<string, unknown> = {}) =>
  query({
    isLoading: false,
    data: {
      days: 30,
      totalSearches: 100,
      selectedSearches: 80,
      abandonmentRate: 0.2,
      semanticAvailableRate: 0.9,
      modes: [
        {
          mode: 'keyword',
          mrrAll: 0.4,
          mrrSelected: 0.5,
          rank1Rate: 0.3,
          coverage: 0.6,
          sampleSize: 100,
          selectedSampleSize: 80,
        },
        {
          mode: 'semantic',
          mrrAll: 0.6,
          mrrSelected: 0.75,
          rank1Rate: 0.5,
          coverage: 0.9,
          sampleSize: 90,
          selectedSampleSize: 72,
        },
        {
          mode: 'hybrid',
          mrrAll: 0.55,
          mrrSelected: 0.7,
          rank1Rate: 0.45,
          coverage: 1,
          sampleSize: 100,
          selectedSampleSize: 80,
        },
      ],
      latency: {
        total: { p50: 120, p95: 300 },
        keyword: { p50: 8, p95: 20 },
        semantic: { p50: 100, p95: 260 },
      },
    },
    ...over,
  });

const events = (rows: unknown[] = []) =>
  query({ isLoading: false, data: { events: rows, total: rows.length, truncated: false } });

describe('SearchInsights', () => {
  it('shows the sign-in screen when unauthenticated', () => {
    mockUseAuth.mockReturnValue(auth({ isLoading: false, isAuthenticated: false }));
    mockUseStats.mockReturnValue(stats());
    mockUseEvents.mockReturnValue(events());
    render(<SearchInsights />);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('renders per-strategy stats when authenticated', () => {
    mockUseAuth.mockReturnValue(auth({ isLoading: false, isAuthenticated: true }));
    mockUseStats.mockReturnValue(stats());
    mockUseEvents.mockReturnValue(events());
    render(<SearchInsights />);

    expect(screen.getByText('Keyword (FTS)')).toBeInTheDocument();
    expect(screen.getByText('Hybrid (shown)')).toBeInTheDocument();
    // "Semantic" also appears as a column header in the raw log, so assert via the badge:
    // semantic has the highest mrrSelected, so it is the row marked "best".
    expect(screen.getByText('best').parentElement).toHaveTextContent('Semantic');
    expect(screen.getByText('0.750')).toBeInTheDocument();
    expect(screen.getByText('20.0%')).toBeInTheDocument(); // abandonment
  });

  it('warns when there is too little data to trust', () => {
    mockUseAuth.mockReturnValue(auth({ isLoading: false, isAuthenticated: true }));
    mockUseStats.mockReturnValue(stats({ data: { ...stats().data, totalSearches: 4 } }));
    mockUseEvents.mockReturnValue(events());
    render(<SearchInsights />);
    expect(screen.getByText(/provisional/i)).toBeInTheDocument();
  });

  it('renders a dash where a strategy did not return the chosen recipe', () => {
    mockUseAuth.mockReturnValue(auth({ isLoading: false, isAuthenticated: true }));
    mockUseStats.mockReturnValue(stats());
    mockUseEvents.mockReturnValue(
      events([
        {
          searchId: 's1',
          userId: 'u1',
          at: '2026-07-20T10:00:00.000Z',
          query: 'chicken',
          resultCount: 3,
          latencyMs: 90,
          hybridRank: 1,
          keywordRank: null,
          semanticRank: 2,
        },
      ]),
    );
    render(<SearchInsights />);
    expect(screen.getByText('chicken')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows an empty state when nothing has been recorded', () => {
    mockUseAuth.mockReturnValue(auth({ isLoading: false, isAuthenticated: true }));
    mockUseStats.mockReturnValue(stats());
    mockUseEvents.mockReturnValue(events());
    render(<SearchInsights />);
    expect(screen.getByText(/No searches recorded yet/i)).toBeInTheDocument();
  });
});
