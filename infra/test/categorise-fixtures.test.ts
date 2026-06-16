// Shared categorisation fixtures (RECP-49). The SAME fixtures are asserted by the iOS
// XCTest suite, so the TypeScript and Swift ports of quantity parsing + rule matching
// cannot drift: both must reproduce these exact outputs.

import quantityFixtures from '../lambda/shared/data/quantity-fixtures.json';
import rulesFixtures from '../lambda/shared/data/rules-fixtures.json';
import { parseQuantity } from '../lambda/shared/quantity';
import { ruleAisle } from '../lambda/shared/categorise-rules';

describe('quantity fixtures', () => {
  for (const f of quantityFixtures) {
    it(`parses "${f.raw}"`, () => {
      expect(parseQuantity(f.raw)).toEqual({
        amount: f.amount,
        unit: f.unit,
        itemText: f.itemText,
      });
    });
  }
});

describe('rules fixtures', () => {
  for (const f of rulesFixtures) {
    it(`classifies "${f.text}"`, () => {
      expect(ruleAisle(f.text)).toBe(f.aisle);
    });
  }
});
