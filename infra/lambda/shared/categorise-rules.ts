// Deterministic grocery → aisle lookup (RECP-35). This handles the common long-tail
// of everyday groceries WITHOUT an LLM call — the cost-saver. The categoriser only
// falls back to Bedrock/Haiku when nothing here matches.
//
// Keys are lowercase keyword phrases; matching is whole-word and prefers the LONGEST
// matching phrase (so "kidney beans" → cupboard beats "beans"). Aisle ids must be
// valid ids from ./aisles.ts.

import { isAisleId } from './aisles';

const RULES: Record<string, string[]> = {
  produce: [
    'apple', 'apples', 'banana', 'bananas', 'orange', 'oranges', 'lemon', 'lemons',
    'lime', 'limes', 'grape', 'grapes', 'strawberry', 'strawberries', 'blueberry',
    'blueberries', 'raspberry', 'raspberries', 'melon', 'pineapple', 'mango', 'avocado',
    'avocados', 'pear', 'pears', 'peach', 'plum', 'kiwi', 'potato', 'potatoes',
    'sweet potato', 'carrot', 'carrots', 'onion', 'onions', 'red onion', 'spring onion',
    'garlic', 'ginger', 'tomato', 'tomatoes', 'cucumber', 'lettuce', 'spinach', 'kale',
    'rocket', 'salad', 'pepper', 'peppers', 'chilli', 'chillies', 'mushroom', 'mushrooms',
    'broccoli', 'cauliflower', 'cabbage', 'courgette', 'aubergine', 'celery', 'leek',
    'leeks', 'sweetcorn', 'peas', 'green beans', 'asparagus', 'beetroot', 'squash',
    'parsnip', 'parsnips', 'herbs', 'coriander', 'parsley', 'basil', 'mint', 'thyme',
    'rosemary',
  ],
  bakery: [
    'bread', 'loaf', 'bread roll', 'rolls', 'baguette', 'bagel', 'bagels', 'croissant',
    'croissants', 'crumpets', 'pitta', 'naan', 'tortilla', 'tortillas', 'wrap', 'wraps',
    'muffin', 'muffins', 'doughnut', 'cake', 'pastry', 'brioche', 'sourdough', 'ciabatta',
  ],
  'meat-fish': [
    'chicken', 'chicken breast', 'chicken thighs', 'beef', 'mince', 'beef mince', 'steak',
    'pork', 'lamb', 'sausages', 'sausage', 'bacon', 'ham', 'turkey', 'gammon', 'ribs',
    'salmon', 'tuna steak', 'cod', 'haddock', 'prawns', 'fish', 'sea bass', 'mackerel',
    'fish fingers', 'chorizo', 'pepperoni',
  ],
  'dairy-eggs': [
    'milk', 'semi skimmed milk', 'whole milk', 'skimmed milk', 'oat milk', 'almond milk',
    'soya milk', 'cheese', 'cheddar', 'mozzarella', 'parmesan', 'feta', 'brie',
    'cream cheese', 'butter', 'margarine', 'cream', 'single cream', 'double cream',
    'soured cream', 'clotted cream', 'creme fraiche', 'yoghurt', 'yogurt', 'greek yoghurt',
    'eggs', 'egg', 'custard',
  ],
  chilled: [
    'hummus', 'houmous', 'dip', 'dips', 'coleslaw', 'olives', 'pate', 'quiche',
    'fresh pasta', 'gnocchi', 'tofu', 'deli meat', 'smoked salmon', 'fresh soup',
    'ready meal', 'ready meals',
  ],
  frozen: [
    'ice cream', 'frozen peas', 'frozen chips', 'chips', 'frozen pizza', 'pizza',
    'frozen veg', 'frozen vegetables', 'ice', 'lolly', 'lollies', 'frozen fruit',
    'frozen berries', 'waffles', 'frozen fish',
  ],
  cupboard: [
    'tinned tomatoes', 'chopped tomatoes', 'tomato puree', 'passata', 'baked beans',
    'beans', 'kidney beans', 'butter beans', 'chickpeas', 'lentils', 'tinned',
    'tuna', 'sweetcorn tin', 'coconut milk', 'stock', 'stock cubes', 'soup', 'gravy',
    'tinned fruit',
  ],
  'pasta-rice-grains': [
    'pasta', 'spaghetti', 'penne', 'fusilli', 'macaroni', 'lasagne', 'rice', 'basmati',
    'basmati rice', 'risotto rice', 'noodles', 'couscous', 'quinoa', 'oats', 'porridge',
    'cereal', 'cornflakes', 'granola', 'muesli', 'bulgur',
  ],
  baking: [
    'flour', 'plain flour', 'self raising flour', 'bread flour', 'sugar', 'caster sugar',
    'icing sugar', 'brown sugar', 'baking powder', 'bicarbonate of soda', 'yeast',
    'vanilla', 'vanilla extract', 'cocoa', 'chocolate chips', 'baking', 'cake mix',
    'icing', 'sprinkles',
  ],
  condiments: [
    'ketchup', 'mayonnaise', 'mayo', 'mustard', 'brown sauce', 'salad cream',
    'soy sauce', 'olive oil', 'vegetable oil', 'sunflower oil', 'oil', 'vinegar',
    'balsamic', 'salt', 'pepper', 'pepper grinder', 'spices', 'paprika', 'cumin',
    'curry powder', 'cinnamon', 'oregano', 'honey', 'jam', 'marmalade', 'peanut butter',
    'nutella', 'chocolate spread', 'pesto', 'pasta sauce', 'curry sauce', 'tahini',
    'sriracha', 'hot sauce', 'worcestershire sauce', 'stock pot',
  ],
  snacks: [
    'crisps', 'chocolate', 'chocolate bar', 'biscuits', 'cookies', 'sweets', 'haribo',
    'nuts', 'peanuts', 'cashews', 'popcorn', 'crackers', 'cereal bars', 'flapjack',
    'chewing gum', 'mints',
  ],
  drinks: [
    'water', 'sparkling water', 'juice', 'orange juice', 'apple juice', 'squash',
    'cordial', 'coke', 'cola', 'lemonade', 'fizzy drink', 'tea', 'tea bags', 'coffee',
    'hot chocolate', 'beer', 'lager', 'wine', 'red wine', 'white wine', 'prosecco',
    'gin', 'vodka', 'whisky', 'tonic', 'energy drink',
  ],
  'world-foods': [
    'curry paste', 'thai curry paste', 'rice noodles', 'miso', 'fish sauce', 'mirin',
    'sushi', 'taco', 'taco shells', 'salsa', 'tortilla chips', 'poppadoms', 'naan bread',
    'sesame oil', 'oyster sauce', 'hoisin', 'sushi rice',
  ],
  'health-beauty': [
    'shampoo', 'conditioner', 'shower gel', 'soap', 'toothpaste', 'toothbrush',
    'deodorant', 'razors', 'shaving foam', 'moisturiser', 'sun cream', 'plasters',
    'paracetamol', 'ibuprofen', 'vitamins', 'cotton wool', 'tampons', 'sanitary pads',
    'tissues', 'face wash', 'hand cream',
  ],
  household: [
    'washing up liquid', 'fairy liquid', 'dishwasher tablets', 'washing powder',
    'laundry detergent', 'fabric softener', 'bleach', 'bleach', 'cleaning spray',
    'surface spray', 'kitchen roll', 'toilet roll', 'loo roll', 'bin bags', 'bin liners',
    'cling film', 'foil', 'tin foil', 'baking paper', 'sponges', 'washing up sponge',
    'batteries', 'light bulb', 'matches', 'candles', 'air freshener', 'disinfectant',
  ],
  'baby-pet': [
    'nappies', 'baby wipes', 'baby food', 'formula', 'cat food', 'dog food', 'cat litter',
    'cat treats', 'dog treats', 'pet food',
  ],
};

// Build a flat phrase → aisle map, validating ids at module load.
const PHRASE_TO_AISLE: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [aisle, phrases] of Object.entries(RULES)) {
    if (!isAisleId(aisle)) throw new Error(`categorise-rules: unknown aisle id "${aisle}"`);
    for (const p of phrases) map.set(p, aisle);
  }
  return map;
})();

// Phrases sorted longest-first (by word count then length) so multi-word phrases win.
const PHRASES_BY_SPECIFICITY: string[] = [...PHRASE_TO_AISLE.keys()].sort((a, b) => {
  const wa = a.split(' ').length;
  const wb = b.split(' ').length;
  return wb - wa || b.length - a.length;
});

function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/**
 * Best-effort deterministic aisle for an item text. Returns the aisle id of the most
 * specific matching phrase, or null if nothing matches (caller falls back to the LLM).
 */
export function ruleAisle(itemText: string): string | null {
  if (!itemText.trim()) return null;
  const haystack = normalise(itemText);
  for (const phrase of PHRASES_BY_SPECIFICITY) {
    if (haystack.includes(` ${phrase} `)) return PHRASE_TO_AISLE.get(phrase) ?? null;
  }
  return null;
}
