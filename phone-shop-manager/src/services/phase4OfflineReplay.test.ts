/**
 * Phase 4 TDD Regression Tests — Offline Replay, Conflict Detection,
 * Temp-ID Remapping, and Claimed vs. Completed Refunds.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Customer, CustomerDebtEntry, PhoneModel, SaleTransaction } from '../types';

const fake = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  const versions = new Map<string, number>();
  let idSeq = 0;
  const flags = {
    reject: null as string | null,
    loseAck: false,
    failReads: false,
  };
  let queue = Promise.resolve() as Promise<unknown>;

  const writeDoc = (key: string, data: object, merge = true) => {
    const prev = merge ? docs.get(key) : undefined;
    docs.set(key, { ...prev, ...structuredClone(data as Record<string, unknown>) });
    versions.set(key, (versions.get(key) ?? 0) + 1);
  };

  const makeRef = (name: string, id: string) => ({ name, id, key: `${name}/${id}` });

  const doc = (_db: unknown, name: string, id: string) => makeRef(name, id);
  const collection = (_db: unknown, name: string) => ({ name });
  const where = (field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value });
  const orderBy = (field: string, dir?: string) => ({ kind: 'orderBy', field, dir });
  const limit = (count: number) => ({ kind: 'limit', count });
  const query = (target: { name: string }, ...constraints: Array<{ kind: string; field?: string; value?: unknown; count?: number }>) => ({
    name: target.name,
    constraints,
  });

  const matchQuery = (q: { name: string; constraints?: Array<{ kind: string; field?: string; value?: unknown; count?: number }> }) => {
    const wheres = (q.constraints || []).filter(c => c.kind === 'where');
    const lim = (q.constraints || []).find(c => c.kind === 'limit')?.count;
    let rows = [...docs.entries()]
      .filter(([key, data]) => {
        if (!key.startsWith(`${q.name}/`)) return false;
        return wheres.every(w => w.field && data[w.field] === w.value);
      })
      .map(([key, data]) => {
        const [, id] = key.split('/');
        return {
          id,
          ref: makeRef(q.name, id),
          exists: () => true,
          data: () => structuredClone(data),
        };
      });
    if (typeof lim === 'number') rows = rows.slice(0, lim);
    return { empty: rows.length === 0, docs: rows };
  };

  const getDoc = async (ref: { key: string; id: string }) => {
    if (flags.failReads) throw new Error('network-unavailable');
    const data = docs.get(ref.key);
    return { id: ref.id, ref, exists: () => data !== undefined, data: () => structuredClone(data ?? {}) };
  };

  const getDocs = async (target: { name: string; constraints?: Array<{ kind: string; field?: string; value?: unknown; count?: number }> }) => {
    if (flags.failReads) throw new Error('network-unavailable');
    return matchQuery(target);
  };

  const addDoc = async (col: { name: string }, data: Record<string, unknown>) => {
    const id = `srv_${col.name}_${++idSeq}`;
    writeDoc(`${col.name}/${id}`, data, false);
    return makeRef(col.name, id);
  };

  const setDoc = async (ref: { key: string }, data: Record<string, unknown>, opts?: { merge?: boolean }) => {
    writeDoc(ref.key, data, Boolean(opts?.merge));
  };

  const updateDoc = async (ref: { key: string }, patch: Record<string, unknown>) => {
    if (!docs.has(ref.key)) throw new Error('Missing update target');
    writeDoc(ref.key, patch, true);
  };

  const writeBatch = () => {
    const ops: Array<() => void> = [];
    return {
      update: (ref: { key: string }, patch: Record<string, unknown>) => {
        ops.push(() => writeDoc(ref.key, patch, true));
      },
      set: (ref: { key: string }, data: Record<string, unknown>, opts?: { merge?: boolean }) => {
        ops.push(() => writeDoc(ref.key, data, Boolean(opts?.merge)));
      },
      delete: (ref: { key: string }) => {
        ops.push(() => docs.delete(ref.key));
      },
      commit: async () => {
        for (const op of ops) op();
      },
    };
  };

  const runTransaction = vi.fn(async (_db: unknown, callback: (tx: {
    get: (ref: { key: string; id: string }) => Promise<{ exists: () => boolean; data: () => Record<string, unknown>; id: string }>;
    update: (ref: { key: string }, patch: Record<string, unknown>) => void;
    set: (ref: { key: string }, data: Record<string, unknown>, opts?: { merge?: boolean }) => void;
  }) => Promise<unknown>) => {
    const run = queue.then(async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = new Map<string, number>();
        const writes: Array<{ key: string; patch: Record<string, unknown>; merge: boolean }> = [];
        const result = await callback({
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
        return result;
      }
      throw new Error('Contention');
    });
    queue = run.catch(() => undefined);
    return run;
  });

  const reset = () => {
    docs.clear();
    versions.clear();
    idSeq = 0;
    flags.reject = null;
    flags.loseAck = false;
    flags.failReads = false;
  };

  return {
    docs,
    versions,
    flags,
    writeDoc,
    doc,
    collection,
    where,
    orderBy,
    limit,
    query,
    getDoc,
    getDocs,
    getDocsFromServer: getDocs,
    addDoc,
    setDoc,
    updateDoc,
    writeBatch,
    runTransaction,
    reset,
  };
});

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    doc: fake.doc,
    collection: fake.collection,
    where: fake.where,
    orderBy: fake.orderBy,
    limit: fake.limit,
    query: fake.query,
    getDoc: fake.getDoc,
    getDocs: fake.getDocs,
    getDocsFromServer: fake.getDocsFromServer,
    addDoc: fake.addDoc,
    setDoc: fake.setDoc,
    updateDoc: fake.updateDoc,
    writeBatch: fake.writeBatch,
    runTransaction: fake.runTransaction,
    Timestamp: { now: () => 'fixture-timestamp' },
  };
});

vi.mock('../store/toastStore', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('./activityLogService', () => ({
  activityLogService: { log: vi.fn(async () => undefined) },
}));

vi.mock('./trackingMirrorService', () => ({
  writeTrackingMirror: vi.fn(async () => undefined),
  refreshTrackingMirrorById: vi.fn(async () => undefined),
  deleteTrackingMirrorFor: vi.fn(async () => undefined),
}));

import { debtService } from './debtService';
import { customerService } from './customerService';
import { transactionService } from './transactionService';
import { offlineQueue } from './offlineQueue';
import { offlineDeadLetterStore } from './offlineDeadLetterStore';
import { registerOfflineHandlers } from './offlineHandlers';
import { unifiedOfflineSyncService } from './unifiedOfflineSyncService';
import { offlineCustomerSyncService } from './offlineCustomerSyncService';

const mockStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, value: string) => mockStorage.set(key, String(value)),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

const ACTOR = { id: 'staff_1', name: 'Counter', role: 'sales' };

const samplePhone = {
  id: 'prod_1',
  name: 'iPhone 15',
  model: '128GB',
  price: 10000,
  cost: 8000,
  stock: 5,
  lowStockThreshold: 1,
} as unknown as PhoneModel;

const sampleDebt = (overrides: Partial<CustomerDebtEntry> = {}): CustomerDebtEntry => ({
  id: 'debt_1',
  customerId: 'cust_1',
  customerName: 'Amine',
  customerPhone: '0550111222',
  productOrService: 'Samsung A55',
  date: '2026-11-10T10:00:00.000Z',
  totalAmount: 10000,
  amountPaid: 2000,
  remainingBalance: 8000,
  status: 'partially_paid',
  payments: [{ id: 'pay_seed', date: '2026-11-10T10:00:00.000Z', amount: 2000, method: 'cash' }],
  createdAt: '2026-11-10T10:00:00.000Z',
  updatedAt: '2026-11-10T10:00:00.000Z',
  ...overrides,
});

const sampleCustomer = (overrides: Partial<Customer> = {}): Customer => ({
  id: 'cust_1',
  name: 'Amine',
  phone: '0550111222',
  normalizedPhone: '0550111222',
  accountType: 'retail',
  notes: 'Initial note',
  totalDebt: 8000,
  storeCredit: 0,
  totalPurchases: 1,
  totalSpent: 10000,
  joinDate: '2026-10-01T10:00:00.000Z',
  lastVisitDate: '2026-11-10T10:00:00.000Z',
  updatedAt: '2026-11-10T10:00:00.000Z',
  ...overrides,
});

const sampleSale = (overrides: Partial<SaleTransaction> = {}): SaleTransaction => ({
  id: 'tx_1',
  date: '2026-11-10T10:00:00.000Z',
  stockApplied: true,
  status: 'completed',
  financialRevision: 0,
  items: [{ product: samplePhone, quantity: 1 }],
  subtotal: 10000,
  total: 10000,
  payments: [{ method: 'debt', amount: 10000 }],
  invoiceNumber: 'INV-100',
  customerId: 'cust_1',
  customerName: 'Amine',
  ...overrides,
});

beforeEach(() => {
  fake.reset();
  mockStorage.clear();
  vi.stubGlobal('localStorage', localStorageMock);
  vi.stubGlobal('navigator', { onLine: true });
  registerOfflineHandlers();
});

describe('Phase 4 — Offline Debt Payments & Stable Payment IDs', () => {
  it('enqueues RECORD_DEBT_PAYMENT for an existing server debt offline and replays idempotently once', async () => {
    fake.writeDoc('customer_debts/debt_1', sampleDebt());
    mockStorage.set('offline_customer_debts', JSON.stringify([sampleDebt()]));
    vi.stubGlobal('navigator', { onLine: false });

    const updated = await debtService.recordPayment('debt_1', {
      amount: 3000,
      method: 'cash',
      note: 'Cash installment',
    });

    expect(updated.amountPaid).toBe(5000);
    expect(updated.remainingBalance).toBe(5000);
    const paymentId = updated.payments[updated.payments.length - 1].id;
    expect(paymentId).toBeTruthy();

    const queue = JSON.parse(mockStorage.get('offline_action_queue') || '[]');
    const action = queue.find((a: { type: string }) => a.type === 'RECORD_DEBT_PAYMENT');
    expect(action).toBeDefined();
    expect(action.payload.debtId).toBe('debt_1');
    expect(action.payload.payment.id).toBe(paymentId);

    // Reconnect and flush
    vi.stubGlobal('navigator', { onLine: true });
    const firstFlush = await offlineQueue.flush();
    expect(firstFlush.success).toBe(1);
    expect(fake.docs.get('customer_debts/debt_1')?.amountPaid).toBe(5000);
    expect(fake.docs.get('customer_debts/debt_1')?.remainingBalance).toBe(5000);

    // Replaying the same payment ID again (e.g. lost ack) does not deduct twice
    await debtService.recordPayment('debt_1', {
      id: paymentId,
      amount: 3000,
      method: 'cash',
      note: 'Cash installment',
    });
    expect(fake.docs.get('customer_debts/debt_1')?.amountPaid).toBe(5000);
    expect(((fake.docs.get('customer_debts/debt_1')?.payments as Array<{ id: string }> | undefined) ?? []).filter(p => p.id === paymentId)).toHaveLength(1);
  });

  it('moves conflicting offline debt payment to dead-letter review instead of overpaying settled debt', async () => {
    // Another terminal collected the remaining 8000 while this device was offline
    fake.writeDoc('customer_debts/debt_1', sampleDebt({ amountPaid: 10000, remainingBalance: 0, status: 'paid' }));
    mockStorage.set('offline_customer_debts', JSON.stringify([sampleDebt()]));
    vi.stubGlobal('navigator', { onLine: false });

    await debtService.recordPayment('debt_1', { amount: 5000, method: 'cash' });

    vi.stubGlobal('navigator', { onLine: true });
    const res = await offlineQueue.flush();
    expect(res.failed).toBe(1);
    expect(fake.docs.get('customer_debts/debt_1')?.amountPaid).toBe(10000);
    expect(fake.docs.get('customer_debts/debt_1')?.remainingBalance).toBe(0);
    const deadLetters = offlineDeadLetterStore.list();
    expect(deadLetters.some(d => d.type === 'RECORD_DEBT_PAYMENT' && d.reason === 'unrecoverable')).toBe(true);
  });
});

describe('Phase 4 — Offline Existing-Customer Field Patches & Conflict Detection', () => {
  it('queues only changed fields for existing server customers offline and detects conflicting field edits', async () => {
    fake.writeDoc('customers/cust_1', sampleCustomer({ notes: 'Server updated note offline window' }));
    mockStorage.set('offline_customers', JSON.stringify([sampleCustomer()]));
    vi.stubGlobal('navigator', { onLine: false });

    // Edit phone offline while server concurrently modified unrelated field `notes`
    await customerService.updateCustomer('cust_1', { phone: '0550999888' });
    const queue = JSON.parse(mockStorage.get('offline_action_queue') || '[]');
    const action = queue.find((a: { type: string }) => a.type === 'UPDATE_CUSTOMER');
    expect(action).toBeDefined();
    expect(action.payload.updates.notes).toBeUndefined();
    expect(action.payload.updates.phone).toBe('0550 99 98 88');
    expect(action.payload.baseValues?.phone).toBe('0550 11 12 22');

    vi.stubGlobal('navigator', { onLine: true });
    const flushOk = await offlineQueue.flush();
    expect(flushOk.success).toBe(1);
    expect(fake.docs.get('customers/cust_1')?.phone).toBe('0550 99 98 88');
    // Server note written concurrently is NOT clobbered by stale local snapshot
    expect(fake.docs.get('customers/cust_1')?.notes).toBe('Server updated note offline window');

    // Now test true field conflict: device was offline editing phone based on '0550 99 98 88', while server moved phone to '0770 77 77 77'
    mockStorage.set('offline_customers', JSON.stringify([sampleCustomer({ phone: '0550 99 98 88' })]));
    fake.writeDoc('customers/cust_1', { phone: '0770 77 77 77' });
    vi.stubGlobal('navigator', { onLine: false });
    await customerService.updateCustomer('cust_1', { phone: '0660666666' });

    vi.stubGlobal('navigator', { onLine: true });
    const flushConflict = await offlineQueue.flush();
    expect(flushConflict.failed).toBe(1);
    expect(fake.docs.get('customers/cust_1')?.phone).toBe('0770 77 77 77');
    expect(offlineDeadLetterStore.list().some(d => d.type === 'UPDATE_CUSTOMER' && d.reason === 'unrecoverable')).toBe(true);
  });
});

describe('Phase 4 — Temp-ID Remapping across offline_action_queue', () => {
  it('remaps offline_cust_, offline_debt_, and offline_tkt_ IDs in queued actions before flush', async () => {
    const tempCust: Customer = sampleCustomer({ id: 'offline_cust_1', name: 'New Offline Cust', phone: '0551234567' });
    const tempDebt: CustomerDebtEntry = sampleDebt({ id: 'offline_debt_1', customerId: 'offline_cust_1', remainingBalance: 6000, amountPaid: 0, totalAmount: 6000, status: 'unpaid', payments: [] });
    mockStorage.set('offline_customers', JSON.stringify([tempCust]));
    mockStorage.set('offline_customer_sync_queue', JSON.stringify([{ tempId: 'offline_cust_1', customerData: tempCust, createdAt: tempCust.joinDate, retryCount: 0 }]));
    mockStorage.set('offline_customer_debts', JSON.stringify([tempDebt]));

    await offlineQueue.enqueue({
      type: 'RECORD_DEBT_PAYMENT',
      payload: {
        debtId: 'offline_debt_1',
        operationId: 'pay_remap_1',
        payment: { id: 'pay_remap_1', amount: 1500, method: 'cash', date: '2026-11-11T10:00:00.000Z' },
      },
    });
    await offlineQueue.enqueue({
      type: 'UPDATE_CUSTOMER',
      payload: {
        id: 'offline_cust_1',
        updates: { notes: 'Updated before online sync' },
        baseValues: { notes: 'Initial note' },
        operationId: 'cust_remap_1',
      },
    });

    vi.stubGlobal('navigator', { onLine: true });
    await offlineCustomerSyncService.syncPendingCustomers();
    const realCustId = JSON.parse(mockStorage.get('offline_customers') || '[]')[0].id as string;
    expect(realCustId).not.toMatch(/^offline_/);

    await unifiedOfflineSyncService.syncOfflineDebts();
    const realDebtId = JSON.parse(mockStorage.get('offline_customer_debts') || '[]')[0].id as string;
    expect(realDebtId).not.toMatch(/^offline_/);

    const flushRes = await offlineQueue.flush();
    expect(flushRes.failed).toBe(0);
    expect(flushRes.success).toBe(2);
    expect(fake.docs.get(`customer_debts/${realDebtId}`)?.amountPaid).toBe(1500);
    expect(fake.docs.get(`customers/${realCustId}`)?.notes).toBe('Updated before online sync');
  });
});

describe('Phase 4 — Claimed vs Completed Refunds & Restart Reconciliation', () => {
  it('persists claimed refund state across lost acknowledgement/restart and reconciles without re-reversing', async () => {
    fake.writeDoc('transactions/tx_1', sampleSale());
    fake.writeDoc('inventory/prod_1', { ...samplePhone });
    fake.writeDoc('customers/cust_1', sampleCustomer());
    fake.writeDoc('customer_debts/debt_1', sampleDebt({ id: 'debt_1', transactionId: 'tx_1', totalAmount: 10000, amountPaid: 0, remainingBalance: 10000 }));

    // Simulate commit succeeded on server, but acknowledgement to client failed/timed out
    fake.flags.loseAck = true;
    await expect(transactionService.refund(sampleSale(), ACTOR)).rejects.toThrow('Acknowledgement lost');

    // Journal retains the claimed/uncertain refund across app close/restart
    const pendingBefore = transactionService.getPendingRefunds();
    expect(pendingBefore).toHaveLength(1);
    expect(pendingBefore[0].transactionId).toBe('tx_1');
    expect(pendingBefore[0].stage).toBe('claimed');

    // On restart/reconnect, reconcilePendingRefunds checks server receipt and adopts without running another refund tx
    fake.runTransaction.mockClear();
    const reconciled = await transactionService.reconcilePendingRefunds();
    expect(reconciled.adopted).toHaveLength(1);
    expect(reconciled.adopted[0].transaction.status).toBe('refunded');
    expect(fake.runTransaction).not.toHaveBeenCalled();
    expect(transactionService.getPendingRefunds()).toHaveLength(0);
    expect(fake.docs.get('inventory/prod_1')?.stock).toBe(6);
  });

  it('completes an uncompleted server refund claim instead of rejecting or assuming it already finished', async () => {
    fake.writeDoc('transactions/tx_1', sampleSale());
    fake.writeDoc('inventory/prod_1', { ...samplePhone });
    fake.writeDoc('customers/cust_1', sampleCustomer());
    fake.writeDoc('customer_debts/debt_1', sampleDebt({ id: 'debt_1', transactionId: 'tx_1', totalAmount: 10000, amountPaid: 0, remainingBalance: 10000 }));
    // Pre-existing claim receipt where stage is still 'claimed' and sale is still 'completed'
    fake.writeDoc('operation_receipts/sale_refund_tx_1', {
      kind: 'sale_refund',
      transactionId: 'tx_1',
      stage: 'claimed',
    });

    const result = await transactionService.refund(sampleSale(), ACTOR);
    expect(result.outcome).toBe('refunded');
    expect(fake.docs.get('transactions/tx_1')?.status).toBe('refunded');
    expect(fake.docs.get('inventory/prod_1')?.stock).toBe(6);
    expect(fake.docs.get('operation_receipts/sale_refund_tx_1')?.stage).toBe('completed');
    expect(transactionService.getPendingRefunds()).toHaveLength(0);
  });
});
