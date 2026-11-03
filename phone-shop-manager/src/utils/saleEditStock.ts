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

const idOf = (item: CartItem | undefined): string | undefined => item?.product?.id;

const labelOf = (item: CartItem): string =>
  item.product?.name || item.product?.model || item.product?.id || 'Item';

/**
 * `shelf` is whatever this till believes it holds. A product it does not list at all
 * is not refused — only a shelf that demonstrably cannot cover the line is, so an
 * imported invoice whose part was later deleted stays correctable.
 */
export const planSaleEditStock = (
  originalItems: CartItem[],
  newItems: CartItem[],
  returnToStockOptions: Record<string, boolean> = {},
  shelf: Pick<PhoneModel, 'id' | 'stock'>[] = []
): SaleEditStockPlan => {
  const deltas: SaleEditStockDelta[] = [];
  const shortages: SaleEditStockShortage[] = [];
  const seen = new Set<string>();

  [...originalItems, ...newItems].forEach(item => {
    const productId = idOf(item);
    if (productId) seen.add(productId);
  });

  seen.forEach(productId => {
    const original = originalItems.find(i => i.product.id === productId);
    const next = newItems.find(i => i.product.id === productId);
    // The line that survives decides the direction; a removal is judged by what was sold.
    const line = next ?? original;
    if (!line) return;

    const moved = (next?.quantity ?? 0) - (original?.quantity ?? 0);
    if (moved === 0) return;

    const isReturn = Boolean(line.isReturn);
    // Goods the customer handed back that were never put on the shelf cannot move it
    // in either direction.
    if (isReturn && line.restock === false) return;

    const delta = isReturn ? moved : -moved;
    if (delta > 0 && returnToStockOptions[productId] === false) return;

    if (delta < 0) {
      const wanted = -delta;
      const level = shelf.find(p => p.id === productId);
      if (level && (Number(level.stock) || 0) < wanted) {
        shortages.push({
          productId,
          name: labelOf(line),
          wanted,
          available: Math.max(0, Number(level.stock) || 0),
        });
        return;
      }
    }

    deltas.push({ productId, name: labelOf(line), delta });
  });

  return { deltas, shortages };
};
