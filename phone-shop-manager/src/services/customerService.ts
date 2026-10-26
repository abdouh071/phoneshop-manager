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
import { isPhoneMatch, normalizePhoneDigits, formatStandardPhone, getPhoneSearchVariants, isMoreDescriptiveName } from '../utils/phoneUtils';
import { offlineCustomerSyncService } from './offlineCustomerSyncService';

const COLLECTION = 'customers';
const LOCAL_STORAGE_KEY = 'offline_customers';

// In-flight concurrency lock to prevent parallel duplicate creations
const inFlightServiceCreations = new Map<string, Promise<Customer>>();

const docToCustomer = (id: string, data: Record<string, unknown>): Customer => {
  const rawPhone = (data.phone as string) || '';
  const cleanPhone = (data.normalizedPhone as string) || (rawPhone ? normalizePhoneDigits(rawPhone) : '');
  const formattedPhone = rawPhone ? formatStandardPhone(rawPhone) : '';

  return {
    ...(data as Omit<Customer, 'id'>),
    id,
    phone: formattedPhone || rawPhone,
    ...(cleanPhone ? { normalizedPhone: cleanPhone } : {}),
  };
};

const getLocalCustomers = (): Customer[] => {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed: Customer[] = JSON.parse(raw);
    return parsed.map(c => {
      const cleanPhone = c.normalizedPhone || (c.phone ? normalizePhoneDigits(c.phone) : '');
      const formattedPhone = c.phone ? formatStandardPhone(c.phone) : '';
      return {
        ...c,
        phone: formattedPhone || c.phone || '',
        ...(cleanPhone ? { normalizedPhone: cleanPhone } : {}),
      };
    });
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
    if (!phone || !phone.trim()) return undefined;

    // 1. Check local cache first with flexible matching
    const local = getLocalCustomers();
    const localMatch = local.find(c => isPhoneMatch(c.phone, phone) || (c.normalizedPhone && isPhoneMatch(c.normalizedPhone, phone)));
    if (localMatch) return localMatch;

    // 2. Query Firestore by normalizedPhone if possible
    const cleanDigits = normalizePhoneDigits(phone);
    if (cleanDigits && cleanDigits.length >= 7) {
      try {
        const qNorm = query(collection(db, COLLECTION), where('normalizedPhone', '==', cleanDigits));
        const snapNorm = await getDocs(qNorm);
        if (!snapNorm.empty) {
          const docItem = docToCustomer(snapNorm.docs[0].id, snapNorm.docs[0].data() as Record<string, unknown>);
          return docItem;
        }
      } catch (err) {
        console.warn('Firestore findByPhone normalized query failed:', err);
      }
    }

    // 3. Query Firestore by all potential formatted/unformatted variations using 'in' operator
    const variants = getPhoneSearchVariants(phone);
    if (variants.length > 0) {
      try {
        const qVariants = query(collection(db, COLLECTION), where('phone', 'in', variants.slice(0, 30)));
        const snapVariants = await getDocs(qVariants);
        if (!snapVariants.empty) {
          const docItem = docToCustomer(snapVariants.docs[0].id, snapVariants.docs[0].data() as Record<string, unknown>);
          return docItem;
        }
      } catch (err) {
        console.warn('Firestore findByPhone variants query failed:', err);
      }
    }

    return undefined;
  },

  addCustomer: async (
    customer: Omit<Customer, 'id' | 'totalPurchases' | 'totalSpent' | 'lastVisitDate' | 'joinDate'>
  ): Promise<Customer> => {
    const cleanPhone = customer.phone ? normalizePhoneDigits(customer.phone) : '';
    const hasValidPhone = cleanPhone.length >= 7;
    const lockKey = hasValidPhone && cleanPhone.length >= 8
      ? `phone_${cleanPhone.slice(-9)}`
      : (customer.name ? `name_${customer.name.trim().toLowerCase()}` : '');

    // Concurrency lock: If a creation with this phone line is already executing, await it
    if (lockKey && inFlightServiceCreations.has(lockKey)) {
      const existingInFlight = await inFlightServiceCreations.get(lockKey)!;
      if (customer.name && isMoreDescriptiveName(customer.name, existingInFlight.name)) {
        return await customerService.updateCustomer(existingInFlight.id, { name: customer.name.trim() });
      }
      return existingInFlight;
    }

    const runAdd = async (): Promise<Customer> => {
      // Pre-check: if a customer with this phone number already exists, enrich and return existing
      if (hasValidPhone) {
        const existing = await customerService.findByPhone(customer.phone);
        if (existing) {
          const updates: Partial<Customer> = {};
          if (customer.name && isMoreDescriptiveName(customer.name, existing.name)) {
            updates.name = customer.name.trim();
          }
          if (!existing.email && customer.email?.trim()) {
            updates.email = customer.email.trim();
          }
          if (!existing.shopName && customer.shopName?.trim()) {
            updates.shopName = customer.shopName.trim();
          }
          if (customer.accountType === 'shop_repairer' && existing.accountType !== 'shop_repairer') {
            updates.accountType = 'shop_repairer';
          }
          if (!existing.address && customer.address?.trim()) {
            updates.address = customer.address.trim();
          }
          if (!existing.rc && customer.rc?.trim()) {
            updates.rc = customer.rc.trim();
          }
          if (!existing.nif && customer.nif?.trim()) {
            updates.nif = customer.nif.trim();
          }
          if (!existing.nis && customer.nis?.trim()) {
            updates.nis = customer.nis.trim();
          }
          if (!existing.art && customer.art?.trim()) {
            updates.art = customer.art.trim();
          }
          if ((!existing.wholesaleDiscountPercent || existing.wholesaleDiscountPercent <= 0) && customer.wholesaleDiscountPercent && customer.wholesaleDiscountPercent > 0) {
            updates.wholesaleDiscountPercent = customer.wholesaleDiscountPercent;
          }
          if ((!existing.creditLimit || existing.creditLimit <= 0) && customer.creditLimit && customer.creditLimit > 0) {
            updates.creditLimit = customer.creditLimit;
          }
          if (customer.notes?.trim()) {
            const cleanNote = customer.notes.trim();
            if (!existing.notes || !existing.notes.trim()) {
              updates.notes = cleanNote;
            } else if (!existing.notes.includes(cleanNote)) {
              const today = new Date().toLocaleDateString('fr-DZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
              updates.notes = `${existing.notes.trim()}\n[${today}]: ${cleanNote}`;
            }
          }
          if (customer.registeredDevices && customer.registeredDevices.length > 0) {
            const currentDevs = existing.registeredDevices || [];
            const toAdd = customer.registeredDevices.filter(nd =>
              !currentDevs.some(ed => ed.brand.toLowerCase() === nd.brand.toLowerCase() && ed.model.toLowerCase() === nd.model.toLowerCase())
            );
            if (toAdd.length > 0) {
              updates.registeredDevices = [...toAdd, ...currentDevs];
            }
          }
          if (Object.keys(updates).length > 0) {
            return await customerService.updateCustomer(existing.id, updates);
          }
          return existing;
        }
      }

      const now = new Date().toISOString();
      const formattedPhone = customer.phone ? formatStandardPhone(customer.phone) : '';
      const newCustomer = {
        ...customer,
        phone: formattedPhone || customer.phone || '',
        ...(cleanPhone ? { normalizedPhone: cleanPhone } : {}),
        totalPurchases: 0,
        totalSpent: 0,
        joinDate: now,
        lastVisitDate: now,
      };

      const local = getLocalCustomers();

      // If offline, store locally immediately and enqueue into persistent background sync queue
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        console.warn('[CustomerService] Device is offline. Storing customer locally and enqueuing for background sync.');
        const offlineId = `offline_cust_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const created = { ...newCustomer, id: offlineId };
        saveLocalCustomers([...local, created]);
        offlineCustomerSyncService.enqueue(created);
        return created;
      }

      try {
        const docRef = await addDoc(collection(db, COLLECTION), newCustomer);
        const created = { ...newCustomer, id: docRef.id };
        saveLocalCustomers([...local.filter(c => c.id !== created.id), created]);
        return created;
      } catch (err) {
        console.warn('Failed to add customer to Firestore, saving locally & enqueuing for sync:', err);
        const offlineId = `offline_cust_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const created = { ...newCustomer, id: offlineId };
        saveLocalCustomers([...local, created]);
        offlineCustomerSyncService.enqueue(created);
        return created;
      }
    };

    if (!lockKey) {
      return await runAdd();
    }

    const promise = runAdd();
    inFlightServiceCreations.set(lockKey, promise);
    try {
      return await promise;
    } finally {
      inFlightServiceCreations.delete(lockKey);
    }
  },

  updateCustomer: async (id: string, updates: Partial<Customer>): Promise<Customer> => {
    const sanitizedUpdates: Partial<Customer> = { ...updates };
    if (updates.phone !== undefined) {
      const cleanPhone = normalizePhoneDigits(updates.phone);
      sanitizedUpdates.phone = formatStandardPhone(updates.phone) || updates.phone;
      if (cleanPhone) {
        sanitizedUpdates.normalizedPhone = cleanPhone;
      }
    }

    const local = getLocalCustomers();
    const existing = local.find(c => c.id === id);
    const merged = { ...(existing || ({} as Customer)), ...sanitizedUpdates, id };
    saveLocalCustomers(local.map(c => c.id === id ? merged : c));

    if (id.startsWith('offline_')) {
      offlineCustomerSyncService.updateQueuedCustomer(id, sanitizedUpdates);
    }

    try {
      const ref = doc(db, COLLECTION, id);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const serverMerged = { ...(snap.data() as Omit<Customer, 'id'>), ...sanitizedUpdates };
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
    if (id.startsWith('offline_')) {
      offlineCustomerSyncService.removeFromQueue(id);
    }

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
