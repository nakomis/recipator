// Alexa shopping-list operations (RECIP-63). The add / check / read logic behind the
// planned Alexa skill (RECIP-61), kept separate from the skill handler so it can be
// unit-tested with fakes.
//
// Storage is injected: the caller binds userId and listId and passes in three functions.
// This module never touches DynamoDB or the categoriser itself (the `import type` below is
// erased at compile time), and it produces no speech — the handler hands the results to
// the builders in ../shared/speech.
//
// Matching a spoken item to a stored one is delegated to findSameItem / itemKey (RECIP-62),
// the single matcher for both add and check: spoken number words become digits, the quantity
// is dropped, case and punctuation are ignored and the last word is lightly singularised, so
// "two pints of milk" finds "milk" and "egg" finds "eggs". There is no fuzzy matching.

import { aisleOrder } from '../shared/aisles';
import { findSameItem, itemKey } from '../shopping/item-key';
import type { ShoppingItem } from '../shopping/store';

/** Storage for one list, with userId and listId already bound by the caller. */
export interface ListOpsDeps {
  /** Every item on the list, ticked or not. */
  listItems(): Promise<ShoppingItem[]>;
  /** Add a new item from the raw spoken text (the caller parses and categorises it). */
  addItem(text: string): Promise<ShoppingItem>;
  /** Tick or untick an item; null when it no longer exists. */
  setChecked(itemId: string, checked: boolean): Promise<ShoppingItem | null>;
}

export type AddOutcome = 'added' | 'unticked' | 'already' | 'empty';

export interface AddResult {
  outcome: AddOutcome;
  /** The item added, unticked or found; absent when outcome is 'empty'. */
  item?: ShoppingItem;
}

export type CheckStatus = 'on' | 'ticked' | 'absent';

export interface CheckResult {
  status: CheckStatus;
  /** The matching item; absent when status is 'absent'. */
  item?: ShoppingItem;
}

export interface ListOps {
  add(text: string): Promise<AddResult>;
  check(text: string): Promise<CheckResult>;
  read(): Promise<ShoppingItem[]>;
}

/** Aisle order, then the order items were added. */
function byAisleThenSortOrder(a: ShoppingItem, b: ShoppingItem): number {
  return aisleOrder(a.aisle) - aisleOrder(b.aisle) || a.sortOrder - b.sortOrder;
}

export function createListOps(deps: ListOpsDeps): ListOps {
  return {
    /**
     * Add an item. Already on the list unticked → 'already'; on the list but ticked →
     * unticked; otherwise added. Text with no item in it → 'empty', and nothing is written.
     * A stored quantity is never changed.
     */
    async add(text) {
      const items = await deps.listItems();
      if (!itemKey(text)) return { outcome: 'empty' };

      const match = findSameItem(items, text);
      if (match && !match.checked) return { outcome: 'already', item: match };
      if (match) {
        const unticked = await deps.setChecked(match.itemId, false);
        if (unticked) return { outcome: 'unticked', item: unticked };
        // Deleted between the read and the update: fall through and add it afresh.
      }
      return { outcome: 'added', item: await deps.addItem(text) };
    },

    /** Whether an item is on the list, ticked off or absent. Never changes anything. */
    async check(text) {
      const match = findSameItem(await deps.listItems(), text);
      if (!match) return { status: 'absent' };
      return match.checked ? { status: 'ticked', item: match } : { status: 'on', item: match };
    },

    /** The unticked items, in aisle order and then the order they were added. */
    async read() {
      const items = await deps.listItems();
      return items.filter((i) => !i.checked).sort(byAisleThenSortOrder);
    },
  };
}
