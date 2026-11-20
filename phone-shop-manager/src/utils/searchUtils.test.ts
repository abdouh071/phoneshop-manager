import { describe, it, expect } from 'vitest';
import { searchAndRank, scoreMatch, fuzzyMatch } from './searchUtils';

// ── Helper ────────────────────────────────────────────────────────────────────
type Product = { name: string; model: string; sku?: string; storage?: string; color?: string };
const getFields = (p: Product) =>
  [p.name, p.model, p.sku, p.storage, p.color].filter((v): v is string => !!v);

// ── The user's exact reported scenario ────────────────────────────────────────
describe('searchAndRank – model-number precision (user-reported bug)', () => {
  const products: Product[] = [
    { name: 'AF-REDMI 9 ORG',  model: 'REDMI 9',  storage: '9A' }, // ← has storage=9A, should NOT match
    { name: 'AF REDMI 9A ORG', model: 'REDMI 9A', storage: '9A' }, // ← the CORRECT match
    { name: 'AF-REDMI 10 ORG', model: 'REDMI 10', storage: '10' }, // ← should NOT match
  ];

  it('REDMI 9A → returns only "AF REDMI 9A ORG"', () => {
    const results = searchAndRank(products, 'REDMI 9A', getFields);
    expect(results.map(p => p.name)).toEqual(['AF REDMI 9A ORG']);
  });

  it('REDMI 9 → returns only "AF-REDMI 9 ORG"', () => {
    const results = searchAndRank(products, 'REDMI 9', getFields);
    expect(results.map(p => p.name)).toEqual(['AF-REDMI 9 ORG']);
  });

  it('REDMI 10 → returns only "AF-REDMI 10 ORG"', () => {
    const results = searchAndRank(products, 'REDMI 10', getFields);
    expect(results.map(p => p.name)).toEqual(['AF-REDMI 10 ORG']);
  });

  it('REDMI → returns all three (the brand matches all)', () => {
    const results = searchAndRank(products, 'REDMI', getFields);
    expect(results).toHaveLength(3);
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
    // name has "apple", sku has "15" — query "apple 15" should NOT match
    // if only way to satisfy both words is to combine different fields
    const items = [
      { name: 'Apple Case',  model: 'Generic', sku: 'CASE-15-BLK' },  // name=apple, sku=15 → NO
      { name: 'Apple iPhone 15', model: 'iPhone 15', sku: 'APL-15' }, // name has both → YES
    ];
    const results = searchAndRank(items, 'apple 15', p => [p.name, p.model, p.sku].filter(Boolean) as string[]);
    // Only the second item has "apple" and "15" in the same field
    expect(results.map(r => r.name)).toContain('Apple iPhone 15');
    // The first item (Apple Case with sku CASE-15) should NOT match because
    // "apple" and "15" don't co-exist in name, model, OR sku independently
    expect(results.map(r => r.name)).not.toContain('Apple Case');
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
