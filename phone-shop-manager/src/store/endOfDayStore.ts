import { create } from 'zustand';
import { endOfDayService, type EndOfDayRecord } from '../services/endOfDayService';
import { useCartStore } from './cartStore';
import { usePartsCartStore } from './partsCartStore';
import { useRepairStore } from './repairStore';
import { useCustomerStore } from './customerStore';
import { useAuthStore } from './authStore';
import {
  isClaimedAndPaidRepair,
  getClaimedRepairRevenue,
  getClaimedRepairHandoverCash,
  getClaimedRepairPartsCost,
  getClaimedRepairDebt,
} from '../utils/repairFinancials';

interface EndOfDayState {
  records: EndOfDayRecord[];
  todayRecord: EndOfDayRecord | null;
  isLoading: boolean;
  isSaving: boolean;

  fetchRecords: () => Promise<void>;
  checkTodayRecord: () => Promise<void>;

  /**
   * Build a live preview of target date's numbers without saving.
   * If targetDate is omitted, builds preview for today.
   */
  buildPreview: (targetDate?: string | Date) => Omit<EndOfDayRecord, 'id'>;

  /**
   * Permanently close the day and persist the record.
   */
  closeDay: (isAutoClose?: boolean, notes?: string, targetDate?: string | Date) => Promise<EndOfDayRecord>;

  /**
   * Automatically detect and close unclosed prior day(s) if missed (e.g. PC was shut off at midnight)
   */
  autoCloseMissedDays: () => Promise<EndOfDayRecord | null>;

  updateNotes: (id: string, notes: string) => Promise<void>;
}

/** Returns YYYY-MM-DD in local time for a given Date or string */
export const toDateStr = (d: Date | string = new Date()): string => {
  const dateObj = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dateObj.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** Checks if an ISO timestamp falls on the target local date YYYY-MM-DD */
export const isSameLocalDate = (iso: string | undefined | null, targetLocalDateStr: string): boolean => {
  if (!iso) return false;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return false;
    return toDateStr(d) === targetLocalDateStr;
  } catch {
    return false;
  }
};

