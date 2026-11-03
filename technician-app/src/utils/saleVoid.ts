import type { CartItem } from '../types';
import type { SaleStockLine } from './saleEdit';

/**
 * Which way each line of a voided invoice moves the shelf.
 *
 * A normal line was taken off the shelf when it sold, so a void puts it back. A return
 * line is the opposite: the customer handed goods over and the shop took them in, so
 * voiding the invoice has to take them out again — unless that line was never restocked
 * in the first place (a faulty unit sent away for repair), in which case there is
 * nothing on the shelf to remove. The counter's refund makes exactly this split in
 * `cartStore.refundTransaction`, and getting the sign wrong here inflates the stock
 * count of a shop that has already handed the money back.
 */
export const voidStockLines = (
  items: CartItem[] | undefined
): { restore: SaleStockLine[]; deduct: SaleStockLine[] } => {
  const line = (item: CartItem): SaleStockLine => ({
    productId: String(item?.product?.id || ''),
    name: String(item?.product?.name || ''),
    quantity: Math.max(1, Math.trunc(Number(item?.quantity) || 1)),
  });

  const list = Array.isArray(items) ? items : [];
  return {
    restore: list.filter(item => !item?.isReturn).map(line),
    deduct: list.filter(item => item?.isReturn && item.restock !== false).map(line),
  };
};
