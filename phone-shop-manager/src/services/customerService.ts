import { collection, doc, getDocs, addDoc, setDoc, deleteDoc, query, where, orderBy, runTransaction } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Customer, CustomerActivityLog } from '../types';
import { isPhoneMatch, normalizePhoneDigits, formatStandardPhone, getPhoneSearchVariants, isMoreDescriptiveName } from '../utils/phoneUtils';
import { extractBaseValues, findConflictingField } from '../utils/conflictCheck';
import { offlineCustomerSyncService } from './offlineCustomerSyncService';
import { offlineQueue, UnrecoverableSyncActionError } from './offlineQueue';

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
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return getLocalCustomers();
    }

    try {
      const q = query(collection(db, COLLECTION), orderBy('name'));
      const snapPromise = getDocs(q);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore customers fetch timeout')), 2500)
      );
      const snap = await Promise.race([snapPromise, timeoutPromise]);
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

    // If offline, never touch Firestore — return undefined immediately
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return undefined;
    }

    // 2. Query Firestore by normalizedPhone if possible with timeout
    const cleanDigits = normalizePhoneDigits(phone);
    if (cleanDigits && cleanDigits.length >= 7) {
      try {
        const qNorm = query(collection(db, COLLECTION), where('normalizedPhone', '==', cleanDigits));
        const snapPromise = getDocs(qNorm);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Firestore findByPhone timeout')), 2000)
        );
        const snapNorm = await Promise.race([snapPromise, timeoutPromise]);
        if (!snapNorm.empty) {
          const docItem = docToCustomer(snapNorm.docs[0].id, snapNorm.docs[0].data() as Record<string, unknown>);
          return docItem;
        }
      } catch (err) {
        console.warn('Firestore findByPhone normalized query failed:', err);
      }
    }

    // 3. Query Firestore by all potential formatted/unformatted variations using 'in' operator with timeout
    const variants = getPhoneSearchVariants(phone);
    if (variants.length > 0) {
      try {
        const qVariants = query(collection(db, COLLECTION), where('phone', 'in', variants.slice(0, 30)));
        const snapPromise = getDocs(qVariants);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Firestore findByPhone variants timeout')), 2000)
        );
        const snapVariants = await Promise.race([snapPromise, timeoutPromise]);
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
      const local = getLocalCustomers();

      // If offline, store locally immediately and enqueue into persistent background sync queue with zero remote delay
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (hasValidPhone) {
          const localExisting = local.find(c => isPhoneMatch(c.phone, customer.phone));
          if (localExisting) {
            return localExisting;
          }
        }
        console.warn('[CustomerService] Device is offline. Storing customer locally and enqueuing for background sync.');
        const offlineId = `offline_cust_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
        const now = new Date().toISOString();
        const formattedPhone = customer.phone ? formatStandardPhone(customer.phone) : '';
        const created: Customer = {
          ...customer,
          id: offlineId,
          phone: formattedPhone || customer.phone || '',
          ...(cleanPhone ? { normalizedPhone: cleanPhone } : {}),
          totalPurchases: 0,
          totalSpent: 0,
          joinDate: now,
          lastVisitDate: now,
        };
        saveLocalCustomers([...local, created]);
        offlineCustomerSyncService.enqueue(created);
        return created;
      }

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

      try {
        const addDocPromise = addDoc(collection(db, COLLECTION), newCustomer);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Firestore addDoc timeout')), 2500)
        );
        const docRef = await Promise.race([addDocPromise, timeoutPromise]);
        const created = { ...newCustomer, id: docRef.id };
        saveLocalCustomers([...local.filter(c => c.id !== created.id), created]);
        return created;
      } catch (err) {
        console.warn('Failed to add customer to Firestore, saving locally & enqueuing for sync:', err);
        const offlineId = `offline_cust_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
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

  changeStoreCredit: async (
    customerId: string,
    delta: number,
    operationId: string,
    audit: Pick<CustomerActivityLog, 'actionDescription' | 'actorId' | 'actorName' | 'actorRole'>
  ): Promise<{ balance: number; log: CustomerActivityLog }> => {
    if (!Number.isFinite(delta) || delta === 0 || !operationId.trim()) {
      throw new Error('A credit movement needs a nonzero amount and a stable operation ID.');
    }
    if (customerId.startsWith('offline_') || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      throw new Error('Connect to the server before issuing or spending store credit.');
    }
    const signedCents = Math.round(delta * 100);
    if (!Number.isSafeInteger(signedCents) || signedCents === 0) throw new Error('Invalid store credit amount.');
    const logId = `credit_${encodeURIComponent(operationId)}`;
    const result = await runTransaction(db, async tx => {
      const customerRef = doc(db, COLLECTION, customerId);
      const logRef = doc(db, 'customer_activity_logs', logId);
      const customerSnap = await tx.get(customerRef);
      const logSnap = await tx.get(logRef);
      if (!customerSnap.exists()) throw new Error('Customer not found.');
      const customer = customerSnap.data() as Customer;
      if (customer.mergedIntoId) throw new Error('Select the active customer account manually.');
      const currentCents = Math.round((customer.storeCredit ?? 0) * 100);
      if (!Number.isSafeInteger(currentCents) || currentCents < 0) throw new Error('Invalid store credit balance.');
      if (logSnap.exists()) {
        const log = { ...logSnap.data(), id: logId } as CustomerActivityLog;
        if (log.metadata?.operationCustomerId !== customerId || log.metadata?.signedCents !== signedCents) {
          throw new Error('This credit operation ID already names a different movement.');
        }
        return { balance: currentCents / 100, log };
      }
      const nextCents = currentCents + signedCents;
      if (nextCents < 0) throw new Error('INSUFFICIENT_STORE_CREDIT');
      if (!Number.isSafeInteger(nextCents)) throw new Error('Invalid store credit balance.');
      const balance = nextCents / 100;
      const date = new Date().toISOString();
      const log: CustomerActivityLog = JSON.parse(JSON.stringify({
        ...audit,
        id: logId,
        customerId,
        customerName: customer.name,
        actionType: delta > 0 ? 'store_credit_issued' : 'store_credit_used',
        actionTitle: delta > 0 ? 'Store Credit (Avoir) Issued' : 'Store Credit (Avoir) Redeemed',
        date,
        createdAt: date,
        idempotencyKey: operationId,
        metadata: { operationCustomerId: customerId, signedCents, amount: Math.abs(signedCents) / 100, newCredit: balance },
      }));
      tx.update(customerRef, { storeCredit: balance });
      // The immutable audit row is also the receipt that makes a retry safe.
      tx.set(logRef, log);
      return { balance, log };
    });
    saveLocalCustomers(getLocalCustomers().map(customer => customer.id === customerId
      ? { ...customer, storeCredit: result.balance } : customer));
    return result;
  },

  updateCustomer: async (
    id: string,
    updates: Partial<Customer>,
    options?: { operationId?: string }
  ): Promise<Customer> => {
    const now = new Date().toISOString();
    const sanitizedUpdates: Partial<Customer> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) {
        (sanitizedUpdates as Record<string, unknown>)[k] = v;
      }
    }
    if (updates.phone !== undefined) {
      const cleanPhone = normalizePhoneDigits(updates.phone);
      sanitizedUpdates.phone = formatStandardPhone(updates.phone) || updates.phone;
      if (cleanPhone) {
        sanitizedUpdates.normalizedPhone = cleanPhone;
      }
    }
    sanitizedUpdates.updatedAt = sanitizedUpdates.updatedAt || now;

    const local = getLocalCustomers();
    const existing = local.find(c => c.id === id);
    const baseValues = extractBaseValues(
      existing as unknown as Record<string, unknown> | undefined,
      sanitizedUpdates as unknown as Record<string, unknown>
    );

    const merged = { ...(existing || ({} as Customer)), ...sanitizedUpdates, id };
    saveLocalCustomers(local.map(c => c.id === id ? merged : c));

    if (id.startsWith('offline_')) {
      offlineCustomerSyncService.updateQueuedCustomer(id, sanitizedUpdates);
      return merged;
    }

    const operationId = options?.operationId || `cust_upd_${id}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const enqueuePatch = () =>
      offlineQueue.enqueue({
        type: 'UPDATE_CUSTOMER',
        payload: {
          id,
          updates: sanitizedUpdates,
          ...(baseValues ? { baseValues } : {}),
          ...(existing?.updatedAt ? { baseUpdatedAt: existing.updatedAt } : {}),
          operationId,
        },
      });

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await enqueuePatch();
      return merged;
    }

    try {
      const ref = doc(db, COLLECTION, id);
      const updatePromise = setDoc(ref, sanitizedUpdates, { merge: true });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore updateDoc customer timeout')), 1200)
      );
      await Promise.race([updatePromise, timeoutPromise]);
      return merged;
    } catch (err) {
      console.warn('Failed to update customer on Firestore, queued patch locally:', err);
      await enqueuePatch();
    }

    return merged;
  },

  replayQueuedUpdate: async (payload: {
    id: string;
    updates: Partial<Customer>;
    baseValues?: Record<string, unknown>;
    baseUpdatedAt?: string;
    operationId?: string;
  }): Promise<Customer> => {
    const cleanPatch: Partial<Customer> = {};
    for (const [k, v] of Object.entries(payload.updates || {})) {
      if (v !== undefined) (cleanPatch as Record<string, unknown>)[k] = v;
    }
    const result = await runTransaction(db, async tx => {
      const custRef = doc(db, COLLECTION, payload.id);
      const receiptRef = payload.operationId
        ? doc(db, 'operation_receipts', `cust_upd_${encodeURIComponent(payload.operationId)}`)
        : null;
      const custSnap = await tx.get(custRef);
      const receiptSnap = receiptRef ? await tx.get(receiptRef) : null;
      if (!custSnap.exists()) {
        throw new UnrecoverableSyncActionError(`Customer ${payload.id} no longer exists on the server.`);
      }
      const server = docToCustomer(custSnap.id, custSnap.data() as Record<string, unknown>);
      if (server.mergedIntoId) {
        throw new UnrecoverableSyncActionError('Customer profile was merged on another device. Review before updating.');
      }
      if (receiptSnap?.exists()) {
        return server;
      }

      const conflictKey = findConflictingField(
        server as unknown as Record<string, unknown>,
        cleanPatch as unknown as Record<string, unknown>,
        payload.baseValues
      );
      if (conflictKey) {
        throw new UnrecoverableSyncActionError(
          `Customer field "${conflictKey}" changed on another device while offline. Review before overwriting.`
        );
      }

      tx.set(custRef, cleanPatch, { merge: true });
      if (receiptRef) {
        tx.set(receiptRef, {
          kind: 'customer_update',
          customerId: payload.id,
          operationId: payload.operationId,
          updatedAt: cleanPatch.updatedAt || new Date().toISOString(),
        });
      }
      return { ...server, ...cleanPatch, id: payload.id } as Customer;
    });

    const local = getLocalCustomers();
    saveLocalCustomers(local.some(c => c.id === payload.id) ? local.map(c => (c.id === payload.id ? result : c)) : [result, ...local]);
    return result;
  },

  deleteCustomer: async (id: string): Promise<void> => {
    if (id.startsWith('offline_')) {
      offlineCustomerSyncService.removeFromQueue(id);
    }
    const local = getLocalCustomers();
    saveLocalCustomers(local.filter(c => c.id !== id));

    if (id.startsWith('offline_') || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return;
    }

    try {
      const ref = doc(db, COLLECTION, id);
      const delPromise = deleteDoc(ref);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore deleteDoc customer timeout')), 1200)
      );
      await Promise.race([delPromise, timeoutPromise]);
    } catch (err) {
      console.warn('Failed to delete customer on Firestore, removing locally:', err);
    }
  },
};
