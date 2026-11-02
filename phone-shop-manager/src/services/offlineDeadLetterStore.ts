/**
 * Dead-letter log for abandoned offline writes.
 * =============================================
 * Three situations remove data from a sync queue without it ever reaching Firestore: an
 * action that runs out of retries, an action whose type has no registered handler, and a
 * stock adjustment whose document was deleted. Before this log each of those left nothing
 * behind but a console line, so a dropped sale simply never appeared in the books and
 * nobody could tell when.
 *
 * A queue that could not be *persisted* is a different failure and belongs to
 * `offlineQueueMirror`, which keeps a durable second copy and reports its own health.
 *
 * Only abandonment is recorded. Items that stay queued are already counted by
 * getTotalPendingCount() and would flood this log if every retried failure were written here.
 */
import { errorMessage } from '../utils/errorUtils';
import { offlineQueueMirror } from './offlineQueueMirror';
import type { PendingStockAdjustment } from './inventoryService';

const DEAD_LETTER_KEY = 'offline_dead_letters';

/** Newest entries are kept; older ones are counted in evictedTotal instead of vanishing. */
const MAX_KEPT = 200;

export type DeadLetterSource = 'action_queue' | 'stock_adjustment';

export type DeadLetterReason = 'retries_exhausted' | 'no_handler' | 'document_missing';

export interface DeadLetter {
  id: string;
  source: DeadLetterSource;
  /** Action type for the queue, collection name for a record. */
  type: string;
  detail?: string;
  droppedAt: string;
  /** The abandoned queue entry itself, kept whole so retry can put it back. */
  payload: Record<string, unknown>;
  attempts: number;
  enqueuedAt?: string;
  reason: DeadLetterReason;
}

interface DeadLetterLog {
  dropped: DeadLetter[];
  evictedTotal: number;
}

export interface DeadLetterInput {
  source: DeadLetterSource;
  type: string;
  payload: Record<string, unknown>;
  reason: DeadLetterReason;
  attempts: number;
  detail?: string;
  enqueuedAt?: string;
}

type CountListener = (count: number) => void;

const listeners = new Set<CountListener>();

function readLog(): DeadLetterLog {
  try {
    const raw = localStorage.getItem(DEAD_LETTER_KEY);
    if (!raw) return { dropped: [], evictedTotal: 0 };
    const parsed = JSON.parse(raw) as Partial<DeadLetterLog>;
    return {
      dropped: Array.isArray(parsed.dropped) ? parsed.dropped : [],
      evictedTotal: typeof parsed.evictedTotal === 'number' ? parsed.evictedTotal : 0,
    };
  } catch {
    return { dropped: [], evictedTotal: 0 };
  }
}

function writeLog(log: DeadLetterLog): boolean {
  const raw = JSON.stringify(log);
  let ok = true;
  try {
    localStorage.setItem(DEAD_LETTER_KEY, raw);
  } catch (e) {
    console.error('[DeadLetter] Failed to persist the dead-letter log:', e);
    ok = false;
  }
  // Mirrored either way: a log that could not be written to localStorage is precisely the
  // record that must survive, and the mirror is what the next boot reads it back from.
  offlineQueueMirror.write(DEAD_LETTER_KEY, raw);
  return ok;
}

function notifyListeners(): void {
  const count = offlineDeadLetterStore.count();
  listeners.forEach(fn => {
    try {
      fn(count);
    } catch (e) {
      console.error('[DeadLetter] Listener error:', e);
    }
  });
}

// A log restored from the mirror is a log whose badge count just changed.
offlineQueueMirror.onRestored(notifyListeners);

export const offlineDeadLetterStore = {
  list(): DeadLetter[] {
    return readLog().dropped;
  },

  count(): number {
    return readLog().dropped.length;
  },

  /** Entries trimmed by MAX_KEPT — reported so a full log is not mistaken for a short one. */
  evictedTotal(): number {
    return readLog().evictedTotal;
  },

  /**
   * Records an abandoned entry. Returns null when the log could not be written, and never
   * throws: losing the dead-letter write must not take down the sync loop that is already
   * handling a failure.
   */
  record(input: DeadLetterInput): DeadLetter | null {
    const letter: DeadLetter = {
      id: `dl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      droppedAt: new Date().toISOString(),
      ...input,
    };
    const log = readLog();
    const dropped = [letter, ...log.dropped];
    const overflow = Math.max(0, dropped.length - MAX_KEPT);

    if (!writeLog({ dropped: dropped.slice(0, MAX_KEPT), evictedTotal: log.evictedTotal + overflow })) {
      return null;
    }
    notifyListeners();
    return letter;
  },

  /**
   * Puts an abandoned entry back into the queue it came from.
   *
   * The entry leaves the log before it is re-queued, because a letter that stays in the log
   * can be retried a second time — and a duplicated ADJUST_STOCK action deducts stock twice.
   * If the re-queue then fails, the entry is recorded again.
   */
  retry: async (id: string): Promise<boolean> => {
    const log = readLog();
    const letter = log.dropped.find(l => l.id === id);
    if (!letter) return false;
    if (!writeLog({ dropped: log.dropped.filter(l => l.id !== id), evictedTotal: log.evictedTotal })) {
      return false;
    }
    notifyListeners();

    try {
      if (letter.source === 'action_queue') {
        const { offlineQueue } = await import('./offlineQueue');
        await offlineQueue.enqueue({ type: letter.type, payload: letter.payload });
      } else {
        const { inventoryService } = await import('./inventoryService');
        const adjustment = letter.payload as unknown as PendingStockAdjustment;
        const pending = inventoryService.getPendingStockAdjustments();
        if (!pending.some(a => a.id === adjustment.id)) {
          inventoryService.savePendingStockAdjustments([...pending, adjustment]);
        }
      }
      return true;
    } catch (e) {
      console.error(`[DeadLetter] Failed to re-queue ${letter.type}:`, e);
      offlineDeadLetterStore.record({
        source: letter.source,
        type: letter.type,
        payload: letter.payload,
        reason: letter.reason,
        attempts: letter.attempts,
        enqueuedAt: letter.enqueuedAt,
        detail: errorMessage(e),
      });
      return false;
    }
  },

  async retryAll(): Promise<number> {
    let requeued = 0;
    for (const letter of offlineDeadLetterStore.list()) {
      if (await offlineDeadLetterStore.retry(letter.id)) requeued++;
    }
    return requeued;
  },

  dismiss(id: string): void {
    const log = readLog();
    if (!writeLog({ dropped: log.dropped.filter(l => l.id !== id), evictedTotal: log.evictedTotal })) return;
    notifyListeners();
  },

  clear(): void {
    localStorage.removeItem(DEAD_LETTER_KEY);
    // Without this the next boot would restore a log an admin deliberately cleared.
    offlineQueueMirror.clear(DEAD_LETTER_KEY);
    notifyListeners();
  },

  subscribe(listener: CountListener): () => void {
    listeners.add(listener);
    listener(offlineDeadLetterStore.count());
    return () => { listeners.delete(listener); };
  },
};
