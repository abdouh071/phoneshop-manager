/**
 * The shared sale/repair history snapshot inside customerStore.
 *
 * fetchCustomers runs on every tab mount and recalculateCustomer runs after every sale,
 * settlement and debt payment. Before this they each read the WHOLE transactions and repairs
 * collections, so a single till visit billed the entire history several times. The snapshot is
 * only allowed to shorten that window — these tests pin down that a read still happens when the
 * cache is stale or explicitly forced, so totals cannot silently freeze.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const data = vi.hoisted(() => ({
  customers: [] as Array<Record<string, unknown>>,
  debts: [] as Array<Record<string, unknown>>,
  logs: [] as Array<Record<string, unknown>>,
  transactions: [] as Array<Record<string, unknown>>,
  tickets: [] as Array<Record<string, unknown>>,
  localCart: [] as Array<Record<string, unknown>>,
  localInvoices: [] as Array<Record<string, unknown>>,
  localTickets: [] as Array<Record<string, unknown>>,
  writes: [] as Array<Record<string, unknown>>,
  /** Each flag makes that read answer only from this device's cache, as a slow network does. */
  fail: { transactions: false, tickets: false, debts: false },
  stats: { transactions: 0, tickets: 0, debts: 0 },
}));

const customer = {
  id: 'cust_1',
  name: 'Karim',
  phone: '0555123456',
  accountType: 'retail',
  totalSpent: 0,
  totalPurchases: 0,
  totalDebt: 0,
};

vi.mock('../services/customerService', () => ({
  customerService: {
    getAll: () => Promise.resolve(data.customers),
    updateCustomer: (id: string, updates: Record<string, unknown>) => {
      data.writes.push({ id, ...updates });
      return Promise.resolve(undefined);
    },
  },
}));

vi.mock('../services/debtService', () => ({
  debtService: {
    getAll: (options?: { allowLocalFallback?: boolean }) => {
      data.stats.debts++;
      if (data.fail.debts && options?.allowLocalFallback === false) {
        return Promise.reject(new Error('unavailable'));
      }
      return Promise.resolve(data.debts);
    },
  },
}));

vi.mock('../services/customerLogService', () => ({
  customerLogService: { getAll: () => Promise.resolve(data.logs) },
}));

vi.mock('../services/activityLogService', () => ({
  activityLogService: { log: () => Promise.resolve(undefined) },
}));

vi.mock('../services/transactionService', () => ({
  transactionService: {
    getAll: (options?: { allowLocalFallback?: boolean }) => {
      data.stats.transactions++;
      // The store asks for a strict read: it must be refused, not answered from a cache,
      // when the server did not reply.
      if (data.fail.transactions && options?.allowLocalFallback === false) {
        return Promise.reject(new Error('unavailable'));
      }
      return Promise.resolve(data.transactions);
    },
  },
}));

vi.mock('../services/repairService', () => ({
  repairService: {
    getAll: (options?: { allowLocalFallback?: boolean }) => {
      data.stats.tickets++;
      if (data.fail.tickets && options?.allowLocalFallback === false) {
        return Promise.reject(new Error('unavailable'));
      }
      return Promise.resolve(data.tickets);
    },
  },
}));

vi.mock('./authStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'u1', name: 'Owner', role: 'admin' } }) },
}));

vi.mock('../utils/formatCurrency', () => ({
  formatCurrency: (n: number) => `${n}`,
}));

vi.mock('./cartStore', () => ({
  useCartStore: { getState: () => ({ transactions: data.localCart }) },
}));

vi.mock('./partsCartStore', () => ({
  usePartsCartStore: { getState: () => ({ invoices: data.localInvoices }) },
}));

vi.mock('./repairStore', () => ({
  useRepairStore: { getState: () => ({ tickets: data.localTickets }) },
}));

type CustomerStore = {
  getState: () => {
    customers: Array<Record<string, unknown>>;
    isLoading: boolean;
    fetchCustomers: (options?: { force?: boolean }) => Promise<void>;
    recalculateCustomer: (id: string) => Promise<void>;
    recalculateAllCustomerFinancials: () => Promise<void>;
  };
};

async function loadStore(): Promise<CustomerStore> {
  vi.resetModules();
  const module = await import('./customerStore');
  return module.useCustomerStore as unknown as CustomerStore;
}

