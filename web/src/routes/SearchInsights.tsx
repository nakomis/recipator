// Search scoring dashboard (RECP-21).
//
// Every search runs both the keyword (FTS) and semantic strategies and shows the user the
// merged hybrid list. We record the selected recipe's rank in all three rankings, so one real
// search scores all three — see the caveat note at the foot of the page for what that does and
// doesn't tell us.
import { useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { type ModeStats, type SearchMode, useSearchEvents, useSearchStats } from '@/api/client';
import AppHeader from '@/components/AppHeader';
import Footer from '@/components/Footer';
import SignInScreen from '@/components/SignInScreen';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { signOut } from '@/lib/auth';

const DAY_RANGES = [7, 30, 90] as const;

/** Below this, MRR is noise rather than signal — say so rather than let it be read as fact. */
const LOW_DATA_THRESHOLD = 30;

const MODE_LABEL: Record<SearchMode, string> = {
  keyword: 'Keyword (FTS)',
  semantic: 'Semantic',
  hybrid: 'Hybrid (shown)',
};

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const mrr = (x: number) => x.toFixed(3);
const ms = (x: number) => `${x}ms`;

function rankCell(rank: number | null | undefined) {
  if (rank === null || rank === undefined) return <span className="text-muted-foreground">—</span>;
  return <span className={rank === 1 ? 'font-semibold' : undefined}>{rank}</span>;
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="text-muted-foreground pt-0 text-sm">{hint}</CardContent>}
    </Card>
  );
}

