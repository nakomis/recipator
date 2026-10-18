// Alexa shopping-list operations (RECIP-63). The add / check / read logic behind the
// planned Alexa skill (RECIP-61), kept separate from the skill handler so it can be
// unit-tested with fakes.
//
// Storage is injected: the caller binds userId and listId and passes in three functions.
// This module never touches DynamoDB or the categoriser itself (the `import type` below is
// erased at compile time), and it produces no speech — the handler hands the results to
// the builders in ../shared/speech.
//
// Matching a spoken item to a stored one: the spoken text goes through parseQuantity to drop
// any quantity ("two pints of milk" → "milk"), then both sides are lower-cased, whitespace is
// collapsed and the label is pluralised with pluraliseItem, so "egg" and "eggs" match.
// There is no fuzzy matching.

import { aisleOrder } from '../shared/aisles';
import { parseQuantity } from '../shared/quantity';
import { pluraliseItem } from '../shared/speech';
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

export type AddOutcome = 'added' | 'unticked' | 'already';

export interface AddResult {
  outcome: AddOutcome;
  item: ShoppingItem;
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

/** The comparison key for an item label: lower-cased, whitespace collapsed, pluralised. */
export function matchKey(label: string): string {
  const tidy = label.replace(/\s+/g, ' ').trim().toLowerCase();
  return tidy ? pluraliseItem(tidy) : '';
}

/** The comparison key for spoken text, with any quantity stripped first. */
export function spokenKey(text: string): string {
  return matchKey(parseQuantity(text).itemText);
}

/** Aisle order, then the order items were added. */
function byAisleThenSortOrder(a: ShoppingItem, b: ShoppingItem): number {
  return aisleOrder(a.aisle) - aisleOrder(b.aisle) || a.sortOrder - b.sortOrder;
}

/** Items matching the key, earliest-added first. */
function findMatches(items: readonly ShoppingItem[], key: string): ShoppingItem[] {
  if (!key) return [];
  return items.filter((i) => matchKey(i.item) === key).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function createListOps(deps: ListOpsDeps): ListOps {
  return {
    /**
     * Add an item. Already on the list unticked → 'already'; on the list but ticked →
     * unticked; otherwise added. A stored quantity is never changed.
     */
    async add(text) {
      const key = spokenKey(text);
      if (!key) throw new Error('Nothing to add');

      const matches = findMatches(await deps.listItems(), key);
      const onList = matches.find((i) => !i.checked);
      if (onList) return { outcome: 'already', item: onList };

      const ticked = matches[0];
      if (ticked) {
        const unticked = await deps.setChecked(ticked.itemId, false);
        if (unticked) return { outcome: 'unticked', item: unticked };
        // Deleted between the read and the update: fall through and add it afresh.
      }
      return { outcome: 'added', item: await deps.addItem(text) };
    },

    /** Whether an item is on the list, ticked off or absent. Never changes anything. */
    async check(text) {
      const matches = findMatches(await deps.listItems(), spokenKey(text));
      const onList = matches.find((i) => !i.checked);
      if (onList) return { status: 'on', item: onList };
      if (matches[0]) return { status: 'ticked', item: matches[0] };
      return { status: 'absent' };
    },

    /** The unticked items, in aisle order and then the order they were added. */
    async read() {
      const items = await deps.listItems();
      return items.filter((i) => !i.checked).sort(byAisleThenSortOrder);
    },
  };
}
