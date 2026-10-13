// Alexa speech builders (RECIP-64). Turns shopping-list results into natural British
// English sentences for the planned Alexa skill (RECIP-61).
//
// Pure and dependency-free on purpose: no AWS, no Alexa SDK, no I/O. The skill handler
// fetches the list, hands the items to these builders and puts the returned string in
// its response. Keeping the wording here means it is unit-testable and reusable by any
// other voice surface.
//
// Items arrive in the quantity model from ./quantity (RECP-40): an `item` label plus an
// optional `amount` (as typed, e.g. "2", "1/2", "1.5") and a normalised `unit` id ("ml",
// "pt", "tin", "x" for an explicit count, …). We turn that back into speech:
//
//   { item: 'courgette',    amount: '2',   unit: null }  → "two courgettes"
//   { item: 'loaf of bread', amount: '1',  unit: null }  → "a loaf of bread"
//   { item: 'milk',         amount: '4',   unit: 'pt' }  → "four pints of milk"
//   { item: 'cream',        amount: '1/2', unit: 'cup' } → "half a cup of cream"
//   { item: 'double cream', amount: '200', unit: 'ml' }  → "200 millilitres of double cream"
//
// Output is plain text. Lists are joined with "and" and no Oxford comma ("milk, eggs and
// bread"). Numbers one to ten are spelt out and larger ones left as digits, which Alexa
// reads naturally. Use toSsml() if the response needs SSML.

/** The minimal item shape these builders need. A stored ShoppingItem satisfies it. */
export interface SpeechItem {
  /** The item label, e.g. "courgette", "double cream", "loaf of bread". */
  item: string;
  /** Amount as typed ("2", "1/2", "1.5"); null/undefined when none was given. */
  amount?: string | null;
  /** Normalised unit id from parseQuantity ("ml", "pt", "x", …); null for a bare count. */
  unit?: string | null;
  /** Ticked-off items are left out when reading a list. */
  checked?: boolean;
}

export interface ListSpeechOptions {
  /** The most items to read out before summarising the rest as "and N more". Default 8. */
  maxItems?: number;
  /** The list's name ("Shopping", "Big shop"); omitted → "your list". */
  listName?: string;
}

export interface CheckOffSpeechOptions {
  /** Unchecked items left on the list after the check-off; omitted → not mentioned. */
  remaining?: number;
}

export const DEFAULT_MAX_ITEMS = 8;

// ─── Numbers ────────────────────────────────────────────────────────────────

const SMALL_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** Spell out zero to ten; leave anything else as digits (Alexa reads "12" as "twelve"). */
export function numberWords(n: number): string {
  return Number.isInteger(n) && n >= 0 && n <= 10 ? SMALL_NUMBERS[n] : String(n);
}

// Fractional parts we can say naturally. `of` is the "part of a thing" phrase (before the
// article: "half a cup", "a quarter of a cup"); `and` follows a whole number ("two and a half").
interface FractionWords { of: string; and: string }
const FRACTIONS: Record<string, FractionWords> = {
  '1/2': { of: 'half', and: 'and a half' },
  '1/4': { of: 'a quarter of', and: 'and a quarter' },
  '3/4': { of: 'three quarters of', and: 'and three quarters' },
  '1/3': { of: 'a third of', and: 'and a third' },
  '2/3': { of: 'two thirds of', and: 'and two thirds' },
};
const DECIMAL_FRACTIONS: Record<string, string> = { '5': '1/2', '25': '1/4', '75': '3/4' };

/**
 * How an amount is spoken:
 *  - one:     exactly one → an article ("a pint", "an onion")
 *  - part:    a fraction under one → "half a cup", "a quarter of a watermelon"
 *  - many:    anything else → a number with a plural noun ("two pints", "one and a half litres")
 *  - verbatim: an amount we can't interpret, said as typed
 */
type SpokenAmount =
  | { kind: 'one' }
  | { kind: 'part'; words: string }
  | { kind: 'many'; words: string }
  | { kind: 'verbatim'; words: string };

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function spokenFraction(whole: number, num: number, den: number): SpokenAmount | null {
  if (den === 0) return null;
  whole += Math.floor(num / den);
  num %= den;
  if (num === 0) return spokenWhole(whole);
  const g = gcd(num, den);
  const words = FRACTIONS[`${num / g}/${den / g}`];
  if (!words) return null;
  if (whole === 0) return { kind: 'part', words: words.of };
  return { kind: 'many', words: `${numberWords(whole)} ${words.and}` };
}

