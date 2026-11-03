/**
 * The stock half of correcting a settled invoice.
 * ==============================================
 * `cartStore.editTransaction` used to walk only the lines the invoice already carried,
 * so a product the counter added at the moment of correction — the second cable the
 * customer asks for — was sold, printed and charged without ever leaving the shelf.
 * The walk is over the union of both sides instead, and the sign is the checkout's own
 * (step 6 there): a sale line gives back what it didn't take, a return line takes back
 * what it never gave.
 *
 * Nothing here writes. The caller runs the deltas it is handed, and a shortage is
 * reported before any of them move — the till clamps stock at zero rather than going
 * negative, so an unchecked oversell would have looked like a whole shelf of nothing.
 */
import type { CartItem, PhoneModel } from '../types';

export interface SaleEditStockDelta {
  productId: string;
  name: string;
  /** Positive puts units on the shelf, negative takes them off. */
  delta: number;
}

export interface SaleEditStockShortage {
  productId: string;
  name: string;
  wanted: number;
  available: number;
}

export interface SaleEditStockPlan {
  deltas: SaleEditStockDelta[];
  shortages: SaleEditStockShortage[];
}

interface StockGroup {
  productId: string;
  name: string;
  isReturn: boolean;
  /** How many rows carry this SKU, and how many of them were written off instead of restocked. */
  rows: number;
  writtenOff: number;
  sold: number;
  now: number;
}

const wholeUnits = (value: number): number => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const idOf = (item: CartItem | undefined): string | undefined => item?.product?.id;

const labelOf = (item: CartItem): string =>
  item.product?.name || item.product?.model || item.product?.id || 'Item';

/**
 * `shelf` is whatever this till believes it holds. A product it does not list at all
 * is not refused — only a shelf that demonstrably cannot cover the line is, so an
 * imported invoice whose part was later deleted stays correctable.
 *
 * Units are totalled per product AND per kind, because the editor gives one SKU one
 * control and applies it to every row that carries it: an exchange invoice can hold a
 * sale row and a return row of the same model, and those two move the shelf in
 * opposite directions. They are then merged back into one number per product, because
 * the two sides of the same document cannot be written twice at once — a stock commit
 * reads the shelf and writes it, and Firestore aborts the loser of two concurrent
 * transactions on one product.
 */
export const planSaleEditStock = (
  originalItems: CartItem[],
  newItems: CartItem[],
  returnToStockOptions: Record<string, boolean> = {},
  shelf: Pick<PhoneModel, 'id' | 'stock'>[] = []
): SaleEditStockPlan => {
  const deltas: SaleEditStockDelta[] = [];
  const shortages: SaleEditStockShortage[] = [];
  const totals = new Map<string, StockGroup>();
  const movements = new Map<string, { name: string; delta: number }>();

  const collect = (items: CartItem[], side: 'sold' | 'now') => {
    items.forEach(item => {
      const productId = idOf(item);
      if (!productId) return;
      const isReturn = Boolean(item.isReturn);
      const key = `${productId}::${isReturn ? 'return' : 'sale'}`;
      let group = totals.get(key);
      if (!group) {
        group = {
          productId,
          name: labelOf(item),
          isReturn,
          rows: 0,
          writtenOff: 0,
          sold: 0,
          now: 0,
        };
        totals.set(key, group);
      }
      group[side] += wholeUnits(item.quantity);
      group.rows += 1;
      if (item.restock === false) group.writtenOff += 1;
    });
  };
  collect(originalItems, 'sold');
  collect(newItems, 'now');

  totals.forEach(group => {
    const moved = group.now - group.sold;
    if (moved === 0) return;

    // Goods the customer handed back that were never put on the shelf cannot move it
    // in either direction.
    if (group.isReturn && group.writtenOff === group.rows) return;

    const delta = group.isReturn ? moved : -moved;
    if (delta > 0 && returnToStockOptions[group.productId] === false) return;

    const current = movements.get(group.productId);
    if (current) current.delta += delta;
    else movements.set(group.productId, { name: group.name, delta });
  });

  movements.forEach(({ name, delta }, productId) => {
    if (delta === 0) return;

    if (delta < 0) {
      const wanted = -delta;
      const level = shelf.find(p => p.id === productId);
      if (level && (Number(level.stock) || 0) < wanted) {
        shortages.push({
          productId,
          name,
          wanted,
          available: Math.max(0, Number(level.stock) || 0),
        });
        return;
      }
    }

    deltas.push({ productId, name, delta });
  });

  return { deltas, shortages };
};
