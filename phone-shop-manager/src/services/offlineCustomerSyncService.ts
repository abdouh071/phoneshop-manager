import {
  collection,
  doc,
  addDoc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Customer, RepairTicket, SaleTransaction, CustomerDebtEntry, CustomerActivityLog } from '../types';
import { toast } from '../components/ui/Toast';
import { formatStandardPhone, normalizePhoneDigits, isMoreDescriptiveName } from '../utils/phoneUtils';

export interface OfflineCustomerQueueItem {
  tempId: string;
  customerData: Customer;
  enqueuedAt: string;
  retryCount: number;
  lastAttemptAt?: string;
  lastError?: string;
}

const SYNC_QUEUE_KEY = 'offline_customer_sync_queue';
const CUSTOMERS_LOCAL_KEY = 'offline_customers';
const REPAIRS_LOCAL_KEY = 'offline_repairs';
const TRANSACTIONS_LOCAL_KEY = 'offline_transactions';
const DEBTS_LOCAL_KEY = 'offline_customer_debts';
const LOGS_LOCAL_KEY = 'offline_customer_activity_logs';

let isSyncing = false;
let syncTimeout: any = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach(fn => {
    try {
      fn();
    } catch (e) {
      console.error('[OfflineCustomerSync] Listener error:', e);
    }
  });
}

