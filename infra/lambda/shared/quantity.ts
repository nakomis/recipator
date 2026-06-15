// Quantity parsing + display — RECP-40. Deterministic, done in CODE, never by the LLM.
//
// The raw free-text a user types ("4 pints of milk", "200ml cream", "1/2 cup cream",
// "bin bags", "milk x2") is split into a quantity {amount, unit} and the remaining
// item text. The item text is what gets categorised (RECP-35) and what same-item
// grouping keys on — so "Cream", "200ml Cream" and "double cream" all reduce to the
// item "cream" and group together, while each line keeps its own quantity.
//
// We deliberately do NOT convert between units or merge incompatible quantities
// (200ml + 1/2 cup stays as two lines) — see RECP-40.

export interface ParsedQuantity {
  /** Amount as typed, preserving fractions ("1/2"); null when none given. */
  amount: string | null;
  /** Normalised unit id (see UNIT_SYNONYMS); null for a bare count or no quantity. */
  unit: string | null;
  /** The item text with the quantity stripped — fed to the categoriser and used for grouping. */
  itemText: string;
}

// Known units → normalised id. Anything not here is treated as part of the item
// text (e.g. "4 large eggs" → amount 4, no unit, item "large eggs").
const UNIT_SYNONYMS: Record<string, string> = {
  g: 'g', gram: 'g', grams: 'g', gramme: 'g', grammes: 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  mg: 'mg',
  ml: 'ml', milliliter: 'ml', millilitre: 'ml', millilitres: 'ml', milliliters: 'ml',
  cl: 'cl',
  l: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l',
  pt: 'pt', pint: 'pt', pints: 'pt',
  cup: 'cup', cups: 'cup',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tin: 'tin', tins: 'tin', can: 'can', cans: 'can',
  pack: 'pack', packs: 'pack', packet: 'pack', packets: 'pack',
  bottle: 'bottle', bottles: 'bottle',
  jar: 'jar', jars: 'jar',
  box: 'box', boxes: 'box',
  bag: 'bag', bags: 'bag',
  bunch: 'bunch', bunches: 'bunch',
  clove: 'clove', cloves: 'clove',
  dozen: 'dozen',
  slice: 'slice', slices: 'slice',
  punnet: 'punnet', punnets: 'punnet',
};

// Units rendered with no space after the number ("200ml", "2kg"); everything else
// gets a space ("4 pt", "1/2 cup", "2 tins").
const TIGHT_UNITS = new Set(['g', 'kg', 'mg', 'ml', 'cl', 'l']);

// Fraction branch first so "1/2" is matched whole, not as "1" with "/2" left over.
const NUMBER = String.raw`\d+\s*\/\s*\d+|\d+(?:\.\d+)?`;
const LEADING_RE = new RegExp(String.raw`^\s*(${NUMBER})\s*([a-zA-Z]+)?\.?\s*(.*)$`);
const TRAILING_X_RE = new RegExp(String.raw`^(.*?)\s*[x×]\s*(\d+)\s*$`, 'i');
const LEADING_X_RE = new RegExp(String.raw`^\s*(\d+)\s*[x×]\s+(.*)$`, 'i');

function normaliseAmount(raw: string): string {
  return raw.replace(/\s+/g, '');
}

/** Strip a leading connective word ("of", "x") left over after the quantity. */
function stripLeadingOf(text: string): string {
  return text.replace(/^(?:of|x)\s+/i, '').trim();
}

export function parseQuantity(raw: string): ParsedQuantity {
  const input = raw.trim();
  if (!input) return { amount: null, unit: null, itemText: '' };

  // "2 x tomatoes" / "2x tomatoes" → count 2.
  const leadingX = input.match(LEADING_X_RE);
  if (leadingX) {
    return { amount: leadingX[1], unit: 'x', itemText: leadingX[2].trim() };
  }

  // "milk x2" / "milk ×2" → count 2.
  const trailingX = input.match(TRAILING_X_RE);
  if (trailingX && trailingX[1].trim()) {
    return { amount: trailingX[2], unit: 'x', itemText: trailingX[1].trim() };
  }

  // Leading "<number><unit?> rest".
  const m = input.match(LEADING_RE);
  if (m) {
    const amount = normaliseAmount(m[1]);
    const word = (m[2] ?? '').toLowerCase();
    const rest = m[3] ?? '';
    const unit = UNIT_SYNONYMS[word];
    if (unit) {
      return { amount, unit, itemText: stripLeadingOf(rest) };
    }
    // The word after the number wasn't a unit — it's part of the item ("4 large eggs").
    const itemText = stripLeadingOf(`${m[2] ? `${m[2]} ` : ''}${rest}`.trim());
    return { amount, unit: null, itemText };
  }

  return { amount: null, unit: null, itemText: input };
}

/**
 * Render a quantity for display, e.g. "200ml", "4 pt", "1/2 cup", "x2", "4".
 * Returns null when there is no quantity to show.
 */
export function formatQuantity(amount: string | null, unit: string | null): string | null {
  if (!amount) return null;
  if (unit === 'x') return `x${amount}`;
  if (!unit) return amount;
  return TIGHT_UNITS.has(unit) ? `${amount}${unit}` : `${amount} ${unit}`;
}
