import type { ShoppingItem } from '../lambda/shopping/store';
import { parseQuantity } from '../lambda/shared/quantity';
import {
  SpeechItem,
  escapeSsml,
  indefiniteArticle,
  joinWithAnd,
  numberWords,
  pluraliseItem,
  speakAdded,
  speakCheckedOff,
  speakEmptyList,
  speakItem,
  speakList,
  speakNotFound,
  toSsml,
} from '../lambda/shared/speech';

const it_ = (item: string, amount: string | null = null, unit: string | null = null): SpeechItem => ({ item, amount, unit });

describe('numberWords', () => {
  it.each([
    [0, 'zero'],
    [1, 'one'],
    [2, 'two'],
    [10, 'ten'],
    [11, '11'],
    [250, '250'],
  ])('%d → %s', (n, expected) => {
    expect(numberWords(n)).toBe(expected);
  });
});

describe('joinWithAnd', () => {
  it.each<[string[], string]>([
    [[], ''],
    [['milk'], 'milk'],
    [['milk', 'eggs'], 'milk and eggs'],
    [['milk', 'eggs', 'bread'], 'milk, eggs and bread'],
    [['a', 'b', 'c', 'd'], 'a, b, c and d'],
  ])('%j → "%s" (no Oxford comma)', (parts, expected) => {
    expect(joinWithAnd(parts)).toBe(expected);
  });
});

describe('pluraliseItem', () => {
  it.each([
    ['courgette', 'courgettes'],
    ['large egg', 'large eggs'],
    ['eggs', 'eggs'],
    ['loaf of bread', 'loaves of bread'],
    ['bay leaf', 'bay leaves'],
    ['tomato', 'tomatoes'],
    ['potato', 'potatoes'],
    ['avocado', 'avocados'],
    ['peach', 'peaches'],
    ['radish', 'radishes'],
    ['box', 'boxes'],
    ['glass', 'glasses'],
    ['berry', 'berries'],
    ['strawberry', 'strawberries'],
    ['kidney', 'kidneys'],
    ['LEMON', 'LEMONS'],
    ['LOAF', 'LOAVES'],
    ['Loaf of bread', 'Loaves of bread'],
    ['7up', '7ups'],
    ['milk', 'milk'],
  ])('%s → %s', (input, expected) => {
    expect(pluraliseItem(input)).toBe(expected);
  });
});

describe('indefiniteArticle', () => {
  it.each([
    ['onion', 'an'],
    ['egg', 'an'],
    ['loaf', 'a'],
    ['ounce', 'an'],
    ['hour', 'an'],
    ['herb', 'a'],
    ['unicorn cake', 'a'],
    ['Easter egg', 'an'],
  ])('%s → %s', (word, expected) => {
    expect(indefiniteArticle(word)).toBe(expected);
  });
});

