import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { CustomerActivityLog } from '../types';

const COLLECTION = 'customer_activity_logs';
const LOCAL_STORAGE_KEY = 'offline_customer_activity_logs';

const getLocalLogs = (): CustomerActivityLog[] => {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveLocalLogs = (logs: CustomerActivityLog[]) => {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(logs));
  } catch (err) {
    console.error('Failed to save customer logs to local storage', err);
  }
};

export const customerLogService = {
  /**
   * Fetch all logs for a specific customer, newest first.
   */
  getByCustomerId: async (customerId: string): Promise<CustomerActivityLog[]> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return getLocalLogs()
        .filter(l => l.customerId === customerId)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    try {
      const q = query(
        collection(db, COLLECTION),
        where('customerId', '==', customerId),
        orderBy('date', 'desc'),
        limit(150)
      );
      const snap = await getDocs(q);
      const items = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
      })) as CustomerActivityLog[];

      // Sync local cache
      const local = getLocalLogs().filter(l => l.customerId !== customerId);
      saveLocalLogs([...items, ...local]);

      return items;
    } catch (err) {
      console.warn('Firestore customer logs fetch failed, using local cache:', err);
      return getLocalLogs()
        .filter(l => l.customerId === customerId)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
  },

  /**
   * Fetch all customer activity logs across all customers (latest 300).
   */
  getAll: async (): Promise<CustomerActivityLog[]> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return getLocalLogs().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    try {
      const q = query(
        collection(db, COLLECTION),
        orderBy('date', 'desc'),
        limit(300)
      );
      const snap = await getDocs(q);
      const items = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
      })) as CustomerActivityLog[];
      saveLocalLogs(items);
      return items;
    } catch (err) {
      console.warn('Firestore customer logs fetch failed, using local cache:', err);
      return getLocalLogs().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
  },

  /**
   * Append a new audit event to a customer's record.
   */
  log: async (
    entry: Omit<CustomerActivityLog, 'id' | 'date'> & { date?: string }
  ): Promise<CustomerActivityLog> => {
    const date = entry.date || new Date().toISOString();
    const cleanEntry: Omit<CustomerActivityLog, 'id'> = {
      ...entry,
      date,
      createdAt: date,
      metadata: entry.metadata || {},
    };

    // If offline, store locally with offline_ prefix so unifiedOfflineSyncService catches and syncs it
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const offlineId = `offline_log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const created: CustomerActivityLog = { id: offlineId, ...cleanEntry };
      const local = getLocalLogs();
      saveLocalLogs([created, ...local]);
      return created;
    }

    let id = `offline_log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    try {
      const docRef = await addDoc(collection(db, COLLECTION), cleanEntry);
      id = docRef.id;
    } catch (err) {
      console.warn('Firestore customer log save failed, saved locally only:', err);
    }

    const created: CustomerActivityLog = {
      id,
      ...cleanEntry,
    };

    const local = getLocalLogs();
    saveLocalLogs([created, ...local]);

    return created;
  },

  /**
   * Reassign logs from one customer ID to another (e.g. after offline customer sync or profile merge)
   */
  reassignLogsForCustomer: async (
    primaryId: string,
    secondaryId: string,
    customerName?: string
  ): Promise<number> => {
    // 1. Update local cache
    const local = getLocalLogs();
    saveLocalLogs(
      local.map(l =>
        l.customerId === secondaryId
          ? { ...l, customerId: primaryId, ...(customerName ? { customerName } : {}) }
          : l
      )
    );

    // 2. Update Firestore if online
    try {
      const q = query(
        collection(db, COLLECTION),
        where('customerId', '==', secondaryId)
      );
      const snap = await getDocs(q);
      if (snap.empty) return 0;

      const docs = snap.docs;
      let count = 0;
      for (let i = 0; i < docs.length; i += 450) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + 450);
        for (const logDoc of chunk) {
          batch.update(logDoc.ref, {
            customerId: primaryId,
            ...(customerName ? { customerName } : {}),
          });
          count++;
        }
        await batch.commit();
      }
      return count;
    } catch (err) {
      console.warn('Failed to reassign customer logs in Firestore:', err);
      return 0;
    }
  },
};
