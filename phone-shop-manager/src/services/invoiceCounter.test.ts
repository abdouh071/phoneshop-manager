/**
 * The daily counter, against a fake transaction.
 *
 * One sale, one number: the till used to read its own clock, and two parts sales in
 * the same busy hour could print the same reference — which the sale↔debt match both
 * apps run would then file a payment against the wrong invoice. These tests pin the
 * read-modify-write that replaced it, and the field names the phone reads too.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type CounterDoc = { lastNumber?: number; scope?: string; day?: string };

const store = vi.hoisted(() => ({
  counters: {} as Record<string, CounterDoc>,
  writes: [] as Array<{ path: string; data: CounterDoc }>,
  unreachable: false,
}));

interface FakeTransaction {
  get: (ref: { id: string }) => Promise<{ exists: () => boolean; data: () => CounterDoc | undefined }>;
  set: (ref: { id: string }, data: CounterDoc, options: { merge: boolean }) => void;
}

vi.mock('../lib/firebase', () => ({ db: { appId: 'test-app' } }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  runTransaction: async (_db: unknown, fn: (tx: FakeTransaction) => Promise<string>) => {
    if (store.unreachable) throw new Error('FireShell is offline');
    let wrote = false;
    const tx: FakeTransaction = {
      get: async (ref) => {
        if (wrote) throw new Error('Read after write');
        return {
          exists: () => store.counters[ref.id] !== undefined,
          data: () => store.counters[ref.id],
        };
      },
      set: (ref, data) => {
        wrote = true;
        store.writes.push({ path: `counters/${ref.id}`, data });
        store.counters[ref.id] = data;
      },
    };
    return fn(tx);
  },
}));

const { allocateInvoiceNumber, claimInvoiceNumber } = await import('../services/invoiceCounter');

/** A Wednesday morning in the shop's own calendar. */
const monday = new Date(2026, 10, 4, 11, 0, 0);

beforeEach(() => {
  store.counters = {};
  store.writes = [];
  store.unreachable = false;
});

describe('the daily counter', () => {
  it('hands out the next number and writes the day forward', async () => {
    expect(await allocateInvoiceNumber('retail', monday)).toBe('INV-261104-0001');
    expect(await allocateInvoiceNumber('retail', monday)).toBe('INV-261104-0002');

    expect(store.writes[0]).toEqual({
      path: 'counters/invoices_retail_261104',
      data: { lastNumber: 1, scope: 'retail', day: '261104', updatedAt: expect.any(String) },
    });
  });

  it('keeps the parts book out of the retail one', async () => {
    expect(await allocateInvoiceNumber('retail', monday)).toBe('INV-261104-0001');
    expect(await allocateInvoiceNumber('parts', monday)).toBe('INV-PARTS-261104-0001');
    expect(await allocateInvoiceNumber('retail', monday)).toBe('INV-261104-0002');
  });

  it('starts a new sequence when the day turns over', async () => {
    expect(await allocateInvoiceNumber('retail', monday)).toBe('INV-261104-0001');
    expect(await allocateInvoiceNumber('retail', new Date(2026, 10, 5, 0, 5, 0))).toBe('INV-261105-0001');
  });

  it('counts on from a counter the phone already wrote', async () => {
    store.counters.invoices_parts_261104 = { lastNumber: 41 };
    expect(await allocateInvoiceNumber('parts', monday)).toBe('INV-PARTS-261104-0042');
  });
});

describe('a counter the shop cannot reach', () => {
  it('still lets the customer buy, and says the reference was guessed', async () => {
    store.unreachable = true;
    const claimed = await claimInvoiceNumber('retail', monday);

    expect(claimed.provisional).toBe(true);
    expect(claimed.invoiceNumber).toMatch(/^INV-\d{6}$/);
  });

  it('reports a claimed number as claimed', async () => {
    expect((await claimInvoiceNumber('retail', monday)).provisional).toBe(false);
  });
});
