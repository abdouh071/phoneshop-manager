/**
 * Offline Queue Service
 * =====================
 * A generic, domain-agnostic offline action queue.
 *
 * When the app is offline, writes are stored as "pending actions" in
 * localStorage. When the app comes back online the queue is replayed
 * in FIFO order and each action is flushed to Firebase.
 *
 * Each domain (repairs, transactions, etc.) registers its own
 * action handlers via `registerHandler(actionType, handlerFn)`.
 *
 * Usage:
 *   offlineQueue.enqueue({ type: 'UPDATE_REPAIR_STATUS', payload: { id, status } });
 *   offlineQueue.registerHandler('UPDATE_REPAIR_STATUS', async (payload) => { ... });
 *   offlineQueue.init(); // call once in App.tsx
 */

import { offlineDeadLetterStore } from './offlineDeadLetterStore';
import { offlineQueueMirror } from './offlineQueueMirror';
import { errorMessage } from '../utils/errorUtils';

const QUEUE_KEY = 'offline_action_queue';

/** Maximum attempts before an action is permanently dropped */
const MAX_RETRY_COUNT = 5;

/**
 * Exponential back-off delay (seconds) for retry slot N:
 *   slot 0 → 2s, slot 1 → 4s, slot 2 → 8s, slot 3 → 16s, slot 4 → 32s (max ≈ 5 min)
 */
function backoffDelayMs(retryCount: number): number {
  return Math.min(Math.pow(2, retryCount + 1) * 1000, 5 * 60 * 1000);
}

/** Free-form JSON bag. The concrete shape is declared by each action's registered handler. */
export type OfflineActionPayload = Record<string, unknown>;

export interface OfflineAction {
  id: string;
  type: string;
  payload: OfflineActionPayload;
  enqueuedAt: string;
  retryCount: number;
  /** ISO timestamp before which this action should NOT be retried (exponential back-off) */
  nextRetryAfter?: string;
}

type ActionHandler = (payload: OfflineActionPayload) => Promise<void>;

const handlers = new Map<string, ActionHandler>();
const syncListeners = new Set<(pending: number) => void>();
let isSyncing = false;

function getQueue(): OfflineAction[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: OfflineAction[]): void {
  const raw = JSON.stringify(queue);
  try {
    localStorage.setItem(QUEUE_KEY, raw);
  } catch (e) {
    console.error('[OfflineQueue] Failed to persist queue:', e);
  }
  // Mirrored even when the line above failed: this is the copy that survives a full
  // localStorage bucket, and it is what the next boot restores the queue from.
  offlineQueueMirror.write(QUEUE_KEY, raw);
}

function notifySyncListeners(): void {
  const count = getQueue().length;
  syncListeners.forEach(fn => {
    try { fn(count); } catch (e) { console.error('[OfflineQueue] Listener error:', e); }
  });
}

// A queue restored from the mirror is a queue whose pending count just changed.
offlineQueueMirror.onRestored(notifySyncListeners);