function spokenWhole(n: number): SpokenAmount {
  return n === 1 ? { kind: 'one' } : { kind: 'many', words: numberWords(n) };
}

function spokenAmount(amount: string): SpokenAmount {
  const a = amount.trim();
  let m = a.match(/^(\d+)$/);
  if (m) return spokenWhole(Number(m[1]));

  m = a.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) {
    const spoken = spokenFraction(0, Number(m[1]), Number(m[2]));
    return spoken ?? { kind: 'many', words: `${m[1]} over ${m[2]}` };
  }

  m = a.match(/^(\d*)\.(\d+)$/);
  if (m) {
    const whole = Number(m[1] || '0');
    const frac = DECIMAL_FRACTIONS[m[2].replace(/0+$/, '')];
    if (frac) {
      const [num, den] = frac.split('/').map(Number);
      const spoken = spokenFraction(whole, num, den);
      if (spoken) return spoken;
    }
    if (/^0+$/.test(m[2])) return spokenWhole(whole);
    return { kind: 'many', words: a.startsWith('.') ? `0${a}` : a };
  }

  return { kind: 'verbatim', words: a };
}

// ─── Words ──────────────────────────────────────────────────────────────────

// Mass nouns: "two milk" isn't English, so a bare count of these becomes "two lots of milk",
// and a single one takes no article ("milk", not "a milk").
const UNCOUNTABLE = new Set([
  'bacon', 'bread', 'broccoli', 'butter', 'cereal', 'cheese', 'chocolate', 'coffee', 'cod',
  'couscous', 'cream', 'fish', 'flour', 'garlic', 'ginger', 'granola', 'ham', 'honey',
  'hummus', 'jam', 'juice', 'ketchup', 'marmalade', 'mayonnaise', 'milk', 'mince', 'muesli',
  'mustard', 'oil', 'pasta', 'porridge', 'quinoa', 'rice', 'salmon', 'salt', 'sauce',
  'spaghetti', 'spinach', 'squash', 'sugar', 'tea', 'tuna', 'vinegar', 'water', 'yeast',
  'yoghurt', 'yogurt',
]);

const IRREGULAR_PLURALS: Record<string, string> = {
  loaf: 'loaves', leaf: 'leaves', half: 'halves', knife: 'knives', wife: 'wives',
  potato: 'potatoes', tomato: 'tomatoes', mango: 'mangoes',
  mouse: 'mice', child: 'children', person: 'people', foot: 'feet', tooth: 'teeth',
};

// How each normalised unit id from ./quantity is spoken: [singular, plural].
const UNIT_WORDS: Record<string, [string, string]> = {
  g: ['gram', 'grams'],
  kg: ['kilo', 'kilos'],
  mg: ['milligram', 'milligrams'],
  ml: ['millilitre', 'millilitres'],
  cl: ['centilitre', 'centilitres'],
  l: ['litre', 'litres'],
  lb: ['pound', 'pounds'],
  oz: ['ounce', 'ounces'],
  pt: ['pint', 'pints'],
  cup: ['cup', 'cups'],
  tbsp: ['tablespoon', 'tablespoons'],
  tsp: ['teaspoon', 'teaspoons'],
  tin: ['tin', 'tins'],
  can: ['can', 'cans'],
  pack: ['pack', 'packs'],
  bottle: ['bottle', 'bottles'],
  jar: ['jar', 'jars'],
  box: ['box', 'boxes'],
  bag: ['bag', 'bags'],
  bunch: ['bunch', 'bunches'],
  clove: ['clove', 'cloves'],
  slice: ['slice', 'slices'],
  punnet: ['punnet', 'punnets'],
};

function matchCase(original: string, replacement: string): string {
  return original.length > 1 && original === original.toUpperCase() ? replacement.toUpperCase() : replacement;
}

