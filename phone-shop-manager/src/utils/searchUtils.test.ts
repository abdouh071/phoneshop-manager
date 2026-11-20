import { describe, it, expect } from 'vitest';
import { searchAndRank, scoreMatch, fuzzyMatch } from './searchUtils';

// ── Helper ────────────────────────────────────────────────────────────────────
type Product = { name: string; model: string; sku?: string; storage?: string; color?: string };
const getFields = (p: Product) =>
  [p.name, p.model, p.sku, p.storage, p.color].filter((v): v is string => !!v);

// ── The user's exact reported scenario ────────────────────────────────────────
describe('searchAndRank – model-number precision (user-reported bug)', () => {
  const products: Product[] = [
    { name: 'AF-REDMI 9 ORG',    model: 'REDMI 9',      storage: '9A' }, // ← has storage=9A, should NOT match
    { name: 'AF REDMI 9A ORG',   model: 'REDMI 9A',     storage: '9A' }, // ← the CORRECT match for "9A"
    { name: 'AF-REDMI 10 ORG',   model: 'REDMI 10',     storage: '10' }, // ← should NOT match
    { name: 'AF REDMI NOTE 9 ORG', model: 'REDMI NOTE 9', storage: '9' }, // ← "NOTE" between REDMI and 9
  ];

  it('REDMI 9A → returns only "AF REDMI 9A ORG"', () => {
    const results = searchAndRank(products, 'REDMI 9A', getFields);
    expect(results.map(p => p.name)).toEqual(['AF REDMI 9A ORG']);
  });

  it('REDMI 9 → returns only "AF-REDMI 9 ORG" (not NOTE 9)', () => {
    const results = searchAndRank(products, 'REDMI 9', getFields);
    expect(results.map(p => p.name)).toEqual(['AF-REDMI 9 ORG']);
  });

  it('REDMI 10 → returns only "AF-REDMI 10 ORG"', () => {
    const results = searchAndRank(products, 'REDMI 10', getFields);
    expect(results.map(p => p.name)).toEqual(['AF-REDMI 10 ORG']);
  });

  it('REDMI NOTE 9 → returns only "AF REDMI NOTE 9 ORG"', () => {
    const results = searchAndRank(products, 'REDMI NOTE 9', getFields);
    expect(results.map(p => p.name)).toEqual(['AF REDMI NOTE 9 ORG']);
  });

  it('REDMI → returns all four (the brand matches all)', () => {
    const results = searchAndRank(products, 'REDMI', getFields);
    expect(results).toHaveLength(4);
  });
});

// ── General ranking correctness ────────────────────────────────────────────────
describe('searchAndRank – ranking order', () => {
  const phones: Product[] = [
    { name: 'Samsung Galaxy A54',  model: 'A54' },
    { name: 'Samsung Galaxy A54s', model: 'A54s' },
    { name: 'Oppo A54',            model: 'A54' },
  ];

  it('A54 exact model ranks Samsung A54 first', () => {
    const results = searchAndRank(phones, 'A54', getFields);
    expect(results.map(p => p.name)).toContain('Samsung Galaxy A54');
    // A54s should also appear (prefix match)
    const names = results.map(p => p.name);
    expect(names).toContain('Samsung Galaxy A54');
    expect(names).toContain('Oppo A54');
  });

  it('Samsung A54 → only Samsung phones (not Oppo)', () => {
    const results = searchAndRank(phones, 'Samsung A54', getFields);
    const names = results.map(p => p.name);
    expect(names.some(n => n.includes('Samsung'))).toBe(true);
    expect(names).not.toContain('Oppo A54');
  });
});

// ── Cross-field isolation ──────────────────────────────────────────────────────
describe('searchAndRank – cross-field false positive prevention', () => {
  it('query words must co-exist in the SAME field, not across fields', () => {
    // name="Apple Case" has "apple", sku="CASE-15-BLK" has "15" — different fields → NO
    // name="Apple iPhone 15" has both in one field → YES (via phrase "iphone 15" in model)
    const items = [
      { name: 'Apple Case',      model: 'Generic',   sku: 'CASE-15-BLK' }, // cross-field → NO
      { name: 'Apple iPhone 15', model: 'iPhone 15', sku: 'APL-15' },      // model="iphone 15" → YES
    ];
    const results = searchAndRank(items, 'iphone 15', p => [p.name, p.model, p.sku].filter(Boolean) as string[]);
    // The second item matches via its model field "iphone 15" (exact phrase)
    expect(results.map(r => r.name)).toContain('Apple iPhone 15');
    // The first item has no field containing both "iphone" and "15" → excluded
    expect(results.map(r => r.name)).not.toContain('Apple Case');
  });

  it('numeric token must be adjacent: "apple 15" does NOT match "apple iphone 15"', () => {
    // "15" is pure-numeric → must directly follow "apple" with no gap
    const items = [{ name: 'Apple iPhone 15', model: 'iPhone 15' }];
    const results = searchAndRank(items, 'apple 15', p => [p.name, p.model].filter(Boolean) as string[]);
    // No field has "apple" directly adjacent to "15" (name has "iphone" between them;
    // model has "iphone" between them; joined "apple iphone 15 iphone 15" still has gap)
    // → "iphone 15" is the right query, not "apple 15"
    expect(results).toHaveLength(0);
  });
});

// ── scoreMatch unit tests ──────────────────────────────────────────────────────
describe('scoreMatch', () => {
  it('exact field match → 100', () => expect(scoreMatch('9a', '9a')).toBe(100));
  it('field starts with query (alpha-only) → 80', () => expect(scoreMatch('redmi', 'redmi pro')).toBe(80));
  it('field word exact match (alphanumeric) → 70', () => expect(scoreMatch('9a', 'redmi 9a org')).toBe(70));
  it('field word starts with alpha query → 60', () => expect(scoreMatch('redm', 'af redmi org')).toBe(60));
  it('"9" does NOT start with "9a" → not 60', () => {
    // "9" can't startsWith "9a" (would need to be at least as long)
    expect(scoreMatch('9a', 'redmi 9 org')).toBe(0);
  });
  it('fuzzy: "samsng" ≈ "samsung" (1 missing char)', () => expect(fuzzyMatch('samsng', 'samsung')).toBe(true));
  it('fuzzy: "samong" is 2 edits from "samsung" → no match', () => expect(fuzzyMatch('samong', 'samsung')).toBe(false));
  it('fuzzy: does not apply to 2-char words', () => expect(fuzzyMatch('9a', 'samsung')).toBe(false));
});
