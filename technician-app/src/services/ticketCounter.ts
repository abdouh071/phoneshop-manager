/**
 * The shared sequential ticket counter (`counters/repairs`), identical in shape to
 * the desktop app's so both clients hand out numbers from one sequence.
 */
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { counterValueAfter, nextTicketNumber } from './offlineQueuePolicy';

/** A till must not stall a check-in behind a locked counter document. */
const COUNTER_TIMEOUT_MS = 4_000;

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('counter transaction timed out')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });

/**
 * Claims the next `TKT-####` number. Throws when Firestore is unreachable — the
 * caller must NOT invent a number of its own and let it live forever.
 */
export const allocateTicketNumber = async (): Promise<string> => {
  const ref = doc(db, 'counters', 'repairs');
  return withTimeout(
    runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const last = snap.exists() ? (snap.data()?.lastNumber as number | undefined) : 0;
      tx.set(ref, { lastNumber: counterValueAfter(last) }, { merge: true });
      return nextTicketNumber(last);
    }),
    COUNTER_TIMEOUT_MS
  );
};
