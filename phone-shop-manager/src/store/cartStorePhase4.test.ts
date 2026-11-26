/**
 * Phase 4 TDD Regression Tests — Coordinated Invoice Edits, Un-swallowed Financial Failures,
 * Offline Edit Queueing & Conflict Detection via cartStore.editTransaction.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Customer, CustomerDebtEntry, PhoneModel, SaleTransaction } from '../types';

const fake = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  const versions = new Map<string, number>();
  const flags = { reject: null as string | null, loseAck: false };
  let queue = Promise.resolve() as Promise<unknown>;

  const writeDoc = (key: string, data: Record<string, unknown>, merge = true) => {
    const prev = merge ? docs.get(key) : undefined;
    docs.set(key, { ...prev, ...structuredClone(data) });
    versions.set(key, (versions.get(key) ?? 0) + 1);
  };
  const makeRef = (name: string, id: string) => ({ name, id, key: `${name}/${id}` });

  return {
    docs,
    versions,
    flags,
    writeDoc,
    doc: (_db: unknown, name: string, id: string) => makeRef(name, id),
    collection: (_db: unknown, name: string) => ({ name }),
    where: (field: string, _op: string, value: unknown) => ({ field, value }),
    query: (target: { name: string }, filter: { field: string; value: unknown }) => ({ name: target.name, filter }),
    getDoc: async (r: { key: string; id: string }) => {
      const data = docs.get(r.key);
      return { id: r.id, ref: r, exists: () => data !== undefined, data: () => structuredClone(data ?? {}) };
    },
    getDocs: async (q: { name: string; filter?: { field: string; value: unknown } }) => {
      const rows = [...docs.entries()]
        .filter(([k, d]) => k.startsWith(`${q.name}/`) && (!q.filter || d[q.filter.field] === q.filter.value))
        .map(([k, d]) => {
          const [, id] = k.split('/');
          return { id, ref: makeRef(q.name, id), exists: () => true, data: () => structuredClone(d) };
        });
      return { empty: rows.length === 0, docs: rows };
    },
    runTransaction: vi.fn(async (_db: unknown, callback: (tx: {
      get: (r: { key: string; id: string }) => Promise<{ exists: () => boolean; data: () => Record<string, unknown>; id: string }>;
      update: (r: { key: string }, patch: Record<string, unknown>) => void;
      set: (r: { key: string }, data: Record<string, unknown>, opts?: { merge?: boolean }) => void;
    }) => Promise<unknown>) => {
      const run = queue.then(async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
          const reads = new Map<string, number>();
          const writes: Array<{ key: string; patch: Record<string, unknown>; merge: boolean }> = [];
          const res = await callback({
            get: async (r) => {
              if (writes.length > 0) throw new Error('Read after write');
              reads.set(r.key, versions.get(r.key) ?? 0);
              const data = docs.get(r.key);
              return { id: r.id, exists: () => data !== undefined, data: () => structuredClone(data ?? {}) };
            },
            update: (r, patch) => {
              if (!docs.has(r.key)) throw new Error('Missing update target');
              writes.push({ key: r.key, patch, merge: true });
            },
            set: (r, data, opts) => {
              writes.push({ key: r.key, patch: data, merge: Boolean(opts?.merge) });
            },
          });
          if (flags.reject) throw new Error(flags.reject);
          if ([...reads].some(([k, v]) => (versions.get(k) ?? 0) !== v)) continue;
          for (const w of writes) writeDoc(w.key, w.patch, w.merge);
          if (flags.loseAck) {
            flags.loseAck = false;
            throw new Error('Acknowledgement lost');
          }
          return res;
        }
        throw new Error('Contention');
      });
      queue = run.catch(() => undefined);
      return run;
    }),
    reset: () => {
      docs.clear();
      versions.clear();
      flags.reject = null;
      flags.loseAck = false;
    },
  };
});

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    doc: fake.doc,
    collection: fake.collection,
    where: fake.where,
    query: fake.query,
    getDoc: fake.getDoc,
    getDocs: fake.getDocs,
    getDocsFromServer: fake.getDocs,
    runTransaction: fake.runTransaction,
    Timestamp: { now: () => 'fixture-timestamp' },
  };
});

vi.mock('../store/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('../services/activityLogService', () => ({ activityLogService: { log: vi.fn(async () => undefined) } }));
vi.mock('../services/customerLogService', () => ({ customerLogService: { log: vi.fn(async () => undefined) } }));
vi.mock('./authStore', () => ({
  useAuthStore: {
    getState: () => ({ user: { id: 'admin_1', name: 'Owner', role: 'admin' } }),
  },
}));

import { useCartStore } from './cartStore';
import { useInventoryStore } from './inventoryStore';
import { useCustomerStore } from './customerStore';
import { offlineQueue } from '../services/offlineQueue';
import { offlineDeadLetterStore } from '../services/offlineDeadLetterStore';
import { registerOfflineHandlers } from '../services/offlineHandlers';
import { transactionService } from '../services/transactionService';

const mockStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, value: string) => mockStorage.set(key, String(value)),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

const PHONE = {
  id: 'prod_1',
  name: 'Galaxy A55',
  model: '256GB',
  price: 10000,
  cost: 7000,
  stock: 5,
  lowStockThreshold: 1,
} as unknown as PhoneModel;

const CUSTOMER: Customer = {
  id: 'cust_1',
  name: 'Karim',
  phone: '0550112233',
  normalizedPhone: '0550112233',
  accountType: 'retail',
  totalDebt: 5000,
  storeCredit: 0,
  totalPurchases: 1,
  totalSpent: 10000,
  joinDate: '2026-10-01T00:00:00.000Z',
  lastVisitDate: '2026-11-10T00:00:00.000Z',
};

const DEBT: CustomerDebtEntry = {
  id: 'debt_1',
  customerId: 'cust_1',
  customerName: 'Karim',
  customerPhone: '0550112233',
  productOrService: '1x Galaxy A55',
  date: '2026-11-10T10:00:00.000Z',
  totalAmount: 10000,
  amountPaid: 5000,
  remainingBalance: 5000,
  status: 'partially_paid',
  transactionId: 'tx_srv_1',
  invoiceNumber: 'INV-500',
  payments: [{ id: 'pay_1', date: '2026-11-10T10:00:00.000Z', amount: 5000, method: 'cash' }],
  createdAt: '2026-11-10T10:00:00.000Z',
  updatedAt: '2026-11-10T10:00:00.000Z',
};

const SALE: SaleTransaction = {
  id: 'tx_srv_1',
  date: '2026-11-10T10:00:00.000Z',
  stockApplied: true,
  status: 'completed',
  financialRevision: 0,
  items: [{ product: PHONE, quantity: 1 }],
  subtotal: 10000,
  total: 10000,
  payments: [{ method: 'cash', amount: 5000 }, { method: 'debt', amount: 5000 }],
  invoiceNumber: 'INV-500',
  customerId: 'cust_1',
  customerName: 'Karim',
  accountSettlement: { type: 'partial_payment', paidAmount: 5000, chargedAmount: 5000, debtEntryId: 'debt_1' },
};

beforeEach(() => {
  fake.reset();
  mockStorage.clear();
  vi.stubGlobal('localStorage', localStorageMock);
  vi.stubGlobal('navigator', { onLine: true });
  registerOfflineHandlers();

  fake.writeDoc('inventory/prod_1', { ...PHONE });
  fake.writeDoc('customers/cust_1', { ...CUSTOMER });
  fake.writeDoc('customer_debts/debt_1', { ...DEBT });
  fake.writeDoc('transactions/tx_srv_1', { ...SALE });

  mockStorage.set('offline_inventory', JSON.stringify([PHONE]));
  mockStorage.set('offline_customers', JSON.stringify([CUSTOMER]));
  mockStorage.set('offline_customer_debts', JSON.stringify([DEBT]));
  mockStorage.set('offline_transactions', JSON.stringify([SALE]));

  useInventoryStore.setState({ products: [PHONE], parts: [] });
  useCustomerStore.setState({ customers: [CUSTOMER], debts: [DEBT], customerLogs: [], recalculateCustomer: vi.fn(async () => undefined) });
  useCartStore.setState({ transactions: [SALE] });
});

describe('Phase 4 — cartStore.editTransaction offline queue, conflict review, and un-swallowed errors', () => {
  it('queues an existing-invoice edit offline as a single EDIT_SALE_TRANSACTION operation and applies atomically on reconnect', async () => {
    vi.stubGlobal('navigator', { onLine: false });

    // Edit qty 1 -> 2 (total 10000 -> 20000; remaining debt goes 5000 -> 15000; stock delta -1)
    await useCartStore.getState().editTransaction('tx_srv_1', [{ product: PHONE, quantity: 2 }], {});

    // Marked pending validation locally
    const localTx = useCartStore.getState().transactions.find(t => t.id === 'tx_srv_1');
    expect(localTx?.total).toBe(20000);
    expect(localTx?.validationStatus).toBe('pending_validation');

    // Queued as ONE EDIT_SALE_TRANSACTION action (not separate uncoordinated stock/debt writes)
    const queue = JSON.parse(mockStorage.get('offline_action_queue') || '[]');
    const editAction = queue.find((a: { type: string }) => a.type === 'EDIT_SALE_TRANSACTION');
    expect(editAction).toBeDefined();
    expect(editAction.payload.operationId).toBeTruthy();
    expect(editAction.payload.transactionId).toBe('tx_srv_1');
    expect(editAction.payload.edit.stockDeltas).toEqual([{ productId: 'prod_1', delta: -1 }]);
    expect(mockStorage.get('offline_pending_stock_adjustments')).toBeUndefined();

    // Reconnect and flush
    vi.stubGlobal('navigator', { onLine: true });
    const flushRes = await offlineQueue.flush();
    expect(flushRes.success).toBe(1);
    expect(flushRes.failed).toBe(0);

    expect(fake.docs.get('transactions/tx_srv_1')?.total).toBe(20000);
    expect(fake.docs.get('transactions/tx_srv_1')?.financialRevision).toBe(1);
    expect(fake.docs.get('inventory/prod_1')?.stock).toBe(4);
    expect(fake.docs.get('customer_debts/debt_1')?.remainingBalance).toBe(10000);
  });

  it('sends conflicting offline invoice edits to dead-letter review instead of overwriting newer server data', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await useCartStore.getState().editTransaction('tx_srv_1', [{ product: PHONE, quantity: 2 }], {});

    // Meanwhile another device edited tx_srv_1 on server (revision moved 0 -> 1)
    fake.writeDoc('transactions/tx_srv_1', { financialRevision: 1, total: 12000 });

    vi.stubGlobal('navigator', { onLine: true });
    const flushRes = await offlineQueue.flush();
    expect(flushRes.failed).toBe(1);
    expect(fake.docs.get('transactions/tx_srv_1')?.total).toBe(12000);
    expect(fake.docs.get('inventory/prod_1')?.stock).toBe(5);
    expect(offlineDeadLetterStore.list().some(d => d.type === 'EDIT_SALE_TRANSACTION' && d.reason === 'unrecoverable')).toBe(true);
  });

  it('throws loudly (never swallows) when updating an offline invoice fails a required Avoir or stock change', async () => {
    const offlineSale: SaleTransaction = {
      ...SALE,
      id: 'offline_tx_99',
      items: [{ product: { ...PHONE, price: 2000 }, quantity: 2 }],
      subtotal: 4000,
      total: 4000,
      payments: [{ method: 'cash', amount: 4000 }],
      accountSettlement: { type: 'paid_full', paidAmount: 4000, chargedAmount: 0, debtEntryId: 'debt_1' },
    };
    mockStorage.set('offline_transactions', JSON.stringify([offlineSale]));
    useCartStore.setState({ transactions: [offlineSale] });

    // Edit reduces total below already-paid 5000 while offline -> requires server Avoir issuance -> MUST reject instead of swallowing
    vi.stubGlobal('navigator', { onLine: false });
    await expect(
      useCartStore.getState().editTransaction('offline_tx_99', [{ product: { ...PHONE, price: 2000 }, quantity: 1 }], {})
    ).rejects.toThrow();
  });

  it('persists sale_edit_journal across uncertain online timeout and adopts late server commit via reconcilePendingSaleEdits', async () => {
    fake.flags.loseAck = true;
    await expect(
      useCartStore.getState().editTransaction('tx_srv_1', [{ product: PHONE, quantity: 2 }], {})
    ).rejects.toThrow('Acknowledgement lost');

    // Journal persisted uncertain edit with its operationId across restart
    const pending = transactionService.getPendingSaleEdits();
    expect(pending).toHaveLength(1);
    expect(pending[0].transactionId).toBe('tx_srv_1');
    expect(pending[0].status).toBe('uncertain');

    // Reconcile adopts the server-committed edit without double-deducting stock
    fake.runTransaction.mockClear();
    const rec = await transactionService.reconcilePendingSaleEdits();
    expect(rec.adopted).toHaveLength(1);
    expect(rec.adopted[0].transaction.total).toBe(20000);
    expect(fake.runTransaction).not.toHaveBeenCalled();
    expect(transactionService.getPendingSaleEdits()).toHaveLength(0);
    expect(fake.docs.get('inventory/prod_1')?.stock).toBe(4);
  });
});
