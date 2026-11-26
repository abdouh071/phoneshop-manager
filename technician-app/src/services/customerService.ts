import {
  collection,
  doc,
  getDocs,
  addDoc,
  increment,
  runTransaction,
  updateDoc,
  query,
  where,
  limit,
  type DocumentReference,
  type Transaction,
} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../lib/firebase';
import { isOfflineCustomerId, replaceCachedCustomer, saleProfileDeltas } from './offlineQueuePolicy';
import { runStoreCreditShiftTx, type FirestoreTxOps, type TxRef } from './stockTransactionCore';
import { isRealPhone, isSamePhone } from '../utils/phone';
import type { Customer } from '../types';

const toTxOps = (tx: Transaction): FirestoreTxOps => ({
  doc: (col, id) => doc(db, col, id) as unknown as TxRef,
  get: async (ref) => {
    const snap = await tx.get(ref as unknown as DocumentReference);
    return {
      exists: () => snap.exists(),
      data: () => snap.data() as Record<string, unknown> | undefined,
    };
  },
  update: (ref, data) => tx.update(ref as unknown as DocumentReference, data),
  set: (ref, data) => tx.set(ref as unknown as DocumentReference, data),
});

const CACHED_CUSTOMERS_KEY = '@cached_customers';

export const customerService = {
  /**
   * Cache customers locally in AsyncStorage
   */
  cacheCustomers: async (customers: Customer[]): Promise<void> => {
    try {
      await AsyncStorage.setItem(CACHED_CUSTOMERS_KEY, JSON.stringify(customers));
    } catch (e) {
      console.warn('[CustomerService] Failed to cache customers:', e);
    }
  },

  /**
   * Get cached customers from AsyncStorage
   */
  getCachedCustomers: async (): Promise<Customer[]> => {
    try {
      const raw = await AsyncStorage.getItem(CACHED_CUSTOMERS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  /**
   * Give an `offline_cust_…` id its real document.
   *
   * The temp id exists only in this phone's cache, so a sale or a debt row that
   * references it would point at a customer the server never had. Uploads the cached
   * row and returns the server id it got; null when the row is gone or the server is
   * unreachable, in which case the caller must retry instead of writing the reference.
   */
  resolveOfflineCustomer: async (offlineId: string): Promise<string | null> => {
    if (!isOfflineCustomerId(offlineId)) return offlineId;
    const cached = await customerService.getCachedCustomers();
    const local = cached.find(c => c.id === offlineId);
    if (!local) {
      console.warn(`[CustomerService] No cached row for ${offlineId}; it cannot be resolved.`);
      return null;
    }
    try {
      const { id: _drop, ...data } = local;
      // A crash between the upload and the cache remap used to upload the same
      // person again on the retry — two accounts, one client. The phone line is
      // the identity key: if the profile already landed, adopt it instead of
      // minting a second account.
      const alreadyUploaded = data.phone ? await customerService.findByPhone(data.phone) : null;
      if (alreadyUploaded) {
        await customerService.cacheCustomers(replaceCachedCustomer(cached, offlineId, alreadyUploaded.id));
        return alreadyUploaded.id;
      }
      const docRef = await addDoc(collection(db, 'customers'), data);
      await customerService.cacheCustomers(replaceCachedCustomer(cached, offlineId, docRef.id));
      return docRef.id;
    } catch (err) {
      console.warn('[CustomerService] Offline customer could not be uploaded:', err);
      return null;
    }
  },

  /**
   * Fetch all customers (from Firestore or local cache)
   */
  getAll: async (): Promise<Customer[]> => {
    try {
      const snap = await getDocs(query(collection(db, 'customers'), limit(200)));
      const list: Customer[] = [];
      snap.forEach(d => {
        list.push({ id: d.id, ...d.data() } as Customer);
      });
      await customerService.cacheCustomers(list);
      return list;
    } catch (err) {
      console.warn('[CustomerService] Failed to fetch customers from server, using local cache:', err);
      return customerService.getCachedCustomers();
    }
  },
  /**
   * Look up a customer by phone line: the same number in any of its stored formats.
   */
  findByPhone: async (phone: string): Promise<Customer | null> => {
    if (!phone) return null;
    // Arabic-Indic digits are folded before extraction: `\D` is ASCII-only, so a
    // number typed on an Arabic keyboard used to read as having no digits at all
    // and the lookup silently returned null, which made findOrCreate mint a
    // duplicate profile.
    if (!isRealPhone(phone)) return null;

    try {
      // 1. Exact match query
      const q = query(
        collection(db, 'customers'),
        where('phone', '==', phone.trim()),
        limit(1)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const d = snap.docs[0];
        return { id: d.id, ...d.data() } as Customer;
      }

      // 2. Scan fallback for numbers stored in another format (+213, spaced, no
      // leading zero). The scan is bounded for the read budget, so it is a
      // heuristic, not a census — which is why it must never MISlink: it compares
      // canonical keys for equality, never a suffix, because two different people
      // can share the last digits of a number.
      const allSnap = await getDocs(query(collection(db, 'customers'), limit(100)));
      for (const d of allSnap.docs) {
        const data = d.data() as Customer;
        if (isSamePhone(data.phone, phone)) {
          return { ...data, id: d.id };
        }
      }
      return null;
    } catch (e) {
      console.warn('[CustomerService] findByPhone error:', e);
      return null;
    }
  },

  /**
   * Find existing customer or create a new profile
   */
  findOrCreate: async (name: string, phone: string): Promise<Customer> => {
    const trimmedName = name.trim() || 'Client';
    const trimmedPhone = phone.trim();

    if (trimmedPhone) {
      const existing = await customerService.findByPhone(trimmedPhone);
      if (existing) return existing;
    }

    const now = new Date().toISOString();
    const newCustomerData: Omit<Customer, 'id'> = {
      name: trimmedName,
      phone: trimmedPhone,
      accountType: 'retail',
      totalPurchases: 0,
      totalSpent: 0,
      totalDebt: 0,
      lastVisitDate: now,
      joinDate: now,
    };

    try {
      const docRef = await addDoc(collection(db, 'customers'), newCustomerData);
      const createdCustomer = { id: docRef.id, ...newCustomerData };
      const cached = await customerService.getCachedCustomers();
      await customerService.cacheCustomers([createdCustomer, ...cached.filter(c => c.id !== createdCustomer.id)]);
      return createdCustomer;
    } catch (createErr) {
      console.warn('[CustomerService] Offline fallback: creating local customer profile:', createErr);
      const offlineId = `offline_cust_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
      const offlineCustomer: Customer = { id: offlineId, ...newCustomerData };
      const cached = await customerService.getCachedCustomers();
      await customerService.cacheCustomers([offlineCustomer, ...cached]);
      return offlineCustomer;
    }
  },

  /**
   * Move the customer's Avoir by a signed amount, never below zero.
   *
   * The same `storeCredit` field the counter's Avoir lives in, so money an invoice
   * edit keeps here shows up on the counter's screen too. The note is written as an
   * activity entry with the same action types the counter issues, so a balance that
   * moved always says which receipt moved it.
   */
  shiftStoreCredit: async (
    customerId: string,
    delta: number,
    note: string,
    actorName?: string,
    operationId?: string
  ): Promise<number> => {
    return await runTransaction(db, async (tx) =>
      runStoreCreditShiftTx(toTxOps(tx), {
        customerId,
        delta,
        note,
        actorName,
        operationId,
      })
    );
  },

  /**
   * Register a customer debt entry in customer_debts collection
   */
  createDebtRecord: async (params: {
    customerId: string;
    customerName: string;
    customerPhone: string;
    ticketNumber: string;
    ticketId?: string;
    deviceDescription: string;
    totalAmount: number;
    amountPaid: number;
    paymentMethod?: string;
    actorName?: string;
    notes?: string;
  }): Promise<string> => {
    // One debt row per ticket: a settle that is retried after a crash between the
    // ticket write and this write must adopt the row the first attempt left behind
    // instead of opening the account a second time. The row is found by the
    // ticket's own id — the number alone is not safe, because every ticket that
    // has not claimed its number yet carries TKT-PENDING, and two of them settling
    // in a row would "find" the same debt.
    if (params.ticketId) {
      try {
        const existingSnap = await getDocs(
          query(collection(db, 'customer_debts'), where('linkedTicketId', '==', params.ticketId), limit(1))
        );
        if (!existingSnap.empty) return existingSnap.docs[0].id;
      } catch (lookupErr) {
        console.warn('[CustomerService] Debt dedupe lookup failed, creating a row anyway:', lookupErr);
      }
    }

    const now = new Date().toISOString();
    const remainingBalance = Math.max(0, params.totalAmount - params.amountPaid);
    const status =
      remainingBalance <= 0
        ? 'paid'
        : params.amountPaid > 0
        ? 'partially_paid'
        : 'unpaid';

    const payments = [];
    if (params.amountPaid > 0) {
      payments.push({
        id: `pay_${Date.now()}`,
        date: now,
        amount: params.amountPaid,
        method: params.paymentMethod || 'cash',
        note: `Handover payment for Repair #${params.ticketNumber}`,
        receivedByName: params.actorName || 'Staff',
        // Money the ticket already counts at the till; the drawer must not add it again.
        countedOn: 'repair',
      });
    }

    const debtData = {
      customerId: params.customerId,
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      productOrService: `Repair #${params.ticketNumber} - ${params.deviceDescription}`,
      totalAmount: params.totalAmount,
      amountPaid: params.amountPaid,
      remainingBalance,
      status,
      date: now,
      type: 'repair',
      linkedTicketId: params.ticketId ?? null,
      notes: params.notes || `Repair #${params.ticketNumber} handed over with ${remainingBalance} DA remaining debt.`,
      payments,
      createdAt: now,
      updatedAt: now,
    };

    const debtRef = await addDoc(collection(db, 'customer_debts'), debtData);

    // Update customer debt total atomically without overwriting concurrent terminal changes
    if (remainingBalance > 0) {
      try {
        await updateDoc(doc(db, 'customers', params.customerId), {
          totalDebt: increment(remainingBalance),
          lastVisitDate: now,
        });
      } catch (err) {
        console.warn('[CustomerService] Failed to update customer debt total:', err);
      }
    }

    return debtRef.id;
  },

  /**
   * Update customer spending totals upon ticket completion
   */
  recordCustomerSpending: async (customerId: string, amount: number) => {
    if (!customerId || amount <= 0) return;
    try {
      await updateDoc(doc(db, 'customers', customerId), {
        totalSpent: increment(amount),
        totalPurchases: increment(1),
        lastVisitDate: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[CustomerService] Failed to record customer spending:', e);
    }
  },

  /**
   * What one sale adds to the profile it was written on: the money that came into the
   * drawer, what went onto the account, and the visit itself.
   *
   * The counter answers the same question by recomputing the customer from the whole
   * history it already holds in memory. A phone holds no such list, and fetching one at
   * every sale would bill a read of the man's past for each cable sold — so the server
   * adds the numbers instead. That is also what keeps two tills selling to the same
   * customer in the same minute from overwriting each other, which a read-then-write
   * here would.
   */
  recordSaleOnProfile: async (customerId: string, paid: number, charged: number): Promise<void> => {
    if (!customerId) return;
    const { visits, spent, debt } = saleProfileDeltas(paid, charged);

    const updates: Record<string, unknown> = {
      lastVisitDate: new Date().toISOString(),
      totalPurchases: increment(visits),
    };
    if (spent > 0) updates.totalSpent = increment(spent);
    if (debt > 0) updates.totalDebt = increment(debt);

    try {
      await updateDoc(doc(db, 'customers', customerId), updates);
    } catch (e) {
      // A profile that has gone missing must not stop the till from selling.
      console.warn('[CustomerService] Sale could not be recorded on the customer:', e);
    }
  }
};
