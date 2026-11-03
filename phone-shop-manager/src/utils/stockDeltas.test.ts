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
import { foldStockDeltas } from './stockDeltas';

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