function ModeTable({ modes }: { modes: ModeStats[] }) {
  // Only strategies with data can win; a mode with no selections isn't "best", it's untested.
  const contenders = modes.filter((m) => m.selectedSampleSize > 0);
  const best = contenders.length
    ? contenders.reduce((a, b) => (b.mrrSelected > a.mrrSelected ? b : a)).mode
    : null;
  const maxMrr = Math.max(...modes.map((m) => m.mrrSelected), 0.0001);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left">
            <th className="py-2 pr-4 font-medium">Strategy</th>
            <th className="py-2 pr-4 font-medium">MRR (selected)</th>
            <th className="py-2 pr-4 font-medium">MRR (all)</th>
            <th className="py-2 pr-4 font-medium">Rank 1</th>
            <th className="py-2 pr-4 font-medium">Coverage</th>
            <th className="py-2 pr-4 font-medium">n</th>
          </tr>
        </thead>
        <tbody>
          {modes.map((m) => (
            <tr key={m.mode} className="border-b last:border-0">
              <td className="py-3 pr-4">
                <div className="flex items-center gap-2">
                  {MODE_LABEL[m.mode]}
                  {best === m.mode && <Badge>best</Badge>}
                </div>
              </td>
              <td className="py-3 pr-4">
                <div className="flex items-center gap-2">
                  <span className="tabular-nums">{mrr(m.mrrSelected)}</span>
                  <span className="bg-muted h-2 w-24 overflow-hidden rounded-full">
                    <span
                      className="bg-primary block h-full rounded-full"
                      style={{ width: `${Math.min(100, (m.mrrSelected / maxMrr) * 100)}%` }}
                    />
                  </span>
                </div>
              </td>
              <td className="py-3 pr-4 tabular-nums">{mrr(m.mrrAll)}</td>
              <td className="py-3 pr-4 tabular-nums">{pct(m.rank1Rate)}</td>
              <td className="py-3 pr-4 tabular-nums">{pct(m.coverage)}</td>
              <td className="text-muted-foreground py-3 pr-4 tabular-nums">
                {m.selectedSampleSize} / {m.sampleSize}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Insights() {
  const [days, setDays] = useState<number>(30);
  const stats = useSearchStats(days);
  const events = useSearchEvents(days);

  if (stats.isLoading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-8">
        <Spinner /> Loading search stats…
      </div>
    );
  }

  if (stats.error) {
    return <div className="text-destructive p-8">Error: {(stats.error as Error).message}</div>;
  }

  const s = stats.data;
  if (!s) return null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Search insights</h1>
          <p className="text-muted-foreground text-sm">
            Which ranking strategy surfaces the recipe you actually pick.
          </p>
        </div>
        <div className="flex gap-1">
          {DAY_RANGES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={
                d === days
                  ? 'bg-muted text-foreground rounded-md px-3 py-1.5 text-sm font-medium'
                  : 'text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-sm'
              }
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {s.totalSearches < LOW_DATA_THRESHOLD && (
        <div className="bg-muted text-muted-foreground rounded-md p-4 text-sm">
          Only {s.totalSearches} search{s.totalSearches === 1 ? '' : 'es'} in this window. MRR over
          so few data points is noise — treat these numbers as provisional until there are at least{' '}
          {LOW_DATA_THRESHOLD}.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Searches"
          value={String(s.totalSearches)}
          hint={`${s.selectedSearches} ended in a tap`}
        />
        <StatCard label="Abandonment" value={pct(s.abandonmentRate)} hint="No result was opened" />
        <StatCard
          label="Median latency"
          value={ms(s.latency.total.p50)}
          hint={`p95 ${ms(s.latency.total.p95)}`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Strategy comparison</CardTitle>
          <CardDescription>
            Mean reciprocal rank — 1.000 means the chosen recipe was always first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ModeTable modes={s.modes} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Latency</CardTitle>
          <CardDescription>
            Semantic figures cover only searches where the on-device model was ready (
            {pct(s.semanticAvailableRate)} of searches).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="py-2 pr-4 font-medium">Phase</th>
                  <th className="py-2 pr-4 font-medium">p50</th>
                  <th className="py-2 pr-4 font-medium">p95</th>
                </tr>
              </thead>
              <tbody>
                {(['total', 'keyword', 'semantic'] as const).map((phase) => (
                  <tr key={phase} className="border-b last:border-0">
                    <td className="py-3 pr-4 capitalize">{phase}</td>
                    <td className="py-3 pr-4 tabular-nums">{ms(s.latency[phase].p50)}</td>
                    <td className="py-3 pr-4 tabular-nums">{ms(s.latency[phase].p95)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent searches</CardTitle>
          <CardDescription>
            {events.data?.truncated
              ? `Showing the latest ${events.data.events.length} of ${events.data.total}.`
              : `${events.data?.total ?? 0} in this window.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.isLoading ? (
            <div className="text-muted-foreground flex items-center gap-2">
              <Spinner /> Loading…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-2 pr-4 font-medium">When</th>
                    <th className="py-2 pr-4 font-medium">Query</th>
                    <th className="py-2 pr-4 font-medium">Results</th>
                    <th className="py-2 pr-4 font-medium">Hybrid</th>
                    <th className="py-2 pr-4 font-medium">Keyword</th>
                    <th className="py-2 pr-4 font-medium">Semantic</th>
                    <th className="py-2 pr-4 font-medium">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {(events.data?.events ?? []).map((e) => (
                    <tr key={e.searchId} className="border-b last:border-0">
                      <td className="text-muted-foreground py-2 pr-4 whitespace-nowrap">
                        {new Date(e.at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4">
                        {e.query || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">{e.resultCount ?? 0}</td>
                      <td className="py-2 pr-4 tabular-nums">{rankCell(e.hybridRank)}</td>
                      <td className="py-2 pr-4 tabular-nums">{rankCell(e.keywordRank)}</td>
                      <td className="py-2 pr-4 tabular-nums">{rankCell(e.semanticRank)}</td>
                      <td className="text-muted-foreground py-2 pr-4 tabular-nums">
                        {ms(e.latencyMs ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!events.data?.events.length && (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  No searches recorded yet.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs leading-relaxed">
        <strong>How to read this.</strong> Only the hybrid ranking was actually shown. The keyword
        and semantic ranks are counterfactual — where the chosen recipe <em>would</em> have appeared
        under that strategy alone. Because people tap what they see, a recipe at hybrid rank 1 was
        likelier to be chosen than the same recipe at semantic rank 1 would have been, so hybrid
        carries a built-in advantage. Rows with a dash mean that strategy did not return the chosen
        recipe at all. Semantic is scored only over searches made after the on-device model finished
        downloading.
      </p>
    </div>
  );
}

function SearchInsights() {
  const auth = useAuth();

  if (auth.isLoading) {
    return (
      <div className="text-muted-foreground flex min-h-screen items-center justify-center gap-2 p-8">
        <Spinner /> Loading…
      </div>
    );
  }

  if (auth.error) {
    return (
      <div className="text-muted-foreground flex min-h-screen items-center justify-center p-8">
        Error: {auth.error.message}
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return <SignInScreen onSignIn={() => void auth.signinRedirect()} />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader onSignOut={() => signOut(auth)} />
      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
        <Insights />
      </main>
      <Footer />
    </div>
  );
}

export default SearchInsights;
