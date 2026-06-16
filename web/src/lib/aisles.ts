// Canonical supermarket aisle taxonomy (RECP-36, RECP-49). The data lives in aisles.json,
// kept byte-for-byte in step with the server source of truth
// (infra/lambda/shared/data/aisles.json) by an infra parity test — so this is no longer a
// hand-maintained copy. The order is the shop-route display order.

import aislesData from './aisles.json';

export interface Aisle {
  id: string;
  label: string;
}

export const AISLES: readonly Aisle[] = aislesData;

const AISLE_ORDER = new Map(AISLES.map((a, i) => [a.id, i]));

export function aisleLabel(id: string): string {
  return AISLES.find((a) => a.id === id)?.label ?? 'Other';
}

export function aisleOrder(id: string): number {
  return AISLE_ORDER.get(id) ?? AISLES.length;
}