describe('speakItem', () => {
  describe('no quantity', () => {
    it.each([
      [it_('milk'), 'milk'],
      [it_('bin bags'), 'bin bags'],
      [it_('loaf of bread'), 'loaf of bread'],
    ])('%j → %s', (item, expected) => {
      expect(speakItem(item)).toBe(expected);
    });
  });

  describe('bare counts: zero, one and many', () => {
    it.each([
      [it_('courgette', '1'), 'a courgette'],
      [it_('onion', '1'), 'an onion'],
      [it_('loaf of bread', '1'), 'a loaf of bread'],
      [it_('courgette', '2'), 'two courgettes'],
      [it_('courgettes', '2'), 'two courgettes'],
      [it_('lemons', '3'), 'three lemons'],
      [it_('large eggs', '4'), 'four large eggs'],
      [it_('loaf of bread', '2'), 'two loaves of bread'],
      [it_('eggs', '12'), '12 eggs'],
      [it_('courgette', '0'), 'zero courgettes'],
      [it_('milk', '1'), 'milk'],
      [it_('milk', '2'), 'two lots of milk'],
      [it_('cheddar cheese', '3'), 'three lots of cheddar cheese'],
    ])('%j → %s', (item, expected) => {
      expect(speakItem(item)).toBe(expected);
    });
  });

  describe('explicit x-counts read like bare counts', () => {
    it.each([
      [it_('tomatoes', '2', 'x'), 'two tomatoes'],
      [it_('milk', '2', 'x'), 'two lots of milk'],
      [it_('loaf of bread', '1', 'x'), 'a loaf of bread'],
    ])('%j → %s', (item, expected) => {
      expect(speakItem(item)).toBe(expected);
    });
  });

  describe('units', () => {
    it.each([
      [it_('milk', '4', 'pt'), 'four pints of milk'],
      [it_('milk', '1', 'pt'), 'a pint of milk'],
      [it_('double cream', '200', 'ml'), '200 millilitres of double cream'],
      [it_('flour', '500', 'g'), '500 grams of flour'],
      [it_('potatoes', '2', 'kg'), 'two kilos of potatoes'],
      [it_('potatoes', '1', 'kg'), 'a kilo of potatoes'],
      [it_('cheddar', '8', 'oz'), 'eight ounces of cheddar'],
      [it_('cheddar', '1', 'oz'), 'an ounce of cheddar'],
      [it_('beef mince', '1', 'lb'), 'a pound of beef mince'],
      [it_('chopped tomatoes', '2', 'tin'), 'two tins of chopped tomatoes'],
      [it_('garlic', '3', 'clove'), 'three cloves of garlic'],
      [it_('coriander', '2', 'bunch'), 'two bunches of coriander'],
      [it_('cereal', '2', 'box'), 'two boxes of cereal'],
      [it_('olive oil', '1', 'tbsp'), 'a tablespoon of olive oil'],
      [it_('water', '1.5', 'l'), 'one and a half litres of water'],
      [it_('water', '1.2', 'l'), '1.2 litres of water'],
      [it_('water', '2.0', 'l'), 'two litres of water'],
      [it_('eggs', '1', 'dozen'), 'a dozen eggs'],
      [it_('egg', '2', 'dozen'), 'two dozen eggs'],
      [it_('eggs', '1/2', 'dozen'), 'half a dozen eggs'],
      [it_('stuff', '2', 'furlong'), 'two furlong of stuff'],
    ])('%j → %s', (item, expected) => {
      expect(speakItem(item)).toBe(expected);
    });
  });

  describe('fractions and decimals', () => {
    it.each([
      [it_('cream', '1/2', 'cup'), 'half a cup of cream'],
      [it_('cheddar', '1/2', 'oz'), 'half an ounce of cheddar'],
      [it_('salt', '1/4', 'tsp'), 'a quarter of a teaspoon of salt'],
      [it_('sugar', '3/4', 'cup'), 'three quarters of a cup of sugar'],
      [it_('milk', '2/4', 'pt'), 'half a pint of milk'],
      [it_('cabbage', '1/2'), 'half a cabbage'],
      [it_('watermelon', '1/4'), 'a quarter of a watermelon'],
      [it_('onion', '1/3'), 'a third of an onion'],
      [it_('cucumber', '0.5'), 'half a cucumber'],
      [it_('cucumber', '1.5'), 'one and a half cucumbers'],
      [it_('flour', '3/2', 'kg'), 'one and a half kilos of flour'],
      [it_('flour', '4/2', 'kg'), 'two kilos of flour'],
      [it_('vanilla extract', '3/8', 'tsp'), '3 over 8 teaspoons of vanilla extract'],
    ])('%j → %s', (item, expected) => {
      expect(speakItem(item)).toBe(expected);
    });
  });

  describe('odd item names', () => {
    it.each([
      [it_('  milk   semi  skimmed  '), 'milk semi skimmed'],
      [it_('milk.'), 'milk'],
      [it_('eggs!!', '6'), 'six eggs'],
      [it_('M&S sausages', '2', 'pack'), 'two packs of M&S sausages'],
      [it_('7up', '2'), 'two 7ups'],
      [it_('crème fraîche', '1', 'tub'), 'a tub of crème fraîche'],
      [it_('kitchen roll (the big one)'), 'kitchen roll (the big one)'],
      [it_('Oat milk', '1'), 'Oat milk'],
      [it_('apple', 'a few'), 'a few apple'],
    ])('%j → %s', (item, expected) => {
      expect(speakItem(item)).toBe(expected);
    });
  });

  it('round-trips free text through parseQuantity', () => {
    const say = (raw: string) => {
      const q = parseQuantity(raw);
      return speakItem({ item: q.itemText, amount: q.amount, unit: q.unit });
    };
    expect(say('4 pints of milk')).toBe('four pints of milk');
    expect(say('2 courgettes')).toBe('two courgettes');
    expect(say('1/2 cup cream')).toBe('half a cup of cream');
    expect(say('milk x2')).toBe('two lots of milk');
    expect(say('3 cloves garlic')).toBe('three cloves of garlic');
    expect(say('bin bags')).toBe('bin bags');
  });

  it('accepts a stored ShoppingItem as-is', () => {
    const stored: ShoppingItem = {
      itemId: 'i1',
      listId: 'default',
      raw: '2 courgettes',
      item: 'courgettes',
      amount: '2',
      unit: null,
      aisle: 'fruit-veg',
      checked: false,
      sortOrder: 0,
      createdAt: '2026-10-13T00:00:00Z',
      updatedAt: '2026-10-13T00:00:00Z',
      source: 'rules',
    };
    expect(speakItem(stored)).toBe('two courgettes');
    expect(speakList([stored])).toBe('You have one thing on your list: two courgettes.');
  });
});

