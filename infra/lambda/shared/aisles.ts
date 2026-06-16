// Canonical supermarket aisle taxonomy — the SINGLE SOURCE OF TRUTH (RECP-36, RECP-49).
//
// The data now lives in ./data/aisles.json, imported here AND by the web app
// (web/src/lib/aisles.ts) and bundled into the iOS app (ios/Shared/Aisle.swift loads it,
// guarded by a parity test) — so there is one physical list, not three hand-kept copies.
//
// The `id` is the stable value persisted on each item and the value the LLM is
// constrained to emit. The ORDER is the grouping/display order — it follows a
// typical UK-supermarket shop route so the grouped list reads top-to-bottom as you
// walk round the shop. `OTHER` is the explicit uncategorised bucket and must sort last.
//
// User-customisable remapping/reordering is a LATER story (RECP-34 backlog); this
// pins the canonical set only.

import aislesData from './data/aisles.json';

export interface Aisle {
  /** Stable id — persisted on items and emitted by the categoriser. Never reuse/renumber. */
  id: string;
  /** Human-readable section heading. */
  label: string;
}

export const AISLES: readonly Aisle[] = aislesData;

/** The explicit uncategorised bucket — items default here, and it always sorts last. */
export const OTHER_AISLE_ID = 'other';

const AISLE_IDS: ReadonlySet<string> = new Set(AISLES.map((a) => a.id));
const AISLE_ORDER: ReadonlyMap<string, number> = new Map(AISLES.map((a, i) => [a.id, i]));

/** Whether an id is a known aisle. */
export function isAisleId(id: string): boolean {
  return AISLE_IDS.has(id);
}

/** Coerce an arbitrary string to a valid aisle id, falling back to OTHER. */
export function toAisleId(id: string | undefined | null): string {
  return id && AISLE_IDS.has(id) ? id : OTHER_AISLE_ID;
}

/** Sort index for an aisle id (unknown ids sort last, with OTHER). */
export function aisleOrder(id: string): number {
  return AISLE_ORDER.get(id) ?? AISLES.length;
}

/** Display label for an aisle id (falls back to the OTHER label). */
export function aisleLabel(id: string): string {
  return AISLES.find((a) => a.id === id)?.label ?? 'Other';
}
