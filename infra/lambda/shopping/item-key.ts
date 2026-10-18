// Same-item matching for voice commands (RECIP-62). Alexa hands us words ("two pints of
// milk", "tick off eggs"), so we normalise them to digits for parseQuantity, then key on the
// item text alone — quantity and case ignored, last word lightly singularised — so a spoken
// item finds the line already on the list.

import { cacheKey } from '../shared/categorise';
import { parseQuantity } from '../shared/quantity';
import { ShoppingItem } from './store';

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

// Units that turn a leading "a"/"an" into a count ("a pint of milk" → "1 pint of milk").
// Kept to units parseQuantity recognises; "a loaf of bread" stays as it is.
const SPOKEN_UNITS = [
  'gram', 'gramme', 'kilo', 'kilogram', 'litre', 'liter', 'millilitre', 'milliliter',
  'pound', 'ounce', 'pint', 'cup', 'tablespoon', 'teaspoon', 'tin', 'can', 'pack', 'packet',
  'bottle', 'jar', 'box', 'bag', 'bunch', 'clove', 'dozen', 'slice', 'punnet',
];
const UNIT_ALT = SPOKEN_UNITS.join('|');
const HALF_RE = new RegExp(String.raw`^\s*half\s+an?\s+(${UNIT_ALT})\b`, 'i');
const ARTICLE_RE = new RegExp(String.raw`^\s*an?\s+(${UNIT_ALT})\b`, 'i');
const NUMBER_WORD_RE = new RegExp(String.raw`\b(${Object.keys(NUMBER_WORDS).join('|')})\b`, 'gi');

/** Convert spoken quantities to the digits parseQuantity understands. Other text is untouched. */
export function spokenToDigits(text: string): string {
  return text
    .replace(NUMBER_WORD_RE, (w) => String(NUMBER_WORDS[w.toLowerCase()]))
    .replace(HALF_RE, (_m, unit: string) => `1/2 ${unit}`)
    .replace(ARTICLE_RE, (_m, unit: string) => `1 ${unit}`);
}

/** Drop a plural ending from a word: "eggs" → "egg", "tomatoes" → "tomato"; "glass" kept. */
function singularise(word: string): string {
  if (word.length <= 3 || /(ss|us|is)$/.test(word) || !word.endsWith('s')) return word;
  if (/(s|x|z|ch|sh|o)es$/.test(word)) return word.slice(0, -2);
  return word.slice(0, -1);
}

/** Matching key for an item: quantity and case ignored, last word singularised. */
export function itemKey(text: string): string {
  const key = cacheKey(parseQuantity(spokenToDigits(text)).itemText);
  const words = key.split(' ');
  words[words.length - 1] = singularise(words[words.length - 1]);
  return words.join(' ');
}

/**
 * The list line a spoken item refers to: the first unticked match by sortOrder, otherwise
 * the most recently updated ticked match (so an add can untick it rather than duplicate it).
 */
export function findSameItem(items: ShoppingItem[], text: string): ShoppingItem | undefined {
  const key = itemKey(text);
  if (!key) return undefined;
  const matches = items.filter((i) => itemKey(i.item) === key);
  const unticked = matches.filter((i) => !i.checked).sort((a, b) => a.sortOrder - b.sortOrder);
  if (unticked.length) return unticked[0];
  return matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}
