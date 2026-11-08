/**
 * A sale as the phone reads it back.
 * ==================================
 * `items` and `payments` are required on `SaleTransaction`, but a document written
 * before the till recorded them — or one left half-written by a killed app — arrives
 * without them. The cast at the read boundary believed the type, so `tx.items.map`
 * threw and React tore down the whole screen: one old receipt blanked the entire
 * history instead of drawing an empty card.
 *
 * This is the counter terminal's rule (`transactionService.docToTx`): default the
 * arrays where the document enters the app, so every surface downstream can keep
 * reading them as arrays. No money is invented — a total the phone guessed would be
 * a figure the shop never charged, so stored numbers ride through untouched.
 */
import type { CartItem, SaleTransaction } from '../types/index.ts';

/** The stored entries of one array field, without the holes a partial write leaves. */
const entriesOf = <T>(value: unknown): T[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is T => Boolean(entry) && typeof entry === 'object')
    : [];

export const docToSale = (id: string, data: Record<string, unknown>): SaleTransaction => ({
  ...(data as Omit<SaleTransaction, 'id' | 'items' | 'payments'>),
  id,
  items: entriesOf<CartItem>(data.items),
  payments: entriesOf<SaleTransaction['payments'][number]>(data.payments),
});