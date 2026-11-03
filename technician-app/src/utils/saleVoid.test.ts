import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CartItem, PhoneModel } from '../types/index.ts';
import { voidStockLines } from './saleVoid.ts';

const product = (over: Partial<PhoneModel> = {}): PhoneModel => ({
  id: over.id ?? 'p1',
  name: over.name ?? 'Hoco EQ2',
  model: over.model ?? 'BT-EQ2',
  price: over.price ?? 4500,
  costPrice: over.costPrice ?? 3000,
  stock: over.stock ?? 7,
  stockStatus: over.stockStatus ?? 'in_stock',
  sku: over.sku ?? 'kit-bt-hoco-eq2',
  category: over.category ?? 'accessory',
  lowStockThreshold: over.lowStockThreshold ?? 2,
});

const line = (over: Partial<CartItem> = {}): CartItem => ({
  product: over.product ?? product(),
  quantity: over.quantity ?? 2,
  unitPrice: over.unitPrice,
  isReturn: over.isReturn,
  restock: over.restock,
});

test('a voided sale puts every sold unit back on the shelf', () => {
  const { restore, deduct } = voidStockLines([
    line(),
    line({ product: product({ id: 'p2', name: 'Cable' }), quantity: 3 }),
  ]);
  assert.deepEqual(restore, [
    { productId: 'p1', name: 'Hoco EQ2', quantity: 2 },
    { productId: 'p2', name: 'Cable', quantity: 3 },
  ]);
  assert.deepEqual(deduct, []);
});

test('a returned line was taken in, so voiding the invoice takes it out', () => {
  const { restore, deduct } = voidStockLines([
    line({ quantity: 1 }),
    line({ product: product({ id: 'p9', name: 'Cracked screen' }), quantity: 2, isReturn: true }),
  ]);
  assert.deepEqual(restore, [{ productId: 'p1', name: 'Hoco EQ2', quantity: 1 }]);
  assert.deepEqual(deduct, [{ productId: 'p9', name: 'Cracked screen', quantity: 2 }]);
});

test('a return that never reached the shelf is not taken off it again', () => {
  const { restore, deduct } = voidStockLines([
    line({ isReturn: true, restock: false, quantity: 4 }),
  ]);
  assert.deepEqual(restore, []);
  assert.deepEqual(deduct, []);
});

test('a quantity the document lost still moves one unit, and nothing moves twice', () => {
  const { restore } = voidStockLines([
    line({ quantity: 0 }),
    line({ quantity: 2.7 }),
    line({ quantity: -5 }),
  ]);
  assert.deepEqual(restore.map(l => l.quantity), [1, 2, 1]);
});

test('an invoice with no lines, or a document missing them, moves no shelf', () => {
  assert.deepEqual(voidStockLines([]), { restore: [], deduct: [] });
  assert.deepEqual(voidStockLines(undefined), { restore: [], deduct: [] });
});
