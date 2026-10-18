import type { ShoppingItem } from '../lambda/shopping/store';
import { parseQuantity } from '../lambda/shared/quantity';
import { ListOpsDeps, createListOps, matchKey, spokenKey } from '../lambda/alexa/list-ops';

let nextId = 0;

function stored(raw: string, overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  const q = parseQuantity(raw);
  const n = nextId++;
  return {
    itemId: `item-${n}`,
    listId: 'default',
    raw,
    item: q.itemText,
    amount: q.amount,
    unit: q.unit,
    aisle: 'other',
    checked: false,
    sortOrder: n,
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
    source: null,
    ...overrides,
  };
}

/** An in-memory list standing in for the store, recording every write. */
function fakeList(initial: ShoppingItem[]) {
  const items = [...initial];
  const calls = { addItem: [] as string[], setChecked: [] as [string, boolean][] };
  const deps: ListOpsDeps = {
    listItems: async () => items.map((i) => ({ ...i })),
    addItem: async (text) => {
      calls.addItem.push(text);
      const item = stored(text);
      items.push(item);
      return item;
    },
    setChecked: async (itemId, checked) => {
      calls.setChecked.push([itemId, checked]);
      const item = items.find((i) => i.itemId === itemId);
      if (!item) return null;
      item.checked = checked;
      return { ...item };
    },
  };
  return { items, calls, deps, ops: createListOps(deps) };
}

describe('matching keys', () => {
  it('ignores case and extra whitespace', () => {
    expect(matchKey('  Double   Cream ')).toBe(matchKey('double cream'));
  });

  it('treats singular and plural as the same', () => {
    expect(matchKey('egg')).toBe(matchKey('eggs'));
    expect(matchKey('tomato')).toBe(matchKey('tomatoes'));
    expect(matchKey('loaf of bread')).toBe(matchKey('loaves of bread'));
  });

  it('strips a spoken quantity', () => {
    expect(spokenKey('two pints of milk')).not.toBe(matchKey('milk')); // words aren't amounts
    expect(spokenKey('2 pints of milk')).toBe(matchKey('milk'));
    expect(spokenKey('6 eggs')).toBe(matchKey('egg'));
  });

  it('does not fuzzy-match', () => {
    expect(matchKey('milk')).not.toBe(matchKey('oat milk'));
  });
});

describe('add', () => {
  it('adds an item that is not on the list', async () => {
    const { ops, calls } = fakeList([stored('milk')]);
    const result = await ops.add('2 courgettes');
    expect(result.outcome).toBe('added');
    expect(result.item.item).toBe('courgettes');
    expect(calls.addItem).toEqual(['2 courgettes']);
    expect(calls.setChecked).toEqual([]);
  });

  it('does nothing when the item is already on the list', async () => {
    const milk = stored('1 pt milk');
    const { ops, calls } = fakeList([milk]);
    const result = await ops.add('2 pints of Milk');
    expect(result).toEqual({ outcome: 'already', item: milk });
    expect(calls.addItem).toEqual([]);
    expect(calls.setChecked).toEqual([]);
  });

  it('unticks a ticked item and leaves its quantity alone', async () => {
    const eggs = stored('6 eggs', { checked: true });
    const { ops, calls } = fakeList([eggs]);
    const result = await ops.add('egg');
    expect(result.outcome).toBe('unticked');
    expect(result.item).toMatchObject({ itemId: eggs.itemId, checked: false, amount: '6' });
    expect(calls.setChecked).toEqual([[eggs.itemId, false]]);
    expect(calls.addItem).toEqual([]);
  });

  it('prefers an unticked match over a ticked one', async () => {
    const ticked = stored('cream', { checked: true });
    const unticked = stored('200ml cream');
    const { ops, calls } = fakeList([ticked, unticked]);
    const result = await ops.add('cream');
    expect(result).toEqual({ outcome: 'already', item: unticked });
    expect(calls.setChecked).toEqual([]);
  });

  it('unticks the earliest-added of several ticked matches', async () => {
    const later = stored('lemon', { checked: true, sortOrder: 50 });
    const earlier = stored('lemons', { checked: true, sortOrder: 10 });
    const { ops, calls } = fakeList([later, earlier]);
    await ops.add('lemon');
    expect(calls.setChecked).toEqual([[earlier.itemId, false]]);
  });

  it('adds afresh if the ticked item vanished before it could be unticked', async () => {
    const bread = stored('bread', { checked: true });
    const list = fakeList([bread]);
    list.deps.setChecked = async () => null;
    const result = await createListOps(list.deps).add('bread');
    expect(result.outcome).toBe('added');
    expect(list.calls.addItem).toEqual(['bread']);
  });

  it('rejects text with no item in it', async () => {
    const { ops, calls } = fakeList([]);
    await expect(ops.add('   ')).rejects.toThrow('Nothing to add');
    expect(calls.addItem).toEqual([]);
  });
});

describe('check', () => {
  it('reports an unticked item as on the list', async () => {
    const milk = stored('4 pt milk');
    const { ops } = fakeList([milk]);
    expect(await ops.check('milk')).toEqual({ status: 'on', item: milk });
  });

  it('reports a ticked item as ticked', async () => {
    const eggs = stored('eggs', { checked: true });
    const { ops } = fakeList([eggs]);
    expect(await ops.check('an egg')).toEqual({ status: 'absent' }); // "an egg" isn't "egg"
    expect(await ops.check('egg')).toEqual({ status: 'ticked', item: eggs });
  });

  it('prefers on over ticked when both exist', async () => {
    const ticked = stored('cream', { checked: true });
    const unticked = stored('cream');
    const { ops } = fakeList([ticked, unticked]);
    expect(await ops.check('cream')).toEqual({ status: 'on', item: unticked });
  });

  it('reports a missing item as absent', async () => {
    const { ops } = fakeList([stored('milk')]);
    expect(await ops.check('bananas')).toEqual({ status: 'absent' });
    expect(await ops.check('')).toEqual({ status: 'absent' });
  });

  it('never writes', async () => {
    const { ops, calls } = fakeList([stored('milk', { checked: true })]);
    await ops.check('milk');
    await ops.check('bread');
    expect(calls).toEqual({ addItem: [], setChecked: [] });
  });
});

describe('read', () => {
  it('returns unticked items in aisle order, then the order they were added', async () => {
    const items = [
      stored('bin bags', { aisle: 'other', sortOrder: 1 }),
      stored('milk', { aisle: 'dairy-eggs', sortOrder: 5 }),
      stored('bananas', { aisle: 'produce', sortOrder: 4 }),
      stored('cheese', { aisle: 'dairy-eggs', sortOrder: 2 }),
      stored('apples', { aisle: 'produce', sortOrder: 3, checked: true }),
      stored('mystery', { aisle: 'not-an-aisle', sortOrder: 0 }),
      stored('courgettes', { aisle: 'produce', sortOrder: 6 }),
    ];
    const { ops } = fakeList(items);
    const read = await ops.read();
    expect(read.map((i) => i.item)).toEqual(['bananas', 'courgettes', 'cheese', 'milk', 'bin bags', 'mystery']);
  });

  it('returns nothing for an empty or fully ticked list', async () => {
    expect(await fakeList([]).ops.read()).toEqual([]);
    expect(await fakeList([stored('milk', { checked: true })]).ops.read()).toEqual([]);
  });
});
