import { create } from 'zustand';
import {
  endOfDayService,
  EOD_SEAL_VERSION,
  type EndOfDayRecord,
} from '../services/endOfDayService';
import { serverEnforcement } from '../services/serverEnforcement';
import { useCartStore } from './cartStore';
import { usePartsCartStore } from './partsCartStore';
import { useRepairStore } from './repairStore';
import { useCustomerStore } from './customerStore';
import { useAuthStore } from './authStore';
import { computeDayFigures } from '../utils/dayFigures';
import { isSameLocalDate, toDateStr } from '../utils/localDate';

// The day helpers live in utils now; re-exported so existing importers of this store keep working.
export { isSameLocalDate, toDateStr };

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
   * A date is only ever sealed once: closing an already-sealed day returns that seal
   * instead of writing a second, different one for the same day.
   */
  closeDay: (isAutoClose?: boolean, notes?: string, targetDate?: string | Date) => Promise<EndOfDayRecord>;

  /**
   * Automatically detect and close unclosed prior day(s) if missed (e.g. PC was shut off at midnight)
   */
  autoCloseMissedDays: () => Promise<EndOfDayRecord | null>;

  updateNotes: (id: string, notes: string) => Promise<void>;
}

/** This till's loaded documents, plus how much of each collection it actually holds. */
const readLiveDaySources = () => {
  const posTx = useCartStore.getState().transactions || [];
  const partsInvoices = usePartsCartStore.getState().invoices || [];
  const tickets = useRepairStore.getState().tickets || [];
  const debts = useCustomerStore.getState().debts || [];

  const txMap = new Map<string, (typeof posTx)[0]>();
  posTx.forEach(t => txMap.set(t.id, t));
  partsInvoices.forEach(t => txMap.set(t.id, t));

  return {
    sources: { transactions: Array.from(txMap.values()), repairs: tickets, debts },
    scope: {
      posTransactions: posTx.length,
      partsInvoices: partsInvoices.length,
      repairTickets: tickets.length,
      customerDebts: debts.length,
    },
  };
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
    const existing = await endOfDayService.getByDate(today);
    set({ todayRecord: existing });
  },

  buildPreview: (targetDate?: string | Date) => {
    const targetDateObj = targetDate ? (typeof targetDate === 'string' ? new Date(targetDate) : targetDate) : new Date();
    const targetDateStr = toDateStr(targetDateObj);
    const { sources, scope } = readLiveDaySources();
    const figures = computeDayFigures(sources, targetDateStr);

    const { user } = useAuthStore.getState();
    const closedAt = new Date().toISOString();

    return {
      date: targetDateStr,
      closedAt,
      closedById: user?.id,
      closedByName: user?.name || user?.email || 'System',
      isAutoClose: false,

      salesCount: figures.salesCount,
      salesCash: figures.salesCash,
      salesCard: figures.salesCard,
      salesMobile: figures.salesMobile,
      salesTransfer: figures.salesTransfer,
      salesStoreCredit: figures.salesStoreCredit,
      salesDebt: figures.salesDebt,
      salesTotalRevenue: figures.salesGrossRevenue,
      salesCogs: figures.salesCOGS,
      salesNetProfit: figures.salesNetProfit,

      repairsCompleted: figures.repairsCompletedCount,
      repairsCash: figures.repairsCash,
      repairsCard: figures.repairsHandoverCard,
      repairsMobile: figures.repairsHandoverMobile,
      repairsTransfer: figures.repairsHandoverTransfer,
      repairsDebt: figures.repairsDebt,
      repairsTotalRevenue: figures.repairsRevenue,
      repairsPartsCost: figures.repairsPartsCost,
      repairsNetProfit: figures.repairsNetProfit,

      partsSalesCount: figures.partsCount,
      partsSalesRevenue: figures.partsRevenue,
      partsCash: figures.partsCash,
      partsCard: figures.partsCard,
      partsMobile: figures.partsMobile,
      partsTransfer: figures.partsTransfer,
      partsCogs: figures.partsCOGS,

      repairDepositsCash: figures.repairsDepositCash,
      repairHandoversCash: figures.repairsHandoverCash,
      debtCollectedCash: figures.debtCollectedCash,
      refundsCash: figures.refundsCash,

      totalRevenue: figures.totalRevenue,
      totalNetProfit: figures.totalNetProfit,
      totalCash: figures.totalCash,
      totalCard: figures.totalCard,
      totalMobile: figures.totalMobile,

      sealVersion: EOD_SEAL_VERSION,
      sealedAt: closedAt,
      // The preview reads this till's loaded data, so say how much of it there was: a day
      // sealed from a half-loaded till looks different from one sealed on the full ledger.
      sealScope: scope,
    };
  },

  closeDay: async (isAutoClose = false, notes = '', targetDate?: string | Date) => {
    const targetDateStr = toDateStr(targetDate ?? new Date());

    const alreadySealed = await endOfDayService.getByDate(targetDateStr);
    if (alreadySealed) {
      set(s => ({
        records: s.records.some(r => r.id === alreadySealed.id)
          ? s.records
          : [alreadySealed, ...s.records.filter(r => r.date !== alreadySealed.date)],
        todayRecord: alreadySealed.date === toDateStr() ? alreadySealed : s.todayRecord,
        isSaving: false,
      }));
      return alreadySealed;
    }

    set({ isSaving: true });
    const preview = get().buildPreview(targetDateStr);
    const payload = { ...preview, isAutoClose, notes: notes || undefined };

    // Ask the server to write the seal when the callables are deployed: a per-date lock is
    // the only thing that keeps two tills closing the same day from producing two seals.
    const server = await serverEnforcement.sealEndOfDay(payload);
    if (server.status === 'ok') {
      const sealed =
        (await endOfDayService.getByDate(targetDateStr)) ?? { ...payload, id: server.data.sealId };
      set(s => ({
        records: [sealed, ...s.records.filter(r => r.date !== sealed.date)],
        todayRecord: sealed.date === toDateStr() ? sealed : s.todayRecord,
        isSaving: false,
      }));
      return sealed;
    }
    if (server.status === 'rejected') {
      // The shop still has to close its day, so a refusal degrades to the local write - but
      // out loud, because a rejected seal means something the next report will disagree with.
      console.warn('Server refused this seal, closing the day locally:', server.message);
    }

    const record = await endOfDayService.save(payload);
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
    let lastClosedRecord: EndOfDayRecord | null = null;

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
