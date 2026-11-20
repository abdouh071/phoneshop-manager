import { beforeEach, describe, expect, it, vi } from 'vitest';
import { customerService } from './customerService';

type Data = Record<string, unknown>;
type Ref = { key: string };
type Tx = {
  get: (ref: Ref) => Promise<{ exists: () => boolean; data: () => Data }>;
  update: (ref: Ref, data: Data) => void;
  set: (ref: Ref, data: Data) => void;
};

const fake = vi.hoisted(() => {
  const docs = new Map<string, Data>();
  const versions = new Map<string, number>();
  const flags = { reject: false, loseAck: false };
  const write = (key: string, value: Data) => {
    docs.set(key, { ...docs.get(key), ...value });
    versions.set(key, (versions.get(key) ?? 0) + 1);
  };
  return {
    docs, versions, flags, write,
    doc: (_db: unknown, collection: string, id: string) => ({ key: `${collection}/${id}` }),
    runTransaction: vi.fn(async (_db: unknown, callback: (tx: Tx) => Promise<unknown>) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = new Map<string, number>();
        const writes: { key: string; data: Data }[] = [];
        const stage = (ref: Ref, data: Data) => { writes.push({ key: ref.key, data }); };
        const result = await callback({
          get: async ref => {
            if (writes.length) throw new Error('Read after write');
            reads.set(ref.key, versions.get(ref.key) ?? 0);
            const data = docs.get(ref.key);
            return { exists: () => data !== undefined, data: () => structuredClone(data ?? {}) };
          },
          update: stage, set: stage,
        });
        if (flags.reject) throw new Error('permission-denied');
        if ([...reads].some(([key, version]) => (versions.get(key) ?? 0) !== version)) continue;
        for (const { key, data } of writes) write(key, data);
        if (flags.loseAck) {
          flags.loseAck = false;
          throw new Error('Acknowledgement lost');
        }
        return result;
      }
      throw new Error('Contention');
    }),
  };
});
vi.mock('firebase/firestore', () => ({
  doc: fake.doc, runTransaction: fake.runTransaction,
  collection: vi.fn(), getDocs: vi.fn(), addDoc: vi.fn(), setDoc: vi.fn(),
  deleteDoc: vi.fn(), query: vi.fn(), where: vi.fn(), orderBy: vi.fn(),
}));
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('./offlineCustomerSyncService', () => ({ offlineCustomerSyncService: {} }));

const audit = { actionDescription: 'Fixture credit movement', actorName: 'Fixture cashier' };
const move = (delta: number, operationId: string, customerId = 'customer-1') =>
  customerService.changeStoreCredit(customerId, delta, operationId, audit);
const balance = () => fake.docs.get('customers/customer-1')?.storeCredit;
const receipts = () => [...fake.docs.keys()].filter(key => key.startsWith('customer_activity_logs/'));
let storage: Map<string, string>;

beforeEach(() => {
  fake.docs.clear(); fake.versions.clear(); fake.runTransaction.mockClear();
  fake.flags.reject = false; fake.flags.loseAck = false;
  fake.write('customers/customer-1', { name: 'Fixture customer', storeCredit: 100 });
  storage = new Map([['offline_customers', JSON.stringify([{ id: 'customer-1', name: 'Fixture customer', storeCredit: 999 }])]]);
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  });
});

describe('atomic store credit', () => {
  it('uses the server balance and saves the audit receipt in the same commit', async () => {
    const result = await move(-80, 'sale-1');
    expect(result.balance).toBe(20);
    expect(balance()).toBe(20);
    expect(result.log.metadata).toMatchObject({ amount: 80, signedCents: -8000, newCredit: 20 });
    expect(receipts()).toHaveLength(1);
    expect(JSON.parse(storage.get('offline_customers')!)[0].storeCredit).toBe(20);
  });

  it('allows only one of two concurrent redemptions that exceed the balance', async () => {
    const results = await Promise.allSettled([move(-80, 'sale-A'), move(-80, 'sale-B')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(balance()).toBe(20);
    expect(receipts()).toHaveLength(1);
  });

  it('composes concurrent credit issues instead of overwriting one', async () => {
    await Promise.all([move(50, 'return-A'), move(30, 'return-B')]);
    expect(balance()).toBe(180);
    expect(receipts()).toHaveLength(2);
  });

  it('adopts the same operation raced by two callers exactly once', async () => {
    await Promise.all([move(-80, 'same-sale'), move(-80, 'same-sale')]);
    expect(balance()).toBe(20);
    expect(receipts()).toHaveLength(1);
  });

  it('adopts a committed movement after a lost acknowledgement', async () => {
    fake.flags.loseAck = true;
    await expect(move(-80, 'lost-ack')).rejects.toThrow('Acknowledgement lost');
    expect(balance()).toBe(20);
    expect(JSON.parse(storage.get('offline_customers')!)[0].storeCredit).toBe(999);
    await expect(move(-80, 'lost-ack')).resolves.toMatchObject({ balance: 20 });
    expect(balance()).toBe(20);
    expect(receipts()).toHaveLength(1);
  });

  it('does not partially redeem when the current balance is too small', async () => {
    await expect(move(-120, 'sale-1')).rejects.toThrow('INSUFFICIENT_STORE_CREDIT');
    expect(balance()).toBe(100);
    expect(receipts()).toHaveLength(0);
  });

  it('rejects reusing an operation ID for a different amount or account', async () => {
    await move(-20, 'sale-1');
    fake.write('customers/customer-2', { name: 'Other fixture', storeCredit: 100 });
    await expect(move(-30, 'sale-1')).rejects.toThrow('different movement');
    await expect(move(-20, 'sale-1', 'customer-2')).rejects.toThrow('different movement');
    expect(balance()).toBe(80);
    expect(fake.docs.get('customers/customer-2')?.storeCredit).toBe(100);
  });

  it('propagates refusal without changing the balance, audit or local mirror', async () => {
    fake.flags.reject = true;
    await expect(move(50, 'return-1')).rejects.toThrow('permission-denied');
    expect(balance()).toBe(100);
    expect(receipts()).toHaveLength(0);
    expect(JSON.parse(storage.get('offline_customers')!)[0].storeCredit).toBe(999);
  });

  it('refuses offline spending rather than promising a cached balance', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await expect(move(-20, 'sale-1')).rejects.toThrow('Connect to the server');
    expect(fake.runTransaction).not.toHaveBeenCalled();
  });

  it('refuses an unsynced or merged customer without guessing an account', async () => {
    await expect(move(20, 'return-1', 'offline_customer')).rejects.toThrow('Connect to the server');
    fake.write('customers/customer-1', { mergedIntoId: 'customer-2' });
    await expect(move(20, 'return-1')).rejects.toThrow('Select the active customer');
    expect(balance()).toBe(100);
  });

  it('uses integer cents for decimal balances', async () => {
    fake.write('customers/customer-1', { storeCredit: 0.3 });
    await move(-0.1, 'sale-A');
    await move(-0.2, 'sale-B');
    expect(balance()).toBe(0);
  });

  it.each([NaN, Infinity, 0, 0.001])('refuses an invalid movement %s', async delta => {
    await expect(move(delta, 'invalid')).rejects.toThrow();
    expect(fake.runTransaction).not.toHaveBeenCalled();
  });
});