export const offlineCustomerSyncService = {
  /**
   * Subscribe to queue updates
   */
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /**
   * Get all queued offline customers waiting to sync
   */
  getQueue: (): OfflineCustomerQueueItem[] => {
    try {
      const raw = localStorage.getItem(SYNC_QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('[OfflineCustomerSync] Failed to read sync queue:', e);
      return [];
    }
  },

  /**
   * Count of customers in queue
   */
  getPendingCount: (): number => {
    return offlineCustomerSyncService.getQueue().length;
  },

  /**
   * Save queue to local storage
   */
  saveQueue: (queue: OfflineCustomerQueueItem[]): void => {
    try {
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
      notifyListeners();
    } catch (e) {
      console.error('[OfflineCustomerSync] Failed to save sync queue:', e);
    }
  },

  /**
   * Enqueue a customer created while offline
   */
  enqueue: (customer: Customer): void => {
    if (!customer.id || !customer.id.startsWith('offline_')) {
      return;
    }

    const queue = offlineCustomerSyncService.getQueue();
    const existingIndex = queue.findIndex(item => item.tempId === customer.id);

    if (existingIndex >= 0) {
      queue[existingIndex].customerData = customer;
    } else {
      queue.push({
        tempId: customer.id,
        customerData: customer,
        enqueuedAt: new Date().toISOString(),
        retryCount: 0,
      });
    }

    offlineCustomerSyncService.saveQueue(queue);

    // If online, schedule immediate background sync
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      offlineCustomerSyncService.triggerDebouncedSync();
    }
  },

  /**
   * Remove a synced customer from the queue
   */
  removeFromQueue: (tempId: string): void => {
    const queue = offlineCustomerSyncService.getQueue();
    const updated = queue.filter(item => item.tempId !== tempId);
    if (updated.length !== queue.length) {
      offlineCustomerSyncService.saveQueue(updated);
    }
  },

  /**
   * Update details of a queued customer
   */
  updateQueuedCustomer: (tempId: string, updates: Partial<Customer>): void => {
    const queue = offlineCustomerSyncService.getQueue();
    const item = queue.find(i => i.tempId === tempId);
    if (item) {
      item.customerData = { ...item.customerData, ...updates };
      offlineCustomerSyncService.saveQueue(queue);
    }
  },

  /**
   * Scan offline_customers storage and ensure any offline_cust_ ID is in the queue
   */
  sweepUnsyncedOfflineCustomers: (): void => {
    try {
      const raw = localStorage.getItem(CUSTOMERS_LOCAL_KEY);
      if (!raw) return;
      const customers: Customer[] = JSON.parse(raw);
      const offlineOnes = customers.filter(c => c.id && c.id.startsWith('offline_'));
      if (offlineOnes.length === 0) return;

      const queue = offlineCustomerSyncService.getQueue();
      const queuedIds = new Set(queue.map(q => q.tempId));
      let added = false;

      offlineOnes.forEach(cust => {
        if (!queuedIds.has(cust.id)) {
          queue.push({
            tempId: cust.id,
            customerData: cust,
            enqueuedAt: new Date().toISOString(),
            retryCount: 0,
          });
          added = true;
        }
      });

      if (added) {
        offlineCustomerSyncService.saveQueue(queue);
      }
    } catch (e) {
      console.warn('[OfflineCustomerSync] Sweep failed:', e);
    }
  },

  /**
   * Debounced background trigger
   */
  triggerDebouncedSync: () => {
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
      offlineCustomerSyncService.syncPendingCustomers().catch(err => {
        console.warn('[OfflineCustomerSync] Background sync error:', err);
      });
    }, 600);
  },

  /**
   * Core engine: replaces temporary offline_ IDs across local storage, in-memory stores, and Firestore
   */
  replaceOfflineIdEverywhere: async (
    oldTempId: string,
    newRealId: string,
    customerData: Customer
  ): Promise<void> => {
    console.info(`[OfflineCustomerSync] Replacing temporary ID "${oldTempId}" -> "${newRealId}" across records...`);

    // 1. Update Customers in LocalStorage
    try {
      const raw = localStorage.getItem(CUSTOMERS_LOCAL_KEY);
      if (raw) {
        const localCustomers: Customer[] = JSON.parse(raw);
        const deduplicated = localCustomers
          .filter(c => c.id !== oldTempId && c.id !== newRealId)
          .concat([{ ...customerData, id: newRealId }]);
        localStorage.setItem(CUSTOMERS_LOCAL_KEY, JSON.stringify(deduplicated));
      }
    } catch (e) {
      console.warn('[OfflineCustomerSync] Error updating local customers:', e);
    }

    // 2. Update In-Memory Customer Store
    try {
      const { useCustomerStore } = await import('../store/customerStore');
      useCustomerStore.setState(state => {
        const tempExists = state.customers.some(c => c.id === oldTempId);
        const realExists = state.customers.some(c => c.id === newRealId);

        let updatedCusts: Customer[];
        if (realExists) {
          updatedCusts = state.customers
            .filter(c => c.id !== oldTempId)
            .map(c => (c.id === newRealId ? { ...c, ...customerData, id: newRealId } : c));
        } else if (tempExists) {
          updatedCusts = state.customers.map(c =>
            c.id === oldTempId ? { ...c, ...customerData, id: newRealId } : c
          );
        } else {
          updatedCusts = [...state.customers, { ...customerData, id: newRealId, totalDebt: 0 }];
        }

        return {
          customers: updatedCusts,
          debts: state.debts.map(d =>
            d.customerId === oldTempId
              ? { ...d, customerId: newRealId, customerName: customerData.name, customerPhone: customerData.phone }
              : d
          ),
          customerLogs: state.customerLogs.map(l =>
            l.customerId === oldTempId
              ? { ...l, customerId: newRealId, customerName: customerData.name }
              : l
          ),
        };
      });
    } catch (e) {
      console.warn('[OfflineCustomerSync] Error updating customer store:', e);
    }

    // 3. Update Pending & Existing Repairs / Tickets
    // 3A. Local repairs
    try {
      const rawRepairs = localStorage.getItem(REPAIRS_LOCAL_KEY);
      if (rawRepairs) {
        const repairs: RepairTicket[] = JSON.parse(rawRepairs);
        let changed = false;
        const updatedRepairs = repairs.map(t => {
          if (t.customerId === oldTempId) {
            changed = true;
            return {
              ...t,
              customerId: newRealId,
              customerName: customerData.name,
              customerPhone: customerData.phone,
              updatedAt: new Date().toISOString(),
            };
          }
          return t;
        });
        if (changed) {
          localStorage.setItem(REPAIRS_LOCAL_KEY, JSON.stringify(updatedRepairs));
        }
      }
    } catch (e) {
      console.warn('[OfflineCustomerSync] Error updating local repairs:', e);
    }

    // 3B. In-memory repair store
    try {
      const { useRepairStore } = await import('../store/repairStore');
      useRepairStore.setState(state => ({
        tickets: state.tickets.map(t =>
          t.customerId === oldTempId
            ? {
                ...t,
                customerId: newRealId,
                customerName: customerData.name,
                customerPhone: customerData.phone,
                updatedAt: new Date().toISOString(),
              }
            : t
        ),
      }));
    } catch (e) {
      console.warn('[OfflineCustomerSync] Error updating repair store:', e);
    }

    // 3C. Firestore repairs documents
    try {
      const qRepairs = query(collection(db, 'repairs'), where('customerId', '==', oldTempId));
      const snapRepairs = await getDocs(qRepairs);
      if (!snapRepairs.empty) {
        const batch = writeBatch(db);
        snapRepairs.docs.forEach(d => {
          batch.update(d.ref, {
            customerId: newRealId,
            customerName: customerData.name,
            customerPhone: customerData.phone,
            updatedAt: new Date().toISOString(),
          });
        });
        await batch.commit();
      }
    } catch (e) {
      console.warn('[OfflineCustomerSync] Firestore repairs customerId update skipped/failed:', e);
    }

    // 4. Update Pending & Existing Sales / Transactions
    // 4A. Local transactions
    try {
      const rawTx = localStorage.getItem(TRANSACTIONS_LOCAL_KEY);
      if (rawTx) {
        const txs: SaleTransaction[] = JSON.parse(rawTx);
        let changed = false;
        const updatedTxs = txs.map(t => {
          if (t.customerId === oldTempId) {
            changed = true;
            return {
              ...t,
              customerId: newRealId,
              customerName: customerData.name,
              customerPhone: customerData.phone,
            };
          }
          return t;
        });
        if (changed) {
          localStorage.setItem(TRANSACTIONS_LOCAL_KEY, JSON.stringify(updatedTxs));
        }
      }
    } catch (e) {
      console.warn('[OfflineCustomerSync] Error updating local transactions:', e);
    }

    // 4B. Firestore transactions documents
    try {
      const qTx = query(collection(db, 'transactions'), where('customerId', '==', oldTempId));
      const snapTx = await getDocs(qTx);
      if (!snapTx.empty) {
        const batch = writeBatch(db);
        snapTx.docs.forEach(d => {
          batch.update(d.ref, {
            customerId: newRealId,
            customerName: customerData.name,
            customerPhone: customerData.phone,
          });
        });
        await batch.commit();
      }
    } catch (e) {
      console.warn('[OfflineCustomerSync] Firestore transactions customerId update skipped/failed:', e);
    }

    // 5. Update Debts
    // 5A. Local debts
    try {
      const rawDebts = localStorage.getItem(DEBTS_LOCAL_KEY);
      if (rawDebts) {
        const debts: CustomerDebtEntry[] = JSON.parse(rawDebts);
        let changed = false;
        const updatedDebts = debts.map(d => {
          if (d.customerId === oldTempId) {
            changed = true;
            return {
              ...d,
              customerId: newRealId,
              customerName: customerData.name,
              customerPhone: customerData.phone,
              updatedAt: new Date().toISOString(),
            };
          }
          return d;
        });
        if (changed) {
          localStorage.setItem(DEBTS_LOCAL_KEY, JSON.stringify(updatedDebts));
        }
      }
    } catch (e) {
      console.warn('[OfflineCustomerSync] Error updating local debts:', e);
    }

    // 5B. Firestore debts
    try {
      const qDebts = query(collection(db, 'customer_debts'), where('customerId', '==', oldTempId));
      const snapDebts = await getDocs(qDebts);
      if (!snapDebts.empty) {
        const batch = writeBatch(db);
        snapDebts.docs.forEach(d => {
          batch.update(d.ref, {
            customerId: newRealId,
            customerName: customerData.name,
            customerPhone: customerData.phone,
            updatedAt: new Date().toISOString(),
          });
        });
        await batch.commit();
      }
    } catch (e) {
      console.warn('[OfflineCustomerSync] Firestore debts customerId update skipped/failed:', e);
    }

    // 6. Update Customer Activity Logs
    // 6A. Local logs
    try {
      const rawLogs = localStorage.getItem(LOGS_LOCAL_KEY);
      if (rawLogs) {
        const logs: CustomerActivityLog[] = JSON.parse(rawLogs);
        let changed = false;
        const updatedLogs = logs.map(l => {
          if (l.customerId === oldTempId) {
            changed = true;
            return {
              ...l,
              customerId: newRealId,
              customerName: customerData.name,
            };
          }
          return l;
        });
        if (changed) {
          localStorage.setItem(LOGS_LOCAL_KEY, JSON.stringify(updatedLogs));
        }
      }
    } catch (e) {
      console.warn('[OfflineCustomerSync] Error updating local logs:', e);
    }

    // 6B. Firestore logs
    try {
      const qLogs = query(collection(db, 'customer_activity_logs'), where('customerId', '==', oldTempId));
      const snapLogs = await getDocs(qLogs);
      if (!snapLogs.empty) {
        const batch = writeBatch(db);
        snapLogs.docs.forEach(d => {
          batch.update(d.ref, {
            customerId: newRealId,
            customerName: customerData.name,
          });
        });
        await batch.commit();
      }
    } catch (e) {
      console.warn('[OfflineCustomerSync] Firestore logs customerId update skipped/failed:', e);
    }
  },

  /**
   * Process all queued offline customers and sync them to Firestore
   */
  syncPendingCustomers: async (): Promise<{ syncedCount: number; errors: number }> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { syncedCount: 0, errors: 0 };
    }

    if (isSyncing) {
      return { syncedCount: 0, errors: 0 };
    }

    isSyncing = true;
    notifyListeners();

    try {
      offlineCustomerSyncService.sweepUnsyncedOfflineCustomers();
      const queue = offlineCustomerSyncService.getQueue();
      if (queue.length === 0) {
        return { syncedCount: 0, errors: 0 };
      }

      console.info(`[OfflineCustomerSync] Starting background sync for ${queue.length} offline customer(s)...`);

      let syncedCount = 0;
      let errors = 0;

      const { customerService } = await import('./customerService');

      for (const item of queue) {
        // Stop if internet went away during sync
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          console.warn('[OfflineCustomerSync] Internet connection lost during sync. Pausing queue.');
          break;
        }

        try {
          const { tempId, customerData } = item;
          let realId: string = '';

          // 1. Check if a profile with this phone already exists in Firestore
          const hasPhone = Boolean(customerData.phone && customerData.phone.trim());
          if (hasPhone) {
            const remoteExisting = await customerService.findByPhone(customerData.phone);
            if (remoteExisting && !remoteExisting.id.startsWith('offline_')) {
              realId = remoteExisting.id;
              // Enrich existing remote profile
              const updates: Partial<Customer> = {};
              if (customerData.name && isMoreDescriptiveName(customerData.name, remoteExisting.name)) {
                updates.name = customerData.name.trim();
              }
              if (!remoteExisting.email && customerData.email?.trim()) {
                updates.email = customerData.email.trim();
              }
              if (!remoteExisting.shopName && customerData.shopName?.trim()) {
                updates.shopName = customerData.shopName.trim();
              }
              if (customerData.accountType === 'shop_repairer' && remoteExisting.accountType !== 'shop_repairer') {
                updates.accountType = 'shop_repairer';
              }
              const cleanDigits = normalizePhoneDigits(customerData.phone);
              if (!remoteExisting.normalizedPhone && cleanDigits) {
                updates.normalizedPhone = cleanDigits;
              }
              if (Object.keys(updates).length > 0) {
                await customerService.updateCustomer(remoteExisting.id, updates);
              }
            }
          }

          // 2. If not found on Firestore, create new remote document
          if (!realId) {
            const { id: _temp, ...dataToSave } = customerData;
            const cleanPhone = normalizePhoneDigits(dataToSave.phone || '');
            const newCustomerDoc = {
              ...dataToSave,
              phone: formatStandardPhone(dataToSave.phone || '') || dataToSave.phone || '',
              ...(cleanPhone ? { normalizedPhone: cleanPhone } : {}),
              syncedAt: new Date().toISOString(),
            };

            const docRef = await addDoc(collection(db, 'customers'), newCustomerDoc);
            realId = docRef.id;
          }

          // 3. Replace offline ID everywhere across tickets, sales, debts, and logs
          await offlineCustomerSyncService.replaceOfflineIdEverywhere(
            tempId,
            realId,
            { ...customerData, id: realId }
          );

          // 4. Remove from queue upon success
          offlineCustomerSyncService.removeFromQueue(tempId);
          syncedCount++;
        } catch (err: any) {
          console.error(`[OfflineCustomerSync] Error syncing offline customer ${item.tempId}:`, err);
          errors++;
          item.retryCount = (item.retryCount || 0) + 1;
          item.lastAttemptAt = new Date().toISOString();
          item.lastError = err?.message || 'Sync failed';
          offlineCustomerSyncService.saveQueue(queue);
        }
      }

      // 5. Notify staff with a quiet sync toast
      if (syncedCount > 0) {
        toast.info(
          'Cloud Sync Complete',
          `Synced ${syncedCount} offline customer profile${syncedCount > 1 ? 's' : ''} to cloud & linked pending tickets and sales.`
        );
      }

      return { syncedCount, errors };
    } finally {
      isSyncing = false;
      notifyListeners();
    }
  },

  /**
   * Initialize background sync listeners and periodic sync timer
   */
  init: (): (() => void) => {
    console.info('[OfflineCustomerSync] Initializing background sync service...');

    const handleOnline = () => {
      console.info('[OfflineCustomerSync] Network online detected. Triggering sync...');
      offlineCustomerSyncService.triggerDebouncedSync();
    };

    const handleFocus = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        if (offlineCustomerSyncService.getPendingCount() > 0) {
          offlineCustomerSyncService.triggerDebouncedSync();
        }
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleFocus);

    // Periodic 30-second heartbeat to ensure queue drain
    const intervalId = setInterval(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        if (offlineCustomerSyncService.getPendingCount() > 0) {
          offlineCustomerSyncService.syncPendingCustomers().catch(console.warn);
        }
      }
    }, 30000);

    // Run initial sweep & sync if online on mount
    offlineCustomerSyncService.sweepUnsyncedOfflineCustomers();
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      offlineCustomerSyncService.triggerDebouncedSync();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleFocus);
      clearInterval(intervalId);
      if (syncTimeout) clearTimeout(syncTimeout);
    };
  },
};