describe('customerStore shared history snapshot', () => {
  beforeEach(() => {
    vi.resetModules();
    data.customers = [customer];
    data.debts = [];
    data.logs = [];
    data.transactions = [
      { id: 'tx_1', customerId: 'cust_1', total: 500, status: 'completed', date: '2026-01-05T10:00:00.000Z' },
    ];
    data.tickets = [
      { id: 'tk_1', customerId: 'cust_1', estimatedCost: 2000, status: 'completed', createdAt: '2026-01-04T10:00:00.000Z' },
    ];
    data.localCart = [];
    data.localInvoices = [];
    data.localTickets = [];
    data.writes = [];
    data.fail = { transactions: false, tickets: false, debts: false };
    data.stats.transactions = 0;
    data.stats.tickets = 0;
    data.stats.debts = 0;
  });

  it('reads the two history collections once for concurrent mounts', async () => {
    const store = await loadStore();
    const state = store.getState();

    await Promise.all([state.fetchCustomers(), state.fetchCustomers(), state.fetchCustomers()]);

    expect(data.stats.transactions).toBe(1);
    expect(data.stats.tickets).toBe(1);
  });

  it('reuses the snapshot for the recalculation that follows a sale', async () => {
    const store = await loadStore();
    const state = store.getState();

    await state.fetchCustomers();
    await state.recalculateCustomer('cust_1');
    await state.recalculateCustomer('cust_1');

    expect(data.stats.transactions).toBe(1);
    expect(data.stats.tickets).toBe(1);
  });

  it('still counts the newest sale from the in-memory cart when the snapshot is reused', async () => {
    const store = await loadStore();
    const state = store.getState();

    await state.fetchCustomers();
    // A sale committed seconds ago is not in the snapshot yet, but it is in cartStore.
    data.localCart = [
      { id: 'tx_2', customerId: 'cust_1', total: 250, status: 'completed', date: '2026-01-05T11:00:00.000Z' },
    ];
    await state.recalculateCustomer('cust_1');

    const saved = store.getState().customers.find(c => c.id === 'cust_1');
    expect(saved?.totalSpent).toBe(2750);
  });

  it('forces a fresh read when asked to', async () => {
    const store = await loadStore();
    const state = store.getState();

    await state.fetchCustomers();
    expect(data.stats.transactions).toBe(1);

    await state.fetchCustomers({ force: true });
    expect(data.stats.transactions).toBe(2);

    // The deliberate "recompute every customer" action never reads through the cache.
    await state.recalculateAllCustomerFinancials();
    expect(data.stats.transactions).toBe(3);
    expect(data.stats.tickets).toBe(3);
  });

  it('expires the snapshot so staleness stays bounded', async () => {
    vi.useFakeTimers();
    try {
      const store = await loadStore();
      const state = store.getState();

      await state.fetchCustomers();
      await state.recalculateCustomer('cust_1');
      expect(data.stats.transactions).toBe(1);

      // Past the window, the next recalculation must go back to the server.
      vi.setSystemTime(Date.now() + 16_000);
      await state.recalculateCustomer('cust_1');
      expect(data.stats.transactions).toBe(2);
      expect(data.stats.tickets).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not blank the list with a spinner when the data is already on screen', async () => {
    const store = await loadStore();
    const state = store.getState();

    await state.fetchCustomers();
    expect(store.getState().customers.length).toBe(1);

    const reloading = state.fetchCustomers();
    expect(store.getState().isLoading).toBe(false);
    await reloading;

    expect(store.getState().customers.length).toBe(1);
  });

  describe('a history read that did not reach the server', () => {
    it('writes nothing after a sale when the sale history could not be read', async () => {
      vi.useFakeTimers();
      try {
        const store = await loadStore();
        const state = store.getState();

        data.fail.transactions = true;
        await state.fetchCustomers();
        expect(data.writes).toEqual([]);

        // The till overlays its own newest sale, so a recalculation would happily produce a
        // figure — from one device's memory of the shop rather than the shop's history.
        data.localCart = [
          { id: 'tx_9', customerId: 'cust_1', total: 1000, status: 'completed', date: '2026-01-06T10:00:00.000Z' },
        ];
        await state.recalculateCustomer('cust_1');
        await vi.advanceTimersByTimeAsync(2_000);

        expect(data.writes).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('still writes when the same read succeeds', async () => {
      vi.useFakeTimers();
      try {
        const store = await loadStore();
        const state = store.getState();

        await state.fetchCustomers();
        await state.recalculateCustomer('cust_1');
        await vi.advanceTimersByTimeAsync(2_000);

        expect(data.writes.length).toBeGreaterThan(0);
        expect(data.writes[data.writes.length - 1]).toMatchObject({
          id: 'cust_1',
          totalSpent: 2500,
          totalDebt: 0,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('skips the background repair of every customer when the debt ledger is only a cache', async () => {
      vi.useFakeTimers();
      try {
        const store = await loadStore();
        const state = store.getState();

        data.fail.debts = true;
        await state.fetchCustomers();
        await vi.advanceTimersByTimeAsync(2_000);

        // Mounting the customers tab computes totals that differ from the documents and used to
        // push them straight to Firestore. The ledger here is this device's, so nothing is sent.
        expect(data.writes).toEqual([]);
        expect(data.stats.debts).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('refuses the recompute of every customer on a degraded read', async () => {
      vi.useFakeTimers();
      try {
        const store = await loadStore();
        const state = store.getState();

        await state.fetchCustomers();
        // Let the repair that fetch scheduled on a healthy read finish, then start the refusal
        // check from an empty log so only the degraded pass can be recorded.
        await vi.advanceTimersByTimeAsync(2_000);
        data.writes = [];
        data.fail.tickets = true;

        await state.recalculateAllCustomerFinancials();
        await vi.advanceTimersByTimeAsync(2_000);

        expect(data.writes).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