/** Pluralise a single word. Words that already look plural are left alone. */
export function pluraliseWord(word: string): string {
  const lower = word.toLowerCase();
  if (!/[a-z]$/.test(lower)) return word;
  if (UNCOUNTABLE.has(lower)) return word;
  const irregular = IRREGULAR_PLURALS[lower];
  if (irregular) return matchCase(word, word[0] + irregular.slice(1));
  // Already plural ("eggs", "tomatoes") — but not "glass", "asparagus", "houmous".
  if (/s$/.test(lower) && !/(ss|us|is)$/.test(lower)) return word;
  if (/(s|x|z|ch|sh)$/.test(lower)) return word + matchCase(word, 'es');
  if (/[^aeiou]y$/.test(lower)) return word.slice(0, -1) + matchCase(word, 'ies');
  return word + matchCase(word, 's');
}

/**
 * Pluralise an item label by its head noun: the word before "of" when there is one
 * ("loaf of bread" → "loaves of bread"), otherwise the last word ("large egg" → "large eggs").
 */
export function pluraliseItem(item: string): string {
  const words = item.split(' ');
  const ofIndex = words.findIndex((w, i) => i > 0 && w.toLowerCase() === 'of');
  const head = ofIndex > 0 ? ofIndex - 1 : words.length - 1;
  words[head] = pluraliseWord(words[head]);
  return words.join(' ');
}

function headNoun(item: string): string {
  const words = item.toLowerCase().split(' ');
  const ofIndex = words.findIndex((w, i) => i > 0 && w === 'of');
  return words[ofIndex > 0 ? ofIndex - 1 : words.length - 1];
}

function isUncountable(item: string): boolean {
  return UNCOUNTABLE.has(headNoun(item));
}

/** "a" or "an" for the word that follows, by how it's (usually) said. */
export function indefiniteArticle(next: string): 'a' | 'an' {
  const w = next.toLowerCase();
  if (/^(hour|honest|honour|heir)/.test(w)) return 'an';
  if (/^(uni|use|usu|uk|eu|ewe|one|once)/.test(w)) return 'a';
  return /^[aeiou]/.test(w) ? 'an' : 'a';
}

function withArticle(phrase: string): string {
  return `${indefiniteArticle(phrase)} ${phrase}`;
}

/**
 * Tidy a label for speech: collapse whitespace and drop trailing sentence punctuation,
 * which would otherwise make the sentence read oddly ("milk., eggs").
 */
function cleanItem(item: string): string {
  return item.replace(/\s+/g, ' ').trim().replace(/[\s.,;:!?]+$/, '');
}

// ─── Builders ───────────────────────────────────────────────────────────────

/** Speak a single item with its quantity, e.g. "two courgettes", "half a cup of cream". */
export function speakItem(entry: SpeechItem): string {
  const item = cleanItem(entry.item);
  const amount = entry.amount?.trim();
  if (!amount) return item;

  const spoken = spokenAmount(amount);
  const unit = entry.unit && entry.unit !== 'x' ? entry.unit : null;

  // A dozen is a counting word, not a measure: "a dozen eggs", "two dozen eggs".
  if (unit === 'dozen') {
    const eggs = pluraliseItem(item);
    switch (spoken.kind) {
      case 'one': return `a dozen ${eggs}`;
      case 'part': return `${spoken.words} ${withArticle(`dozen ${eggs}`)}`;
      default: return `${spoken.words} dozen ${eggs}`;
    }
  }

  if (unit) {
    // Unknown unit ids are spoken as stored rather than dropped.
    const [one, many] = UNIT_WORDS[unit] ?? [unit, unit];
    switch (spoken.kind) {
      case 'one': return `${withArticle(one)} of ${item}`;
      case 'part': return `${spoken.words} ${withArticle(one)} of ${item}`;
      default: return `${spoken.words} ${many} of ${item}`;
    }
  }

  // A bare count.
  const uncountable = isUncountable(item);
  switch (spoken.kind) {
    case 'one': return uncountable ? item : withArticle(item);
    case 'part': return `${spoken.words} ${withArticle(item)}`;
    case 'verbatim': return `${spoken.words} ${item}`;
    case 'many': return uncountable ? `${spoken.words} lots of ${item}` : `${spoken.words} ${pluraliseItem(item)}`;
  }
}

