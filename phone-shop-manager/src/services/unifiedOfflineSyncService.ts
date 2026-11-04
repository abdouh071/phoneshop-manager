/**
 * Unified Offline Sync Service
 * =============================
 * Handles automatic, bidirectional synchronization of all offline data to the database
 * whenever the network connection is restored.
 *
 * Synchronizes:
 *  1. Offline Customers (`offline_customers`)
 *  2. Offline Products (`offline_pending_products`)
 *  3. Offline Stock Adjustments (`offline_pending_stock_adjustments`)
 *  4. Offline Repair Tickets (`offline_repairs`)
 *  5. Offline Sales / POS Transactions (`offline_transactions`)
 *  6. Offline Customer Debts (`offline_customer_debts`)
 *  7. Offline Customer Activity Logs (`offline_customer_activity_logs`)
 *  8. Queued action events (status changes, updates via `offlineQueue`)
 *
 * Also records every successful offline data synchronization event into the
 * audit Activity Log (`activityLogs`) so shop owners have permanent verification.
 */

import {
  doc,
  getDoc,
  updateDoc,
} from 'firebase/firestore';
import { addIdempotently, replayKeyOf } from './idempotentReplay';
import { offlineDeadLetterStore } from './offlineDeadLetterStore';
import { offlineQueueMirror } from './offlineQueueMirror';
import { db } from '../lib/firebase';
import { offlineQueue } from './offlineQueue';
import { offlineCustomerSyncService } from './offlineCustomerSyncService';
import { inventoryService, commitStockDelta } from './inventoryService';
import type { RepairTicket, SaleTransaction, CustomerDebtEntry, CustomerActivityLog } from '../types';
import { computeStockStatus } from '../utils/stockStatus';
import { toast } from '../components/ui/Toast';

const REPAIRS_LOCAL_KEY = 'offline_repairs';
const TRANSACTIONS_LOCAL_KEY = 'offline_transactions';
const DEBTS_LOCAL_KEY = 'offline_customer_debts';
const LOGS_LOCAL_KEY = 'offline_customer_activity_logs';
const INVENTORY_LOCAL_KEY = 'offline_inventory';

/**
 * Maximum number of ALREADY-SYNCED records to keep per collection in localStorage.
 * Records with offline_ prefix are always retained (they haven't reached Firestore yet).
 * Old synced records beyond this cap are pruned from the LOCAL mirror only — Firestore is
 * never touched. This prevents localStorage from growing unboundedly over months of use.
 */
const MAX_LOCAL_CACHE_RECORDS = 300;

/**
 * Prunes each localStorage collection to at most MAX_LOCAL_CACHE_RECORDS server-synced
 * records. Offline_ prefixed entries are always preserved unconditionally.
 */
function pruneLocalCache(): void {
  const keys = [REPAIRS_LOCAL_KEY, TRANSACTIONS_LOCAL_KEY, DEBTS_LOCAL_KEY, LOGS_LOCAL_KEY, INVENTORY_LOCAL_KEY];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const all: Array<{ id?: string }> = JSON.parse(raw);

      // Split: offline (must keep) vs synced (can trim)
      const offline = all.filter(r => r.id?.startsWith('offline_'));
      const synced  = all.filter(r => !r.id?.startsWith('offline_'));

      if (synced.length <= MAX_LOCAL_CACHE_RECORDS) continue; // within limit, nothing to do

      // Keep only the most-recent MAX_LOCAL_CACHE_RECORDS synced entries
      const trimmed = synced.slice(0, MAX_LOCAL_CACHE_RECORDS);
      const pruned  = [...offline, ...trimmed];
      localStorage.setItem(key, JSON.stringify(pruned));
    } catch (e) {
      console.warn(`[UnifiedOfflineSync] Cache pruning failed for ${key}:`, e);
    }
  }
}

type SyncCountListener = (totalPending: number) => void;
const listeners = new Set<SyncCountListener>();
let isSyncing = false;
let syncDebounceTimeout: ReturnType<typeof setTimeout> | null = null;

function notifyCountListeners(): void {
  const count = unifiedOfflineSyncService.getTotalPendingCount();
  listeners.forEach(fn => {
    try {
      fn(count);
    } catch (e) {
      console.error('[UnifiedOfflineSync] Listener error:', e);
    }
  });
}