export const useEndOfDayStore = create<EndOfDayState>((set, get) => ({
  records: [],
  todayRecord: null,
  isLoading: false,
  isSaving: false,

  fetchRecords: async () => {
    set({ isLoading: true });
    const records = await endOfDayService.getAll();
    set({ records, isLoading: false });
  },

  checkTodayRecord: async () => {
    const today = toDateStr();
    const existing = await endOfDayService.getTodayRecord(today);
    set({ todayRecord: existing });
  },

  buildPreview: (targetDate?: string | Date) => {
    const targetDateObj = targetDate ? (typeof targetDate === 'string' ? new Date(targetDate) : targetDate) : new Date();
    const targetDateStr = toDateStr(targetDateObj);

    // ---- 1. Sales (POS & Parts B2B) ----
    const posTx = useCartStore.getState().transactions || [];
    const partsInvoices = usePartsCartStore.getState().invoices || [];
    const txMap = new Map<string, typeof posTx[0]>();
    posTx.forEach(t => txMap.set(t.id, t));
    partsInvoices.forEach(t => txMap.set(t.id, t));
    const allTx = Array.from(txMap.values());

    const todayTx = allTx.filter(t => t.status !== 'refunded' && t.saleType !== 'parts_b2b' && isSameLocalDate(t.date, targetDateStr));
    const refundedTx = allTx.filter(t => t.status === 'refunded' && isSameLocalDate(t.date, targetDateStr));
    const partsTx = allTx.filter(t => t.status !== 'refunded' && t.saleType === 'parts_b2b' && isSameLocalDate(t.date, targetDateStr));

    const sumPayment = (txList: typeof allTx, method: string) =>
      txList.reduce((s, tx) => s + (tx.payments || []).filter(p => p.method === method).reduce((a, p) => a + p.amount, 0), 0);

    const salesCash     = sumPayment(todayTx, 'cash');
    const salesCard     = sumPayment(todayTx, 'card');
    const salesMobile   = sumPayment(todayTx, 'mobile');
    const salesTransfer = sumPayment(todayTx, 'transfer');
    const salesDebt     = sumPayment(todayTx, 'debt');
    const salesTotalRevenue = todayTx.reduce((s, t) => s + t.total, 0);
    const salesCogs = todayTx.reduce(
      (s, t) => s + t.items.reduce((a, i) => a + (i.product.costPrice || 0) * i.quantity, 0), 0
    );

    // Cash refunds paid out today
    const refundsCash = sumPayment(refundedTx, 'cash');

    // ---- 2. Repairs ----
    const allTickets = useRepairStore.getState().tickets || [];

    // Only tickets completed ON this day
    const completedRepairs = allTickets.filter(t =>
      t.status === 'completed' &&
      isSameLocalDate(t.completedAt || t.updatedAt, targetDateStr)
    );

    // CLAIMED & PAID/PARTLY-PAID repairs = recognized revenue
    // Phones with status 'completed' but paymentStatus 'debt' (0 paid) are NOT counted
    // until the customer makes a payment (tracked via debt repayments).
    // Phones with paymentStatus 'partial' ONLY count the paid amount, NOT the full price!
    const claimedPaidRepairs = completedRepairs.filter(r => isClaimedAndPaidRepair(r));

    // RECOGNIZED revenue: paid amount for partial, full price for paid
    const repairsTotalRevenue = claimedPaidRepairs.reduce(
      (s, r) => s + getClaimedRepairRevenue(r), 0
    );

    // Handover cash received today upon completion (excludes intake deposits)
    const repairHandoversCash = claimedPaidRepairs.reduce(
      (s, r) => s + getClaimedRepairHandoverCash(r), 0
    );

    // Deposits collected today on newly received phones (regardless of completion)
    const ticketsCreatedToday = allTickets.filter(t => isSameLocalDate(t.createdAt, targetDateStr));
    const repairDepositsCash = ticketsCreatedToday.reduce((s, t) => s + (t.depositAmount || 0), 0);

    // Unpaid debt on completed repairs (phones claimed but not fully paid)
    const repairsDebt = completedRepairs.reduce(
      (s, r) => s + getClaimedRepairDebt(r), 0
    );

    // Parts cost only for recognized (claimed & paid) repairs
    const repairsPartsCost = claimedPaidRepairs.reduce(
      (s, r) => s + getClaimedRepairPartsCost(r), 0
    );

    // Total cash from repairs = handover collections + intake deposits
    const repairsCash = repairHandoversCash + repairDepositsCash;

    // ---- 3. Customer Debt Collections (Dette repayments made today) ----
    const allDebts = useCustomerStore.getState().debts || [];
    const todayDebtPayments = allDebts.flatMap(d =>
      (d.payments || []).filter(p => isSameLocalDate(p.date, targetDateStr))
    );
    const debtCollectedCash = todayDebtPayments
      .filter(p => p.method === 'cash')
      .reduce((s, p) => s + p.amount, 0);

    // ---- 4. Parts B2B ----
    const partsSalesRevenue = partsTx.reduce((s, t) => s + t.total, 0);
    const partsSalesCash    = sumPayment(partsTx, 'cash');
    const partsSalesCard    = sumPayment(partsTx, 'card');
    const partsSalesMobile  = sumPayment(partsTx, 'mobile');

    // ---- 5. Grand Totals (including debt recovered today) ----
    const totalRevenue = salesTotalRevenue + repairsTotalRevenue + partsSalesRevenue + debtCollectedCash;
    // Exact physical cash in drawer: POS cash + Parts B2B cash + Repair handover + Repair deposit + Debt payments - Cash refunds
    const totalCash    = Math.max(0, (salesCash + partsSalesCash + repairsCash + debtCollectedCash) - refundsCash);
    const totalCard    = salesCard + partsSalesCard;
    const totalMobile  = salesMobile + partsSalesMobile;
    const totalNetProfit = (salesTotalRevenue - salesCogs) + (repairsTotalRevenue - repairsPartsCost) + debtCollectedCash;

    const { user } = useAuthStore.getState();

    return {
      date: targetDateStr,
      closedAt: new Date().toISOString(),
      closedById: user?.id,
      closedByName: user?.name || user?.email || 'System',
      isAutoClose: false,

      salesCount: todayTx.length,
      salesCash, salesCard, salesMobile, salesTransfer, salesDebt,
      salesTotalRevenue,
      salesCogs,
      salesNetProfit: salesTotalRevenue - salesCogs,

      repairsCompleted: completedRepairs.length,
      repairsCash,
      repairsCard: 0,
      repairsMobile: 0,
      repairsDebt,
      repairsTotalRevenue,
      repairsPartsCost,
      repairsNetProfit: repairsTotalRevenue - repairsPartsCost,

      partsSalesCount: partsTx.length,
      partsSalesRevenue,

      repairDepositsCash,
      repairHandoversCash,
      debtCollectedCash,
      refundsCash,

      totalRevenue,
      totalNetProfit,
      totalCash,
      totalCard,
      totalMobile,
    };
  },

  closeDay: async (isAutoClose = false, notes = '', targetDate?: string | Date) => {
    set({ isSaving: true });
    const preview = get().buildPreview(targetDate);
    const record = await endOfDayService.save({ ...preview, isAutoClose, notes: notes || undefined });
    set(s => ({
      records: [record, ...s.records.filter(r => r.date !== record.date)],
      todayRecord: record.date === toDateStr() ? record : s.todayRecord,
      isSaving: false,
    }));
    return record;
  },

  autoCloseMissedDays: async () => {
    await get().fetchRecords();
    const { records } = get();
    const now = new Date();
    let lastClosedRecord: any = null;

    // Check up to 7 days backward (from oldest to yesterday) to close all unclosed days with activity
    const MAX_LOOKBACK_DAYS = 7;
    for (let daysAgo = MAX_LOOKBACK_DAYS; daysAgo >= 1; daysAgo--) {
      const pastDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
      const pastDateStr = toDateStr(pastDate);

      const alreadyClosed = records.some(r => r.date === pastDateStr);
      if (!alreadyClosed) {
        const prev = get().buildPreview(pastDateStr);
        // If there was any activity on that day, seal it automatically
        if (prev.totalRevenue > 0 || prev.totalCash > 0 || prev.salesCount > 0 || prev.repairsCompleted > 0) {
          console.log(`[EndOfDay] Automatically closing unclosed past day: ${pastDateStr}`);
          lastClosedRecord = await get().closeDay(true, `Auto-closed for ${pastDateStr} on shop open`, pastDateStr);
        }
      }
    }
    return lastClosedRecord;
  },

  updateNotes: async (id, notes) => {
    await endOfDayService.updateNotes(id, notes);
    set(s => ({
      records: s.records.map(r => r.id === id ? { ...r, notes } : r),
      todayRecord: s.todayRecord?.id === id ? { ...s.todayRecord, notes } : s.todayRecord,
    }));
  },
}));
