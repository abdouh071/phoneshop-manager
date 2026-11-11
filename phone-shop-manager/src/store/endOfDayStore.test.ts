/**
 * Sealing a day from the till.
 *
 * A date gets exactly one seal: closing an already-closed day returns the seal it finds
 * rather than writing a second, different one that reports would then have to pick between.
 * The four data stores are stubbed so the seal's provenance can be asserted without Firebase,
 * and the callable path is stubbed too - a till with the functions deployed hands the write
 * to the server, and one without them closes exactly as it always did.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SaleTransaction } from '../types';

const tx = (id: string, date: string, amount: number): SaleTransaction => ({
  id,
  date,
  items: [],
  subtotal: amount,
  total: amount,
  payments: [{ method: 'cash', amount }],
  status: 'completed',
});

const data = vi.hoisted(() => ({
  transactions: [] as unknown[],
  invoices: [] as unknown[],
  tickets: [] as unknown[],
  debts: [] as unknown[],
  sealCache: null as null | Record<string, unknown>,
  /** The row a deployed `sealEndOfDay` leaves behind, read back through `getByDate`. */
  serverSeal: null as null | Record<string, unknown>,
  saved: [] as Array<Record<string, unknown>>,
}));

const server = vi.hoisted(() => ({
  sealAnswer: null as null | Record<string, unknown>,
  /** The row the callable wrote only becomes readable *after* it ran; before that the day is open. */
  called: false,
  calls: 0,
}));

vi.mock('../services/serverEnforcement', () => ({
  serverEnforcement: {
    sealEndOfDay: async () => {
      server.called = true;
      server.calls += 1;
      return server.sealAnswer ?? { status: 'unavailable', message: 'functions are not deployed' };
    },
    verifyApprovalPin: async () => ({ status: 'unavailable', message: 'functions are not deployed' }),
  },
}));

vi.mock('./cartStore', () => ({ useCartStore: { getState: () => ({ transactions: data.transactions }) } }));
vi.mock('./partsCartStore', () => ({ usePartsCartStore: { getState: () => ({ invoices: data.invoices }) } }));
vi.mock('./repairStore', () => ({ useRepairStore: { getState: () => ({ tickets: data.tickets }) } }));
vi.mock('./customerStore', () => ({ useCustomerStore: { getState: () => ({ debts: data.debts }) } }));
vi.mock('./authStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'u-1', name: 'Admin' } }) },
}));

vi.mock('../services/endOfDayService', () => ({
  EOD_SEAL_VERSION: 2,
  endOfDayService: {
    getAll: async () => [],
    getByDate: async (date: string) =>
      data.sealCache && data.sealCache.date === date
        ? data.sealCache
        : server.called && data.serverSeal && data.serverSeal.date === date
          ? data.serverSeal
          : null,
    save: async (record: Record<string, unknown>) => {
      data.saved.push(record);
      return { ...record, id: 'seal-new' };
    },
    updateNotes: async () => {},
  },
}));

const localDate = (offsetDays = 0): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const atOn = (day: string, hour: number): string => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0).toISOString();
};

const loadStore = async () => {
  vi.resetModules();
  const mod = await import('./endOfDayStore');
  return mod.useEndOfDayStore;
};

