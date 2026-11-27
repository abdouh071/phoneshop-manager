import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docToSale } from './saleDocument.ts';

const line = (id: string, quantity: number) => ({
  product: { id, name: 'USB-C Cable', price: 500 },
  quantity,
});

test('a document that lost its lines reads as an empty sale, not a thrown page', () => {
  const sale = docToSale('tx_1', { date: '2026-11-08T10:00:00.000Z', total: 1500 });

  assert.deepEqual(sale.items, []);
  assert.deepEqual(sale.payments, []);
  assert.equal(sale.id, 'tx_1');
  assert.equal(sale.total, 1500);
});

test('the stored lines and tenders ride through untouched', () => {
  const items = [line('prod_1', 2)];
  const payments = [{ method: 'cash', amount: 1000 }];

  const sale = docToSale('tx_2', { items, payments, total: 1000 });

  assert.deepEqual(sale.items, items);
  assert.deepEqual(sale.payments, payments);
});

test('a non-array field is a missing field, not something to iterate', () => {
  const sale = docToSale('tx_3', { items: ' corrupted ', payments: { method: 'cash' } });

  assert.deepEqual(sale.items, []);
  assert.deepEqual(sale.payments, []);
});

test('a hole in the middle of the lines does not take the card down with it', () => {
  const sale = docToSale('tx_4', {
    items: [line('prod_1', 1), null, undefined, line('prod_2', 3)],
    payments: [null, { method: 'debt', amount: 400 }],
  });

  assert.equal(sale.items.length, 2);
  assert.equal(sale.items[1].product.id, 'prod_2');
  assert.deepEqual(sale.payments, [{ method: 'debt', amount: 400 }]);
});

test('the id comes from the document, not from a field a stale write left behind', () => {
  const sale = docToSale('real_id', { id: 'offline_tx_9', total: 10 });

  assert.equal(sale.id, 'real_id');
});

test('a credit line keeps its sign, so a corrected invoice still reads as corrected', () => {
  const sale = docToSale('tx_5', {
    items: [line('prod_1', 2), { ...line('prod_1', 1), isReturn: true, restock: false }],
  });

  assert.equal(sale.items[1].isReturn, true);
  assert.equal(sale.items[1].restock, false);
});

test('no money is invented for a figure the document never stored', () => {
  const sale = docToSale('tx_6', { items: [] });

  assert.equal(sale.total, undefined);
  assert.equal(sale.subtotal, undefined);
});

test('the document read is not mutated', () => {
  const data: Record<string, unknown> = { items: [line('prod_1', 1)], total: 500 };
  const before = JSON.stringify(data);

  docToSale('tx_7', data);

  assert.equal(JSON.stringify(data), before);
});