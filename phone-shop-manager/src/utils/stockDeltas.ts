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
