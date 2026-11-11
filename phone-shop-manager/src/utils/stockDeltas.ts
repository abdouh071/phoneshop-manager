/**
 * One shelf movement per product, however many lines of the invoice carried it.
 * ===========================================================================
 * A stock write reads the shelf and writes the number back inside a transaction, so
 * two of them opened on the same document in the same breath abort each other and the
 * loser is filed in the offline queue. That is not a hypothetical here: an exchange
 * puts a sale row and a return row of the same model on one document by design —
 * `addToCart` folds one SKU into a single sale line and `addReturnItem` into a single
 * return line, so the pair is the shape the till itself produces.
 *
 * Nothing here decides what a line owes the shelf; the caller keeps its own signs,
 * because checkout, the B2B counter and a refund each read the same lines differently.
 */
import type { CartItem } from '../types';

export interface StockDeltaEntry {
  productId?: string;
  delta: number;
}

export interface StockDelta {
  productId: string;
  delta: number;
}

const wholeUnits = (value: number): number => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : 0;
};

export const foldStockDeltas = (entries: StockDeltaEntry[]): StockDelta[] => {
  const byProduct = new Map<string, number>();

  for (const entry of entries) {
    const productId = entry?.productId;
    if (!productId) continue;
    const delta = wholeUnits(entry.delta);
    if (!delta) continue;
    byProduct.set(productId, (byProduct.get(productId) || 0) + delta);
  }

  // A product whose movements cancel — two of one model sold, one handed back — is the
  // shelf ending where it started, so it asks for no write at all.
  return [...byProduct]
    .filter(([, delta]) => delta !== 0)
    .map(([productId, delta]) => ({ productId, delta }));
};

/**
 * What a whole invoice owes the shelf, in one place.
 * ===================================================
 * Checkout writes this movement, and the sync pass and the unfinished-sale sweep
 * re-derive it from the stored document when a crash left the shelf unmoved. They
 * must agree to the unit, or the heal would deduct a different number than the till
 * intended — so the signs live here once, not copied into each caller.
 *
 * A retail return goes back on the shelf unless the counter explicitly kept it out
 * (`restock === false`); a parts B2B line is always a dispatch out. Net-zero products
 * are dropped by the fold, exactly as the till's own checkout drops them.
 */
export const saleStockDeltas = (
  items: CartItem[],
  saleType?: 'retail' | 'parts_b2b'
): StockDelta[] =>
  foldStockDeltas(
    (items || []).map(item => ({
      productId: item.product?.id,
      delta:
        saleType === 'parts_b2b'
          ? -item.quantity
          : item.isReturn
            ? item.restock !== false
              ? item.quantity
              : 0
            : -item.quantity,
    }))
  );
