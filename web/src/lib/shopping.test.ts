import { describe, expect, it } from 'vitest';
import type { ShoppingItem } from '@/api/client';
import { groupByAisle, itemDisplay } from './shopping';

function item(over: Partial<ShoppingItem>): ShoppingItem {
  return {
    itemId: 'i',
    listId: 'default',
    raw: '',
    item: 'thing',
    amount: null,
    unit: null,
    aisle: 'other',
    checked: false,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('groupByAisle', () => {
  it('orders aisles by shop route and Other last', () => {
    const groups = groupByAisle([
      item({ itemId: 'a', aisle: 'other', item: 'bin bags' }),
      item({ itemId: 'b', aisle: 'produce', item: 'apples' }),
      item({ itemId: 'c', aisle: 'dairy-eggs', item: 'milk' }),
    ]);
    expect(groups.map((g) => g.aisleId)).toEqual(['produce', 'dairy-eggs', 'other']);
    expect(groups[0].label).toBe('Fruit & Vegetables');
  });

  it('places same-item lines adjacently within an aisle', () => {
    const groups = groupByAisle([
      item({ itemId: '1', aisle: 'dairy-eggs', item: 'milk', sortOrder: 1 }),
      item({
        itemId: '2',
        aisle: 'dairy-eggs',
        item: 'cream',
        amount: '200',
        unit: 'ml',
        sortOrder: 2,
      }),
      item({
        itemId: '3',
        aisle: 'dairy-eggs',
        item: 'cream',
        amount: '1/2',
        unit: 'cup',
        sortOrder: 3,
      }),
    ]);
    expect(groups[0].items.map((i) => i.itemId)).toEqual(['2', '3', '1']); // cream, cream, milk
  });
});

describe('itemDisplay', () => {
  it('appends the quantity in parentheses when present', () => {
    expect(itemDisplay('Cream', '200ml')).toBe('Cream (200ml)');
    expect(itemDisplay('Cream', null)).toBe('Cream');
  });
});
