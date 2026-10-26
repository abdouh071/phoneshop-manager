import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  getDocs,
  query,
  limit,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { RepairTicket, SaleTransaction, RepairStatus, CustomerDebtEntry } from '../types';

const STORAGE_KEYS = {
  OFFLINE_TICKETS: '@offline_tickets',
  OFFLINE_SALES: '@offline_sales',
  OFFLINE_STATUS_UPDATES: '@offline_status_updates',
  OFFLINE_DEBTS: '@offline_debts',
  OFFLINE_REMARKS: '@offline_remarks',
  OFFLINE_PARTS: '@offline_parts',
  CACHED_TICKETS: '@cached_tickets',
  CACHED_PRODUCTS: '@cached_products',
};

export interface OfflineStatusAction {
  id: string;
  ticketId: string;
  status: RepairStatus;
  changerName?: string;
  additionalUpdates?: any;
  timestamp: string;
}

type SyncListener = (pendingCount: number, isSyncing: boolean) => void;
const listeners = new Set<SyncListener>();
let isSyncing = false;

function notifyListeners(pendingCount: number, syncing: boolean) {
  listeners.forEach(fn => {
    try {
      fn(pendingCount, syncing);
    } catch (e) {
      console.warn('[OfflineSync] Listener error:', e);
    }
  });
}

async function getStoredList<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function setStoredList<T>(key: string, list: T[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(list));
  } catch (e) {
    console.error(`[OfflineSync] Failed to persist ${key}:`, e);
  }
}

