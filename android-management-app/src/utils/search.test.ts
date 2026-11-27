import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearch, matchesSearch, normalizeForSearch } from './search.ts';

test('normalizes case, accents and separators', () => {
  assert.equal(normalizeForSearch('  iPhone 13   Pro '), 'iphone 13 pro');
  assert.equal(normalizeForSearch('Amélie Zène'), 'amelie zene');
  assert.equal(normalizeForSearch('Nokia-3310/2018'), 'nokia 3310 2018');
});

test('folds Arabic letter forms and strips diacritics', () => {
  assert.equal(normalizeForSearch('أحمد'), normalizeForSearch('احمد'));
  assert.equal(normalizeForSearch('مَحْمُود'), normalizeForSearch('محمود'));
  assert.equal(normalizeForSearch('شيشاوي'), normalizeForSearch('شيشاوي'));
  assert.equal(normalizeForSearch('زناتة'), normalizeForSearch('زناته'));
  // Tatweel is decoration, not a letter.
  assert.equal(normalizeForSearch('محمــــود'), normalizeForSearch('محمود'));
});

test('folds Arabic-Indic digits to ASCII', () => {
  assert.equal(normalizeForSearch('٠٧٧٠١٢٣'), '0770123');
});

test('a phone stored in ASCII digits is found by an Arabic-keyboard query', () => {
  const doc = buildSearch('Karim', '0770 12 34 56');
  assert.equal(doc.digits, '0770123456');
  assert.equal(matchesSearch(doc, '٠٧٧٠-١٢٣٤٥٦'), true);
  assert.equal(matchesSearch(doc, '٠٧٧٠ ١٢ ٣٤ ٥٦'), true);
});

test('a phone stored in Arabic digits is found by an ASCII query', () => {
  const doc = buildSearch('Karim', '٠٧٧٠-١٢٣٤٥٦');
  assert.equal(doc.digits, '0770123456');
  assert.equal(matchesSearch(doc, '0770123456'), true);
  assert.equal(matchesSearch(doc, '0770 12 34 56'), true);
});

test('coerces missing, null and non-string fields instead of throwing', () => {
  const doc = buildSearch(undefined, null, 42, { not: 'a string' }, 'Samsung');
  assert.equal(doc.text, '42 samsung');
  assert.equal(doc.digits, '42');
  assert.doesNotThrow(() => buildSearch(null, undefined));
});

test('empty or whitespace-only queries match everything', () => {
  const doc = buildSearch('Samsung A12', 'TKT-0042');
  assert.equal(matchesSearch(doc, ''), true);
  assert.equal(matchesSearch(doc, '   '), true);
  assert.equal(matchesSearch(doc, null), true);
});

test('matches every token in any order', () => {
  const doc = buildSearch('Samsung Galaxy A12', 'TKT-0042', 'Amel');
  assert.equal(matchesSearch(doc, 'a12 0042'), true);
  assert.equal(matchesSearch(doc, '0042 a12 amel'), true);
  assert.equal(matchesSearch(doc, 'a12 nokia'), false);
});

test('digits typed with separators still match a stored phone', () => {
  const doc = buildSearch('+213 770 12 34 56');
  assert.equal(doc.digits, '213770123456');
  assert.equal(matchesSearch(doc, '0770123456'), false); // leading zero is not stored
  assert.equal(matchesSearch(doc, '770 12 34 56'), true);
  assert.equal(matchesSearch(doc, '77012 3456'), true);
});

test('arabic query finds a record stored in arabic', () => {
  const doc = buildSearch('محمود بن علي', 'TKT-0099');
  assert.equal(matchesSearch(doc, 'محمود'), true);
  assert.equal(matchesSearch(doc, 'بن علي'), true);
  assert.equal(matchesSearch(doc, 'علي بن'), true);
});
