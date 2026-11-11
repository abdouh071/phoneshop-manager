/**
 * One shelf write per product, however many lines of the invoice named it.
 *
 * Checkout, the B2B counter and a refund each walked their lines and called a stock
 * write per row. A stock write is a transaction that reads the shelf and writes the
 * number back, so two of them on one document in the same breath abort each other —
 * and an exchange invoice holds a sale row and a return row of the same model by
 * design, because that is how `addToCart` and `addReturnItem` fold one SKU. These
 * cases cover the folding the callers used to skip.
 */
import { describe, it, expect } from 'vitest';
import type { CartItem } from '../types';
import { foldStockDeltas, saleStockDeltas } from './stockDeltas';

describe('foldStockDeltas', () => {
  it('passes an ordinary basket through, one movement per product', () => {
    const deltas = foldStockDeltas([
      { productId: 'p1', delta: -2 },
      { productId: 'p9', delta: -1 },
    ]);

    expect(deltas).toEqual([
      { productId: 'p1', delta: -2 },
      { productId: 'p9', delta: -1 },
    ]);
  });

  it('adds a sale row and a return row of one model into a single write', () => {
    const deltas = foldStockDeltas([
      { productId: 'p1', delta: -3 },
      { productId: 'p1', delta: 1 },
    ]);

    // Three sold, one handed back: the shelf is asked for two, once.
    expect(deltas).toEqual([{ productId: 'p1', delta: -2 }]);
  });

  it('writes nothing for a product whose rows cancel each other out', () => {
    const deltas = foldStockDeltas([
      { productId: 'p1', delta: -1 },
      { productId: 'p1', delta: 1 },
      { productId: 'p9', delta: -2 },
    ]);

    expect(deltas).toEqual([{ productId: 'p9', delta: -2 }]);
  });

  it('drops a line the document never gave a product', () => {
    const deltas = foldStockDeltas([{ delta: -2 }, { productId: 'p1', delta: -1 }]);

    expect(deltas).toEqual([{ productId: 'p1', delta: -1 }]);
  });

  it('ignores a row that moves no units', () => {
    const deltas = foldStockDeltas([
      { productId: 'p1', delta: 0 },
      { productId: 'p9', delta: -1 },
    ]);

    expect(deltas).toEqual([{ productId: 'p9', delta: -1 }]);
  });

  it('keeps whole units only, because the shelf has no halves', () => {
    const deltas = foldStockDeltas([
      { productId: 'p1', delta: -2.7 },
      { productId: 'p1', delta: 0.4 },
    ]);

    expect(deltas).toEqual([{ productId: 'p1', delta: -2 }]);
  });
});

/**
 * The signs a whole invoice owes the shelf, derived once for checkout, the offline upload
 * heal and the unfinished-sale sweep. If these disagreed, a crash heal would deduct a
 * different number than the till intended — so the return and dispatch rules are pinned here.
 */
const line = (id: string | undefined, quantity: number, extra: Partial<CartItem> = {}): CartItem =>
  ({ product: id ? { id } : undefined, quantity, ...extra }) as unknown as CartItem;

describe('saleStockDeltas', () => {
  it('takes a retail sale off the shelf, one movement per product', () => {
    expect(saleStockDeltas([line('p1', 2), line('p9', 1)], 'retail')).toEqual([
      { productId: 'p1', delta: -2 },
      { productId: 'p9', delta: -1 },
    ]);
  });

  it('puts a returned unit back on the shelf by default', () => {
    expect(saleStockDeltas([line('p1', 1, { isReturn: true })], 'retail')).toEqual([
      { productId: 'p1', delta: 1 },
    ]);
  });

  it('leaves the shelf alone when the counter kept the returned unit out (restock false)', () => {
    expect(saleStockDeltas([line('p1', 1, { isReturn: true, restock: false })], 'retail')).toEqual([]);
  });

  it('folds an exchange of one model into the net the shelf owes', () => {
    expect(
      saleStockDeltas([line('p1', 3), line('p1', 1, { isReturn: true })], 'retail')
    ).toEqual([{ productId: 'p1', delta: -2 }]);
  });

  it('drops a product whose sale and return cancel out entirely', () => {
    expect(
      saleStockDeltas([line('p1', 1), line('p1', 1, { isReturn: true })], 'retail')
    ).toEqual([]);
  });

  it('treats every parts B2B line as a dispatch out, never a restock', () => {
    expect(saleStockDeltas([line('p1', 4), line('p9', 2)], 'parts_b2b')).toEqual([
      { productId: 'p1', delta: -4 },
      { productId: 'p9', delta: -2 },
    ]);
  });

  it('drops a line the document never gave a product', () => {
    expect(saleStockDeltas([line(undefined, 2), line('p1', 1)], 'retail')).toEqual([
      { productId: 'p1', delta: -1 },
    ]);
  });

  it('moves nothing for an empty invoice', () => {
    expect(saleStockDeltas([], 'retail')).toEqual([]);
  });
});