describe('speakList', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => it_(`item ${i + 1}`));

  it('reads a short list (the RECIP-64 example)', () => {
    expect(speakList([it_('milk'), it_('courgette', '2'), it_('loaf of bread', '1')])).toBe(
      'You have three things on your list: milk, two courgettes and a loaf of bread.',
    );
  });

  it.each<[string, SpeechItem[], string]>([
    ['zero items', [], 'Your list is empty.'],
    ['one item', [it_('milk')], 'You have one thing on your list: milk.'],
    ['two items', [it_('milk'), it_('eggs', '6')], 'You have two things on your list: milk and six eggs.'],
  ])('%s', (_label, items, expected) => {
    expect(speakList(items)).toBe(expected);
  });

  it('names the list, without saying "list list"', () => {
    expect(speakList([it_('milk')], { listName: 'Shopping' })).toBe('You have one thing on your Shopping list: milk.');
    expect(speakList([it_('milk')], { listName: 'Party list' })).toBe('You have one thing on your Party list: milk.');
    expect(speakList([], { listName: 'Shopping' })).toBe('Your Shopping list is empty.');
  });

  it('skips ticked-off items', () => {
    const items = [{ ...it_('milk'), checked: true }, it_('eggs'), { ...it_('bread'), checked: false }];
    expect(speakList(items)).toBe('You have two things on your list: eggs and bread.');
  });

  it('says so when everything is ticked off', () => {
    expect(speakList([{ ...it_('milk'), checked: true }])).toBe("You've ticked off everything on your list.");
  });

  it('skips items whose name is blank', () => {
    expect(speakList([it_('   '), it_('...'), it_('eggs')])).toBe('You have one thing on your list: eggs.');
    expect(speakList([it_('')])).toBe('Your list is empty.');
  });

  describe('truncation', () => {
    it.each<[number, number | undefined, string]>([
      [8, undefined, 'You have eight things on your list: item 1, item 2, item 3, item 4, item 5, item 6, item 7 and item 8.'],
      // One left over is just read out — "and one more" would take as long to say.
      [9, undefined, 'You have nine things on your list: item 1, item 2, item 3, item 4, item 5, item 6, item 7, item 8 and item 9.'],
      [10, undefined, 'You have ten things on your list: item 1, item 2, item 3, item 4, item 5, item 6, item 7, item 8 and two more.'],
      [20, undefined, 'You have 20 things on your list: item 1, item 2, item 3, item 4, item 5, item 6, item 7, item 8 and 12 more.'],
      [20, 3, 'You have 20 things on your list: item 1, item 2, item 3 and 17 more.'],
      [5, 1, 'You have five things on your list: item 1 and four more.'],
      [5, 0, 'You have five things on your list: item 1 and four more.'],
    ])('%d items, max %s', (n, maxItems, expected) => {
      expect(speakList(many(n), { maxItems })).toBe(expected);
    });

    it('counts only outstanding items towards the limit', () => {
      const items = [...many(10).map((i) => ({ ...i, checked: true })), ...many(3)];
      expect(speakList(items, { maxItems: 2 })).toBe('You have three things on your list: item 1, item 2 and item 3.');
    });
  });
});

