/**
 * The refund claim at the server's door.
 *
 * The till's list is whatever it last fetched, so two tills can both hold `completed`
 * for an invoice one of them is closing. claimRefund reads the status the server holds
 * and stamps it in one transaction: the first claim wins, every later one — or one
 * arriving after the phone voided the same sale — is refused, and a refused claim
 * leaves the local mirror saying what the server says.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { transactionService } from './transactionService';

const fake = vi.hoisted(() => ({
  server: new Map<string, Record<string, unknown>>(),
  /** Serializes transactions the way Firestore's optimistic concurrency does. */
  queue: Promise.resolve() as Promise<unknown>,
  doc: (_db: unknown, name: string, id: string) => ({ name, id }),
  collection: (_db: unknown, name: string) => ({ name }),
  runTransaction: (_db: unknown, fn: (t: unknown) => Promise<boolean>): Promise<boolean> => {
    const run = fake.queue.then(() =>
      fn({
        get: async (ref: { id: string }) => {
          const data = fake.server.get(ref.id);
          return { exists: () => data !== undefined, data: () => data };
        },
        update: (ref: { id: string }, patch: Record<string, unknown>) => {
          fake.server.set(ref.id, { ...fake.server.get(ref.id), ...patch });
        },
      })
    );
    fake.queue = run.catch(() => undefined);
    return run;
  },
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    doc: fake.doc,
    collection: fake.collection,
    runTransaction: fake.runTransaction,
  };
});

const mockStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => mockStorage.get(key) || null,
  setItem: (key: string, value: string) => mockStorage.set(key, String(value)),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

const MIRROR_KEY = 'offline_transactions';
const seedMirror = (rows: unknown[]): void => {
  localStorage.setItem(MIRROR_KEY, JSON.stringify(rows));
};
const mirrorRow = (id: string) =>
  JSON.parse(localStorage.getItem(MIRROR_KEY) || '[]').find((t: { id: string }) => t.id === id);

describe('claimRefund', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('navigator', { onLine: true });
    localStorageMock.clear();
    fake.server.clear();
    fake.queue = Promise.resolve();
  });

  it('claims a completed sale and stamps one moment on both copies', async () => {
    fake.server.set('tx1', { status: 'completed', total: 500 });
    seedMirror([{ id: 'tx1', status: 'completed', total: 500 }]);

    const { claimed, refundedAt } = await transactionService.claimRefund('tx1');

    expect(claimed).toBe(true);
    expect(fake.server.get('tx1')).toMatchObject({ status: 'refunded', refundedAt });
    expect(mirrorRow('tx1')).toMatchObject({ status: 'refunded', refundedAt });
  });

  it('only the first of two simultaneous claims gets through', async () => {
    fake.server.set('tx1', { status: 'completed', total: 500 });
    seedMirror([{ id: 'tx1', status: 'completed', total: 500 }]);

    const [a, b] = await Promise.all([
      transactionService.claimRefund('tx1'),
      transactionService.claimRefund('tx1'),
    ]);

    expect([a.claimed, b.claimed]).toEqual([true, false]);
    expect(fake.server.get('tx1')?.refundedAt).toBe(a.refundedAt);
  });

  it('a sale the phone already voided is closed for the counter too', async () => {
    fake.server.set('tx1', { status: 'voided', voidedAt: '2026-11-04T11:00:00.000Z' });
    seedMirror([{ id: 'tx1', status: 'completed', total: 500 }]);

    const { claimed } = await transactionService.claimRefund('tx1');

    expect(claimed).toBe(false);
    expect(fake.server.get('tx1')).toEqual({ status: 'voided', voidedAt: '2026-11-04T11:00:00.000Z' });
    // A refused claim must not make the mirror disagree with the server.
    expect(mirrorRow('tx1').status).toBe('completed');
  });

  it('a cancelled sale never took the money and cannot be refunded', async () => {
    fake.server.set('tx1', { status: 'cancelled' });
    expect((await transactionService.claimRefund('tx1')).claimed).toBe(false);
  });

  it('a sale the server no longer holds is an error, not a silent local refund', async () => {
    seedMirror([{ id: 'tx_gone', status: 'completed', total: 500 }]);
    await expect(transactionService.claimRefund('tx_gone')).rejects.toThrow(/no longer exists/);
    expect(mirrorRow('tx_gone').status).toBe('completed');
  });

  it('a sale this till wrote offline claims locally, without asking the server', async () => {
    seedMirror([{ id: 'offline_tx_1', status: 'completed', total: 500 }]);

    const { claimed, refundedAt } = await transactionService.claimRefund('offline_tx_1');

    expect(claimed).toBe(true);
    expect(mirrorRow('offline_tx_1')).toMatchObject({ status: 'refunded', refundedAt });
    expect(fake.server.size).toBe(0);
  });

  it('a till with no network claims locally, exactly as before', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    fake.server.set('tx1', { status: 'completed', total: 500 });
    seedMirror([{ id: 'tx1', status: 'completed', total: 500 }]);

    const { claimed } = await transactionService.claimRefund('tx1');

    expect(claimed).toBe(true);
    expect(mirrorRow('tx1').status).toBe('refunded');
    expect(fake.server.get('tx1')?.status).toBe('completed');
  });
});