import { useEffect } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDocs,
  runTransaction,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { printRepairLabelDirect } from '../utils/printWindow';
import { useSettingsStore } from '../store/settingsStore';
import { useToast } from '../components/ui/Toast';

/**
 * How a remote sticker request survives a printer that is not ready.
 *
 * The phone only ever hears "command sent", so the desk is where the truth is
 * kept. A failed attempt is parked as `pending_retry` with a retry time and
 * re-attempted by a local timer with growing delays; each job is claimed inside
 * a Firestore transaction first, so of two open windows only one ever prints
 * it. Jobs a crash left stranded in `processing` are revived after a grace
 * period on the next subscribe. After the last attempt the job is honestly
 * `failed` with its reason — and the counter saw every attempt along the way.
 */
const MAX_ATTEMPTS = 6;
const PROCESSING_GRACE_MS = 2 * 60_000;

const retryDelayMs = (attempts: number): number =>
  Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 16 * 60_000);

export function usePrintQueue() {
  const storeName = useSettingsStore(state => state.storeName);
  const toast = useToast();

  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const clearTimer = (id: string) => {
      const timer = timers.get(id);
      if (timer) {
        clearTimeout(timer);
        timers.delete(id);
      }
    };

    const scheduleRetry = (requestId: string, retryAt: string) => {
      const delay = Math.max(0, new Date(retryAt).getTime() - Date.now());
      clearTimer(requestId);
      const timer = setTimeout(() => {
        void attemptPrint(requestId);
      }, delay);
      timers.set(requestId, timer);
    };

    const attemptPrint = async (requestId: string) => {
      const jobRef = doc(db, 'printQueue', requestId);
      try {
        // Claim inside a transaction: the doc is re-read for its current
        // status, attempts and retry time, and only one window in the shop can
        // move it to `processing` — the old mark-then-print sequence let two
        // open desktops print the same sticker.
        const claimed = await runTransaction(db, async (tx) => {
          const snap = await tx.get(jobRef);
          const data = snap.data();
          const status = data?.status;
          if (status !== 'pending' && status !== 'pending_retry') return null;
          const retryAt = data?.retryAt;
          if (retryAt && new Date(String(retryAt)).getTime() > Date.now()) return null;
          tx.update(jobRef, { status: 'processing', processingAt: new Date().toISOString() });
          return data;
        });
        if (!claimed) return; // another window took it, or it is not due yet

        const attempts = (Number(claimed.attempts) || 0) + 1;
        if (attempts === 1) {
          toast.info('Remote Print Job Received', `Printing sticker for ticket #${claimed.ticket?.ticketNumber}...`);
        }

        const result = await printRepairLabelDirect(claimed.ticket, storeName || 'PhoneShop Pro', 1);

        if (result.method === 'direct' && !result.error) {
          await updateDoc(jobRef, { status: 'completed' });
          toast.success('Remote Print Complete', 'Sticker sent to printer.');
          return;
        }

        const reason = result.error ?? 'Print server unreachable — no sticker was printed.';
        if (attempts >= MAX_ATTEMPTS) {
          await updateDoc(jobRef, { status: 'failed', error: reason, attempts });
          toast.error('Remote Print Failed', `${reason} Gave up after ${attempts} attempts.`);
          return;
        }

        const retryAt = new Date(Date.now() + retryDelayMs(attempts)).toISOString();
        await updateDoc(jobRef, { status: 'pending_retry', attempts, retryAt, lastError: reason });
        toast.warning(
          'Remote Print Failed — Will Retry',
          `${reason} Attempt ${attempts}/${MAX_ATTEMPTS} failed; next try in about ${Math.round(retryDelayMs(attempts) / 1000)}s.`
        );
        scheduleRetry(requestId, retryAt);
      } catch (err) {
        console.error('[PrintQueue] Remote print attempt failed', err);
        try {
          await updateDoc(jobRef, { status: 'failed', error: err?.toString() });
        } catch {
          // The job row itself is gone; there is nothing left to mark.
        }
        toast.error('Remote Print Failed', 'Failed to print the remote request.');
      }
    };

    // Live stream of everything this window may claim. `status in [...]` is a
    // single-field query, so no composite index is needed.
    const q = query(
      collection(db, 'printQueue'),
      where('status', 'in', ['pending', 'pending_retry'])
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'removed') {
          clearTimer(change.doc.id);
          return;
        }
        if (change.type !== 'added') return;
        const data = change.doc.data();
        if (data.type !== 'repair_label' || !data.ticket) return;
        const retryAt = data.retryAt;
        if (retryAt && new Date(String(retryAt)).getTime() > Date.now()) {
          // Parked by an earlier failure: let its timer wake it, not this event.
          scheduleRetry(change.doc.id, String(retryAt));
          return;
        }
        void attemptPrint(change.doc.id);
      });
    }, (err) => {
      console.warn('[PrintQueue] subscription error:', err);
    });

    // Revive jobs a crash left mid-flight. A `processing` row older than the
    // grace period cannot still be printing — a sticker takes seconds — so it
    // goes back to the queue, and the claim above makes sure only one window
    // takes it. Rows without a timestamp are from before this fix and have
    // been stuck long enough by definition.
    void getDocs(query(collection(db, 'printQueue'), where('status', '==', 'processing')))
      .then((snap) => {
        const oldest = Date.now() - PROCESSING_GRACE_MS;
        snap.docs.forEach((d) => {
          const processingAt = d.data().processingAt;
          const ts = processingAt ? new Date(String(processingAt)).getTime() : 0;
          if (!ts || ts <= oldest) {
            void updateDoc(d.ref, { status: 'pending_retry', retryAt: new Date().toISOString() }).catch(() => {});
          }
        });
      })
      .catch(() => {});

    return () => {
      unsubscribe();
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, [storeName, toast]);
}