describe('speakEmptyList', () => {
  it.each<[string | undefined, string]>([
    [undefined, 'Your list is empty.'],
    ['', 'Your list is empty.'],
    ['Shopping', 'Your Shopping list is empty.'],
    ['Big shop list', 'Your Big shop list is empty.'],
  ])('listName %j', (listName, expected) => {
    expect(speakEmptyList({ listName })).toBe(expected);
  });
});

describe('speakAdded', () => {
  it.each<[SpeechItem | SpeechItem[], string]>([
    [it_('courgette', '2'), 'Added two courgettes.'],
    [it_('milk', '4', 'pt'), 'Added four pints of milk.'],
    [it_('onion', '1'), 'Added an onion.'],
    [[it_('milk'), it_('eggs', '6')], 'Added milk and six eggs.'],
    [[it_('milk'), it_('eggs'), it_('bread')], 'Added milk, eggs and bread.'],
    [[], "I didn't add anything."],
    [it_('  '), "I didn't add anything."],
  ])('%j → %s', (added, expected) => {
    expect(speakAdded(added)).toBe(expected);
  });

  it('names the list when asked', () => {
    expect(speakAdded(it_('milk'), { listName: 'Shopping' })).toBe('Added milk to your Shopping list.');
  });
});

describe('speakCheckedOff', () => {
  it.each<[SpeechItem | SpeechItem[], number | undefined, string]>([
    [it_('milk'), undefined, 'Ticked off milk.'],
    [it_('courgette', '2'), undefined, 'Ticked off two courgettes.'],
    [[it_('milk'), it_('eggs')], undefined, 'Ticked off milk and eggs.'],
    [it_('milk'), 0, "Ticked off milk. That's everything on your list."],
    [it_('milk'), 1, 'Ticked off milk. One thing left.'],
    [it_('milk'), 3, 'Ticked off milk. Three things left.'],
    [it_('milk'), 15, 'Ticked off milk. 15 things left.'],
    [it_('milk'), -1, 'Ticked off milk.'],
    [[], 2, 'There was nothing to tick off.'],
  ])('%j, remaining %s → %s', (checked, remaining, expected) => {
    expect(speakCheckedOff(checked, { remaining })).toBe(expected);
  });
});

describe('speakNotFound', () => {
  it.each<[string, string | undefined, string]>([
    ['bananas', undefined, "I couldn't find bananas on your list."],
    ['bananas', 'Shopping', "I couldn't find bananas on your Shopping list."],
    ['  ', undefined, "I couldn't find that on your list."],
  ])('%j, list %j', (name, listName, expected) => {
    expect(speakNotFound(name, { listName })).toBe(expected);
  });
});

describe('SSML', () => {
  it('escapes reserved characters', () => {
    expect(escapeSsml(`M&S <big> "fish" & Tom's chips`)).toBe(
      'M&amp;S &lt;big&gt; &quot;fish&quot; &amp; Tom&apos;s chips',
    );
  });

  it('wraps builder output in <speak>', () => {
    expect(toSsml(speakAdded(it_('M&S sausages', '2', 'pack')))).toBe(
      '<speak>Added two packs of M&amp;S sausages.</speak>',
    );
  });
});
