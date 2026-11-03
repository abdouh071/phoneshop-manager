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
  stats: { transactions: 0, tickets: 0 },
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
    updateCustomer: () => Promise.resolve(undefined),
  },
}));

vi.mock('../services/debtService', () => ({
  debtService: { getAll: () => Promise.resolve(data.debts) },
}));

vi.mock('../services/customerLogService', () => ({
  customerLogService: { getAll: () => Promise.resolve(data.logs) },
}));

vi.mock('../services/activityLogService', () => ({
  activityLogService: { log: () => Promise.resolve(undefined) },
}));

vi.mock('../services/transactionService', () => ({
  transactionService: {
    getAll: () => {
      data.stats.transactions++;
      return Promise.resolve(data.transactions);
    },
  },
}));

vi.mock('../services/repairService', () => ({
  repairService: {
    getAll: () => {
      data.stats.tickets++;
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
    data.stats.transactions = 0;
    data.stats.tickets = 0;
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
});
