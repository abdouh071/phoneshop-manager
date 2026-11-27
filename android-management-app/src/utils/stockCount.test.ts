import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStockCount } from './stockCount.ts';

test('a counted total is read as itself, not as a movement', () => {
  assert.equal(parseStockCount('10'), 10);
  assert.equal(parseStockCount(' 10 '), 10);
  assert.equal(parseStockCount('0'), 0);
  assert.equal(parseStockCount('007'), 7);
});

test('an Arabic or Persian keypad counts the same shelf', () => {
  assert.equal(parseStockCount('١٠'), 10);
  assert.equal(parseStockCount('۲۵'), 25);
  assert.equal(parseStockCount(' ٠ '), 0);
});

test('anything that is not a whole number of units is refused', () => {
  for (const value of ['', '   ', '-3', '+3', '1.5', '12abc', 'abc', '1e3', '1 2', null, undefined, {}, NaN, Infinity]) {
    assert.equal(parseStockCount(value), null, `${String(value)} must not be a count`);
  }
});

test('a count too large to be a real shelf is refused, not rounded', () => {
  assert.equal(parseStockCount('9007199254740993'), null);
  assert.equal(parseStockCount('9'.repeat(400)), null);
  assert.equal(parseStockCount('9007199254740991'), 9007199254740991);
});