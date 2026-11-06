import type { CartItem } from '../types';
import type { SaleStockLine } from './saleEdit';

/**
 * Whether the goods have already been taken back and the money handed over.
 *
 * The counter closes a sale as `refunded`, the phone as `voided`, and a cancelled one
 * never took the money at all. A second void on any of them puts the same units back on
 * the shelf a second time, so this has to be asked of the status the SERVER holds — the
 * list's own copy is whatever the phone last fetched, and two terminals can both be
 * holding `completed` for an invoice one of them has already closed.
 */
export const isSaleClosed = (status: string | undefined | null): boolean =>
  status === 'voided' || status === 'refunded' || status === 'cancelled';

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