/** Join phrases with commas and a final "and", no Oxford comma: "a, b and c". */
export function joinWithAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "one thing", "three things", "12 things". */
function countThings(n: number): string {
  return `${numberWords(n)} ${n === 1 ? 'thing' : 'things'}`;
}

/** "your list", "your Shopping list"; a name already ending in "list" isn't doubled. */
function listPhrase(listName?: string): string {
  const name = listName?.replace(/\s+/g, ' ').trim();
  if (!name) return 'your list';
  return /\blist$/i.test(name) ? `your ${name}` : `your ${name} list`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Items worth saying: not ticked off, and with a label left after tidying. */
function speakable(items: readonly SpeechItem[]): SpeechItem[] {
  return items.filter((i) => !i.checked && cleanItem(i.item ?? '') !== '');
}

/** The empty-list response. */
export function speakEmptyList(options: Pick<ListSpeechOptions, 'listName'> = {}): string {
  return `${capitalise(listPhrase(options.listName))} is empty.`;
}

/**
 * Read a list: "You have three things on your list: milk, two courgettes and a loaf of bread."
 * Ticked-off items are skipped. Long lists are cut short after `maxItems` with "and N more";
 * if only one item would be left over it is read out instead, as that's no longer to say.
 */
export function speakList(items: readonly SpeechItem[], options: ListSpeechOptions = {}): string {
  const list = listPhrase(options.listName);
  const outstanding = speakable(items);

  if (outstanding.length === 0) {
    // Everything ticked off reads better than "empty" when there were items.
    return items.some((i) => i.checked)
      ? `You've ticked off everything on ${list}.`
      : speakEmptyList(options);
  }

  const max = Math.max(1, Math.floor(options.maxItems ?? DEFAULT_MAX_ITEMS));
  const shown = outstanding.length > max + 1 ? outstanding.slice(0, max) : outstanding;
  const parts = shown.map(speakItem);
  const rest = outstanding.length - shown.length;
  if (rest > 0) parts.push(`${numberWords(rest)} more`);

  return `You have ${countThings(outstanding.length)} on ${list}: ${joinWithAnd(parts)}.`;
}

/** Confirm an add: "Added two courgettes." / "Added milk and eggs to your Shopping list." */
export function speakAdded(added: SpeechItem | readonly SpeechItem[], options: Pick<ListSpeechOptions, 'listName'> = {}): string {
  const items = (Array.isArray(added) ? added : [added]).filter((i) => cleanItem(i.item ?? '') !== '');
  if (items.length === 0) return "I didn't add anything.";
  const where = options.listName ? ` to ${listPhrase(options.listName)}` : '';
  return `Added ${joinWithAnd(items.map(speakItem))}${where}.`;
}

/** Confirm a check-off: "Ticked off milk." optionally followed by what's left. */
export function speakCheckedOff(checked: SpeechItem | readonly SpeechItem[], options: CheckOffSpeechOptions = {}): string {
  const items = (Array.isArray(checked) ? checked : [checked]).filter((i) => cleanItem(i.item ?? '') !== '');
  if (items.length === 0) return 'There was nothing to tick off.';
  const sentence = `Ticked off ${joinWithAnd(items.map(speakItem))}.`;

  const { remaining } = options;
  if (remaining === undefined || remaining < 0) return sentence;
  if (remaining === 0) return `${sentence} That's everything on your list.`;
  return `${sentence} ${capitalise(countThings(remaining))} left.`;
}

/** The item couldn't be found to tick off: "I couldn't find bananas on your list." */
export function speakNotFound(itemName: string, options: Pick<ListSpeechOptions, 'listName'> = {}): string {
  const item = cleanItem(itemName);
  return item
    ? `I couldn't find ${item} on ${listPhrase(options.listName)}.`
    : `I couldn't find that on ${listPhrase(options.listName)}.`;
}

// ─── SSML ───────────────────────────────────────────────────────────────────

/** Escape the characters SSML (XML) reserves, so "M&S sausages" can't break the markup. */
export function escapeSsml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Wrap plain speech from these builders as an SSML document. */
export function toSsml(text: string): string {
  return `<speak>${escapeSsml(text)}</speak>`;
}
