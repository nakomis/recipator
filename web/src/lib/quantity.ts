// Quantity display — MIRROR of formatQuantity in infra/lambda/shared/quantity.ts
// (RECP-40). The server parses raw text into {amount, unit}; the client renders it.

const TIGHT_UNITS = new Set(['g', 'kg', 'mg', 'ml', 'cl', 'l']);

/** Render a quantity, e.g. "200ml", "4 pt", "1/2 cup", "x2", "4"; null when none. */
export function formatQuantity(amount: string | null, unit: string | null): string | null {
  if (!amount) return null;
  if (unit === 'x') return `x${amount}`;
  if (!unit) return amount;
  return TIGHT_UNITS.has(unit) ? `${amount}${unit}` : `${amount} ${unit}`;
}
