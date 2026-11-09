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
import { mergeStatusHistory } from '../utils/statusHistoryMerge';
import { newIdempotencyKey } from './idempotentReplay';
import { offlineQueue } from './offlineQueue';

const COLLECTION = 'repairs';
const LOCAL_STORAGE_KEY = 'offline_repairs';
const DELETED_TICKETS_KEY = 'deleted_repair_ticket_ids';

// Shared by the scoped read below and the live stream: what counts as "still work",
// what counts as recently closed, and how long "recently" lasts.
const ACTIVE_STATUSES = ['pending', 'in_progress', 'ready', 'returned'];
const CLOSED_STATUSES = ['completed', 'cancelled'];
const CLOSED_RETENTION_DAYS = 60;

/** What a live stream says changed: rows to merge in, and ids that are gone for good. */
export interface RepairPatch {
  upsert: RepairTicket[];
  removedIds: string[];
}

const docToTicket = (id: string, data: Record<string, unknown>): RepairTicket => ({
  ...(data as Omit<RepairTicket, 'id'>),
  id,
});

// Tombstones: Track deleted ticket IDs to prevent resurrection from Firestore replication lag or cache
const getDeletedTicketIds = (): Set<string> => {
  try {
    const raw = localStorage.getItem(DELETED_TICKETS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
};

const addDeletedTicketId = (id: string): void => {
  try {
    const set = getDeletedTicketIds();
    set.add(id);
    localStorage.setItem(DELETED_TICKETS_KEY, JSON.stringify(Array.from(set)));
  } catch (err) {
    console.warn('Failed to save deleted ticket tombstone:', err);
  }
};

// Local storage fallback helpers with automatic deduplication & tombstone purging
const getLocalRepairs = (): RepairTicket[] => {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    const parsed: RepairTicket[] = raw ? JSON.parse(raw) : [];
    const deletedIds = getDeletedTicketIds();
    const alive = parsed.filter(t => !deletedIds.has(t.id));
    return deduplicateTickets(alive);
  } catch {
    return [];
  }
};

const saveLocalRepairs = (tickets: RepairTicket[]) => {
  try {
    const deletedIds = getDeletedTicketIds();
    const alive = tickets.filter(t => !deletedIds.has(t.id));
    const clean = deduplicateTickets(alive);
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
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return generateFallbackTicketNumber(localTickets);
  }

  const counterRef = doc(db, 'counters', 'repairs');

  try {
    // 1. Ensure counter doc exists if initializing for the first time with timeout guard
    const readCounterPromise = getDoc(counterRef).catch(() => null);
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
    const existingCounter = await Promise.race([readCounterPromise, timeoutPromise]);
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

    // 2. Atomically increment counter via transaction with timeout guard
    const txPromise = runTransaction(db, async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists() ? (snap.data()?.lastNumber || 0) : 0;
      const nextNum = current + 1;
      tx.set(counterRef, { lastNumber: nextNum }, { merge: true });
      return `TKT-${String(nextNum).padStart(4, '0')}`;
    });
    const txTimeout = new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error('Transaction timeout')), 2000)
    );
    const ticketNumber = await Promise.race([txPromise, txTimeout]);

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
let createTicketLock: Promise<unknown> = Promise.resolve(null);

