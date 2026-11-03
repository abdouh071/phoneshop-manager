import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCodeCollisions, normalizeCode, resolveProductByCode, matchesForCode } from './productCode.ts';
import type { PhoneModel } from '../types/index.ts';

const makeProduct = (overrides: Partial<PhoneModel> & { id: string }): PhoneModel => ({
  name: 'Product',
  model: '',
  price: 100,
  costPrice: 50,
  stock: 5,
  stockStatus: 'in_stock',
  sku: '',
  category: 'accessory',
  lowStockThreshold: 2,
  ...overrides,
});

const HOCO_128 = makeProduct({ id: 'doc-128', name: 'Hoco Speaker', model: 'EQ128', sku: 'kit-bt-hoco-128' });
const HOCO_EQ2 = makeProduct({ id: 'doc-eq2', name: 'Hoco Speaker', model: 'EQ2', sku: 'kit-bt-hoco-eq2' });

test('a code that belongs to exactly one row resolves to that row', () => {
  const result = resolveProductByCode([HOCO_128, HOCO_EQ2], 'kit-bt-hoco-128');
  assert.equal(result.kind, 'unique');
  if (result.kind === 'unique') assert.equal(result.product.id, 'doc-128');
});

test('scanning 128 no longer lands on eq2 when eq2 carries 128 in its barcode', () => {
  // The reported bug: eq2 was saved with 128's code in its barcode field, and the old
  // single find() returned whichever row came first in Firestore order.
  const pollutedEq2 = makeProduct({ ...HOCO_EQ2, barcode: 'kit-bt-hoco-128' });
  const result = resolveProductByCode([pollutedEq2, HOCO_128], 'kit-bt-hoco-128');
  assert.equal(result.kind, 'ambiguous');
  if (result.kind === 'ambiguous') {
    assert.deepEqual(result.candidates.map((c) => c.product.id).sort(), ['doc-128', 'doc-eq2']);
  }
});

test('a barcode hit is offered before a sku hit when the technician has to choose', () => {
  const pollutedEq2 = makeProduct({ ...HOCO_EQ2, barcode: 'kit-bt-hoco-128' });
  const withSkuOn128 = makeProduct({ ...HOCO_128, barcode: 'EAN-9999' });
  const result = resolveProductByCode([withSkuOn128, pollutedEq2], 'kit-bt-hoco-128');
  assert.equal(result.kind, 'ambiguous');
  if (result.kind === 'ambiguous') assert.deepEqual(result.candidates.map((c) => c.field), ['barcode', 'sku']);
});

test('case, padding and a barcode defaulted to the sku do not create fake ambiguity', () => {
  const row = makeProduct({ id: 'doc-a', name: 'Cable', sku: 'KIT-BT-HOCO-128 ', barcode: 'kit-bt-hoco-128' });
  const result = resolveProductByCode([row, HOCO_EQ2], '  Kit-BT-Hoco-128');
  assert.equal(result.kind, 'unique');
  if (result.kind === 'unique') assert.equal(result.product.id, 'doc-a');
});

test('the doc id is a last resort when nothing else claims the code', () => {
  const result = resolveProductByCode([HOCO_128, HOCO_EQ2], 'doc-eq2');
  assert.equal(result.kind, 'unique');
  if (result.kind === 'unique') assert.equal(result.field, 'id');
});

test('a blank or missing code matches nothing instead of returning the first row', () => {
  for (const code of ['', '   ', undefined, null]) {
    assert.deepEqual(resolveProductByCode([HOCO_128], code), { kind: 'none' });
    assert.deepEqual(matchesForCode([HOCO_128], code), []);
  }
});

test('a code that belongs to no row is reported as none', () => {
  assert.deepEqual(resolveProductByCode([HOCO_128], 'kit-bt-hoco-999'), { kind: 'none' });
});

test('normalizeCode trims, lowercases and survives non-strings', () => {
  assert.equal(normalizeCode('  Kit-BT-Hoco-128  '), 'kit-bt-hoco-128');
  assert.equal(normalizeCode(undefined), '');
  assert.equal(normalizeCode(null), '');
  assert.equal(normalizeCode(12345), '12345');
});

test('a duplicate sku or barcode is caught before the row is saved', () => {
  const collisions = findCodeCollisions([HOCO_128, HOCO_EQ2], {
    id: 'brand-new-doc',
    sku: 'kit-bt-hoco-eq2',
    barcode: 'KIT-BT-HOCO-128',
  });
  assert.equal(collisions.length, 2);
  assert.ok(collisions.some((c) => c.startsWith('SKU ')));
  assert.ok(collisions.some((c) => c.startsWith('barcode ')));
});

test('a row keeping its own codes is not a collision with itself', () => {
  const withBarcode = makeProduct({ ...HOCO_128, barcode: 'kit-bt-hoco-128' });
  assert.deepEqual(findCodeCollisions([withBarcode], { id: withBarcode.id, sku: withBarcode.sku, barcode: withBarcode.barcode }), []);
});

test('an empty barcode field is not compared against anything', () => {
  const other = makeProduct({ id: 'doc-empty', name: 'Blank', sku: '' });
  assert.deepEqual(findCodeCollisions([other, HOCO_128], { id: 'doc-new', sku: '', barcode: '' }), []);
});
