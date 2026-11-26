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
import { invalidateReportsCache } from './reportCacheInvalidation';

/**
 * Bumped when a seal starts storing provenance (`sealedAt`, `sealScope`). Records without
 * it were written by an older closer and are compared on the fields they did store.
 */
export const EOD_SEAL_VERSION = 2;

/** Ids of seals made while the till could not reach Firestore; they live only on this device. */
export const OFFLINE_EOD_ID_PREFIX = 'offline_eod_';

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
  salesStoreCredit?: number;
  salesDebt: number;
  salesTotalRevenue: number;
  salesCogs: number;       // cost of goods sold
  salesNetProfit: number;

  // Repairs
  repairsCompleted: number;
  repairsCash: number;
  repairsCard: number;
  repairsMobile: number;
  /** Seals written before handover tenders were split carry no transfer figure. */
  repairsTransfer?: number;
  repairsDebt: number;
  repairsTotalRevenue: number;
  repairsPartsCost: number;
  repairsNetProfit: number;

  // Parts / B2B
  partsSalesCount: number;
  partsSalesRevenue: number;
  /** Legacy aliases written by earlier EOD closers */
  partsSalesCash?: number;
  partsCash?: number;
  partsCard?: number;
  partsMobile?: number;
  partsTransfer?: number;
  partsCount?: number;
  partsCogs?: number;

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

  /**
   * Provenance, so a seal can be read back months later and said to have meant something:
   * how the numbers were produced and how much source data the closer actually had loaded.
   */
  sealVersion?: number;
  sealedAt?: string;
  sealScope?: {
    posTransactions: number;
    partsInvoices: number;
    repairTickets: number;
    customerDebts: number;
  };
}

const COLLECTION = 'end_of_day';
const LOCAL_KEY  = 'eod_records';

const getLocal = (): EndOfDayRecord[] => {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; }
};
const saveLocal = (r: EndOfDayRecord[]) => {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(r)); } catch { /**/ }
};

const toRecord = (id: string, data: Record<string, unknown>): EndOfDayRecord =>
  ({ ...(data as Omit<EndOfDayRecord, 'id'>), id });

/**
 * Server rows plus the seals this till made while it was offline.
 * Without this, every successful fetch overwrote the local mirror with server rows alone and
 * an offline day disappeared from reports on the next online load, showing live numbers instead.
 */
const withLocalOnlySeals = (serverItems: EndOfDayRecord[]): EndOfDayRecord[] => {
  const sealedDates = new Set(serverItems.map(r => r.date));
  const localOnly = getLocal().filter(
    r => r.id.startsWith(OFFLINE_EOD_ID_PREFIX) && !sealedDates.has(r.date)
  );
  return [...serverItems, ...localOnly].sort(
    (a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime()
  );
};

export const endOfDayService = {
  /** Save a new EOD record */
  save: async (record: Omit<EndOfDayRecord, 'id'>): Promise<EndOfDayRecord> => {
    const local = getLocal();
    const sealed: Omit<EndOfDayRecord, 'id'> = {
      ...record,
      sealVersion: record.sealVersion ?? EOD_SEAL_VERSION,
      sealedAt: record.sealedAt ?? record.closedAt,
    };
    try {
      const ref = await addDoc(collection(db, COLLECTION), sealed);
      const created = { ...sealed, id: ref.id };
      saveLocal([created, ...local]);
      invalidateReportsCache();
      return created;
    } catch {
      const id = `${OFFLINE_EOD_ID_PREFIX}${Date.now()}`;
      const created = { ...sealed, id };
      saveLocal([created, ...local]);
      invalidateReportsCache();
      return created;
    }
  },

  /** Update notes on an existing record */
  updateNotes: async (id: string, notes: string): Promise<void> => {
    saveLocal(getLocal().map(r => r.id === id ? { ...r, notes } : r));
    if (id.startsWith(OFFLINE_EOD_ID_PREFIX)) return;
    try { await updateDoc(doc(db, COLLECTION, id), { notes }); } catch { /**/ }
  },

  /** Fetch all records, newest first */
  getAll: async (): Promise<EndOfDayRecord[]> => {
    try {
      const q = query(collection(db, COLLECTION), orderBy('closedAt', 'desc'), limit(90));
      const snap = await getDocs(q);
      const items = snap.docs.map(d => toRecord(d.id, d.data() as Record<string, unknown>));
      const merged = withLocalOnlySeals(items);
      saveLocal(merged);
      return merged;
    } catch {
      return getLocal();
    }
  },

  /**
   * Seals whose `date` falls in [fromDateStr, toDateStr] (inclusive), oldest first.
   * `getAll` stops at the 90 newest rows, so a report over a longer period would silently
   * fall back to live numbers for closed days it never saw. Dates are YYYY-MM-DD, so a
   * string range is the same as a date range.
   */
  getRange: async (
    fromDateStr: string,
    toDateStr: string,
    options?: { allowLocalFallback?: boolean }
  ): Promise<EndOfDayRecord[]> => {
    const mayFallBack = options?.allowLocalFallback !== false;
    const inRange = (r: EndOfDayRecord): boolean => r.date >= fromDateStr && r.date <= toDateStr;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (!mayFallBack) {
        throw new Error('Offline: End-of-Day records on this device are cached, not live server records.');
      }
      return getLocal().filter(inRange);
    }

    try {
      const q = query(
        collection(db, COLLECTION),
        where('date', '>=', fromDateStr),
        where('date', '<=', toDateStr),
        orderBy('date', 'asc'),
        limit(400)
      );
      const snap = await getDocs(q);
      const items = snap.docs.map(d => toRecord(d.id, d.data() as Record<string, unknown>));
      const serverDates = new Set(items.map(r => r.date));
      const localOnly = getLocal().filter(
        r => r.id.startsWith(OFFLINE_EOD_ID_PREFIX) && !serverDates.has(r.date) && inRange(r)
      );
      return [...items, ...localOnly];
    } catch (err) {
      if (!mayFallBack) throw err;
      return getLocal().filter(inRange);
    }
  },

  /** The seal for one local date, or null if that day has not been closed. */
  getByDate: async (dateStr: string): Promise<EndOfDayRecord | null> => {
    const localHit = getLocal().find(r => r.date === dateStr);
    if (localHit) return localHit;
    try {
      const q = query(collection(db, COLLECTION), where('date', '==', dateStr), limit(1));
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const d = snap.docs[0];
      return toRecord(d.id, d.data() as Record<string, unknown>);
    } catch {
      return null;
    }
  },
};
