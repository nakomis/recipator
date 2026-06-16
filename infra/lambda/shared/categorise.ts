// Categorisation orchestrator (RECP-35). Turns a raw free-text shopping entry into a
// structured {item, amount, unit, aisle}. Pure and dependency-injected so it is unit
// testable without Bedrock or DynamoDB:
//
//   raw text → parseQuantity (code) → item text
//            → ruleAisle (deterministic, free)       ─┐
//            → cache lookup (keyed on item text)       ├─ first hit wins
//            → LLM categorise (Bedrock/Haiku, paid)   ─┘
//            → Other (explicit fallback)
//
// The LLM only fires on a genuine miss (no rule, no cache), and its result is cached,
// so each novel item costs at most one Haiku call ever. Quantity is parsed in code,
// never by the LLM (RECP-40). Item labels keep distinguishing words ("double cream"
// is not collapsed to "cream") — see the RECP-35 decision comments.

import { OTHER_AISLE_ID, isAisleId, toAisleId } from './aisles';
import { ruleAisle } from './categorise-rules';
import { parseQuantity } from './quantity';

export type CategorisationSource = 'rules' | 'cache' | 'device' | 'llm' | 'fallback';

export interface CategorisedItem {
  /** Clean product label, distinguishing words preserved (e.g. "double cream"). */
  item: string;
  amount: string | null;
  unit: string | null;
  aisle: string;
  source: CategorisationSource;
}

export interface CategoriseDeps {
  /** LLM categorisation — returns an aisle id (and optionally a cleaned label), or null on failure. */
  llmCategorise?: (itemText: string) => Promise<{ aisle: string; item?: string } | null>;
  cacheGet?: (key: string) => Promise<{ aisle: string; item: string } | null>;
  cachePut?: (key: string, value: { aisle: string; item: string }) => Promise<void>;
}

function cleanLabel(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Normalised cache/grouping key for an item text. */
export function cacheKey(itemText: string): string {
  return itemText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function categorise(
  raw: string,
  deps: CategoriseDeps = {},
  /** An aisle already chosen on-device (Foundation Models, RECP-35). Used for the long
   *  tail in place of a Bedrock call — consulted after rules/cache so deterministic
   *  matches still win, and cached so web/other users benefit too. */
  deviceAisle?: string | null,
  /** When false ("offline only"), never call the cloud LLM — anything rules/cache/device
   *  can't place falls straight to Other. */
  allowLlm = true,
): Promise<CategorisedItem> {
  const { amount, unit, itemText } = parseQuantity(raw);
  const label = cleanLabel(itemText) || cleanLabel(raw);
  const key = cacheKey(itemText || raw);

  // 1. Deterministic rules — free, instant.
  const ruled = ruleAisle(itemText || raw);
  if (ruled) return { item: label, amount, unit, aisle: ruled, source: 'rules' };

  // 2. Cache — a previously-categorised novel item.
  if (deps.cacheGet) {
    const cached = await deps.cacheGet(key);
    if (cached) {
      return {
        item: cleanLabel(cached.item) || label,
        amount,
        unit,
        aisle: toAisleId(cached.aisle),
        source: 'cache',
      };
    }
  }

  // 3. On-device result — the client already classified this with Foundation Models,
  //    so we skip the paid Bedrock call entirely. Cache it for everyone else.
  if (deviceAisle && isAisleId(deviceAisle)) {
    if (deps.cachePut) {
      try {
        await deps.cachePut(key, { aisle: deviceAisle, item: label });
      } catch {
        /* cache write is best-effort */
      }
    }
    return { item: label, amount, unit, aisle: deviceAisle, source: 'device' };
  }

  // 4. LLM — the long tail, at most once per novel item (result is cached). Skipped
  //    entirely in offline-only mode.
  if (allowLlm && deps.llmCategorise) {
    const res = await deps.llmCategorise(itemText || raw);
    if (res) {
      const aisle = toAisleId(res.aisle);
      const item = cleanLabel(res.item ?? '') || label;
      if (deps.cachePut) {
        try {
          await deps.cachePut(key, { aisle, item });
        } catch {
          /* cache write is best-effort */
        }
      }
      return { item, amount, unit, aisle, source: 'llm' };
    }
  }

  // 5. Explicit fallback — uncategorised, editable by the user.
  return { item: label, amount, unit, aisle: OTHER_AISLE_ID, source: 'fallback' };
}
