// RECP-21 — search scoring aggregation. Pure arithmetic, no AWS, no mocks.
import { aggregate, percentile, StoredSearchEvent, Mode } from '../lambda/search-events/aggregate';

let seq = 0;
function ev(over: Partial<StoredSearchEvent> = {}): StoredSearchEvent {
  seq += 1;
  return {
    searchId: `s${seq}`,
    userId: 'u1',
    at: `2026-07-${String((seq % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
    query: 'chicken',
    latencyMs: 100,
    keywordMs: 10,
    semanticMs: 80,
    semanticAvailable: true,
    resultCount: 5,
    ...over,
  };
}

/** A search that ended in a tap, with the selected recipe's rank in each strategy. */
function selected(hybrid: number | null, keyword: number | null, semantic: number | null, over: Partial<StoredSearchEvent> = {}) {
  return ev({ selectedRecipeId: 'r1', hybridRank: hybrid, keywordRank: keyword, semanticRank: semantic, ...over });
}

const modeOf = (stats: ReturnType<typeof aggregate>, m: Mode) => stats.modes.find(x => x.mode === m)!;

describe('percentile', () => {
  it('returns 0 for empty input', () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([], 0.95)).toBe(0);
  });

  it('uses nearest-rank on sorted values', () => {
    const xs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(xs, 0.5)).toBe(50);
    expect(percentile(xs, 0.95)).toBe(100);
  });

  it('sorts numerically, not lexicographically', () => {
    expect(percentile([9, 100, 20], 0.5)).toBe(20);
  });

  it('handles a single value', () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.95)).toBe(42);
  });

  it('ignores non-finite values', () => {
    // NaN and Infinity are dropped, leaving [10, 20]; nearest-rank p50 of two values is the
    // first, so this also pins down that a bad reading can't shift the percentile upward.
    expect(percentile([10, NaN, 20, Infinity], 0.5)).toBe(10);
    expect(percentile([10, NaN, 20, Infinity], 0.95)).toBe(20);
  });
});

describe('aggregate — empty input', () => {
  it('returns zeroed stats rather than NaN', () => {
    const stats = aggregate([], 30);
    expect(stats.totalSearches).toBe(0);
    expect(stats.abandonmentRate).toBe(0);
    expect(stats.semanticAvailableRate).toBe(0);
    for (const m of stats.modes) {
      expect(m.mrrAll).toBe(0);
      expect(m.mrrSelected).toBe(0);
      expect(m.rank1Rate).toBe(0);
      expect(m.coverage).toBe(0);
    }
    expect(stats.latency.total).toEqual({ p50: 0, p95: 0 });
  });
});

describe('aggregate — MRR arithmetic', () => {
  it('averages reciprocal ranks', () => {
    // hybrid ranks 1, 2, 4 -> (1 + 0.5 + 0.25) / 3 = 0.5833
    const stats = aggregate([selected(1, 1, 1), selected(2, 2, 2), selected(4, 4, 4)], 30);
    expect(modeOf(stats, 'hybrid').mrrSelected).toBeCloseTo(0.5833, 4);
    expect(modeOf(stats, 'hybrid').mrrAll).toBeCloseTo(0.5833, 4);
  });

  it('scores abandoned searches as zero in mrrAll but excludes them from mrrSelected', () => {
    // One tap at rank 1, one abandoned.
    const stats = aggregate([selected(1, 1, 1), ev()], 30);
    const hybrid = modeOf(stats, 'hybrid');
    expect(hybrid.mrrAll).toBeCloseTo(0.5, 4);      // (1 + 0) / 2
    expect(hybrid.mrrSelected).toBeCloseTo(1.0, 4); // (1) / 1
    expect(hybrid.sampleSize).toBe(2);
    expect(hybrid.selectedSampleSize).toBe(1);
    expect(stats.abandonmentRate).toBeCloseTo(0.5, 4);
  });

  it('scores a null rank as zero — the strategy did not return the chosen recipe', () => {
    // Keyword missed it entirely; semantic had it first.
    const stats = aggregate([selected(3, null, 1)], 30);
    expect(modeOf(stats, 'keyword').mrrSelected).toBe(0);
    expect(modeOf(stats, 'keyword').coverage).toBe(0);
    expect(modeOf(stats, 'semantic').mrrSelected).toBe(1);
    expect(modeOf(stats, 'semantic').coverage).toBe(1);
  });

  it('treats a zero or negative rank as absent', () => {
    const stats = aggregate([selected(0, -1, 2)], 30);
    expect(modeOf(stats, 'hybrid').coverage).toBe(0);
    expect(modeOf(stats, 'keyword').coverage).toBe(0);
    expect(modeOf(stats, 'semantic').coverage).toBe(1);
  });
});

describe('aggregate — rank-1 rate and coverage', () => {
  it('counts only rank 1 for rank1Rate, any rank for coverage', () => {
    const stats = aggregate([selected(1, 1, 1), selected(2, 5, 2), selected(1, null, 3)], 30);
    const keyword = modeOf(stats, 'keyword');
    expect(keyword.rank1Rate).toBeCloseTo(1 / 3, 4); // only the first
    expect(keyword.coverage).toBeCloseTo(2 / 3, 4);  // first and second
    const hybrid = modeOf(stats, 'hybrid');
    expect(hybrid.rank1Rate).toBeCloseTo(2 / 3, 4);
    expect(hybrid.coverage).toBe(1);
  });
});

describe('aggregate — semantic availability', () => {
  it('excludes searches made before the model landed from the semantic pool only', () => {
    // Two searches with the model ready (semantic found it at rank 1), two without it.
    const events = [
      selected(1, 2, 1, { semanticAvailable: true }),
      selected(1, 2, 1, { semanticAvailable: true }),
      selected(1, 1, null, { semanticAvailable: false }),
      selected(1, 1, null, { semanticAvailable: false }),
    ];
    const stats = aggregate(events, 30);

    // Semantic is judged only on the two searches where it could actually run.
    const semantic = modeOf(stats, 'semantic');
    expect(semantic.sampleSize).toBe(2);
    expect(semantic.mrrAll).toBe(1);

    // Keyword and hybrid use every search.
    expect(modeOf(stats, 'keyword').sampleSize).toBe(4);
    expect(modeOf(stats, 'hybrid').sampleSize).toBe(4);
    expect(stats.semanticAvailableRate).toBeCloseTo(0.5, 4);
  });

  it('reports zeroed semantic stats when the model never landed', () => {
    const stats = aggregate([selected(1, 1, null, { semanticAvailable: false })], 30);
    const semantic = modeOf(stats, 'semantic');
    expect(semantic.sampleSize).toBe(0);
    expect(semantic.mrrAll).toBe(0);
    expect(semantic.mrrSelected).toBe(0);
  });
});

describe('aggregate — latency', () => {
  it('computes percentiles per phase', () => {
    const events = [
      ev({ latencyMs: 100, keywordMs: 10, semanticMs: 90 }),
      ev({ latencyMs: 200, keywordMs: 20, semanticMs: 180 }),
      ev({ latencyMs: 300, keywordMs: 30, semanticMs: 270 }),
    ];
    const stats = aggregate(events, 30);
    expect(stats.latency.total.p50).toBe(200);
    expect(stats.latency.total.p95).toBe(300);
    expect(stats.latency.keyword.p50).toBe(20);
  });

  it('excludes unavailable-model searches from semantic latency', () => {
    const events = [
      ev({ semanticMs: 500, semanticAvailable: false }),
      ev({ semanticMs: 50, semanticAvailable: true }),
    ];
    // The 500ms figure is not a semantic search; it must not skew the phase percentile.
    expect(aggregate(events, 30).latency.semantic.p50).toBe(50);
  });
});

describe('aggregate — passthrough', () => {
  it('echoes the requested window and counts', () => {
    const stats = aggregate([selected(1, 1, 1), ev(), ev()], 7);
    expect(stats.days).toBe(7);
    expect(stats.totalSearches).toBe(3);
    expect(stats.selectedSearches).toBe(1);
  });
});
