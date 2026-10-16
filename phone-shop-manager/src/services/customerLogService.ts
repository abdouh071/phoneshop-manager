import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
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

    let id = `local_log_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
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
};
