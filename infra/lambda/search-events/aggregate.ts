// Search scoring aggregation (RECP-21) — pure functions, no AWS SDK, so the arithmetic can
// be unit tested against fixtures without DynamoDB.
//
// Every search runs both the keyword (FTS) and semantic strategies and shows the user the
// merged hybrid list. We record the selected recipe's rank in all three rankings, so a single
// real search scores all three counterfactually. See PLAN.md / RECP-21 for why this beats an
// A/B split at household volume.

export type Mode = 'keyword' | 'semantic' | 'hybrid';

export const MODES: Mode[] = ['keyword', 'semantic', 'hybrid'];

/** A stored search item, optionally carrying the selection that followed it. */
export interface StoredSearchEvent {
  searchId: string;
  userId: string;
  at: string;
  query?: string;
  latencyMs?: number;
  keywordMs?: number;
  semanticMs?: number;
  /** False before the on-device embedding model has finished downloading/compiling. */
  semanticAvailable?: boolean;
  resultCount?: number;
  /** Present only if the user tapped a result. Absent = abandoned search. */
  selectedRecipeId?: string;
  /** 1-based rank of the selected recipe; null/absent = that strategy did not return it. */
  hybridRank?: number | null;
  keywordRank?: number | null;
  semanticRank?: number | null;
}

export interface Percentiles {
  p50: number;
  p95: number;
}

export interface ModeStats {
  mode: Mode;
  /** Mean reciprocal rank over every search in the pool; abandoned and not-found both score 0. */
  mrrAll: number;
  /** Mean reciprocal rank over only the searches that ended in a tap. */
  mrrSelected: number;
  /** Share of selections this strategy ranked first. */
  rank1Rate: number;
  /** Share of selections this strategy returned at all, at any rank. */
  coverage: number;
  /** Searches contributing to mrrAll. */
  sampleSize: number;
  /** Searches contributing to mrrSelected, rank1Rate and coverage. */
  selectedSampleSize: number;
}

export interface SearchStats {
  days: number;
  totalSearches: number;
  selectedSearches: number;
  abandonmentRate: number;
  semanticAvailableRate: number;
  modes: ModeStats[];
  latency: { total: Percentiles; keyword: Percentiles; semantic: Percentiles };
}

function rankFor(ev: StoredSearchEvent, mode: Mode): number | null {
  const r = mode === 'keyword' ? ev.keywordRank : mode === 'semantic' ? ev.semanticRank : ev.hybridRank;
  return typeof r === 'number' && r > 0 ? r : null;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : 0;
}

function round(x: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

/** Nearest-rank percentile over a sorted-ascending copy. Empty input yields 0. */
export function percentile(values: number[], p: number): number {
  const xs = values.filter(v => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return 0;
  const idx = Math.min(xs.length - 1, Math.max(0, Math.ceil(p * xs.length) - 1));
  return Math.round(xs[idx]);
}

function percentiles(values: number[]): Percentiles {
  return { p50: percentile(values, 0.5), p95: percentile(values, 0.95) };
}

function statsForMode(events: StoredSearchEvent[], mode: Mode): ModeStats {
  // Semantic search is inert until the on-device model has landed — the semantic list is
  // empty by construction, so every rank would be null. Including those searches would score
  // model-download latency, not ranking quality, so they're excluded from the semantic pool
  // only. Keyword and hybrid work from first launch and use every search.
  const pool = mode === 'semantic' ? events.filter(e => e.semanticAvailable === true) : events;
  const selected = pool.filter(e => !!e.selectedRecipeId);

  const reciprocal = (e: StoredSearchEvent) => {
    const r = rankFor(e, mode);
    return r === null ? 0 : 1 / r;
  };

  return {
    mode,
    mrrAll: round(mean(pool.map(reciprocal))),
    mrrSelected: round(mean(selected.map(reciprocal))),
    rank1Rate: round(ratio(selected.filter(e => rankFor(e, mode) === 1).length, selected.length)),
    coverage: round(ratio(selected.filter(e => rankFor(e, mode) !== null).length, selected.length)),
    sampleSize: pool.length,
    selectedSampleSize: selected.length,
  };
}

export function aggregate(events: StoredSearchEvent[], days: number): SearchStats {
  const selectedSearches = events.filter(e => !!e.selectedRecipeId).length;
  const semanticEvents = events.filter(e => e.semanticAvailable === true);

  return {
    days,
    totalSearches: events.length,
    selectedSearches,
    abandonmentRate: round(ratio(events.length - selectedSearches, events.length)),
    semanticAvailableRate: round(ratio(semanticEvents.length, events.length)),
    modes: MODES.map(m => statsForMode(events, m)),
    latency: {
      total: percentiles(events.map(e => e.latencyMs).filter((v): v is number => typeof v === 'number')),
      keyword: percentiles(events.map(e => e.keywordMs).filter((v): v is number => typeof v === 'number')),
      semantic: percentiles(semanticEvents.map(e => e.semanticMs).filter((v): v is number => typeof v === 'number')),
    },
  };
}
