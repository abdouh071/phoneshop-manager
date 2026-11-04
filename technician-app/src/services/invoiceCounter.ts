/**
 * Claims invoice numbers from the shared daily counter (`counters/invoices_retail_{YYMMDD}`).
 *
 * The counter desktop writes the same document, so a sale rung up at the till and one
 * sold on the phone draw from one sequence instead of racing each other with clock
 * numbers. Same shape as the repair ticket counter next to it, and the same rule about
 * a till waiting on Firestore — but bounded here by a flag rather than a retry: the
 * sale must go through, so an unreachable counter leaves the clock's guess on the
 * document, written as guessed so the shop can find those references later.
 */
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { clockInvoiceNumber, invoiceCounterDocId, invoiceDayKey, nextInvoiceNumber } from '../utils/invoiceNumber';

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

/** The next number in the day's retail sequence. Throws if the counter cannot be reached. */
export const allocateInvoiceNumber = async (date: Date = new Date()): Promise<string> => {
  const dayKey = invoiceDayKey(date);
  const ref = doc(db, 'counters', invoiceCounterDocId(dayKey));

  return withTimeout(
    runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const last = snap.exists() ? Number(snap.data()?.lastNumber) || 0 : 0;
      tx.set(ref, {
        lastNumber: last + 1,
        scope: 'retail',
        day: dayKey,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      return nextInvoiceNumber(dayKey, last);
    }),
    COUNTER_TIMEOUT_MS
  );
};

/**
 * The number a sale carries, claimed or guessed. Never throws: a counter the shop
 * cannot reach stops being a reason a customer cannot buy.
 */
export const claimInvoiceNumber = async (
  date: Date = new Date()
): Promise<{ invoiceNumber: string; provisional: boolean }> => {
  try {
    return { invoiceNumber: await allocateInvoiceNumber(date), provisional: false };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn('[InvoiceCounter] Could not claim a number, using the clock:', reason);
    return { invoiceNumber: clockInvoiceNumber(date.getTime()), provisional: true };
  }
};
