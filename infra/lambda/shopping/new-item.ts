// Builds a new shopping-list row from a categorised item (RECIP-62). Shared by
// POST /shopping/items and the Alexa skill so both write exactly the same shape.

import { randomUUID } from 'crypto';
import { CategorisedItem } from '../shared/categorise';
import { ShoppingItem } from './store';

export function newShoppingItem(
  listId: string,
  raw: string,
  cat: CategorisedItem,
  /** A client-supplied id (idempotent sync push); a fresh one is minted when omitted. */
  itemId: string = randomUUID(),
  now: Date = new Date(),
): ShoppingItem {
  const iso = now.toISOString();
  return {
    itemId,
    listId,
    raw,
    item: cat.item,
    amount: cat.amount,
    unit: cat.unit,
    aisle: cat.aisle,
    checked: false,
    sortOrder: now.getTime(),
    createdAt: iso,
    updatedAt: iso,
    source: cat.source,
  };
}
