// RECP-49 — the categorisation data (aisles + rules) is a single source of truth in
// lambda/shared/data/*.json. These tests fail loudly if a consumer drifts from it:
//   • the web app keeps a byte-identical copy at web/src/lib/aisles.json
//   • aisles.ts must expose exactly the canonical list
//   • the iOS app bundles the same JSON (a Swift XCTest asserts the enum matches).

import { readFileSync } from 'fs';
import { join } from 'path';
import canonicalAisles from '../lambda/shared/data/aisles.json';
import canonicalRules from '../lambda/shared/data/categorise-rules.json';
import { AISLES, OTHER_AISLE_ID, isAisleId } from '../lambda/shared/aisles';

function readJson(relPath: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, relPath), 'utf8'));
}

describe('shared aisle data', () => {
  it('aisles.ts exposes exactly the canonical JSON', () => {
    expect(AISLES).toEqual(canonicalAisles);
  });

  it('the web app copy is byte-identical to the canonical JSON', () => {
    expect(readJson('../../web/src/lib/aisles.json')).toEqual(canonicalAisles);
  });

  it('ids are unique and Other sorts last', () => {
    const ids = canonicalAisles.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[ids.length - 1]).toBe(OTHER_AISLE_ID);
  });
});

describe('shared rules data', () => {
  it('every rule aisle is a known aisle id', () => {
    for (const aisle of Object.keys(canonicalRules)) {
      expect(isAisleId(aisle)).toBe(true);
    }
  });
});
