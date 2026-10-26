/**
 * Unified Offline Sync Service
 * =============================
 * Handles automatic, bidirectional synchronization of all offline data to the database
 * whenever the network connection is restored.
 *
 * Synchronizes:
 *  1. Offline Customers (`offline_customers`)
 *  2. Offline Repair Tickets (`offline_repairs`)
 *  3. Offline Sales / POS Transactions (`offline_transactions`)
 *  4. Offline Customer Debts (`offline_customer_debts`)
 *  5. Offline Customer Activity Logs (`offline_customer_activity_logs`)
 *  6. Queued action events (status changes, updates via `offlineQueue`)
 */

import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  limit,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { offlineQueue } from './offlineQueue';
import { offlineCustomerSyncService } from './offlineCustomerSyncService';
import type { RepairTicket, SaleTransaction, CustomerDebtEntry, CustomerActivityLog } from '../types';
import { toast } from '../components/ui/Toast';

const REPAIRS_LOCAL_KEY = 'offline_repairs';
const TRANSACTIONS_LOCAL_KEY = 'offline_transactions';
const DEBTS_LOCAL_KEY = 'offline_customer_debts';
const LOGS_LOCAL_KEY = 'offline_customer_activity_logs';

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

        // Check if already created on server with the same ticketNumber
        let realDocId = '';
        if (ticket.ticketNumber) {
          const q = query(
            collection(db, 'repairs'),
            where('ticketNumber', '==', ticket.ticketNumber),
            limit(1)
          );
          const snap = await getDocs(q);
          if (!snap.empty) {
            realDocId = snap.docs[0].id;
          }
        }

        if (!realDocId) {
          const docRef = await addDoc(collection(db, 'repairs'), {
            ...ticketData,
            syncedAt: new Date().toISOString(),
          });
          realDocId = docRef.id;
        }

        // Replace temporary ID in local repairs
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
   * Master synchronization routine: sweeps all collections and flushes queues
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

    try {
      console.info('[UnifiedOfflineSync] Starting master sync across all domains...');

      // 1. Sync offline customers first (so remote customer IDs are resolved)
      try {
        const custResult = await offlineCustomerSyncService.syncPendingCustomers();
        totalSynced += custResult.syncedCount;
        if (custResult.errors > 0) hadErrors = true;
      } catch (e) {
        console.warn('[UnifiedOfflineSync] Customer sync warning:', e);
        hadErrors = true;
      }

      // 2. Sync offline repair tickets
      try {
        const repairsSynced = await unifiedOfflineSyncService.syncOfflineRepairs();
        totalSynced += repairsSynced;
      } catch (e) {
        console.warn('[UnifiedOfflineSync] Repairs sync warning:', e);
        hadErrors = true;
      }

      // 3. Sync offline sales/transactions
      try {
        const txsSynced = await unifiedOfflineSyncService.syncOfflineTransactions();
        totalSynced += txsSynced;
      } catch (e) {
        console.warn('[UnifiedOfflineSync] Transactions sync warning:', e);
        hadErrors = true;
      }

      // 4. Sync offline debts
      try {
        const debtsSynced = await unifiedOfflineSyncService.syncOfflineDebts();
        totalSynced += debtsSynced;
      } catch (e) {
        console.warn('[UnifiedOfflineSync] Debts sync warning:', e);
        hadErrors = true;
      }

      // 5. Sync offline customer logs
      try {
        const logsSynced = await unifiedOfflineSyncService.syncOfflineLogs();
        totalSynced += logsSynced;
      } catch (e) {
        console.warn('[UnifiedOfflineSync] Logs sync warning:', e);
        hadErrors = true;
      }

      // 6. Flush action queue (status updates, ticket updates, refunds)
      try {
        const queueResult = await offlineQueue.flush();
        totalSynced += queueResult.success;
        if (queueResult.failed > 0) hadErrors = true;
      } catch (e) {
        console.warn('[UnifiedOfflineSync] Action queue flush warning:', e);
        hadErrors = true;
      }

      if (totalSynced > 0) {
        toast.success(
          'Database Synchronized',
          `Successfully sent ${totalSynced} offline change${totalSynced > 1 ? 's' : ''} to the database.`
        );
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