export const repairService = {
  /**
   * `allowLocalFallback: false` makes this read throw instead of answering from this device's
   * cache after 2.5 seconds. Screens may show a cache; a caller about to WRITE an absolute
   * figure off what it read has to know when it is not looking at the shop's real history.
   */
  getAll: async (options?: { allowLocalFallback?: boolean }): Promise<RepairTicket[]> => {
    const mayFallBack = options?.allowLocalFallback !== false;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (!mayFallBack) throw new Error("Offline: the repair history on this device is not the shop's history.");
      return deduplicateTickets(getLocalRepairs());
    }

    try {
      const q = query(collection(db, COLLECTION), orderBy('createdAt', 'desc'));
      const snapPromise = getDocs(q);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore repairs fetch timeout')), 2500)
      );
      const snap = await Promise.race([snapPromise, timeoutPromise]);
      const items = snap.docs.map(d => docToTicket(d.id, d.data() as Record<string, unknown>));
      
      const deletedIds = getDeletedTicketIds();
      const serverTickets = items.filter(t => !deletedIds.has(t.id));
      const serverIds = new Set(serverTickets.map(i => i.id));
      const serverTicketNumbers = new Set(
        serverTickets.map(i => (i.ticketNumber || '').trim().toUpperCase()).filter(Boolean)
      );

      // Merge with any offline-created tickets not yet on server
      // Discard offline copy if the server already has the same ticketNumber or ID
      const local = getLocalRepairs();
      const pendingLocal = local.filter(l =>
        l.id.startsWith('offline_') &&
        !deletedIds.has(l.id) &&
        !serverIds.has(l.id) &&
        (!l.ticketNumber || !serverTicketNumbers.has(l.ticketNumber.trim().toUpperCase()))
      );

      const merged = [...pendingLocal, ...serverTickets].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      const deduped = deduplicateTickets(merged);
      saveLocalRepairs(deduped);
      return deduped;
    } catch (err) {
      console.warn('Firestore repairs fetch failed, using local cache:', err);
      if (!mayFallBack) throw err;
      return deduplicateTickets(getLocalRepairs());
    }
  },

  /**
   * Optimized workbench query: loads only active tickets + recently closed (last 60 days).
   * Use this for the main RepairsPage / Dashboard — it is significantly faster than getAll()
   * for large shops because it avoids streaming years of completed ticket history.
   *
   * getAll() is still available and is still used by ReportsService for full financial history.
   * No records are ever deleted — this only scopes which records are READ at query time.
   */
  getActive: async (): Promise<RepairTicket[]> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return deduplicateTickets(getLocalRepairs());
    }

    try {
      const closedCutoff = new Date();
      closedCutoff.setDate(closedCutoff.getDate() - CLOSED_RETENTION_DAYS);

      // Run both queries in parallel with timeout race
      const queryPromise = Promise.all([
        getDocs(query(
          collection(db, COLLECTION),
          where('status', 'in', ACTIVE_STATUSES),
          orderBy('createdAt', 'desc')
        )),
        getDocs(query(
          collection(db, COLLECTION),
          where('status', 'in', CLOSED_STATUSES),
          where('updatedAt', '>=', closedCutoff.toISOString()),
          orderBy('updatedAt', 'desc'),
          limit(200)
        )),
      ]);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore getActive timeout')), 2500)
      );
      const [activeSnap, closedSnap] = await Promise.race([queryPromise, timeoutPromise]);

      // Merge, deduplicating by document ID and filtering out tombstones
      const deletedIds = getDeletedTicketIds();
      const seen = new Set<string>();
      const combined: RepairTicket[] = [];
      for (const snap of [activeSnap, closedSnap]) {
        for (const d of snap.docs) {
          if (!seen.has(d.id) && !deletedIds.has(d.id)) {
            seen.add(d.id);
            combined.push(docToTicket(d.id, d.data() as Record<string, unknown>));
          }
        }
      }

      // Merge offline-pending tickets
      const local = getLocalRepairs();
      const serverTicketNumbers = new Set(
        combined.map(i => (i.ticketNumber || '').trim().toUpperCase()).filter(Boolean)
      );
      const pendingLocal = local.filter(l =>
        l.id.startsWith('offline_') &&
        !deletedIds.has(l.id) &&
        !seen.has(l.id) &&
        (!l.ticketNumber || !serverTicketNumbers.has(l.ticketNumber.trim().toUpperCase()))
      );

      return deduplicateTickets(
        [...pendingLocal, ...combined].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
      );
    } catch (err) {
      console.warn('Firestore getActive repairs failed, falling back to local cache:', err);
      return deduplicateTickets(getLocalRepairs());
    }
  },

  /**
   * Live stream of the tickets still under work, so a repair added or moved on a
   * technician's phone lands on this terminal without a reload.
   *
   * Scoped to ACTIVE_STATUSES on purpose. A listener over every ticket ever written
   * would re-bill the whole collection on the shop's slowest day, and the counter
   * only needs to hear about work in progress; history stays behind getAll() and
   * the on-demand report reads. When a ticket settles it drops out of the stream, so
   * one extra read fetches its new shape and the existing row updates in place
   * instead of freezing at its last open status.
   */
  subscribeToActive: (
    onPatch: (patch: RepairPatch) => void,
    onError?: (err: unknown) => void
  ): (() => void) => {
    const q = query(
      collection(db, COLLECTION),
      where('status', 'in', ACTIVE_STATUSES),
      orderBy('createdAt', 'desc')
    );

    return onSnapshot(
      q,
      (snap) => {
        const deletedIds = getDeletedTicketIds();
        const changed = snap.docChanges();

        const upsert = changed
          .filter((c) => c.type !== 'removed')
          .map((c) => docToTicket(c.doc.id, c.doc.data() as Record<string, unknown>))
          .filter((t) => !deletedIds.has(t.id));

        const left = changed
          .filter((c) => c.type === 'removed')
          .map((c) => c.doc.id)
          .filter((id) => !deletedIds.has(id));

        if (left.length === 0) {
          if (upsert.length > 0) onPatch({ upsert, removedIds: [] });
          return;
        }

        Promise.all(left.map((id) => getDoc(doc(db, COLLECTION, id))))
          .then((settled) => {
            const fresh = settled
              .filter((s) => s.exists())
              .map((s) => docToTicket(s.id, s.data() as Record<string, unknown>));
            const gone = settled.filter((s) => !s.exists()).map((s) => s.id);
            onPatch({ upsert: [...upsert, ...fresh], removedIds: gone });
          })
          .catch((err) => onError?.(err));
      },
      (err) => {
        // The one-shot list stays usable; the terminal simply behaves the way it
        // did before this stream existed.
        console.warn('[RepairService] Live repairs stream unavailable:', err);
        onError?.(err);
      }
    );
  },

  getById: async (id: string): Promise<RepairTicket | undefined> => {
    const local = getLocalRepairs().find(t => t.id === id);
    if (id.startsWith('offline_') || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return local;
    }
    try {
      const snapPromise = getDoc(doc(db, COLLECTION, id));
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore getById timeout')), 1200)
      );
      const snap = await Promise.race([snapPromise, timeoutPromise]);
      if (snap.exists()) {
        return docToTicket(snap.id, snap.data() as Record<string, unknown>);
      }
    } catch (err) {
      console.warn('Firestore getById failed, checking local cache:', err);
    }
    return local;
  },

  updateStatus: async (
    id: string,
    status: RepairTicket['status'],
    statusHistory?: RepairStatusHistoryEntry[],
    options?: { throwOnError?: boolean; completedAt?: string }
  ): Promise<RepairTicket> => {
    const updatedAt = new Date().toISOString();
    const local = getLocalRepairs();
    const existingLocal = local.find(t => t.id === id);
    
    const repairedAt = (status === 'ready' && !existingLocal?.repairedAt) ? updatedAt : existingLocal?.repairedAt;
    
    const updatedLocal: RepairTicket = {
      ...(existingLocal || ({} as RepairTicket)),
      id,
      status,
      updatedAt,
      ...(repairedAt ? { repairedAt } : {}),
      ...(statusHistory ? { statusHistory } : {}),
      ...(options?.completedAt ? { completedAt: options.completedAt } : {}),
    };

    // Save to local storage immediately
    saveLocalRepairs(local.map(t => t.id === id ? updatedLocal : t));

    // A ticket whose id starts with `offline_` has no document to update: that id was
    // invented here, and `syncOfflineRepairs` creates the document from the local ticket
    // exactly as it now stands — this status, its history and all. So the write above is
    // already on its way to Firestore, and queueing an action keyed on the temporary id
    // only ever made work: the replay landed back in this branch and queued it again,
    // which is how one entry survived every sync pass the shop ran.
    if (id.startsWith('offline_')) {
      return updatedLocal;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      offlineQueue.enqueue({
        type: 'UPDATE_REPAIR_STATUS',
        payload: { id, status, history: statusHistory, completedAt: options?.completedAt }
      }).catch(console.warn);
      return updatedLocal;
    }

    try {
      const ref = doc(db, COLLECTION, id);
      const updatePromise = runTransaction(db, async (tx) => {
        const liveSnap = await tx.get(ref);
        const live = liveSnap.exists() ? (liveSnap.data() as Record<string, unknown>) : {};
        const updatePayload: Record<string, unknown> = { status, updatedAt };
        if (repairedAt) updatePayload.repairedAt = repairedAt;
        if (options?.completedAt) updatePayload.completedAt = options.completedAt;
        let mergedHistory = statusHistory;
        if (statusHistory && statusHistory.length > 0) {
          // Append-only against the live document: a verbatim write used to
          // erase entries another window — or a replayed offline action —
          // recorded in between, so both writers now keep everything they each
          // recorded, in order.
          mergedHistory = mergeStatusHistory(
            (live.statusHistory as RepairStatusHistoryEntry[]) || [],
            statusHistory
          );
          updatePayload.statusHistory = mergedHistory;
        }
        tx.update(ref, updatePayload);
        return mergedHistory;
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore updateDoc timeout')), 1200)
      );
      const mergedHistory = await Promise.race([updatePromise, timeoutPromise]);
      return mergedHistory ? { ...updatedLocal, statusHistory: mergedHistory } : updatedLocal;
    } catch (err) {
      console.warn('Failed to update status on Firestore, stored locally & queued for sync:', err);
      offlineQueue.enqueue({
        type: 'UPDATE_REPAIR_STATUS',
        payload: { id, status, history: statusHistory, completedAt: options?.completedAt }
      }).catch(console.warn);

      if (options?.throwOnError) {
        throw err;
      }
    }

    return updatedLocal;
  },

  createTicket: async (
    ticket: Omit<RepairTicket, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt'>
  ): Promise<RepairTicket> => {
    const runCreation = async (): Promise<RepairTicket> => {
      const local = getLocalRepairs();

      // De-duplication check: an identical same-phone ticket submitted in the same
      // breath is a double-submit; everything else is a real device and is created.
      const existingRecent = local.find(t => isSameTicketContent(t, {
        ...ticket,
        id: 'temp',
        ticketNumber: 'temp',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      if (existingRecent) {
        console.warn('Duplicate ticket creation blocked in repairService; returning existing ticket:', existingRecent.ticketNumber);
        return existingRecent;
      }

      // If offline, save locally immediately with zero delay
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const ticketNumber = generateFallbackTicketNumber(local);
        const now = new Date().toISOString();
        const trackingPin = Math.random().toString(36).substring(2, 6).toUpperCase();
        const offlineId = `offline_tkt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const created: RepairTicket = {
          ...ticket,
          id: offlineId,
          ticketNumber,
          trackingPin,
          createdAt: now,
          updatedAt: now,
          idempotencyKey: newIdempotencyKey('ticket'),
        };
        saveLocalRepairs([created, ...local.filter(t => t.id !== created.id && t.ticketNumber !== created.ticketNumber)]);
        return created;
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
        // Minted before the first attempt and kept on the local copy filed when this write is
        // not heard, so the replay finds the ticket the server may already have — by this key
        // alone, never by its number, which two devices can mint for two different jobs.
        idempotencyKey: newIdempotencyKey('ticket'),
      };

      try {
        const addDocPromise = addDoc(collection(db, COLLECTION), newTicket);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Firestore addDoc timeout')), 2500)
        );
        const docRef = await Promise.race([addDocPromise, timeoutPromise]);
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

  updateTicket: async (
    id: string,
    updates: Partial<RepairTicket>,
    options?: { throwOnError?: boolean }
  ): Promise<RepairTicket> => {
    const local = getLocalRepairs();
    const existing = local.find(t => t.id === id);
    const merged = { ...(existing || ({} as RepairTicket)), ...updates, id, updatedAt: new Date().toISOString() };
    saveLocalRepairs(local.map(t => t.id === id ? merged : t));

    // Same rule as the status change: a temporary id names no document, and the local
    // ticket the sync uploads already carries these fields.
    if (id.startsWith('offline_')) {
      return merged;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      offlineQueue.enqueue({
        type: 'UPDATE_REPAIR_TICKET',
        payload: { id, updates }
      }).catch(console.warn);
      return merged;
    }

    try {
      const ref = doc(db, COLLECTION, id);
      const payload: Record<string, unknown> = { updatedAt: merged.updatedAt };
      for (const [key, val] of Object.entries(updates)) {
        if (val !== undefined) {
          payload[key] = val;
        }
      }

      const updatePromise = updateDoc(ref, payload);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore updateDoc timeout')), 1200)
      );
      await Promise.race([updatePromise, timeoutPromise]);
      return merged;
    } catch (err) {
      console.warn('Failed to update ticket on Firestore, stored locally & queued for sync:', err);
      offlineQueue.enqueue({
        type: 'UPDATE_REPAIR_TICKET',
        payload: { id, updates }
      }).catch(console.warn);

      if (options?.throwOnError) {
        throw err;
      }
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
          assignedTechnicianId: undefined,
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
        assignedTechnicianId: undefined,
        createdById: undefined,
        createdByName: undefined,
        partsUsed: raw.partsUsed?.map(p => ({ ...p, cost: 0 })),
      };
    } catch (err) {
      console.error('[Tracking] Failed to fetch ticket by number:', err);
      return null;
    }
  },

  deleteTicket: async (
    id: string,
    options?: { throwOnError?: boolean }
  ): Promise<void> => {
    // 1. Record tombstone immediately to prevent resurrection from cached or slow queries
    addDeletedTicketId(id);

    // 2. Purge from local storage immediately
    const local = getLocalRepairs();
    saveLocalRepairs(local.filter(t => t.id !== id));

    // 3. Offline tickets only exist locally
    if (id.startsWith('offline_')) {
      return;
    }

    // 4. If offline, enqueue delete action for background sync
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      offlineQueue.enqueue({
        type: 'DELETE_REPAIR_TICKET',
        payload: { id },
      }).catch(console.warn);
      return;
    }

    // 5. Online Firestore deletion with timeout guard
    try {
      const ref = doc(db, COLLECTION, id);
      const delPromise = deleteDoc(ref);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore deleteDoc timeout')), 2500)
      );
      await Promise.race([delPromise, timeoutPromise]);
    } catch (err) {
      console.warn('Failed to delete repair ticket on Firestore, enqueuing for offline sync:', err);
      offlineQueue.enqueue({
        type: 'DELETE_REPAIR_TICKET',
        payload: { id },
      }).catch(console.warn);

      if (options?.throwOnError) {
        throw err;
      }
    }
  },

  deleteTicketsByIds: async (ids: string[]): Promise<void> => {
    const set = new Set(ids);
    ids.forEach(id => addDeletedTicketId(id));

    const local = getLocalRepairs();
    saveLocalRepairs(local.filter(t => !set.has(t.id)));

    await Promise.all(
      ids.map(id => repairService.deleteTicket(id).catch(console.warn))
    );
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

  mergeTickets: async (
    primaryTicketId: string,
    secondaryTicketId: string,
    consolidatedUpdates: Partial<RepairTicket>
  ): Promise<RepairTicket> => {
    // 1. Update primary ticket with consolidated data
    const updatedPrimary = await repairService.updateTicket(primaryTicketId, consolidatedUpdates);

    // 2. Archive secondary ticket with merged metadata (NEVER delete from DB)
    await repairService.updateTicket(secondaryTicketId, {
      mergedIntoTicketId: primaryTicketId,
      mergedAt: new Date().toISOString(),
    });

    return updatedPrimary;
  },
};

