// Deterministic grocery → aisle lookup (RECP-35). This handles the common long-tail
// of everyday groceries WITHOUT an LLM call — the cost-saver. The categoriser only
// falls back to Bedrock/Haiku when nothing here matches.
//
// Keys are lowercase keyword phrases; matching is whole-word and prefers the LONGEST
// matching phrase (so "kidney beans" → cupboard beats "beans"). Aisle ids must be
// valid ids from ./aisles.ts.

import { isAisleId } from './aisles';
import rulesData from './data/categorise-rules.json';

// Keyword phrases per aisle — the single source of truth lives in ./data/categorise-rules.json,
// shared with the iOS on-device rules engine (RECP-49) via the same bundled file.
const RULES: Record<string, string[]> = rulesData;

// Build a flat phrase → aisle map, validating ids at module load.
const PHRASE_TO_AISLE: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [aisle, phrases] of Object.entries(RULES)) {
    if (!isAisleId(aisle)) throw new Error(`categorise-rules: unknown aisle id "${aisle}"`);
    for (const p of phrases) map.set(p, aisle);
  }
  return map;
})();

// Phrases sorted longest-first (by word count then length) so multi-word phrases win.
const PHRASES_BY_SPECIFICITY: string[] = [...PHRASE_TO_AISLE.keys()].sort((a, b) => {
  const wa = a.split(' ').length;
  const wb = b.split(' ').length;
  return wb - wa || b.length - a.length;
});

function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/**
 * Best-effort deterministic aisle for an item text. Returns the aisle id of the most
 * specific matching phrase, or null if nothing matches (caller falls back to the LLM).
 */
export function ruleAisle(itemText: string): string | null {
  if (!itemText.trim()) return null;
  const haystack = normalise(itemText);
  for (const phrase of PHRASES_BY_SPECIFICITY) {
    if (haystack.includes(` ${phrase} `)) return PHRASE_TO_AISLE.get(phrase) ?? null;
  }
  return null;
}
