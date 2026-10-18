import { findSameItem, itemKey, spokenToDigits } from '../lambda/shopping/item-key';
import { newShoppingItem } from '../lambda/shopping/new-item';
import { ShoppingItem } from '../lambda/shopping/store';

describe('spokenToDigits', () => {
  it('maps number words zero to twenty to digits', () => {
    expect(spokenToDigits('two pints of milk')).toBe('2 pints of milk');
    expect(spokenToDigits('Twelve eggs')).toBe('12 eggs');
    expect(spokenToDigits('twenty tea bags')).toBe('20 tea bags');
    expect(spokenToDigits('zero bananas')).toBe('0 bananas');
  });

  it('maps a leading "a"/"an" to 1 only before a known unit', () => {
    expect(spokenToDigits('a pint of milk')).toBe('1 pint of milk');
    expect(spokenToDigits('a dozen eggs')).toBe('1 dozen eggs');
    expect(spokenToDigits('A bag of flour')).toBe('1 bag of flour');
    expect(spokenToDigits('a loaf of bread')).toBe('a loaf of bread');
    expect(spokenToDigits('an apple')).toBe('an apple');
  });

  it('maps "half a <unit>" to 1/2', () => {
    expect(spokenToDigits('half a cup of cream')).toBe('1/2 cup of cream');
    expect(spokenToDigits('half a loaf')).toBe('half a loaf');
  });

  it('leaves other text unchanged', () => {
    expect(spokenToDigits('bin bags')).toBe('bin bags');
    expect(spokenToDigits('someone')).toBe('someone');
  });
});

describe('itemKey', () => {
  it('ignores quantity and case', () => {
    expect(itemKey('Milk')).toBe('milk');
    expect(itemKey('4 pints of milk')).toBe('milk');
    expect(itemKey('two pints of milk')).toBe('milk');
    expect(itemKey('half a cup of Double Cream')).toBe('double cream');
  });

  it('singularises the last word', () => {
    expect(itemKey('eggs')).toBe(itemKey('egg'));
    expect(itemKey('tomatoes')).toBe('tomato');
    expect(itemKey('apples')).toBe(itemKey('apple'));
    expect(itemKey('boxes')).toBe('box');
    expect(itemKey('bin bags')).toBe('bin bag');
  });

  it('leaves ss/us/is endings alone', () => {
    expect(itemKey('cress')).toBe('cress');
    expect(itemKey('asparagus')).toBe('asparagus');
    expect(itemKey('hummus')).toBe('hummus');
  });
});

function row(item: string, over: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    itemId: over.itemId ?? item,
    listId: 'default',
    raw: item,
    item,
    amount: null,
    unit: null,
    aisle: 'dairy',
    checked: false,
    sortOrder: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    source: 'rules',
    ...over,
  };
}

describe('findSameItem', () => {
  it('returns undefined when nothing matches', () => {
    expect(findSameItem([row('milk')], 'bread')).toBeUndefined();
    expect(findSameItem([], 'milk')).toBeUndefined();
  });

  it('matches regardless of quantity, case and plural', () => {
    const egg = row('egg');
    expect(findSameItem([row('milk'), egg], 'Eggs')).toBe(egg);
    expect(findSameItem([row('milk', { itemId: 'm' })], 'two pints of milk')?.itemId).toBe('m');
  });

  it('prefers the first unticked match by sortOrder', () => {
    const items = [
      row('milk', { itemId: 'ticked', checked: true, sortOrder: 1 }),
      row('milk', { itemId: 'late', sortOrder: 30 }),
      row('milk', { itemId: 'early', sortOrder: 20 }),
    ];
    expect(findSameItem(items, 'milk')?.itemId).toBe('early');
  });

  it('falls back to the most recently updated ticked match', () => {
    const items = [
      row('milk', { itemId: 'old', checked: true, updatedAt: '2026-10-01T00:00:00.000Z' }),
      row('milk', { itemId: 'new', checked: true, updatedAt: '2026-10-05T00:00:00.000Z' }),
      row('bread', { itemId: 'bread' }),
    ];
    expect(findSameItem(items, 'milk')?.itemId).toBe('new');
  });
});

describe('newShoppingItem', () => {
  const cat = { item: 'milk', amount: '4', unit: 'pt', aisle: 'dairy', source: 'rules' as const };

  it('builds an unticked row from the categorisation', () => {
    const now = new Date('2026-10-18T12:00:00.000Z');
    expect(newShoppingItem('default', '4 pints of milk', cat, 'id-1', now)).toEqual({
      itemId: 'id-1',
      listId: 'default',
      raw: '4 pints of milk',
      item: 'milk',
      amount: '4',
      unit: 'pt',
      aisle: 'dairy',
      checked: false,
      sortOrder: now.getTime(),
      createdAt: '2026-10-18T12:00:00.000Z',
      updatedAt: '2026-10-18T12:00:00.000Z',
      source: 'rules',
    });
  });

  it('mints an id when none is given', () => {
    const a = newShoppingItem('default', 'milk', cat);
    const b = newShoppingItem('default', 'milk', cat);
    expect(a.itemId).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.itemId).not.toBe(b.itemId);
  });
});