// Counting the badge means re-parsing every local queue, so a pass that writes several queues
// coalesces its notifications instead of recounting after each one.
let countNotifyTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleCountNotify(): void {
  if (countNotifyTimer !== null) return;
  countNotifyTimer = setTimeout(() => {
    countNotifyTimer = null;
    notifyCountListeners();
  }, 50);
}

function flushCountNotify(): void {
  if (countNotifyTimer !== null) {
    clearTimeout(countNotifyTimer);
    countNotifyTimer = null;
  }
  notifyCountListeners();
}

// A queue restored from the mirror is a queue whose pending count just changed.
offlineQueueMirror.onRestored(notifyCountListeners);

function getLocalList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalList<T>(key: string, list: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
    scheduleCountNotify();
  } catch (e) {
    console.error(`[UnifiedOfflineSync] Failed to persist ${key}:`, e);
  }
}

export const unifiedOfflineSyncService = {
  /**
   * Subscribe to the total pending unsynced offline records count
   */
  subscribe: (listener: SyncCountListener): (() => void) => {
    listeners.add(listener);
    listener(unifiedOfflineSyncService.getTotalPendingCount());
    return () => {
      listeners.delete(listener);
    };
  },

  /**
   * Get the grand total of all offline pending items waiting to be sent to Firestore
   */
  getTotalPendingCount: (): number => {
    let count = 0;
    try {
      count += offlineCustomerSyncService.getPendingCount();
      count += offlineQueue.getPendingCount();

      // Pending offline products added without internet
      count += inventoryService.getPendingProducts().length;

      // Pending offline stock adjustments
      count += inventoryService.getPendingStockAdjustments().length;

      const repairs = getLocalList<RepairTicket>(REPAIRS_LOCAL_KEY);
      count += repairs.filter(t => t.id && t.id.startsWith('offline_')).length;

      const txs = getLocalList<SaleTransaction>(TRANSACTIONS_LOCAL_KEY);
      count += txs.filter(t => t.id && t.id.startsWith('offline_')).length;

      const debts = getLocalList<CustomerDebtEntry>(DEBTS_LOCAL_KEY);
      count += debts.filter(d => d.id && d.id.startsWith('offline_')).length;

      const logs = getLocalList<CustomerActivityLog>(LOGS_LOCAL_KEY);
      count += logs.filter(l => l.id && l.id.startsWith('offline_')).length;
    } catch (e) {
      console.warn('[UnifiedOfflineSync] Error calculating pending count:', e);
    }
    return count;
  },

  /**
   * Sync offline-added products to Firestore
   */
  syncOfflineProducts: async (): Promise<number> => {
    const pending = inventoryService.getPendingProducts();
    if (pending.length === 0) return 0;

    let synced = 0;
    // Temporary id -> Firestore id. Everything below is persisted once at the end of the pass
    // instead of once per record: each write re-stringifies the whole local mirror and re-parses
    // every queue to recount the badge, so a per-record write is quadratic on the main thread —
    // and it lands immediately after a sale, which is when the till goes on to print.
    // A tab killed mid-pass loses only the remap; the next pass re-resolves each temp id through
    // addIdempotently/findExistingDocId rather than writing the record a second time.
    const remapped = new Map<string, string>();

    for (const product of pending) {
      if (!navigator.onLine) break;
      try {
        const oldTempId = product.id;
        const { id: _, ...productData } = product;

        const realDocId = await addIdempotently('inventory', replayKeyOf(product, oldTempId), { ...productData });

        remapped.set(oldTempId, realDocId);
        synced++;
      } catch (err) {
        console.error(`[UnifiedOfflineSync] Failed to sync offline product ${product.id}:`, err);
      }
    }

    if (synced === 0) return 0;

    // Re-read the mirrors rather than reusing the arrays captured before the loop, so anything
    // the UI added while these uploads were in flight is not clobbered.
    inventoryService.savePendingProducts(
      inventoryService.getPendingProducts().filter(p => !remapped.has(p.id))
    );

    inventoryService.saveLocalInventory(
      inventoryService.getLocalInventory().map(p => {
        const realId = remapped.get(p.id);
        return realId ? { ...p, id: realId } : p;
      })
    );

    // Update in-memory inventoryStore
    try {
      const { useInventoryStore } = await import('../store/inventoryStore');
      useInventoryStore.setState(state => ({
        products: state.products.map(p => {
          const realId = remapped.get(p.id);
          return realId ? { ...p, id: realId } : p;
        }),
        parts: state.parts.map(p => {
          const realId = remapped.get(p.id);
          return realId ? { ...p, id: realId } : p;
        }),
      }));
    } catch (e) {
      console.warn('[UnifiedOfflineSync] Error updating inventoryStore:', e);
    }

    // Remap any offline transactions that referenced these temporary product IDs
    try {
      const txs = getLocalList<SaleTransaction>(TRANSACTIONS_LOCAL_KEY);
      let txsModified = false;
      const updatedTxs = txs.map(tx => {
        const touched = tx.items.some(item => remapped.has(item.product.id));
        if (!touched) return tx;
        txsModified = true;
        return {
          ...tx,
          items: tx.items.map(item => {
            const realId = remapped.get(item.product.id);
            return realId
              ? { ...item, product: { ...item.product, id: realId } }
              : item;
          }),
        };
      });
      if (txsModified) {
        saveLocalList(TRANSACTIONS_LOCAL_KEY, updatedTxs);
      }
    } catch (e) {
      console.warn('[UnifiedOfflineSync] Error remapping transaction product IDs:', e);
    }

    return synced;
  },

  /**
   * Sync offline stock adjustments to Firestore
   */
  syncOfflineStockAdjustments: async (): Promise<number> => {
    const adjustments = inventoryService.getPendingStockAdjustments();
    if (adjustments.length === 0) return 0;

    let synced = 0;
    const syncedIds = new Set<string>();

    for (const adj of adjustments) {
      if (!navigator.onLine) break;
      try {
        const ref = doc(db, 'inventory', adj.productId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          if (adj.mode === 'relative') {
            // A queued delta must be added to the server's stock at commit time — replaying the
            // locally-computed absolute value would overwrite sales made from other devices.
            await commitStockDelta(adj.productId, adj.delta);
          } else {
            const currentStock = snap.data()?.stock ?? 0;
            const threshold = snap.data()?.lowStockThreshold ?? 1;
            const newStock = adj.newStock !== undefined
              ? adj.newStock
              : Math.max(0, currentStock + adj.delta);
            const stockStatus = computeStockStatus(newStock, threshold);

            await updateDoc(ref, { stock: newStock, stockStatus });
          }
        } else {
          // The product was deleted, or never reached Firestore, while this adjustment waited.
          // Discarding the entry is right — doing it silently is how stock disappears from the
          // books with no trace, so the abandonment is logged instead.
          offlineDeadLetterStore.record({
            source: 'stock_adjustment',
            type: 'inventory',
            payload: { ...adj },
            reason: 'document_missing',
            attempts: 0,
            enqueuedAt: adj.timestamp,
            detail: `inventory/${adj.productId} no longer exists`,
          });
        }

        syncedIds.add(adj.id);
        synced++;
      } catch (err) {
        console.error(`[UnifiedOfflineSync] Failed to sync stock adjustment for ${adj.productId}:`, err);
      }
    }

    // One write for the whole pass: savePendingStockAdjustments re-stringifies the queue and
    // mirrors it to IndexedDB, which is quadratic when done per adjustment.
    if (synced > 0) {
      inventoryService.savePendingStockAdjustments(
        inventoryService.getPendingStockAdjustments().filter(a => !syncedIds.has(a.id))
      );
    }

    return synced;
  },

  /**
   * Sync offline repair tickets to Firestore
   */
  syncOfflineRepairs: async (): Promise<number> => {
    const repairs = getLocalList<RepairTicket>(REPAIRS_LOCAL_KEY);
    const pending = repairs.filter(t => t.id && t.id.startsWith('offline_'));
    if (pending.length === 0) return 0;

    let synced = 0;
    const remapped = new Map<string, string>();

    for (const ticket of pending) {
      if (!navigator.onLine) break;
      try {
        const oldTempId = ticket.id;
        const { id: _, ...ticketData } = ticket;

        // Find the ticket by its own replay key, or create it once. Matching by `ticketNumber`
        // is not available here: two devices mint the same number for two different jobs, and
        // adopting the other shop's document drops this ticket out of the queue as "synced"
        // without ever uploading the repair the counter actually wrote.
        const realDocId = await addIdempotently('repairs', replayKeyOf(ticket, oldTempId), { ...ticketData });

        remapped.set(oldTempId, realDocId);
        synced++;
      } catch (err) {
        console.error(`[UnifiedOfflineSync] Failed to sync offline repair ticket ${ticket.id}:`, err);
      }
    }

    if (synced === 0) return 0;

    // Replace the temporary ids in local storage once for the whole pass, re-reading the list so
    // tickets queued while these uploads were in flight are kept.
    saveLocalList(
      REPAIRS_LOCAL_KEY,
      getLocalList<RepairTicket>(REPAIRS_LOCAL_KEY).map(t => {
        const realId = t.id ? remapped.get(t.id) : undefined;
        return realId ? { ...t, id: realId } : t;
      })
    );

    // Update in-memory repairStore
    try {
      const { useRepairStore } = await import('../store/repairStore');
      useRepairStore.setState(state => ({
        tickets: state.tickets.map(t => {
          const realId = remapped.get(t.id);
          return realId ? { ...t, id: realId } : t;
        }),
      }));
    } catch (e) {
      console.warn('[UnifiedOfflineSync] Error updating repairStore:', e);
    }

    return synced;
  },

  /**
   * Sync offline sales/transactions to Firestore
   */
  syncOfflineTransactions: async (): Promise<number> => {
    const txs = getLocalList<SaleTransaction>(TRANSACTIONS_LOCAL_KEY);
    const pending = txs.filter(t => t.id && t.id.startsWith('offline_'));
    if (pending.length === 0) return 0;

    let synced = 0;
    const remapped = new Map<string, string>();

    for (const tx of pending) {
      if (!navigator.onLine) break;
      try {
        const oldTempId = tx.id;
        const { id: _, ...txData } = tx;

        const realDocId = await addIdempotently('transactions', replayKeyOf(tx, oldTempId), { ...txData });

        remapped.set(oldTempId, realDocId);
        synced++;
      } catch (err) {
        console.error(`[UnifiedOfflineSync] Failed to sync offline transaction ${tx.id}:`, err);
      }
    }

    if (synced === 0) return 0;

    saveLocalList(
      TRANSACTIONS_LOCAL_KEY,
      getLocalList<SaleTransaction>(TRANSACTIONS_LOCAL_KEY).map(t => {
        const realId = t.id ? remapped.get(t.id) : undefined;
        return realId ? { ...t, id: realId } : t;
      })
    );

    // Update in-memory cartStore
    try {
      const { useCartStore } = await import('../store/cartStore');
      useCartStore.setState(state => ({
        transactions: state.transactions.map(t => {
          const realId = remapped.get(t.id);
          return realId ? { ...t, id: realId } : t;
        }),
      }));
    } catch (e) {
      console.warn('[UnifiedOfflineSync] Error updating cartStore:', e);
    }

    return synced;
  },

  /**
   * Sync offline debts to Firestore
   */
  syncOfflineDebts: async (): Promise<number> => {
    const debts = getLocalList<CustomerDebtEntry>(DEBTS_LOCAL_KEY);
    const pending = debts.filter(d => d.id && d.id.startsWith('offline_'));
    if (pending.length === 0) return 0;

    let synced = 0;
    const remapped = new Map<string, string>();

    for (const debt of pending) {
      if (!navigator.onLine) break;
      try {
        const oldTempId = debt.id;
        const { id: _, ...debtData } = debt;

        const realDocId = await addIdempotently('customer_debts', replayKeyOf(debt, oldTempId), { ...debtData });

        remapped.set(oldTempId, realDocId);
        synced++;
      } catch (err) {
        console.error(`[UnifiedOfflineSync] Failed to sync offline debt ${debt.id}:`, err);
      }
    }

    if (synced === 0) return 0;

    saveLocalList(
      DEBTS_LOCAL_KEY,
      getLocalList<CustomerDebtEntry>(DEBTS_LOCAL_KEY).map(d => {
        const realId = d.id ? remapped.get(d.id) : undefined;
        return realId ? { ...d, id: realId } : d;
      })
    );

    // Update in-memory customerStore debts
    try {
      const { useCustomerStore } = await import('../store/customerStore');
      useCustomerStore.setState(state => ({
        debts: state.debts.map(d => {
          const realId = remapped.get(d.id);
          return realId ? { ...d, id: realId } : d;
        }),
      }));
    } catch (e) {
      console.warn('[UnifiedOfflineSync] Error updating customerStore debts:', e);
    }

    return synced;
  },

  /**
   * Sync offline customer activity logs to Firestore
   */
  syncOfflineLogs: async (): Promise<number> => {
    const logs = getLocalList<CustomerActivityLog>(LOGS_LOCAL_KEY);
    const pending = logs.filter(l => l.id && l.id.startsWith('offline_'));
    if (pending.length === 0) return 0;

    let synced = 0;
    const remapped = new Map<string, string>();

    for (const log of pending) {
      if (!navigator.onLine) break;
      try {
        const oldTempId = log.id;
        const { id: _, ...logData } = log;

        const realDocId = await addIdempotently('customer_activity_logs', replayKeyOf(log, oldTempId), { ...logData });

        remapped.set(oldTempId, realDocId);
        synced++;
      } catch (err) {
        console.error(`[UnifiedOfflineSync] Failed to sync offline customer log ${log.id}:`, err);
      }
    }

    if (synced === 0) return 0;

    saveLocalList(
      LOGS_LOCAL_KEY,
      getLocalList<CustomerActivityLog>(LOGS_LOCAL_KEY).map(l => {
        const realId = l.id ? remapped.get(l.id) : undefined;
        return realId ? { ...l, id: realId } : l;
      })
    );

    return synced;
  },

  /**
   * MASTER SYNC: Triggers all domain syncs in correct sequence
   */
  syncAll: async (): Promise<{ totalSynced: number; errors: boolean }> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { totalSynced: 0, errors: false };
    }

    if (isSyncing) {
      return { totalSynced: 0, errors: false };
    }

    isSyncing = true;
    notifyCountListeners();

    let totalSynced = 0;
    let hadErrors = false;
    const summaryDetails: string[] = [];

    try {
      // 1. Sync offline customers first (so remote customer IDs are resolved)
      try {
        const custResult = await offlineCustomerSyncService.syncPendingCustomers();
        totalSynced += custResult.syncedCount;
        if (custResult.syncedCount > 0) {
          summaryDetails.push(`${custResult.syncedCount} customer${custResult.syncedCount > 1 ? 's' : ''}`);
        }
        if (custResult.errors > 0) hadErrors = true;
      } catch (e) {
        console.warn('[UnifiedOfflineSync] Customer sync warning:', e);
        hadErrors = true;
      }

      // 2. Sync offline products
      try {
        const productsSynced = await unifiedOfflineSyncService.syncOfflineProducts();
        totalSynced += productsSynced;
        if (productsSynced > 0) {
          summaryDetails.push(`${productsSynced} product${productsSynced > 1 ? 's' : ''}`);
        }
      } catch (e) {
        console.warn('[UnifiedOfflineSync] Products sync warning:', e);
        hadErrors = true;
      }

      // 3. Sync offline stock adjustments
      try {
        const stockSynced = await unifiedOfflineSyncService.syncOfflineStockAdjustments();
        totalSynced += stockSynced;
        if (stockSynced > 0) {
          summaryDetails.push(`${stockSynced} stock update${stockSynced > 1 ? 's' : ''}`);
        }
      } catch (e) {
        console.warn('[UnifiedOfflineSync] Stock adjustments sync warning:', e);
        hadErrors = true;
      }

      // 4. Sync offline repair tickets
      try {
        const repairsSynced = await unifiedOfflineSyncService.syncOfflineRepairs();
        totalSynced += repairsSynced;
        if (repairsSynced > 0) {
          summaryDetails.push(`${repairsSynced} ticket${repairsSynced > 1 ? 's' : ''}`);
        }
      } catch (e) {
        console.warn('[UnifiedOfflineSync] Repairs sync warning:', e);
        hadErrors = true;
      }

      // 5. Sync offline sales/transactions
      try {
        const txsSynced = await unifiedOfflineSyncService.syncOfflineTransactions();
        totalSynced += txsSynced;
        if (txsSynced > 0) {
          summaryDetails.push(`${txsSynced} sale${txsSynced > 1 ? 's' : ''}`);
        }
      } catch (e) {
        console.warn('[UnifiedOfflineSync] Transactions sync warning:', e);
        hadErrors = true;
      }

      // 6. Sync offline debts
      try {
        const debtsSynced = await unifiedOfflineSyncService.syncOfflineDebts();
        totalSynced += debtsSynced;
        if (debtsSynced > 0) {
          summaryDetails.push(`${debtsSynced} debt${debtsSynced > 1 ? 's' : ''}`);
        }
      } catch (e) {
        console.warn('[UnifiedOfflineSync] Debts sync warning:', e);
        hadErrors = true;
      }

      // 7. Sync offline customer logs
      try {
        const logsSynced = await unifiedOfflineSyncService.syncOfflineLogs();
        totalSynced += logsSynced;
        if (logsSynced > 0) {
          summaryDetails.push(`${logsSynced} customer log${logsSynced > 1 ? 's' : ''}`);
        }
      } catch (e) {
        console.warn('[UnifiedOfflineSync] Logs sync warning:', e);
        hadErrors = true;
      }

      // 8. Flush action queue (status updates, ticket updates, refunds)
      try {
        const queueResult = await offlineQueue.flush();
        totalSynced += queueResult.success;
        if (queueResult.success > 0) {
          summaryDetails.push(`${queueResult.success} action${queueResult.success > 1 ? 's' : ''}`);
        }
        if (queueResult.failed > 0) hadErrors = true;
      } catch (e) {
        console.warn('[UnifiedOfflineSync] Action queue flush warning:', e);
        hadErrors = true;
      }

      // If changes were successfully synced to database:
      if (totalSynced > 0) {
        const detailsStr = summaryDetails.join(', ');

        // 1. Show user toast notification
        toast.success(
          'Database Synchronized',
          `Successfully sent ${totalSynced} offline change${totalSynced > 1 ? 's' : ''} to database (${detailsStr}).`
        );

        // 2. Persist to Firestore Activity Log so data transfer is permanently audited
        try {
          const { activityLogService } = await import('./activityLogService');
          await activityLogService.log(
            'system',
            `Offline Sync Complete: ${totalSynced} change${totalSynced > 1 ? 's' : ''} sent to database`,
            {
              detail: `Synced items: ${detailsStr}. All local records successfully uploaded.`,
              severity: 'success',
              entityType: 'system',
            }
          );
        } catch (logErr) {
          console.warn('[UnifiedOfflineSync] Could not write sync event to activity log:', logErr);
        }

        // 3. Trim stale synced records from localStorage now that we know Firestore is reachable
        pruneLocalCache();
      }

      return { totalSynced, errors: hadErrors };
    } finally {
      isSyncing = false;
      flushCountNotify();
    }
  },

  /**
   * Debounced sync trigger
   */
  triggerDebouncedSync: (delay = 800) => {
    if (syncDebounceTimeout) clearTimeout(syncDebounceTimeout);
    syncDebounceTimeout = setTimeout(() => {
      unifiedOfflineSyncService.syncAll().catch(err => {
        console.warn('[UnifiedOfflineSync] Background sync error:', err);
      });
    }, delay);
  },

  /**
   * Initialize global listeners for online reconnection, window focus, and heartbeat
   */
  init: (): (() => void) => {
    const handleOnline = () => {
      unifiedOfflineSyncService.triggerDebouncedSync(500);
    };

    const handleFocus = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        if (unifiedOfflineSyncService.getTotalPendingCount() > 0) {
          unifiedOfflineSyncService.triggerDebouncedSync(1000);
        }
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('app:online', handleOnline);
    window.addEventListener('focus', handleFocus);

    // Periodic 30-second heartbeat to flush any pending changes when online
    const intervalId = setInterval(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        if (unifiedOfflineSyncService.getTotalPendingCount() > 0) {
          unifiedOfflineSyncService.syncAll().catch(console.warn);
        }
      }
    }, 30000);

    // Initial check on load
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      if (unifiedOfflineSyncService.getTotalPendingCount() > 0) {
        unifiedOfflineSyncService.triggerDebouncedSync(2000);
      }
    }

    notifyCountListeners();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('app:online', handleOnline);
      window.removeEventListener('focus', handleFocus);
      clearInterval(intervalId);
      if (syncDebounceTimeout) clearTimeout(syncDebounceTimeout);
    };
  },
};
