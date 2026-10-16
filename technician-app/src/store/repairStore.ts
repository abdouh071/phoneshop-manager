import { create } from 'zustand';
import { 
  collection, 
  query, 
  where, 
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  addDoc,
  runTransaction
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuthStore } from './authStore';
import type { RepairTicket, RepairStatus, RepairStatusHistoryEntry } from '../types';

interface RepairState {
  tickets: RepairTicket[];
  isLoading: boolean;
  error: string | null;
  subscribeToTickets: () => () => void;
  updateTicketStatus: (id: string, status: RepairStatus, technicianName: string, additionalUpdates?: any) => Promise<void>;
  createTicket: (ticket: Partial<RepairTicket>) => Promise<void>;
  fetchMyCompletedTickets: (technicianName: string) => Promise<RepairTicket[]>;
  updateTicketParts: (id: string, parts: { name: string; cost: number }[]) => Promise<void>;
}

export const useRepairStore = create<RepairState>((set, get) => ({
  tickets: [],
  isLoading: true,
  error: null,

  subscribeToTickets: () => {
    set({ isLoading: true });
    // Fetch all active tickets (pending, in_progress, ready)
    const q = query(
      collection(db, 'repairs')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const tickets: RepairTicket[] = [];
        snapshot.forEach((doc) => {
          tickets.push({ id: doc.id, ...doc.data() } as RepairTicket);
        });
        // Sort descending by creation date roughly (or whatever field is available)
        tickets.sort((a, b) => {
          const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return timeB - timeA;
        });
        set({ tickets, isLoading: false, error: null });
      },
      (error) => {
        console.error('Error fetching tickets:', error);
        set({ error: error.message, isLoading: false });
      }
    );

    return unsubscribe;
  },

  updateTicketStatus: async (id: string, status: RepairStatus, technicianName: string, additionalUpdates?: any) => {
    try {
      const docRef = doc(db, 'repairs', id);
      const now = new Date().toISOString();
      const currentUser = useAuthStore.getState().user;
      const changerId = currentUser?.id || 'technician-app';
      const changerName = technicianName || currentUser?.name || 'Technician';

      // Preserve existing statusHistory or fetch from Firestore/local state
      let currentHistory: RepairStatusHistoryEntry[] = [];
      const localTicket = get().tickets.find(t => t.id === id);
      if (localTicket?.statusHistory && Array.isArray(localTicket.statusHistory)) {
        currentHistory = localTicket.statusHistory;
      } else {
        const currentSnap = await getDoc(docRef);
        if (currentSnap.exists()) {
          const data = currentSnap.data();
          if (Array.isArray(data.statusHistory)) {
            currentHistory = data.statusHistory;
          }
        }
      }

      const newHistoryEntry: RepairStatusHistoryEntry = {
        status,
        changedById: changerId,
        changedByName: changerName,
        at: now,
        timestamp: now,
        notes: additionalUpdates?.notes || `Status changed to ${status} via Technician App`
      };

      const updates = {
        status,
        assignedTechnician: technicianName,
        statusHistory: [...currentHistory, newHistoryEntry],
        updatedAt: now,
        ...additionalUpdates
      };
      await updateDoc(docRef, updates);
    } catch (error) {
      console.error('Failed to update ticket status:', error);
      throw error;
    }
  },

  updateTicketParts: async (id: string, parts: { name: string; cost: number }[]) => {
    try {
      const docRef = doc(db, 'repairs', id);
      await updateDoc(docRef, {
        partsUsed: parts.map(p => ({
          name: p.name,
          cost: p.cost,
          quantity: 1,
          productId: 'custom-mobile-part'
        })),
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to update parts:', error);
      throw error;
    }
  },

  createTicket: async (ticket) => {
    try {
      // Atomic counter for sequential ticket numbers: TKT-XXXX (synchronized with web app)
      const counterRef = doc(db, 'counters', 'repairs');
      let ticketNumber: string;
      try {
        ticketNumber = await runTransaction(db, async (tx) => {
          const snap = await tx.get(counterRef);
          const current = snap.exists() ? (snap.data()?.lastNumber || 0) : 0;
          const nextNum = current + 1;
          tx.set(counterRef, { lastNumber: nextNum }, { merge: true });
          return `TKT-${String(nextNum).padStart(4, '0')}`;
        });
      } catch (counterErr) {
        console.warn('Failed atomic counter transaction, using fallback ticket number:', counterErr);
        ticketNumber = 'TKT-' + Math.floor(100000 + Math.random() * 900000);
      }

      const now = new Date().toISOString();
      const currentUser = useAuthStore.getState().user;
      const creatorName = currentUser?.name || ticket.createdByName || 'Technician';
      const creatorId = currentUser?.id || ticket.createdById || 'technician-app';

      const initialHistory: RepairStatusHistoryEntry = {
        status: 'pending',
        changedById: creatorId,
        changedByName: creatorName,
        at: now,
        timestamp: now,
        notes: 'Created via Technician App'
      };

      const newTicket = {
        ...ticket,
        ticketNumber,
        status: 'pending',
        createdById: creatorId,
        createdByName: creatorName,
        createdAt: now,
        updatedAt: now,
        statusHistory: [initialHistory]
      };
      await addDoc(collection(db, 'repairs'), newTicket);
    } catch (error) {
      console.error('Failed to create ticket:', error);
      throw error;
    }
  },

  fetchMyCompletedTickets: async (technicianName: string) => {
    try {
      const { getDocs } = await import('firebase/firestore');
      const q = query(
        collection(db, 'repairs'),
        where('status', '==', 'completed'),
        where('assignedTechnician', '==', technicianName)
      );
      const snapshot = await getDocs(q);
      const myTickets: RepairTicket[] = [];
      snapshot.forEach((doc) => {
        myTickets.push({ id: doc.id, ...doc.data() } as RepairTicket);
      });
      return myTickets;
    } catch (error) {
      console.error('Failed to fetch completed tickets:', error);
      return [];
    }
  }
}));
