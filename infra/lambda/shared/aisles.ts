// Canonical supermarket aisle taxonomy — the SINGLE SOURCE OF TRUTH (RECP-36).
//
// This is mirrored, in lockstep, in three places. If you change this list you MUST
// update the other two (the ids and their order must match exactly):
//   - web/src/lib/aisles.ts        (TypeScript, web app)
//   - ios/Shared/Aisle.swift       (Swift enum, iOS app + on-device Foundation Models)
//
// The `id` is the stable value persisted on each item and the value the LLM is
// constrained to emit. The ORDER is the grouping/display order — it follows a
// typical UK-supermarket shop route so the grouped list reads top-to-bottom as you
// walk round the shop. `OTHER` is the explicit uncategorised bucket and must sort last.
//
// User-customisable remapping/reordering is a LATER story (RECP-34 backlog); this
// pins the canonical set only.

export interface Aisle {
  /** Stable id — persisted on items and emitted by the categoriser. Never reuse/renumber. */
  id: string;
  /** Human-readable section heading. */
  label: string;
}

export const AISLES: readonly Aisle[] = [
  { id: 'produce', label: 'Fruit & Vegetables' },
  { id: 'bakery', label: 'Bakery' },
  { id: 'meat-fish', label: 'Meat & Fish' },
  { id: 'dairy-eggs', label: 'Dairy & Eggs' },
  { id: 'chilled', label: 'Chilled & Deli' },
  { id: 'frozen', label: 'Frozen' },
  { id: 'cupboard', label: 'Tins, Jars & Packets' },
  { id: 'pasta-rice-grains', label: 'Pasta, Rice & Grains' },
  { id: 'baking', label: 'Baking & Home Baking' },
  { id: 'condiments', label: 'Condiments & Sauces' },
  { id: 'snacks', label: 'Snacks & Confectionery' },
  { id: 'drinks', label: 'Drinks' },
  { id: 'world-foods', label: 'World Foods' },
  { id: 'health-beauty', label: 'Health & Beauty' },
  { id: 'household', label: 'Household & Cleaning' },
  { id: 'baby-pet', label: 'Baby & Pet' },
  { id: 'other', label: 'Other' },
] as const;

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
