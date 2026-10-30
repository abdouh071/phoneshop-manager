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
  collection,
  doc,
  addDoc,
  getDoc,
  updateDoc,
  getDocs,
  query,
  where,
  limit,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { offlineQueue } from './offlineQueue';
import { offlineCustomerSyncService } from './offlineCustomerSyncService';
import { inventoryService } from './inventoryService';
import type { RepairTicket, SaleTransaction, CustomerDebtEntry, CustomerActivityLog, PhoneModel } from '../types';
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
      console.info(`[UnifiedOfflineSync] Pruned ${synced.length - trimmed.length} stale records from ${key}`);
    } catch (e) {
      console.warn(`[UnifiedOfflineSync] Cache pruning failed for ${key}:`, e);
    }
  }
}

type SyncCountListener = (totalPending: number) => void;
const listeners = new Set<SyncCountListener>();
let isSyncing = false;
let syncDebounceTimeout: any = null;

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
    notifyCountListeners();
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
    let remainingPending = [...pending];

    for (const product of pending) {
      if (!navigator.onLine) break;
      try {
        const oldTempId = product.id;
        const { id: _, ...productData } = product;

        const docRef = await addDoc(collection(db, 'inventory'), {
          ...productData,
          syncedAt: new Date().toISOString(),
        });
        const realDocId = docRef.id;

        // Remove from pending products list
        remainingPending = remainingPending.filter(p => p.id !== oldTempId);
        inventoryService.savePendingProducts(remainingPending);

        // Update local inventory mirror
        const local = inventoryService.getLocalInventory();
        inventoryService.saveLocalInventory(
          local.map(p => p.id === oldTempId ? { ...p, id: realDocId } : p)
        );

        // Update in-memory inventoryStore
        try {
          const { useInventoryStore } = await import('../store/inventoryStore');
          useInventoryStore.setState(state => ({
            products: state.products.map(p => p.id === oldTempId ? { ...p, id: realDocId } : p),
            parts: state.parts.map(p => p.id === oldTempId ? { ...p, id: realDocId } : p),
          }));
        } catch (e) {
          console.warn('[UnifiedOfflineSync] Error updating inventoryStore:', e);
        }

        // Remap any offline transactions that referenced this temporary product ID
        try {
          const txs = getLocalList<SaleTransaction>(TRANSACTIONS_LOCAL_KEY);
          let txsModified = false;
          const updatedTxs = txs.map(tx => {
            const hasTempProd = tx.items.some(i => i.product.id === oldTempId);
            if (!hasTempProd) return tx;
            txsModified = true;
            return {
              ...tx,
              items: tx.items.map(item =>
                item.product.id === oldTempId
                  ? { ...item, product: { ...item.product, id: realDocId } }
                  : item
              ),
            };
          });
          if (txsModified) {
            saveLocalList(TRANSACTIONS_LOCAL_KEY, updatedTxs);
          }
        } catch (e) {
          console.warn('[UnifiedOfflineSync] Error remapping transaction product IDs:', e);
        }

        synced++;
      } catch (err) {
        console.error(`[UnifiedOfflineSync] Failed to sync offline product ${product.id}:`, err);
      }
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
    let remaining = [...adjustments];

    for (const adj of adjustments) {
      if (!navigator.onLine) break;
      try {
        const ref = doc(db, 'inventory', adj.productId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const currentStock = snap.data()?.stock ?? 0;
          const threshold = snap.data()?.lowStockThreshold ?? 1;
          const newStock = adj.newStock !== undefined
            ? adj.newStock
            : Math.max(0, currentStock + adj.delta);
          const stockStatus =
            newStock === 0 ? 'out_of_stock' :
            newStock <= threshold ? 'low_stock' : 'in_stock';

          await updateDoc(ref, { stock: newStock, stockStatus });
        }

        remaining = remaining.filter(a => a.id !== adj.id);
        inventoryService.savePendingStockAdjustments(remaining);
        synced++;
      } catch (err) {
        console.error(`[UnifiedOfflineSync] Failed to sync stock adjustment for ${adj.productId}:`, err);
      }
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
    let updatedRepairs = [...repairs];

    for (const ticket of pending) {
      if (!navigator.onLine) break;
      try {
        const oldTempId = ticket.id;
        const { id: _, ...ticketData } = ticket;

        // Check if ticket with identical ticketNumber already exists on Firestore
        let realDocId: string;
        if (ticket.ticketNumber) {
          const q = query(
            collection(db, 'repairs'),
            where('ticketNumber', '==', ticket.ticketNumber),
            limit(1)
          );
          const snap = await getDocs(q);
          if (!snap.empty) {
            realDocId = snap.docs[0].id;
          } else {
            const docRef = await addDoc(collection(db, 'repairs'), {
              ...ticketData,
              syncedAt: new Date().toISOString(),
            });
            realDocId = docRef.id;
          }
        } else {
          const docRef = await addDoc(collection(db, 'repairs'), {
            ...ticketData,
            syncedAt: new Date().toISOString(),
          });
          realDocId = docRef.id;
        }

        // Replace temporary ID in local storage
        updatedRepairs = updatedRepairs.map(t =>
          t.id === oldTempId ? { ...t, id: realDocId } : t
        );
        saveLocalList(REPAIRS_LOCAL_KEY, updatedRepairs);

        // Update in-memory repairStore
        try {
          const { useRepairStore } = await import('../store/repairStore');
          useRepairStore.setState(state => ({
            tickets: state.tickets.map(t =>
              t.id === oldTempId ? { ...t, id: realDocId } : t
            ),
          }));
        } catch (e) {
          console.warn('[UnifiedOfflineSync] Error updating repairStore:', e);
        }

        synced++;
      } catch (err) {
        console.error(`[UnifiedOfflineSync] Failed to sync offline repair ticket ${ticket.id}:`, err);
      }
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
    let updatedTxs = [...txs];

    for (const tx of pending) {
      if (!navigator.onLine) break;
      try {
        const oldTempId = tx.id;
        const { id: _, ...txData } = tx;

        const docRef = await addDoc(collection(db, 'transactions'), {
          ...txData,
          syncedAt: new Date().toISOString(),
        });
        const realDocId = docRef.id;

        updatedTxs = updatedTxs.map(t =>
          t.id === oldTempId ? { ...t, id: realDocId } : t
        );
        saveLocalList(TRANSACTIONS_LOCAL_KEY, updatedTxs);

        // Update in-memory cartStore
        try {
          const { useCartStore } = await import('../store/cartStore');
          useCartStore.setState(state => ({
            transactions: state.transactions.map(t =>
              t.id === oldTempId ? { ...t, id: realDocId } : t
            ),
          }));
        } catch (e) {
          console.warn('[UnifiedOfflineSync] Error updating cartStore:', e);
        }

        synced++;
      } catch (err) {
        console.error(`[UnifiedOfflineSync] Failed to sync offline transaction ${tx.id}:`, err);
      }
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
    let updatedDebts = [...debts];

    for (const debt of pending) {
      if (!navigator.onLine) break;
      try {
        const oldTempId = debt.id;
        const { id: _, ...debtData } = debt;

        const docRef = await addDoc(collection(db, 'customer_debts'), {
          ...debtData,
          syncedAt: new Date().toISOString(),
        });
        const realDocId = docRef.id;

        updatedDebts = updatedDebts.map(d =>
          d.id === oldTempId ? { ...d, id: realDocId } : d
        );
        saveLocalList(DEBTS_LOCAL_KEY, updatedDebts);

        // Update in-memory customerStore debts
        try {
          const { useCustomerStore } = await import('../store/customerStore');
          useCustomerStore.setState(state => ({
            debts: state.debts.map(d =>
              d.id === oldTempId ? { ...d, id: realDocId } : d
            ),
          }));
        } catch (e) {
          console.warn('[UnifiedOfflineSync] Error updating customerStore debts:', e);
        }

        synced++;
      } catch (err) {
        console.error(`[UnifiedOfflineSync] Failed to sync offline debt ${debt.id}:`, err);
      }
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
    let updatedLogs = [...logs];

    for (const log of pending) {
      if (!navigator.onLine) break;
      try {
        const oldTempId = log.id;
        const { id: _, ...logData } = log;

        const docRef = await addDoc(collection(db, 'customer_activity_logs'), {
          ...logData,
          syncedAt: new Date().toISOString(),
        });
        const realDocId = docRef.id;

        updatedLogs = updatedLogs.map(l =>
          l.id === oldTempId ? { ...l, id: realDocId } : l
        );
        saveLocalList(LOGS_LOCAL_KEY, updatedLogs);

        synced++;
      } catch (err) {
        console.error(`[UnifiedOfflineSync] Failed to sync offline customer log ${log.id}:`, err);
      }
    }

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
      console.info('[UnifiedOfflineSync] Starting master sync across all domains...');

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
      notifyCountListeners();
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
    console.info('[UnifiedOfflineSync] Initializing unified offline sync service...');

    const handleOnline = () => {
      console.info('[UnifiedOfflineSync] Network back online! Triggering automatic sync to database...');
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
