import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  query,
  orderBy,
  limit,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

export interface EndOfDayRecord {
  id: string;
  date: string;            // ISO date string (YYYY-MM-DD)
  closedAt: string;        // ISO datetime of when EOD was triggered
  closedById?: string;
  closedByName?: string;
  isAutoClose: boolean;    // true = midnight auto-trigger, false = manual

  // Sales
  salesCount: number;
  salesCash: number;
  salesCard: number;
  salesMobile: number;
  salesTransfer: number;
  salesDebt: number;
  salesTotalRevenue: number;
  salesCogs: number;       // cost of goods sold
  salesNetProfit: number;

  // Repairs
  repairsCompleted: number;
  repairsCash: number;
  repairsCard: number;
  repairsMobile: number;
  repairsDebt: number;
  repairsTotalRevenue: number;
  repairsPartsCost: number;
  repairsNetProfit: number;

  // Parts / B2B
  partsSalesCount: number;
  partsSalesRevenue: number;

  // Combined
  totalRevenue: number;
  totalNetProfit: number;
  totalCash: number;       // total physical cash in drawer
  totalCard: number;
  totalMobile: number;

  // Detailed Physical Cash Flow
  repairDepositsCash?: number;
  repairHandoversCash?: number;
  debtCollectedCash?: number;
  refundsCash?: number;

  notes?: string;
}

const COLLECTION = 'end_of_day';
const LOCAL_KEY  = 'eod_records';

const getLocal = (): EndOfDayRecord[] => {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; }
};
const saveLocal = (r: EndOfDayRecord[]) => {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(r)); } catch { /**/ }
};

export const endOfDayService = {
  /** Save a new EOD record */
  save: async (record: Omit<EndOfDayRecord, 'id'>): Promise<EndOfDayRecord> => {
    const local = getLocal();
    try {
      const ref = await addDoc(collection(db, COLLECTION), record);
      const created = { ...record, id: ref.id };
      saveLocal([created, ...local]);
      return created;
    } catch {
      const id = `offline_eod_${Date.now()}`;
      const created = { ...record, id };
      saveLocal([created, ...local]);
      return created;
    }
  },

  /** Update notes on an existing record */
  updateNotes: async (id: string, notes: string): Promise<void> => {
    saveLocal(getLocal().map(r => r.id === id ? { ...r, notes } : r));
    try { await updateDoc(doc(db, COLLECTION, id), { notes }); } catch { /**/ }
  },

  /** Fetch all records, newest first */
  getAll: async (): Promise<EndOfDayRecord[]> => {
    try {
      const q = query(collection(db, COLLECTION), orderBy('closedAt', 'desc'), limit(90));
      const snap = await getDocs(q);
      const items: EndOfDayRecord[] = snap.docs.map(d => ({ ...(d.data() as Omit<EndOfDayRecord,'id'>), id: d.id }));
      saveLocal(items);
      return items;
    } catch {
      return getLocal();
    }
  },

  /** Get today's EOD record if it exists */
  getTodayRecord: async (dateStr: string): Promise<EndOfDayRecord | null> => {
    try {
      const q = query(collection(db, COLLECTION), where('date', '==', dateStr), limit(1));
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const d = snap.docs[0];
      return { ...(d.data() as Omit<EndOfDayRecord,'id'>), id: d.id };
    } catch {
      return getLocal().find(r => r.date === dateStr) ?? null;
    }
  },
};
