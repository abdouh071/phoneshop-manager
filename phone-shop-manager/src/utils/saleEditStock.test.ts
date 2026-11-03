/**
 * Which units a corrected invoice moves, and which it may not.
 *
 * The old walk in `cartStore.editTransaction` visited only the lines the invoice already
 * carried, so a cable added at the counter printed, charged and left the shelf untouched.
 * A return line going the other way was restocked as if it were a sale. These cases lock
 * the signs to the checkout's own, and lock the one thing the till cannot see for itself:
 * stock that is not there cannot be sold, no matter what the document says.
 */
import { describe, it, expect } from 'vitest';
import { planSaleEditStock } from './saleEditStock';
import type { CartItem, PhoneModel } from '../types';

const phone = (id: string, over: Partial<PhoneModel> = {}): PhoneModel =>
  ({ id, name: 'Phone', model: id, price: 9000, stock: 4, category: 'phones', ...over }) as PhoneModel;

const cable = (id = 'p9', over: Partial<PhoneModel> = {}): PhoneModel =>
  ({ id, name: 'Cable', model: 'USB-C', price: 100, stock: 6, category: 'accessories', ...over }) as PhoneModel;

const line = (product: PhoneModel, quantity: number, over: Partial<CartItem> = {}): CartItem => ({
  product,
  quantity,
  ...over,
});

const sold = line(phone('p1'), 2);
const shelf = [phone('p1', { stock: 4 }), cable('p9', { stock: 6 })];

describe('planSaleEditStock', () => {
  it('takes a line the invoice never carried off the shelf in full', () => {
    const plan = planSaleEditStock([sold], [sold, line(cable(), 2)], {}, shelf);

    expect(plan.deltas).toEqual([{ productId: 'p9', name: 'Cable', delta: -2 }]);
    expect(plan.shortages).toHaveLength(0);
  });

  it('deducts only the difference when a sold line grows', () => {
    const grown = line(phone('p1'), 3);
    const plan = planSaleEditStock([sold], [grown], {}, shelf);

    expect(plan.deltas).toEqual([{ productId: 'p1', name: 'Phone', delta: -1 }]);
  });

  it('puts the units back when a sold line shrinks', () => {
    const plan = planSaleEditStock([sold], [line(phone('p1'), 1)], {}, shelf);

    expect(plan.deltas).toEqual([{ productId: 'p1', name: 'Phone', delta: 1 }]);
  });

  it('restocks a removed line in full', () => {
    const plan = planSaleEditStock([sold], [], {}, shelf);

    expect(plan.deltas).toEqual([{ productId: 'p1', name: 'Phone', delta: 2 }]);
  });

  it('leaves the shelf alone when the cashier says do not restock', () => {
    const plan = planSaleEditStock([sold], [], { p1: false }, shelf);

    expect(plan.deltas).toHaveLength(0);
  });

  it('takes back what a shortened return line never gave', () => {
    const returned = line(phone('p1'), 2, { isReturn: true, restock: true });
    const plan = planSaleEditStock([returned], [line(phone('p1'), 1, { isReturn: true, restock: true })], {}, shelf);

    expect(plan.deltas).toEqual([{ productId: 'p1', name: 'Phone', delta: -1 }]);
  });

  it('gives stock for a return line that grew', () => {
    const returned = line(phone('p1'), 1, { isReturn: true, restock: true });
    const plan = planSaleEditStock([returned], [line(phone('p1'), 2, { isReturn: true, restock: true })], {}, shelf);

    expect(plan.deltas).toEqual([{ productId: 'p1', name: 'Phone', delta: 1 }]);
  });

  it('never moves the shelf for a return that was written off', () => {
    const notRestocked = line(phone('p1'), 2, { isReturn: true, restock: false });
    const plan = planSaleEditStock([notRestocked], [line(phone('p1'), 1, { isReturn: true, restock: false })], {}, shelf);

    expect(plan.deltas).toHaveLength(0);
    expect(plan.shortages).toHaveLength(0);
  });

  it('reports a line the shelf cannot give and plans no delta for it', () => {
    const thinShelf = [phone('p1', { stock: 4 }), cable('p9', { stock: 1 })];
    const plan = planSaleEditStock([sold], [sold, line(cable(), 3)], {}, thinShelf);

    expect(plan.deltas).toHaveLength(0);
    expect(plan.shortages).toEqual([
      { productId: 'p9', name: 'Cable', wanted: 3, available: 1 },
    ]);
  });

  it('refuses the oversold line without stopping the line that came back', () => {
    // The phone that came off the invoice puts a unit on the shelf; that unit is a
    // phone's, not a cable's, so the cable is still refused by its own shelf.
    const thinShelf = [phone('p1', { stock: 4 }), cable('p9', { stock: 2 })];
    const plan = planSaleEditStock([sold], [line(phone('p1'), 1), line(cable(), 3)], {}, thinShelf);

    expect(plan.deltas).toEqual([{ productId: 'p1', name: 'Phone', delta: 1 }]);
    expect(plan.shortages).toEqual([
      { productId: 'p9', name: 'Cable', wanted: 3, available: 2 },
    ]);
  });

  it('does not refuse a product this till no longer lists', () => {
    const ghost = line(phone('gone', { name: 'Old Stock' }), 5);
    const more = line(phone('gone', { name: 'Old Stock' }), 8);
    const plan = planSaleEditStock([ghost], [more], {}, shelf);

    expect(plan.shortages).toHaveLength(0);
    expect(plan.deltas).toEqual([{ productId: 'gone', name: 'Old Stock', delta: -3 }]);
  });

  it('totals two rows of one SKU, because one control sets them both', () => {
    const twin = phone('p1');
    const plan = planSaleEditStock([line(twin, 1), line(twin, 4)], [line(twin, 2), line(twin, 2)], {}, shelf);

    // Five units were sold and four now stand on the document: one comes back, and
    // nothing is taken off again for the row that appeared to grow.
    expect(plan.deltas).toEqual([{ productId: 'p1', name: 'Phone', delta: 1 }]);
    expect(plan.shortages).toHaveLength(0);
  });

  it('keeps a sale row and a return row of one model as two movements', () => {
    const twin = phone('p1');
    const plan = planSaleEditStock(
      [line(twin, 3), line(twin, 1, { isReturn: true, restock: true })],
      [line(twin, 2), line(twin, 2, { isReturn: true, restock: true })],
      {},
      shelf
    );

    // The sale row hands a unit back and the return row takes one more in. Both go on
    // the shelf, and neither cancels the other out.
    expect(plan.deltas).toEqual([
      { productId: 'p1', name: 'Phone', delta: 1 },
      { productId: 'p1', name: 'Phone', delta: 1 },
    ]);
  });

  it('plans nothing when no line moved', () => {
    const plan = planSaleEditStock([sold], [line(phone('p1'), 2)], {}, shelf);

    expect(plan.deltas).toHaveLength(0);
    expect(plan.shortages).toHaveLength(0);
  });

  it('plans nothing for an untouched invoice with an added zero-quantity line', () => {
    const plan = planSaleEditStock([sold], [sold, line(cable(), 0)], {}, shelf);

    expect(plan.deltas).toHaveLength(0);
    expect(plan.shortages).toHaveLength(0);
  });
});
