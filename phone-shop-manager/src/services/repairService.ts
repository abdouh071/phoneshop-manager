import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  query,
  orderBy,
  where,
  onSnapshot,
  limit,
  runTransaction,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { RepairTicket, RepairStatusHistoryEntry } from '../types';
import { deduplicateTickets, isSameTicketContent } from '../utils/ticketDeduplication';

const COLLECTION = 'repairs';
const LOCAL_STORAGE_KEY = 'offline_repairs';

const docToTicket = (id: string, data: Record<string, unknown>): RepairTicket => ({
  ...(data as Omit<RepairTicket, 'id'>),
  id,
});

// Local storage fallback helpers with automatic deduplication
const getLocalRepairs = (): RepairTicket[] => {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return deduplicateTickets(parsed);
  } catch {
    return [];
  }
};

const saveLocalRepairs = (tickets: RepairTicket[]) => {
  try {
    const clean = deduplicateTickets(tickets);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(clean));
  } catch (err) {
    console.error('Failed to save repairs to local storage', err);
  }
};

const generateFallbackTicketNumber = (existingTickets: RepairTicket[]): string => {
  let max = 0;
  existingTickets.forEach(t => {
    if (t.ticketNumber) {
      const match = t.ticketNumber.match(/TKT-(\d+)/i);
      if (match) {
        const val = parseInt(match[1], 10);
        if (val > max) max = val;
      }
    }
  });

  try {
    const storedLast = parseInt(localStorage.getItem('last_repair_ticket_number') || '0', 10);
    if (!isNaN(storedLast) && storedLast > max) max = storedLast;
  } catch {}

  const nextNum = max + 1;
  try {
    localStorage.setItem('last_repair_ticket_number', String(nextNum));
  } catch {}

  return `TKT-${String(nextNum).padStart(4, '0')}`;
};

// Atomic counter for sequential ticket numbers: TKT-XXXX
const getNextTicketNumber = async (localTickets: RepairTicket[]): Promise<string> => {
  const counterRef = doc(db, 'counters', 'repairs');

  try {
    // 1. Ensure counter doc exists if initializing for the first time
    const existingCounter = await getDoc(counterRef).catch(() => null);
    if (!existingCounter || !existingCounter.exists()) {
      let max = 0;
      try {
        const snap = await getDocs(collection(db, COLLECTION));
        snap.docs.forEach(d => {
          const tn = d.data()?.ticketNumber;
          if (typeof tn === 'string') {
            const match = tn.match(/TKT-(\d+)/i);
            if (match) {
              const val = parseInt(match[1], 10);
              if (val > max) max = val;
            }
          }
        });
      } catch (e) {
        console.warn('Could not read existing repairs for counter init:', e);
      }
      // Also consider local tickets
      localTickets.forEach(t => {
        if (t.ticketNumber) {
          const match = t.ticketNumber.match(/TKT-(\d+)/i);
          if (match) {
            const val = parseInt(match[1], 10);
            if (val > max) max = val;
          }
        }
      });
      await setDoc(counterRef, { lastNumber: max }, { merge: true }).catch(() => {});
    }

    // 2. Atomically increment counter via transaction
    const ticketNumber = await runTransaction(db, async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists() ? (snap.data()?.lastNumber || 0) : 0;
      const nextNum = current + 1;
      tx.set(counterRef, { lastNumber: nextNum }, { merge: true });
      return `TKT-${String(nextNum).padStart(4, '0')}`;
    });

    try {
      const numVal = parseInt(ticketNumber.replace(/\D/g, ''), 10);
      if (!isNaN(numVal)) localStorage.setItem('last_repair_ticket_number', String(numVal));
    } catch {}

    return ticketNumber;
  } catch (err) {
    console.warn('Transaction failed for repair ticket counter, using local fallback:', err);
    return generateFallbackTicketNumber(localTickets);
  }
};

// Sequential queue to strictly prevent concurrent duplicate ticket number allocations
let createTicketLock = Promise.resolve<any>(null);

