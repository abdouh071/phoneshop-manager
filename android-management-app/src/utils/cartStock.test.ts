import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCartStock } from './cartStock.ts';

test('a line may hold exactly what the shelf holds, never one more', () => {
  assert.deepEqual(checkCartStock(3, 1), { success: true, availableStock: 3 });
  assert.deepEqual(checkCartStock(3, 3), { success: true, availableStock: 3 });
  assert.deepEqual(checkCartStock(3, 4), { success: false, reason: 'max_reached', availableStock: 3 });
});

test('an empty shelf refuses the first unit, not just the second', () => {
  assert.deepEqual(checkCartStock(0, 1), { success: false, reason: 'out_of_stock', availableStock: 0 });
  assert.deepEqual(checkCartStock(-2, 1), { success: false, reason: 'out_of_stock', availableStock: 0 });
});

test('a count that is missing or not a number is an empty shelf', () => {
  // NaN would fail every `<` comparison and let an unlimited quantity through.
  for (const stock of [undefined, null, '', 'abc', {}, NaN, Infinity]) {
    assert.deepEqual(checkCartStock(stock, 1), { success: false, reason: 'out_of_stock', availableStock: 0 });
  }
});

test('a numeric count stored as text still counts', () => {
  assert.deepEqual(checkCartStock('5', 5), { success: true, availableStock: 5 });
  assert.deepEqual(checkCartStock('5', 6), { success: false, reason: 'max_reached', availableStock: 5 });
});

test('a fractional count is whole units, rounded down', () => {
  assert.deepEqual(checkCartStock(2.9, 2), { success: true, availableStock: 2 });
  assert.deepEqual(checkCartStock(2.9, 3), { success: false, reason: 'max_reached', availableStock: 2 });
});