describe('endOfDayStore.closeDay', () => {
  beforeEach(() => {
    data.transactions = [];
    data.invoices = [];
    data.tickets = [];
    data.debts = [];
    data.sealCache = null;
    data.serverSeal = null;
    server.sealAnswer = null;
    server.called = false;
    server.calls = 0;
    data.saved.length = 0;
  });

  it('returns the existing seal instead of closing the same day twice', async () => {
    const store = await loadStore();
    const today = localDate();
    data.sealCache = { id: 'seal-existing', date: today, totalRevenue: 500, closedAt: atOn(today, 23) };
    data.transactions = [tx('tx-late', atOn(today, 10), 900)];

    const record = await store.getState().closeDay(false, 'extra cash');

    expect(record.id).toBe('seal-existing');
    expect(data.saved).toHaveLength(0);
  });

  it('seals an open day once, with the numbers and the provenance', async () => {
    const store = await loadStore();
    const today = localDate();
    data.transactions = [tx('tx-1', atOn(today, 10), 400), tx('tx-2', atOn(today, 11), 100)];

    const record = await store.getState().closeDay(true, 'Drawer verified');

    expect(data.saved).toHaveLength(1);
    expect(record.id).toBe('seal-new');
    expect(record.totalRevenue).toBe(500);
    expect(record.totalCash).toBe(500);
    expect(record.isAutoClose).toBe(true);
    expect(record.notes).toBe('Drawer verified');
    expect(record.sealVersion).toBe(2);
    expect(record.sealScope).toEqual({
      posTransactions: 2,
      partsInvoices: 0,
      repairTickets: 0,
      customerDebts: 0,
    });
  });

  it('keeps a seal for a past day on that day, not on today', async () => {
    const store = await loadStore();
    const yesterday = localDate(-1);
    data.transactions = [
      tx('tx-old', atOn(yesterday, 18), 700),
      tx('tx-today', atOn(localDate(), 9), 50),
    ];

    const record = await store.getState().closeDay(true, 'Auto-closed yesterday', yesterday);

    expect(record.date).toBe(yesterday);
    expect(record.salesCount).toBe(1);
    expect(record.totalRevenue).toBe(700);
  });

  it('seals the whole parts block, not only its revenue', async () => {
    const store = await loadStore();
    const today = localDate();
    data.invoices = [
      {
        id: 'inv-1',
        date: atOn(today, 12),
        saleType: 'parts_b2b',
        status: 'completed',
        total: 1000,
        payments: [{ method: 'card', amount: 1000 }],
        items: [{ quantity: 2, product: { costPrice: 300 } }],
      },
    ];
    data.transactions = [
      {
        id: 'tx-1',
        date: atOn(today, 9),
        status: 'completed',
        total: 250,
        payments: [{ method: 'store_credit', amount: 250 }],
        items: [],
      },
    ];

    const preview = store.getState().buildPreview();

    expect(preview.partsSalesRevenue).toBe(1000);
    expect(preview.partsCogs).toBe(600);
    expect(preview.partsCard).toBe(1000);
    expect(preview.partsCash).toBe(0);
    expect(preview.salesStoreCredit).toBe(250);
    // Reports add parts cost to the day's COGS; a seal that omits it would show 100% parts margin.
    expect(preview.totalNetProfit).toBe(250 + 1000 - 600);
  });

  it('lets the server write the seal and does not write a second one locally', async () => {
    const store = await loadStore();
    const today = localDate();
    data.transactions = [tx('tx-1', atOn(today, 10), 400)];
    data.serverSeal = { id: 'seal-server', date: today, totalRevenue: 400, closedAt: atOn(today, 23) };
    server.sealAnswer = { status: 'ok', data: { status: 'sealed', sealId: 'seal-server', date: today } };

    const record = await store.getState().closeDay(false, 'sealed upstairs');

    expect(data.saved).toHaveLength(0);
    expect(record.id).toBe('seal-server');
  });

  it('refuses to close when the server rejects the seal', async () => {
    const store = await loadStore();
    const today = localDate();
    data.transactions = [tx('tx-1', atOn(today, 10), 400)];
    server.sealAnswer = { status: 'rejected', code: 'failed-precondition', message: 'inconsistent seal' };

    await expect(store.getState().closeDay(true, '')).rejects.toThrow('inconsistent seal');

    // A local seal after a refusal would be a second, different truth for this day.
    expect(data.saved).toHaveLength(0);
    expect(store.getState().records).toHaveLength(0);
    expect(store.getState().isSaving).toBe(false);
  });

  it('adopts the seal the server committed when its answer was lost', async () => {
    const store = await loadStore();
    const today = localDate();
    data.transactions = [tx('tx-1', atOn(today, 10), 400)];
    // The callable wrote the seal, then the response never arrived: the day looks open
    // locally, but writing again would give reports two truths for one date.
    data.serverSeal = { id: 'seal-server', date: today, totalRevenue: 400, closedAt: atOn(today, 23) };
    server.sealAnswer = { status: 'unavailable', message: 'response lost' };

    const record = await store.getState().closeDay(false, '');

    expect(record.id).toBe('seal-server');
    expect(data.saved).toHaveLength(0);
    expect(store.getState().todayRecord?.id).toBe('seal-server');
  });

  it('still closes locally when no server answered and no seal exists', async () => {
    const store = await loadStore();
    const today = localDate();
    data.transactions = [tx('tx-1', atOn(today, 10), 400)];
    server.sealAnswer = { status: 'unavailable', message: 'functions are not deployed' };

    const record = await store.getState().closeDay(false, '');

    expect(data.saved).toHaveLength(1);
    expect(record.id).toBe('seal-new');
  });

  it('keeps closing the backlog after one day is refused', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = await loadStore();
    data.transactions = [
      tx('tx-1', atOn(localDate(-1), 10), 400),
      tx('tx-2', atOn(localDate(-2), 10), 300),
    ];
    server.sealAnswer = { status: 'rejected', code: 'failed-precondition', message: 'inconsistent seal' };

    const record = await store.getState().autoCloseMissedDays();

    expect(record).toBeNull();
    expect(server.calls).toBe(2);
    expect(data.saved).toHaveLength(0);
    error.mockRestore();
  });

  it('previews without writing anything', async () => {
    const store = await loadStore();
    data.transactions = [tx('tx-1', atOn(localDate(), 9), 300)];

    const preview = store.getState().buildPreview();

    expect(preview.salesCash).toBe(300);
    expect(preview.sealScope?.posTransactions).toBe(1);
    expect(data.saved).toHaveLength(0);
  });
});
