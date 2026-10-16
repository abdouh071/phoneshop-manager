import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Customer } from '../types';

const COLLECTION = 'customers';
const LOCAL_STORAGE_KEY = 'offline_customers';

const docToCustomer = (id: string, data: Record<string, unknown>): Customer => ({
  ...(data as Omit<Customer, 'id'>),
  id,
});

const getLocalCustomers = (): Customer[] => {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveLocalCustomers = (customers: Customer[]) => {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(customers));
  } catch (err) {
    console.error('Failed to save customers to local storage', err);
  }
};

export const customerService = {
  getAll: async (): Promise<Customer[]> => {
    try {
      const q = query(collection(db, COLLECTION), orderBy('name'));
      const snap = await getDocs(q);
      const items = snap.docs.map(d => docToCustomer(d.id, d.data() as Record<string, unknown>));
      
      const local = getLocalCustomers();
      const serverIds = new Set(items.map(i => i.id));
      const pendingLocal = local.filter(l => !serverIds.has(l.id) && l.id.startsWith('offline_'));
      const merged = [...pendingLocal, ...items].sort((a, b) => a.name.localeCompare(b.name));
      saveLocalCustomers(merged);
      return merged;
    } catch (err) {
      console.warn('Firestore customers fetch failed, using local cache:', err);
      return getLocalCustomers();
    }
  },

  findByPhone: async (phone: string): Promise<Customer | undefined> => {
    try {
      const q = query(collection(db, COLLECTION), where('phone', '==', phone));
      const snap = await getDocs(q);
      if (!snap.empty) {
        return docToCustomer(snap.docs[0].id, snap.docs[0].data() as Record<string, unknown>);
      }
    } catch (err) {
      console.warn('Firestore findByPhone failed, checking local cache:', err);
    }
    const clean = phone.replace(/\D/g, '');
    return getLocalCustomers().find(c => c.phone && c.phone.replace(/\D/g, '') === clean);
  },

  addCustomer: async (
    customer: Omit<Customer, 'id' | 'totalPurchases' | 'totalSpent' | 'lastVisitDate' | 'joinDate'>
  ): Promise<Customer> => {
    const now = new Date().toISOString();
    const newCustomer = {
      ...customer,
      totalPurchases: 0,
      totalSpent: 0,
      joinDate: now,
      lastVisitDate: now,
    };

    const local = getLocalCustomers();

    try {
      const docRef = await addDoc(collection(db, COLLECTION), newCustomer);
      const created = { ...newCustomer, id: docRef.id };
      saveLocalCustomers([...local.filter(c => c.id !== created.id), created]);
      return created;
    } catch (err) {
      console.warn('Failed to add customer to Firestore, saving locally:', err);
      const offlineId = `offline_cust_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const created = { ...newCustomer, id: offlineId };
      saveLocalCustomers([...local, created]);
      return created;
    }
  },

  updateCustomer: async (id: string, updates: Partial<Customer>): Promise<Customer> => {
    const local = getLocalCustomers();
    const existing = local.find(c => c.id === id);
    const merged = { ...(existing || ({} as Customer)), ...updates, id };
    saveLocalCustomers(local.map(c => c.id === id ? merged : c));

    try {
      const ref = doc(db, COLLECTION, id);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const serverMerged = { ...(snap.data() as Omit<Customer, 'id'>), ...updates };
        await updateDoc(ref, serverMerged);
        const finalCustomer = { ...serverMerged, id };
        saveLocalCustomers(local.map(c => c.id === id ? finalCustomer : c));
        return finalCustomer;
      }
    } catch (err) {
      console.warn('Failed to update customer on Firestore, stored locally:', err);
    }

    return merged;
  },

  deleteCustomer: async (id: string): Promise<void> => {
    try {
      const ref = doc(db, COLLECTION, id);
      await deleteDoc(ref);
    } catch (err) {
      console.warn('Failed to delete customer on Firestore, removing locally:', err);
    }
    const local = getLocalCustomers();
    saveLocalCustomers(local.filter(c => c.id !== id));
  },
};
