/**
 * Claims invoice numbers from the shared daily counter (`counters/invoices_{scope}_{YYMMDD}`).
 *
 * Same shape as the repair ticket counter, and the same rule: a till must not stall
 * behind a locked counter document, so the claim is bounded by a timeout. When the
 * counter cannot be reached the sale still goes through on the clock's guess — the
 * number the shop used before this existed — but it is written flagged, so a sale
 * carrying a guessed reference is visible rather than quietly duplicated.
 */
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { errorMessage } from '../utils/errorUtils';
import {
  clockInvoiceNumber,
  invoiceCounterDocId,
  invoiceDayKey,
  nextInvoiceNumber,
  type InvoiceScope,
} from '../utils/invoiceNumber';

/** A checkout must not wait on Firestore for longer than a customer will wait. */
const COUNTER_TIMEOUT_MS = 4_000;

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('counter transaction timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });

/** The next number in this scope's sequence for the given day. Throws if unreachable. */
export const allocateInvoiceNumber = async (
  scope: InvoiceScope,
  date: Date = new Date()
): Promise<string> => {
  const dayKey = invoiceDayKey(date);
  const ref = doc(db, 'counters', invoiceCounterDocId(scope, dayKey));

  return withTimeout(
    runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const last = snap.exists() ? Number(snap.data()?.lastNumber) || 0 : 0;
      tx.set(ref, { lastNumber: last + 1, scope, day: dayKey, updatedAt: new Date().toISOString() }, { merge: true });
      return nextInvoiceNumber(scope, dayKey, last);
    }),
    COUNTER_TIMEOUT_MS
  );
};

/**
 * The number a sale carries, claimed or guessed. Never throws: a counter the shop
 * cannot reach stops being a reason a customer cannot buy.
 */
export const claimInvoiceNumber = async (
  scope: InvoiceScope,
  date: Date = new Date()
): Promise<{ invoiceNumber: string; provisional: boolean }> => {
  try {
    return { invoiceNumber: await allocateInvoiceNumber(scope, date), provisional: false };
  } catch (err) {
    console.warn('[InvoiceCounter] Could not claim a number, using the clock:', errorMessage(err));
    return { invoiceNumber: clockInvoiceNumber(scope, date.getTime()), provisional: true };
  }
};