export const offlineQueue = {
  /**
   * Subscribe to queue size changes
   */
  subscribe(listener: (pending: number) => void): () => void {
    syncListeners.add(listener);
    listener(getQueue().length);
    return () => { syncListeners.delete(listener); };
  },

  /**
   * Get current pending count
   */
  getPendingCount(): number {
    return getQueue().length;
  },

  /**
   * Register a handler for a given action type.
   * The handler receives the action payload and must return a Promise.
   */
  registerHandler<T extends OfflineActionPayload>(type: string, handler: (payload: T) => Promise<void>): void {
    handlers.set(type, handler as ActionHandler);
  },

  /**
   * Enqueue an action for later sync.
   * Supports both:
   *   offlineQueue.enqueue({ type: 'UPDATE_REPAIR_STATUS', payload: { id, status } })
   * and:
   *   offlineQueue.enqueue('UPDATE_REPAIR_STATUS', { id, status })
   *
   * Returns true if processed immediately, false if queued for later sync.
   */
  async enqueue(
    actionOrType: Omit<OfflineAction, 'id' | 'enqueuedAt' | 'retryCount'> | string,
    payloadArg?: OfflineActionPayload,
    options?: { tryImmediate?: boolean }
  ): Promise<boolean> {
    const action: Omit<OfflineAction, 'id' | 'enqueuedAt' | 'retryCount'> =
      typeof actionOrType === 'string'
        ? { type: actionOrType, payload: payloadArg as OfflineActionPayload }
        : actionOrType;

    const fullAction: OfflineAction = {
      ...action,
      id: `offline_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      enqueuedAt: new Date().toISOString(),
      retryCount: 0,
    };

    if (options?.tryImmediate && typeof navigator !== 'undefined' && navigator.onLine) {
      // Try to execute immediately if explicitly requested and online
      const handler = handlers.get(action.type);
      if (handler) {
        try {
          await handler(action.payload);
          return true;
        } catch (err) {
          console.warn(`[OfflineQueue] Immediate handler failed for ${action.type}, queueing:`, err);
        }
      }
    }

    // Queue for later sync
    const queue = getQueue();
    queue.push(fullAction);
    saveQueue(queue);
    notifySyncListeners();
    return false;
  },

  /**
   * Flush all pending actions to Firebase (called when back online).
   * Actions are processed in order; failed ones are re-queued with a retry counter.
   */
  async flush(): Promise<{ success: number; failed: number }> {
    if (isSyncing || !navigator.onLine) return { success: 0, failed: 0 };
    isSyncing = true;

    let success = 0;
    let failed = 0;
    const queue = getQueue();
    const remaining: OfflineAction[] = [];
    const now = Date.now();

    for (const action of queue) {
      // --- Exponential back-off: skip until the retry window has elapsed ---
      if (action.nextRetryAfter && new Date(action.nextRetryAfter).getTime() > now) {
        remaining.push(action); // preserve, will try later
        continue;
      }

      const handler = handlers.get(action.type);
      if (!handler) {
        console.warn(`[OfflineQueue] No handler for action type: ${action.type} — dropping.`);
        offlineDeadLetterStore.record({
          source: 'action_queue',
          type: action.type,
          payload: action.payload,
          reason: 'no_handler',
          attempts: action.retryCount,
          enqueuedAt: action.enqueuedAt,
          detail: `No handler is registered for ${action.type}`,
        });
        failed++;
        continue;
      }

      try {
        await handler(action.payload);
        success++;
      } catch (err) {
        console.error(`[OfflineQueue] Failed to sync action ${action.type} (attempt ${action.retryCount + 1}/${MAX_RETRY_COUNT}):`, err);
        failed++;
        if (action.retryCount < MAX_RETRY_COUNT - 1) {
          const nextRetry = new Date(now + backoffDelayMs(action.retryCount)).toISOString();
          remaining.push({
            ...action,
            retryCount: action.retryCount + 1,
            nextRetryAfter: nextRetry,
          });
        } else {
          console.error(`[OfflineQueue] Action ${action.type} (id=${action.id}) permanently dropped after ${MAX_RETRY_COUNT} attempts.`);
          offlineDeadLetterStore.record({
            source: 'action_queue',
            type: action.type,
            payload: action.payload,
            reason: 'retries_exhausted',
            attempts: MAX_RETRY_COUNT,
            enqueuedAt: action.enqueuedAt,
            detail: errorMessage(err),
          });
        }
      }
    }

    saveQueue(remaining);
    notifySyncListeners();
    isSyncing = false;

    return { success, failed };
  },

  /**
   * Initialize the offline queue: listen for the app:online event
   * and auto-flush the queue when the network recovers.
   */
  init(): () => void {
    const handleOnline = async () => {
      const pending = getQueue().length;
      if (pending === 0) return;

      const result = await offlineQueue.flush();
      if (result.success > 0) {
        // Dynamically import toast to avoid circular deps
        try {
          const { toast } = await import('../components/ui/Toast');
          toast.success('Sync Complete', `${result.success} offline action${result.success > 1 ? 's' : ''} synced successfully.`);
        } catch {
          // toast unavailable
        }
      }
      if (result.failed > 0) {
        try {
          const { toast } = await import('../components/ui/Toast');
          toast.warning('Partial Sync', `${result.failed} action${result.failed > 1 ? 's' : ''} could not be synced and will retry later.`);
        } catch {
          // toast unavailable
        }
      }
    };

    window.addEventListener('app:online', handleOnline);
    // Also try on regular 'online' event
    window.addEventListener('online', handleOnline);

    // Attempt flush on init in case we have a stale queue and are online
    if (navigator.onLine) {
      setTimeout(() => offlineQueue.flush(), 2000);
    }

    return () => {
      window.removeEventListener('app:online', handleOnline);
      window.removeEventListener('online', handleOnline);
    };
  },

  /**
   * Manually clear the queue (for testing / admin reset)
   */
  clear(): void {
    saveQueue([]);
    notifySyncListeners();
  },
};
