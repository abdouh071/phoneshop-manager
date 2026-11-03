import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISCOUNT_APPROVAL_PERCENT,
  discountAmountOf,
  discountPercentOf,
  requiresDiscountApproval,
} from './discountPolicy.ts';

test('a percentage is taken off the basket and rounded once, for the screen and the ledger alike', () => {
  assert.equal(discountAmountOf(1000, { mode: 'percent', value: 10 }), 100);
  assert.equal(discountAmountOf(999, { mode: 'percent', value: 15 }), 150);
  assert.equal(discountAmountOf(999, { mode: 'percent', value: 10 }), 100);
});

test('a percentage never exceeds the basket, however it is typed', () => {
  assert.equal(discountAmountOf(200, { mode: 'percent', value: 500 }), 200);
  assert.equal(discountAmountOf(200, { mode: 'flat', value: 5000 }), 200);
});

test('a flat amount is reported as the percentage it really grants', () => {
  assert.equal(discountPercentOf(1000, { mode: 'flat', value: 300 }), 30);
  assert.equal(discountPercentOf(2000, { mode: 'flat', value: 100 }), 5);
  assert.equal(discountPercentOf(1000, { mode: 'percent', value: 12 }), 12);
});

test('exactly 15% stays under the rule even when rounding lifts it past the line', () => {
  // 15% of 999 rounds to 150, which is 15.015% of 999. The threshold judges the
  // discount the technician asked for, not the rounding artifact.
  assert.equal(discountPercentOf(999, { mode: 'percent', value: DISCOUNT_APPROVAL_PERCENT }), 15);
  assert.equal(requiresDiscountApproval('sales_agent', 999, { mode: 'percent', value: 15 }), false);
  assert.equal(requiresDiscountApproval('sales_agent', 999, { mode: 'percent', value: 15.1 }), true);
});

test('an agent needs an admin above 15%, whatever mode they typed it in', () => {
  assert.equal(requiresDiscountApproval('sales_agent', 1000, { mode: 'percent', value: 20 }), true);
  assert.equal(requiresDiscountApproval('repair_agent', 1000, { mode: 'flat', value: 200 }), true);
  assert.equal(requiresDiscountApproval('sales_agent', 1000, { mode: 'flat', value: 100 }), false);
  assert.equal(requiresDiscountApproval('admin', 1000, { mode: 'percent', value: 90 }), false);
});

test('no discount is nobody business', () => {
  for (const role of ['sales_agent', 'repair_agent', 'admin'] as const) {
    assert.equal(requiresDiscountApproval(role, 1000, { mode: 'percent', value: 0 }), false);
    assert.equal(requiresDiscountApproval(role, 1000, { mode: 'flat', value: 0 }), false);
    assert.equal(requiresDiscountApproval(role, 0, { mode: 'flat', value: 500 }), false);
  }
});

test('junk input reads as no discount instead of a NaN the cart would print', () => {
  const junk = [Number.NaN, Number.POSITIVE_INFINITY, -50];
  for (const value of junk) {
    assert.equal(discountAmountOf(1000, { mode: 'percent', value }), 0);
    assert.equal(discountAmountOf(1000, { mode: 'flat', value }), 0);
    assert.equal(discountPercentOf(1000, { mode: 'flat', value }), 0);
    assert.equal(requiresDiscountApproval('sales_agent', 1000, { mode: 'flat', value }), false);
  }
});
