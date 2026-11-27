import { create } from 'zustand';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';

/**
 * The phone's window onto its own remote print requests.
 *
 * The phone writes a `printQueue` document and the desk drives it through
 * `pending → processing → completed` (or parks it in `pending_retry` and
 * finally `failed`). Until now the phone stopped listening at "command sent",
 * so a sticker that never printed was indistinguishable from one already on
 * the device. Each tracked job keeps one document listener until it reaches a
 * terminal state; the map lives in the store so the status survives leaving
 * the ticket screen and coming back.
 */
export type PrintJobStatus = 'pending' | 'processing' | 'pending_retry' | 'completed' | 'failed';

export interface PrintJob {
  id: string;
  status: PrintJobStatus;
  attempts?: number;
  error?: string;
  lastError?: string;
  retryAt?: string;
}

interface PrintJobState {
  jobs: Record<string, PrintJob>;
  /** The most recent job this ticket asked for. */
  ticketJobs: Record<string, string>;
  trackJob: (id: string, ticketId: string) => void;
}

export const usePrintJobStore = create<PrintJobState>((set, get) => ({
  jobs: {},
  ticketJobs: {},

  trackJob: (id, ticketId) => {
    if (get().jobs[id]) return;
    set((s) => ({
      jobs: { ...s.jobs, [id]: { id, status: 'pending' } },
      ticketJobs: { ...s.ticketJobs, [ticketId]: id },
    }));

    const unsubscribe = onSnapshot(
      doc(db, 'printQueue', id),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const status: PrintJobStatus =
          data.status === 'completed' || data.status === 'failed' || data.status === 'processing' || data.status === 'pending_retry'
            ? data.status
            : 'pending';
        const job: PrintJob = {
          id,
          status,
          attempts: typeof data.attempts === 'number' ? data.attempts : undefined,
          error: typeof data.error === 'string' ? data.error : undefined,
          lastError: typeof data.lastError === 'string' ? data.lastError : undefined,
          retryAt: typeof data.retryAt === 'string' ? data.retryAt : undefined,
        };
        set((s) => ({ jobs: { ...s.jobs, [id]: job } }));
        if (status === 'completed' || status === 'failed') {
          // Terminal: nothing after this can change the truth, so stop paying
          // for a listener that will never speak again.
          unsubscribe();
        }
      },
      (err) => {
        console.warn('[PrintJobStore] tracking failed:', err);
        set((s) => ({
          jobs: { ...s.jobs, [id]: { id, status: 'failed', error: err.message } },
        }));
        unsubscribe();
      }
    );
  },
}));
