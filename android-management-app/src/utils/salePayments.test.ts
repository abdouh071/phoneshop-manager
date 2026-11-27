import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditAmountOf, salePayments } from './salePayments.ts';
import type { Customer, PaymentMethod } from '../types';

const customer: Customer = {
  id: 'c1',
  name: 'Yacine',
  phone: '0550000000',
  totalPurchases: 0,
  totalSpent: 0,
  lastVisitDate: '2026-11-02T10:00:00.000Z',
  joinDate: '2026-01-01T10:00:00.000Z',
};

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

test('a sale on account puts the whole invoice on the account', () => {
  assert.equal(creditAmountOf('debt', 1000, 0, customer), 1000);
});

test('a partly-paid sale puts only the unpaid remainder on the account', () => {
  assert.equal(creditAmountOf('cash', 1000, 600, customer), 400);
  assert.equal(creditAmountOf('card', 1000, 1000, customer), 0);
});

test('an overpayment never leaves a negative balance on the account', () => {
  assert.equal(creditAmountOf('cash', 1000, 1500, customer), 0);
});

test('a credit sale with no customer attached is refused, not silently untracked', () => {
  assert.throws(() => creditAmountOf('debt', 1000, 0, null), /customer profile is required/);
  assert.throws(() => creditAmountOf('debt', 1000, 0, undefined), /customer profile is required/);
  assert.throws(() => creditAmountOf('cash', 1000, 400, null), /customer profile is required/);
});

test('a walk-in paying in full is still served with no account', () => {
  assert.equal(creditAmountOf('cash', 1000, 1000, null), 0);
  assert.equal(creditAmountOf('card', 1000, 0, null), 0);
  assert.equal(creditAmountOf('cash', 0, 0, null), 0);
});
