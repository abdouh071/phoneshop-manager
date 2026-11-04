import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISCOUNT_APPROVAL_PERCENT,
  discountAmountOf,
  discountPercentOf,
  lineDiscountOf,
  requiresDiscountApproval,
  requiresLineDiscountApproval,
  unitPriceAfterDiscount,
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

test('one line is measured against the price the document carried for it', () => {
  const line = lineDiscountOf(1000, 800, 2);
  assert.equal(line.granted, 400);
  assert.equal(line.percent, 20);
});

test('a raised price is not a discount, and a line with no units has nothing to discount', () => {
  assert.deepEqual(lineDiscountOf(1000, 1100, 1), { granted: 0, percent: 0 });
  assert.deepEqual(lineDiscountOf(1000, 500, 0), { granted: 0, percent: 0 });
  assert.deepEqual(lineDiscountOf(0, 0, 3), { granted: 0, percent: 0 });
});

test('the price a discount writes is the discount the line reads back', () => {
  // The sheet keeps one truth — the unit price — so the field the cashier typed and
  // the number the invoice stores cannot drift apart by the rounding between them.
  assert.equal(unitPriceAfterDiscount(1000, 100, 3), 966.67);
  assert.equal(lineDiscountOf(1000, 966.67, 3).granted, 99.99);
  assert.equal(unitPriceAfterDiscount(4500, 500, 1), 4000);
  assert.equal(lineDiscountOf(4500, 4000, 1).granted, 500);
});

test('a discount deeper than the line floors at nothing rather than a negative price', () => {
  assert.equal(unitPriceAfterDiscount(300, 900, 1), 0);
  assert.equal(unitPriceAfterDiscount(300, 0, 2), 300);
  assert.equal(unitPriceAfterDiscount(300, Number.NaN, 2), 300);
});

test('an agent putting a fifth of one product off a settled invoice needs an admin', () => {
  assert.equal(requiresLineDiscountApproval('sales_agent', 20), true);
  assert.equal(requiresLineDiscountApproval('repair_agent', DISCOUNT_APPROVAL_PERCENT), false);
  assert.equal(requiresLineDiscountApproval('admin', 90), false);
  assert.equal(requiresLineDiscountApproval('sales_agent', Number.NaN), false);
});
