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

const QUEUE_KEY = 'offline_action_queue';

export interface OfflineAction {
  id: string;
  type: string;
  payload: any;
  enqueuedAt: string;
  retryCount: number;
}

type ActionHandler = (payload: any) => Promise<void>;

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
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error('[OfflineQueue] Failed to persist queue:', e);
  }
}

function notifySyncListeners(): void {
  const count = getQueue().length;
  syncListeners.forEach(fn => {
    try { fn(count); } catch (e) { console.error('[OfflineQueue] Listener error:', e); }
  });
}

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
  registerHandler(type: string, handler: ActionHandler): void {
    handlers.set(type, handler);
  },

  /**
   * Enqueue an action for later sync (or immediate execution if online).
   * Returns true if executed immediately, false if queued for later.
   */
  async enqueue(action: Omit<OfflineAction, 'id' | 'enqueuedAt' | 'retryCount'>): Promise<boolean> {
    const fullAction: OfflineAction = {
      ...action,
      id: `offline_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      enqueuedAt: new Date().toISOString(),
      retryCount: 0,
    };

    if (navigator.onLine) {
      // Try to execute immediately if online
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

    // Queue for later
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

    for (const action of queue) {
      const handler = handlers.get(action.type);
      if (!handler) {
        console.warn(`[OfflineQueue] No handler for action type: ${action.type} — dropping.`);
        failed++;
        continue;
      }

      try {
        await handler(action.payload);
        success++;
      } catch (err) {
        console.error(`[OfflineQueue] Failed to sync action ${action.type}:`, err);
        failed++;
        if (action.retryCount < 5) {
          remaining.push({ ...action, retryCount: action.retryCount + 1 });
        }
        // else drop after 5 retries
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

      console.log(`[OfflineQueue] Back online — flushing ${pending} queued action(s)…`);
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
