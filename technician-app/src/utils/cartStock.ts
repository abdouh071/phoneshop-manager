/**
 * What the shelf allows a basket line to hold.
 *
 * The phone's cart used to take any quantity it was handed. The grid's + button
 * capped, the checkout sheet's + button clamped silently, and the store itself
 * accepted anything — so a scan, a second tap on a row already in the basket, or
 * a quantity typed elsewhere could ring up units the shop does not have. The
 * server's stock transaction clamps at zero, which means the invoice would claim
 * five sold while the shelf only ever held two.
 *
 * This is the desktop cartStore's rule: refuse, and say what is available, so the
 * screen can tell the seller instead of quietly taking a different order.
 */

import { clampStock } from '../services/offlineQueuePolicy.ts';

export type CartStockResult = {
  success: boolean;
  reason?: 'out_of_stock' | 'max_reached';
  availableStock?: number;
};

/**
 * `wanted` is the quantity the line would hold after the change, not the increment.
 * The count is coerced by the same `clampStock` every stock writer uses, so a
 * missing, negative or non-finite count reads as an empty shelf here exactly as it
 * does on the shelf itself.
 */
export const checkCartStock = (stock: unknown, wanted: number): CartStockResult => {
  const available = clampStock(stock);
  if (available <= 0) return { success: false, reason: 'out_of_stock', availableStock: 0 };
  if (available < wanted) return { success: false, reason: 'max_reached', availableStock: available };
  return { success: true, availableStock: available };
};