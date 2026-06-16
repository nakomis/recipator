// Canonical supermarket aisle taxonomy — MIRROR of the server source of truth at
// infra/lambda/shared/aisles.ts (RECP-36). Keep the ids and ORDER in lockstep with
// that file and ios/Shared/Aisle.swift. The order is the shop-route display order.

export interface Aisle {
  id: string;
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

const AISLE_ORDER = new Map(AISLES.map((a, i) => [a.id, i]));

export function aisleLabel(id: string): string {
  return AISLES.find((a) => a.id === id)?.label ?? 'Other';
}

export function aisleOrder(id: string): number {
  return AISLE_ORDER.get(id) ?? AISLES.length;
}
