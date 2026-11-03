/**
 * Resolving a scanned code to one row.
 *
 * These lock the bug that made a scan add the neighbour product: two rows answering
 * to the same code, where the old `find` returned whichever came first. A resolution
 * that guesses is a wrong sale, so the tests below insist that a shared code is
 * reported as shared instead of quietly picking a winner — and that a row with a
 * missing sku cannot throw, because an exception in the keystroke listener left the
 * scan buffer full and every scan after it broken.
 */
import { describe, it, expect } from 'vitest';
import {
  describeCodeCandidates,
  findCodeCollisions,
  matchesForCode,
  normalizeCode,
  resolveProductByCode,
} from './productCode';
import type { PhoneModel } from '../types';

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

describe('normalizeCode', () => {
  it('compares codes by case, spaces and nothing else', () => {
    expect(normalizeCode('  KIT-BT-Hoco-128 ')).toBe('kit-bt-hoco-128');
    expect(normalizeCode(undefined)).toBe('');
    expect(normalizeCode(null)).toBe('');
  });
});

describe('resolveProductByCode', () => {
  it('a code that belongs to exactly one row resolves to that row', () => {
    const result = resolveProductByCode([HOCO_128, HOCO_EQ2], 'kit-bt-hoco-128');
    expect(result.kind).toBe('unique');
    if (result.kind === 'unique') expect(result.product.id).toBe('doc-128');
  });

  it('scanning 128 no longer lands on eq2 when eq2 carries 128 in its barcode', () => {
    const polluted = makeProduct({ ...HOCO_EQ2, barcode: 'kit-bt-hoco-128' });
    const result = resolveProductByCode([HOCO_128, polluted], 'KIT-BT-HOCO-128');
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      // Candidates are ordered by the field that answered, barcode first, so the row
      // carrying the stray code is the one an admin is pointed at.
      expect(result.candidates.map(c => c.product.id)).toEqual(['doc-eq2', 'doc-128']);
    }
  });

  it('a barcode, a sku and a document id all answer to their own row', () => {
    const withBarcode = makeProduct({ id: 'doc-a', name: 'Cable', sku: 'KIT-C', barcode: '6291234567890' });
    const rows = [withBarcode, HOCO_128];
    expect(resolveProductByCode(rows, '6291234567890')).toMatchObject({ kind: 'unique', product: withBarcode, field: 'barcode' });
    expect(resolveProductByCode(rows, 'KIT-C')).toMatchObject({ kind: 'unique', product: withBarcode, field: 'sku' });
    expect(resolveProductByCode(rows, 'doc-128')).toMatchObject({ kind: 'unique', product: HOCO_128, field: 'id' });
  });

  it('an unknown or blank code resolves to nothing', () => {
    expect(resolveProductByCode([HOCO_128], 'not-a-code').kind).toBe('none');
    expect(resolveProductByCode([HOCO_128], '   ').kind).toBe('none');
    expect(resolveProductByCode([HOCO_128], undefined).kind).toBe('none');
  });

  it('a row stored without a sku cannot throw at the counter', () => {
    // Legacy imports and half-filled rows carry no sku at all. The old lookup called
    // p.sku.toLowerCase() straight off the row, so one of these broke the scan
    // listener for the rest of the session.
    const blank = makeProduct({ id: 'doc-blank', name: 'Unknown Lot' });
    expect(() => resolveProductByCode([blank, HOCO_128], 'kit-bt-hoco-128')).not.toThrow();
    expect(resolveProductByCode([blank, HOCO_128], 'kit-bt-hoco-128')).toMatchObject({ kind: 'unique', product: HOCO_128 });
  });

  it('one row claiming a code once is listed once', () => {
    const row = makeProduct({ id: 'doc-same', name: 'Same', sku: '6290000000001', barcode: '6290000000001' });
    expect(matchesForCode([row], '6290000000001')).toHaveLength(1);
  });
});

describe('findCodeCollisions', () => {
  it('a sku already saved on another row is refused before it is written', () => {
    const collisions = findCodeCollisions([HOCO_128, HOCO_EQ2], { id: 'doc-new', sku: 'kit-bt-hoco-128' });
    expect(collisions).toEqual(['SKU "kit-bt-hoco-128" is already used by Hoco Speaker (EQ128)']);
  });

  it('a barcode copied onto the wrong row is the collision that breaks a scan', () => {
    const collisions = findCodeCollisions([HOCO_128], { id: 'doc-eq2', sku: 'kit-bt-hoco-eq2', barcode: 'KIT-BT-HOCO-128 ' });
    expect(collisions).toEqual(['barcode "kit-bt-hoco-128" is already used by Hoco Speaker (EQ128)']);
  });

  it('a product keeping its own code is not a collision with itself', () => {
    expect(findCodeCollisions([HOCO_128], { id: 'doc-128', sku: 'kit-bt-hoco-128', barcode: 'kit-bt-hoco-128' })).toEqual([]);
  });

  it('an empty code field is not compared against anything', () => {
    const other = makeProduct({ id: 'doc-empty', name: 'Blank', sku: '' });
    expect(findCodeCollisions([other, HOCO_128], { id: 'doc-new', sku: '', barcode: '' })).toEqual([]);
  });
});

describe('describeCodeCandidates', () => {
  it('names the rows so the cashier knows which two to pick from', () => {
    const polluted = makeProduct({ ...HOCO_EQ2, barcode: 'kit-bt-hoco-128' });
    const result = resolveProductByCode([HOCO_128, polluted], 'kit-bt-hoco-128');
    if (result.kind === 'ambiguous') {
      expect(describeCodeCandidates(result.candidates)).toBe('Hoco Speaker EQ2 / Hoco Speaker EQ128');
    }
  });
});
