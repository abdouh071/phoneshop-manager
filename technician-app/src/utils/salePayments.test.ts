import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salePayments } from './salePayments.ts';
import type { PaymentMethod } from '../types';

test('money in the drawer is one line for the tender that handed it over', () => {
  assert.deepEqual(salePayments('cash', 1000, 0), [{ method: 'cash', amount: 1000 }]);
  assert.deepEqual(salePayments('card', 450, 0), [{ method: 'card', amount: 450 }]);
});

test('a phone on account is a debt the day must report, not a zero', () => {
  assert.deepEqual(salePayments('debt', 1000, 1000), [{ method: 'debt', amount: 1000 }]);
});

test('a partly-paid invoice shows both what came in and what is still owed', () => {
  assert.deepEqual(salePayments('cash', 1000, 400), [
    { method: 'cash', amount: 600 },
    { method: 'debt', amount: 400 },
  ]);
});

test('the lines always add up to the invoice, so the drawer closes', () => {
  const cases: [PaymentMethod, number, number][] = [
    ['cash', 1000, 0],
    ['debt', 1000, 1000],
    ['card', 1000, 333],
    ['mobile', 0.3, 0.1],
    ['transfer', 999.99, 0.01],
  ];
  for (const [method, total, debtAmount] of cases) {
    const sum = salePayments(method, total, debtAmount).reduce((s, p) => s + p.amount, 0);
    assert.equal(Math.round(sum * 100) / 100, total, `${method} ${total}/${debtAmount}`);
  }
});

test('an account that swallowed the invoice leaves no empty cash line behind', () => {
  assert.equal(salePayments('cash', 500, 500).length, 1);
  assert.equal(salePayments('cash', 500, 500)[0].method, 'debt');
});

test('an over-charged balance is capped at the invoice, never negative', () => {
  assert.deepEqual(salePayments('cash', 500, 900), [{ method: 'debt', amount: 500 }]);
  assert.equal(salePayments('cash', 500, -20)[0].amount, 500);
});

test('a free line still records how it was paid', () => {
  assert.deepEqual(salePayments('card', 0, 0), [{ method: 'card', amount: 0 }]);
});
