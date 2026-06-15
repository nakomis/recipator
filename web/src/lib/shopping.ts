import type { ShoppingItem } from '@/api/client';
import { aisleLabel, aisleOrder } from './aisles';

export interface AisleGroup {
  aisleId: string;
  label: string;
  items: ShoppingItem[];
}

/**
 * Group items into aisle sections in shop-route order (RECP-39). Within an aisle,
 * items are sorted by their item label so same-item lines sit adjacently
 * ("Cream (200ml)" next to "Cream (1/2 cup)") — RECP-40 — then by sortOrder.
 */
export function groupByAisle(items: ShoppingItem[]): AisleGroup[] {
  const byAisle = new Map<string, ShoppingItem[]>();
  for (const item of items) {
    const list = byAisle.get(item.aisle) ?? [];
    list.push(item);
    byAisle.set(item.aisle, list);
  }

  return [...byAisle.entries()]
    .map(([aisleId, groupItems]) => ({
      aisleId,
      label: aisleLabel(aisleId),
      items: groupItems.sort(
        (a, b) =>
          a.item.localeCompare(b.item, undefined, { sensitivity: 'base' }) ||
          a.sortOrder - b.sortOrder,
      ),
    }))
    .sort((a, b) => aisleOrder(a.aisleId) - aisleOrder(b.aisleId));
}

/** Display label for a line: "Item (quantity)" or just "Item". */
export function itemDisplay(item: string, quantity: string | null): string {
  return quantity ? `${item} (${quantity})` : item;
}