export const offlineSyncService = {
  /**
   * Subscribe to pending sync count and syncing state
   */
  subscribe: (listener: SyncListener): (() => void) => {
    listeners.add(listener);
    offlineSyncService.getPendingCount().then(c => listener(c, isSyncing));
    return () => {
      listeners.delete(listener);
    };
  },

  /**
   * Calculate total pending items across all offline queues
   */
  getPendingCount: async (): Promise<number> => {
    try {
      const [tickets, sales, statuses, debts, remarks, parts] = await Promise.all([
        getStoredList<RepairTicket>(STORAGE_KEYS.OFFLINE_TICKETS),
        getStoredList<SaleTransaction>(STORAGE_KEYS.OFFLINE_SALES),
        getStoredList<OfflineStatusAction>(STORAGE_KEYS.OFFLINE_STATUS_UPDATES),
        getStoredList<CustomerDebtEntry>(STORAGE_KEYS.OFFLINE_DEBTS),
        getStoredList<any>(STORAGE_KEYS.OFFLINE_REMARKS),
        getStoredList<any>(STORAGE_KEYS.OFFLINE_PARTS),
      ]);
      return tickets.length + sales.length + statuses.length + debts.length + remarks.length + parts.length;
    } catch {
      return 0;
    }
  },

  /**
   * Enqueue a new ticket created offline
   */
  saveOfflineTicket: async (ticket: RepairTicket): Promise<void> => {
    const list = await getStoredList<RepairTicket>(STORAGE_KEYS.OFFLINE_TICKETS);
    list.unshift(ticket);
    await setStoredList(STORAGE_KEYS.OFFLINE_TICKETS, list);

    // Also update cached tickets so user immediately sees it on screen
    const cached = await getStoredList<RepairTicket>(STORAGE_KEYS.CACHED_TICKETS);
    await setStoredList(STORAGE_KEYS.CACHED_TICKETS, [ticket, ...cached]);

    const count = await offlineSyncService.getPendingCount();
    notifyListeners(count, isSyncing);
  },

  /**
   * Enqueue a POS sale completed offline
   */
  saveOfflineSale: async (sale: SaleTransaction): Promise<void> => {
    const list = await getStoredList<SaleTransaction>(STORAGE_KEYS.OFFLINE_SALES);
    list.unshift(sale);
    await setStoredList(STORAGE_KEYS.OFFLINE_SALES, list);

    const count = await offlineSyncService.getPendingCount();
    notifyListeners(count, isSyncing);
  },

  /**
   * Enqueue a customer debt record created offline
   */
  saveOfflineDebt: async (debt: CustomerDebtEntry): Promise<void> => {
    const list = await getStoredList<CustomerDebtEntry>(STORAGE_KEYS.OFFLINE_DEBTS);
    list.unshift(debt);
    await setStoredList(STORAGE_KEYS.OFFLINE_DEBTS, list);

    const count = await offlineSyncService.getPendingCount();
    notifyListeners(count, isSyncing);
  },

  /**
   * Enqueue a status update made offline
   */
  saveOfflineStatusUpdate: async (
    ticketId: string,
    status: RepairStatus,
    changerName?: string,
    additionalUpdates?: any
  ): Promise<void> => {
    const list = await getStoredList<OfflineStatusAction>(STORAGE_KEYS.OFFLINE_STATUS_UPDATES);
    list.push({
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ticketId,
      status,
      changerName,
      additionalUpdates,
      timestamp: new Date().toISOString(),
    });
    await setStoredList(STORAGE_KEYS.OFFLINE_STATUS_UPDATES, list);

    const count = await offlineSyncService.getPendingCount();
    notifyListeners(count, isSyncing);
  },

  /**
   * Cache tickets from Firestore for immediate offline viewing
   */
  setCachedTickets: async (tickets: RepairTicket[]): Promise<void> => {
    await setStoredList(STORAGE_KEYS.CACHED_TICKETS, tickets);
  },

  /**
   * Get cached tickets from storage
   */
  getCachedTickets: async (): Promise<RepairTicket[]> => {
    return getStoredList<RepairTicket>(STORAGE_KEYS.CACHED_TICKETS);
  },

  /**
   * Cache inventory products for offline POS
   */
  setCachedProducts: async (products: any[]): Promise<void> => {
    await setStoredList(STORAGE_KEYS.CACHED_PRODUCTS, products);
  },

  /**
   * Get cached inventory products
   */
  getCachedProducts: async (): Promise<any[]> => {
    return getStoredList<any>(STORAGE_KEYS.CACHED_PRODUCTS);
  },

  /**
   * Master sync runner: checks connection and flushes all offline queues to Firestore
   */
  syncAll: async (): Promise<{ syncedCount: number; errors: boolean }> => {
    if (isSyncing) return { syncedCount: 0, errors: false };

    // 1. Check internet connectivity with a quick lightweight probe
    try {
      const probeQuery = query(collection(db, 'repairs'), limit(1));
      await getDocs(probeQuery);
    } catch (e: any) {
      // Still offline or connection timed out
      return { syncedCount: 0, errors: false };
    }

    const initialPending = await offlineSyncService.getPendingCount();
    if (initialPending === 0) return { syncedCount: 0, errors: false };

    isSyncing = true;
    notifyListeners(initialPending, true);

    let syncedCount = 0;
    let hasErrors = false;

    try {
      console.log(`[OfflineSync] Reconnected! Flushing ${initialPending} pending offline item(s)...`);

      // ─── 1. Flush Offline Tickets ──────────────────────────────────────────
      const pendingTickets = await getStoredList<RepairTicket>(STORAGE_KEYS.OFFLINE_TICKETS);
      if (pendingTickets.length > 0) {
        const remainingTickets: RepairTicket[] = [];
        for (const ticket of pendingTickets) {
          try {
            const { id: oldTempId, ...ticketData } = ticket;
            const docRef = await addDoc(collection(db, 'repairs'), {
              ...ticketData,
              syncedAt: new Date().toISOString(),
            });
            syncedCount++;

            // Update cached tickets with the real Firestore ID
            const cached = await getStoredList<RepairTicket>(STORAGE_KEYS.CACHED_TICKETS);
            const updatedCached = cached.map(t => (t.id === oldTempId ? { ...t, id: docRef.id } : t));
            await setStoredList(STORAGE_KEYS.CACHED_TICKETS, updatedCached);
          } catch (tErr) {
            console.error('[OfflineSync] Failed to upload ticket:', tErr);
            remainingTickets.push(ticket);
            hasErrors = true;
          }
        }
        await setStoredList(STORAGE_KEYS.OFFLINE_TICKETS, remainingTickets);
      }

      // ─── 2. Flush Offline POS Sales ────────────────────────────────────────
      const pendingSales = await getStoredList<SaleTransaction>(STORAGE_KEYS.OFFLINE_SALES);
      if (pendingSales.length > 0) {
        const remainingSales: SaleTransaction[] = [];
        for (const sale of pendingSales) {
          try {
            const { id: _, ...saleData } = sale;
            await addDoc(collection(db, 'transactions'), {
              ...saleData,
              syncedAt: new Date().toISOString(),
            });
            syncedCount++;
          } catch (sErr) {
            console.error('[OfflineSync] Failed to upload sale transaction:', sErr);
            remainingSales.push(sale);
            hasErrors = true;
          }
        }
        await setStoredList(STORAGE_KEYS.OFFLINE_SALES, remainingSales);
      }

      // ─── 3. Flush Offline Status Updates ──────────────────────────────────
      const pendingStatuses = await getStoredList<OfflineStatusAction>(STORAGE_KEYS.OFFLINE_STATUS_UPDATES);
      if (pendingStatuses.length > 0) {
        const remainingStatuses: OfflineStatusAction[] = [];
        for (const act of pendingStatuses) {
          try {
            const docRef = doc(db, 'repairs', act.ticketId);
            const updatePayload: any = {
              status: act.status,
              updatedAt: act.timestamp,
              ...(act.additionalUpdates || {}),
            };
            await updateDoc(docRef, updatePayload);
            syncedCount++;
          } catch (uErr) {
            console.error('[OfflineSync] Failed to apply offline status update:', uErr);
            remainingStatuses.push(act);
            hasErrors = true;
          }
        }
        await setStoredList(STORAGE_KEYS.OFFLINE_STATUS_UPDATES, remainingStatuses);
      }

      // ─── 4. Flush Offline Customer Debts ──────────────────────────────────
      const pendingDebts = await getStoredList<CustomerDebtEntry>(STORAGE_KEYS.OFFLINE_DEBTS);
      if (pendingDebts.length > 0) {
        const remainingDebts: CustomerDebtEntry[] = [];
        for (const debt of pendingDebts) {
          try {
            const { id: _, ...dataToSave } = debt;
            await addDoc(collection(db, 'customer_debts'), dataToSave);
            syncedCount++;
          } catch (dErr) {
            console.error('[OfflineSync] Failed to upload customer debt:', dErr);
            remainingDebts.push(debt);
            hasErrors = true;
          }
        }
        await setStoredList(STORAGE_KEYS.OFFLINE_DEBTS, remainingDebts);
      }

      console.log(`[OfflineSync] Sync complete. Successfully sent ${syncedCount} item(s) to Firestore.`);
      return { syncedCount, errors: hasErrors };
    } finally {
      isSyncing = false;
      const remainingCount = await offlineSyncService.getPendingCount();
      notifyListeners(remainingCount, false);
    }
  },

  /**
   * Start background sync heartbeat
   */
  init: (): (() => void) => {
    // Initial check
    offlineSyncService.syncAll().catch(console.warn);

    // Periodic 15-second heartbeat
    const intervalId = setInterval(() => {
      offlineSyncService.syncAll().catch(console.warn);
    }, 15000);

    return () => {
      clearInterval(intervalId);
    };
  },
};