export const repairService = {
  getAll: async (): Promise<RepairTicket[]> => {
    try {
      const q = query(collection(db, COLLECTION), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const items = snap.docs.map(d => docToTicket(d.id, d.data() as Record<string, unknown>));
      
      const serverIds = new Set(items.map(i => i.id));
      const serverTicketNumbers = new Set(
        items.map(i => (i.ticketNumber || '').trim().toUpperCase()).filter(Boolean)
      );

      // Merge with any offline-created tickets not yet on server
      // Discard offline copy if the server already has the same ticketNumber or ID
      const local = getLocalRepairs();
      const pendingLocal = local.filter(l =>
        l.id.startsWith('offline_') &&
        !serverIds.has(l.id) &&
        (!l.ticketNumber || !serverTicketNumbers.has(l.ticketNumber.trim().toUpperCase()))
      );

      const merged = [...pendingLocal, ...items].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      const deduped = deduplicateTickets(merged);
      saveLocalRepairs(deduped);
      return deduped;
    } catch (err) {
      console.warn('Firestore repairs fetch failed, using local cache:', err);
      return deduplicateTickets(getLocalRepairs());
    }
  },

  getById: async (id: string): Promise<RepairTicket | undefined> => {
    try {
      const snap = await getDoc(doc(db, COLLECTION, id));
      if (snap.exists()) {
        return docToTicket(snap.id, snap.data() as Record<string, unknown>);
      }
    } catch (err) {
      console.warn('Firestore getById failed, checking local cache:', err);
    }
    return getLocalRepairs().find(t => t.id === id);
  },

  updateStatus: async (
    id: string,
    status: RepairTicket['status'],
    statusHistory?: RepairStatusHistoryEntry[]
  ): Promise<RepairTicket> => {
    const updatedAt = new Date().toISOString();
    const local = getLocalRepairs();
    const existingLocal = local.find(t => t.id === id);
    
    const updatedLocal: RepairTicket = {
      ...(existingLocal || ({} as RepairTicket)),
      id,
      status,
      updatedAt,
      ...(statusHistory ? { statusHistory } : {}),
    };

    // Save to local storage immediately
    saveLocalRepairs(local.map(t => t.id === id ? updatedLocal : t));

    try {
      const ref = doc(db, COLLECTION, id);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const updatePayload: Record<string, unknown> = { status, updatedAt };
        if (statusHistory) updatePayload.statusHistory = statusHistory;
        await updateDoc(ref, updatePayload);
        // Merge: keep local ticket data as base, only apply status-related fields
        const serverTicket: RepairTicket = {
          ...(existingLocal || ({} as RepairTicket)),
          id,
          status,
          updatedAt,
          ...(statusHistory ? { statusHistory } : {}),
        };
        saveLocalRepairs(local.map(t => t.id === id ? serverTicket : t));
        return serverTicket;
      }
    } catch (err) {
      console.warn('Failed to update status on Firestore, stored locally:', err);
    }

    return updatedLocal;
  },

  createTicket: async (
    ticket: Omit<RepairTicket, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt'>
  ): Promise<RepairTicket> => {
    const runCreation = async (): Promise<RepairTicket> => {
      const local = getLocalRepairs();

      // De-duplication check: if an identical ticket was submitted within the last 30s, return existing
      const existingRecent = local.find(t => isSameTicketContent(t, {
        ...ticket,
        id: 'temp',
        ticketNumber: 'temp',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any));

      if (existingRecent) {
        console.warn('Duplicate ticket creation blocked in repairService; returning existing ticket:', existingRecent.ticketNumber);
        return existingRecent;
      }

      let ticketNumber = '';
      try {
        ticketNumber = await getNextTicketNumber(local);
      } catch {
        ticketNumber = generateFallbackTicketNumber(local);
      }
      if (!ticketNumber) {
        ticketNumber = generateFallbackTicketNumber(local);
      }

      const now = new Date().toISOString();
      const trackingPin = Math.random().toString(36).substring(2, 6).toUpperCase();
      
      const newTicket = {
        ...ticket,
        ticketNumber,
        trackingPin,
        createdAt: now,
        updatedAt: now,
      };

      try {
        const docRef = await addDoc(collection(db, COLLECTION), newTicket);
        const created = { ...newTicket, id: docRef.id };
        saveLocalRepairs([created, ...local.filter(t => t.id !== created.id && t.ticketNumber !== created.ticketNumber)]);
        return created;
      } catch (err) {
        console.warn('Failed to create ticket on Firestore, saving locally:', err);
        const offlineId = `offline_tkt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const created = { ...newTicket, id: offlineId };
        saveLocalRepairs([created, ...local.filter(t => t.id !== created.id && t.ticketNumber !== created.ticketNumber)]);
        return created;
      }
    };

    const promise = createTicketLock.then(runCreation, runCreation);
    createTicketLock = promise;
    return promise;
  },

  updateTicket: async (id: string, updates: Partial<RepairTicket>): Promise<RepairTicket> => {
    const local = getLocalRepairs();
    const existing = local.find(t => t.id === id);
    const merged = { ...(existing || ({} as RepairTicket)), ...updates, id, updatedAt: new Date().toISOString() };
    saveLocalRepairs(local.map(t => t.id === id ? merged : t));

    try {
      const ref = doc(db, COLLECTION, id);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const payload = { ...updates, updatedAt: merged.updatedAt };
        await updateDoc(ref, payload);
        saveLocalRepairs(local.map(t => t.id === id ? merged : t));
        return merged;
      }
    } catch (err) {
      console.warn('Failed to update ticket on Firestore, stored locally:', err);
    }

    return merged;
  },

  /**
   * Subscribe to a ticket by its public ticketNumber (e.g. "TKT-0042") and a security PIN.
   * Used by the customer-facing tracking page. Returns an unsubscribe function.
   * If the PIN is invalid, returns null.
   * Sensitive fields (lock code, tech notes, part costs) are stripped before the callback.
   */
  subscribeToTicketByNumber: (
    ticketNumber: string,
    pin: string,
    callback: (ticket: RepairTicket | null) => void
  ): (() => void) => {
    const cleanNum = (ticketNumber || '').trim().toUpperCase();
    const cleanPin = (pin || '').trim().toUpperCase();
    
    if (!cleanNum || !/^TKT-\d{4,}$/i.test(cleanNum) || !cleanPin) {
      callback(null);
      return () => {};
    }

    const q = query(
      collection(db, COLLECTION),
      where('ticketNumber', '==', cleanNum),
      limit(1)
    );

    return onSnapshot(
      q,
      (snapshot) => {
        if (snapshot.empty) {
          callback(null);
          return;
        }
        const docSnap = snapshot.docs[0];
        const raw = docToTicket(docSnap.id, docSnap.data() as Record<string, unknown>);
        
        // --- Security PIN Verification ---
        // For new tickets, check trackingPin. For older tickets, check last 4 of phone number.
        const isPinValid = 
          (raw.trackingPin && raw.trackingPin.toUpperCase() === cleanPin) || 
          (!raw.trackingPin && raw.customerPhone && raw.customerPhone.slice(-4) === cleanPin);

        if (!isPinValid) {
          callback(null);
          return;
        }

        // Strip sensitive fields for public consumption
        const safeTicket: RepairTicket = {
          ...raw,
          lockType: undefined,
          lockValue: undefined,
          assignedTechnician: undefined,
          createdById: undefined,
          createdByName: undefined,
          partsUsed: raw.partsUsed?.map(p => ({
            ...p,
            cost: 0, // hide internal part costs
          })),
        };
        callback(safeTicket);
      },
      (err) => {
        console.error('[Tracking] Firestore subscription error:', err);
        callback(null);
      }
    );
  },

  /**
   * One-time fetch of a ticket by its public ticketNumber and PIN.
   * Used for the manual search fallback on the tracking page.
   */
  getTicketByNumber: async (ticketNumber: string, pin: string): Promise<RepairTicket | null> => {
    const cleanNum = (ticketNumber || '').trim().toUpperCase();
    const cleanPin = (pin || '').trim().toUpperCase();
    if (!cleanNum || !/^TKT-\d{4,}$/i.test(cleanNum) || !cleanPin) return null;

    try {
      const q = query(
        collection(db, COLLECTION),
        where('ticketNumber', '==', cleanNum),
        limit(1)
      );
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const docSnap = snap.docs[0];
      const raw = docToTicket(docSnap.id, docSnap.data() as Record<string, unknown>);
      
      // --- Security PIN Verification ---
      const isPinValid = 
        (raw.trackingPin && raw.trackingPin.toUpperCase() === cleanPin) || 
        (!raw.trackingPin && raw.customerPhone && raw.customerPhone.slice(-4) === cleanPin);

      if (!isPinValid) return null;

      // Strip sensitive fields
      return {
        ...raw,
        lockType: undefined,
        lockValue: undefined,
        assignedTechnician: undefined,
        createdById: undefined,
        createdByName: undefined,
        partsUsed: raw.partsUsed?.map(p => ({ ...p, cost: 0 })),
      };
    } catch (err) {
      console.error('[Tracking] Failed to fetch ticket by number:', err);
      return null;
    }
  },

  deleteTicket: async (id: string): Promise<void> => {
    try {
      const ref = doc(db, COLLECTION, id);
      await deleteDoc(ref);
    } catch (err) {
      console.warn('Failed to delete repair ticket on Firestore, removing locally:', err);
    }
    const local = getLocalRepairs();
    saveLocalRepairs(local.filter(t => t.id !== id));
  },

  deleteTicketsByIds: async (ids: string[]): Promise<void> => {
    const set = new Set(ids);
    try {
      await Promise.all(ids.map(id => deleteDoc(doc(db, COLLECTION, id)).catch(() => {})));
    } catch (err) {
      console.warn('Failed to batch delete repair tickets on Firestore:', err);
    }
    const local = getLocalRepairs();
    saveLocalRepairs(local.filter(t => !set.has(t.id)));
  },

  updateDeviceForCustomer: async (
    customerId: string,
    customerPhone: string,
    oldBrand: string,
    oldModel: string,
    newBrand: string,
    newModel: string
  ): Promise<number> => {
    const cleanOldBrand = (oldBrand || '').toLowerCase().trim();
    const cleanOldModel = (oldModel || '').toLowerCase().trim();
    const cleanPhone = (customerPhone || '').replace(/\D/g, '');

    const local = getLocalRepairs();
    const matchingIds: string[] = [];

    const updated = local.map(t => {
      const matchDevice = (t.deviceBrand || '').toLowerCase().trim() === cleanOldBrand &&
        (t.deviceModel || '').toLowerCase().trim() === cleanOldModel;
      const matchCust = (customerId && t.customerId === customerId) ||
        (cleanPhone && (t.customerPhone || '').replace(/\D/g, '') === cleanPhone);

      if (matchDevice && matchCust) {
        matchingIds.push(t.id);
        return {
          ...t,
          deviceBrand: newBrand.trim(),
          deviceModel: newModel.trim(),
          updatedAt: new Date().toISOString(),
        };
      }
      return t;
    });

    saveLocalRepairs(updated);

    if (matchingIds.length > 0) {
      try {
        await Promise.all(
          matchingIds.map(id =>
            updateDoc(doc(db, COLLECTION, id), {
              deviceBrand: newBrand.trim(),
              deviceModel: newModel.trim(),
              updatedAt: new Date().toISOString(),
            }).catch(() => {})
          )
        );
      } catch (err) {
        console.warn('Failed to batch update device on Firestore:', err);
      }
    }

    return matchingIds.length;
  },

  reassignCustomerTickets: async (
    targetCustomerId: string,
    targetCustomerName: string,
    targetCustomerPhone: string,
    sourceCustomerId: string,
    sourceCustomerPhone?: string
  ): Promise<void> => {
    const local = getLocalRepairs();
    const updated = local.map(t => {
      const matches = t.customerId === sourceCustomerId ||
        (sourceCustomerPhone && t.customerPhone && t.customerPhone.replace(/\D/g, '') === sourceCustomerPhone.replace(/\D/g, ''));
      if (matches) {
        return {
          ...t,
          customerId: targetCustomerId,
          customerName: targetCustomerName,
          customerPhone: targetCustomerPhone,
          updatedAt: new Date().toISOString(),
        };
      }
      return t;
    });
    saveLocalRepairs(updated);

    try {
      const ticketsToUpdate = updated.filter(t => t.customerId === targetCustomerId);
      await Promise.all(
        ticketsToUpdate.map(t =>
          updateDoc(doc(db, COLLECTION, t.id), {
            customerId: targetCustomerId,
            customerName: targetCustomerName,
            customerPhone: targetCustomerPhone,
            updatedAt: new Date().toISOString(),
          }).catch(() => {})
        )
      );
    } catch (err) {
      console.warn('Failed to batch reassign customer tickets on Firestore:', err);
    }
  },
};

