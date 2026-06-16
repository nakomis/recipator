import { aisleLabel, aisleOrder, isAisleId, toAisleId } from '../lambda/shared/aisles';
import { ruleAisle } from '../lambda/shared/categorise-rules';
import { cacheKey, categorise } from '../lambda/shared/categorise';

describe('aisles', () => {
  it('validates and coerces ids', () => {
    expect(isAisleId('dairy-eggs')).toBe(true);
    expect(isAisleId('nope')).toBe(false);
    expect(toAisleId('nope')).toBe('other');
    expect(toAisleId(undefined)).toBe('other');
    expect(toAisleId('produce')).toBe('produce');
  });

  it('orders Other last and labels ids', () => {
    expect(aisleOrder('produce')).toBeLessThan(aisleOrder('other'));
    expect(aisleOrder('unknown')).toBeGreaterThanOrEqual(aisleOrder('other'));
    expect(aisleLabel('dairy-eggs')).toBe('Dairy & Eggs');
    expect(aisleLabel('unknown')).toBe('Other');
  });
});

describe('ruleAisle', () => {
  it('matches common groceries', () => {
    expect(ruleAisle('milk')).toBe('dairy-eggs');
    expect(ruleAisle('bananas')).toBe('produce');
    expect(ruleAisle('bin bags')).toBe('household');
    expect(ruleAisle('chicken breast')).toBe('meat-fish');
  });

  it('prefers the more specific multi-word phrase', () => {
    // "kidney beans" → cupboard, even though "beans" alone also matches cupboard.
    expect(ruleAisle('kidney beans')).toBe('cupboard');
    // "double cream" still lands in dairy.
    expect(ruleAisle('double cream')).toBe('dairy-eggs');
    // "garlic powder" → condiments, not produce (where bare "garlic" lives) — RECP-49.
    expect(ruleAisle('garlic powder')).toBe('condiments');
    expect(ruleAisle('garlic')).toBe('produce');
  });

  it('returns null when nothing matches', () => {
    expect(ruleAisle('xyzzy widget')).toBeNull();
    expect(ruleAisle('')).toBeNull();
  });
});

describe('cacheKey', () => {
  it('normalises punctuation and case', () => {
    expect(cacheKey('Double Cream!')).toBe('double cream');
    expect(cacheKey('  TAHINI ')).toBe('tahini');
  });
});

describe('categorise', () => {
  it('uses rules first (no LLM call) and parses quantity', async () => {
    const llm = jest.fn();
    const result = await categorise('200ml double cream', { llmCategorise: llm });
    expect(result).toMatchObject({
      item: 'double cream',
      amount: '200',
      unit: 'ml',
      aisle: 'dairy-eggs',
      source: 'rules',
    });
    expect(llm).not.toHaveBeenCalled();
  });

  it('falls back to the cache before the LLM', async () => {
    const llm = jest.fn();
    const cacheGet = jest.fn().mockResolvedValue({ aisle: 'world-foods', item: 'gochujang' });
    const result = await categorise('2 tubs gochujang', { llmCategorise: llm, cacheGet });
    expect(result.aisle).toBe('world-foods');
    expect(result.source).toBe('cache');
    expect(llm).not.toHaveBeenCalled();
  });

  it('calls the LLM on a miss and caches the result', async () => {
    // "sauerkraut" isn't in the rules table, so categorise must reach the LLM.
    const llmCategorise = jest.fn().mockResolvedValue({ aisle: 'world-foods', item: 'sauerkraut' });
    const cacheGet = jest.fn().mockResolvedValue(null);
    const cachePut = jest.fn().mockResolvedValue(undefined);
    const result = await categorise('sauerkraut', { llmCategorise, cacheGet, cachePut });
    expect(result).toMatchObject({ item: 'sauerkraut', aisle: 'world-foods', source: 'llm' });
    expect(cachePut).toHaveBeenCalledWith('sauerkraut', {
      aisle: 'world-foods',
      item: 'sauerkraut',
    });
  });

  it('uses a valid on-device aisle instead of the LLM, and caches it (RECP-35)', async () => {
    const llmCategorise = jest.fn();
    const cachePut = jest.fn().mockResolvedValue(undefined);
    const result = await categorise(
      'sauerkraut',
      { llmCategorise, cacheGet: async () => null, cachePut },
      'world-foods',
    );
    expect(result).toMatchObject({ item: 'sauerkraut', aisle: 'world-foods', source: 'device' });
    expect(llmCategorise).not.toHaveBeenCalled();
    expect(cachePut).toHaveBeenCalledWith('sauerkraut', { aisle: 'world-foods', item: 'sauerkraut' });
  });

  it('ignores an on-device aisle when rules already match', async () => {
    const result = await categorise('milk', {}, 'world-foods');
    expect(result).toMatchObject({ aisle: 'dairy-eggs', source: 'rules' });
  });

  it('coerces an invalid LLM aisle to Other', async () => {
    const llmCategorise = jest.fn().mockResolvedValue({ aisle: 'not-a-real-aisle', item: 'thing' });
    const result = await categorise('mystery thing', { llmCategorise, cacheGet: async () => null });
    expect(result.aisle).toBe('other');
  });

  it('falls back to Other when there is no LLM and no rule match', async () => {
    const result = await categorise('mystery widget');
    expect(result).toMatchObject({ aisle: 'other', source: 'fallback', item: 'mystery widget' });
  });
});
