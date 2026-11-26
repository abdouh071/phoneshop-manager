import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runPartsAllocationTx,
  runSaleEffectsTx,
  runPosCheckoutTx,
  runStoreCreditShiftTx,
  runSaleEditClaimAndStockTx,
  runSaleVoidClaimTx,
  type FirestoreTxOps,
  type TxRef,
} from './stockTransactionCore.ts';

function createStrictStore(initial: Record<string, Record<string, unknown>> = {}) {
  const docs = new Map<string, Record<string, unknown>>(
    Object.entries(initial).map(([k, v]) => [k, structuredClone(v)])
  );

  async function runTransaction<T>(fn: (ops: FirestoreTxOps) => Promise<T>): Promise<T> {
    // Simple serialized optimistic lock per simulated Firestore transaction
    const working = new Map<string, Record<string, unknown>>(
      [...docs.entries()].map(([k, v]) => [k, structuredClone(v)])
    );
    let hasWritten = false;
    const ops: FirestoreTxOps = {
      doc: (col: string, id: string): TxRef => ({ path: `${col}/${id}`, id }),
      get: async (ref: TxRef) => {
        if (hasWritten) {
          throw new Error(
            `Firestore transactions require all reads to be executed before all writes (attempted get on ${ref.path})`
          );
        }
        const row = working.get(ref.path);
        return {
          exists: () => row !== undefined,
          data: () => (row ? structuredClone(row) : undefined),
        };
      },
      update: (ref: TxRef, data: Record<string, unknown>) => {
        hasWritten = true;
        const prev = working.get(ref.path);
        if (!prev) throw new Error(`No document to update: ${ref.path}`);
        working.set(ref.path, { ...prev, ...structuredClone(data) });
      },
      set: (ref: TxRef, data: Record<string, unknown>) => {
        hasWritten = true;
        working.set(ref.path, structuredClone(data));
      },
    };

    const result = await fn(ops);
    docs.clear();
    for (const [k, v] of working.entries()) docs.set(k, v);
    return result;
  }

  return { docs, runTransaction };
}

test('commitPartsAllocation reads ticket and all products before any writes', async () => {
  const store = createStrictStore({
    'repairs/r1': { status: 'in_progress', partsUsed: [] },
    'inventory/p1': { stock: 4, lowStockThreshold: 1 },
    'products/p2': { stock: 3, lowStockThreshold: 1 },
  });

  const outcome = await store.runTransaction((ops) =>
    runPartsAllocationTx(ops, {
      ticketId: 'r1',
      actionId: 'act_1',
      deltas: [
        { productId: 'p1', name: 'Screen', delta: 1 },
        { productId: 'p2', name: 'Battery', delta: 2 },
      ],
      fields: {
        partsUsed: [
          { productId: 'p1', name: 'Screen', cost: 1000, quantity: 1 },
          { productId: 'p2', name: 'Battery', cost: 500, quantity: 2 },
        ],
        updatedAt: '2026-11-25T10:00:00Z',
      },
    })
  );

  assert.equal(outcome.adopted, false);
  assert.equal(outcome.failed.length, 0);
  assert.equal(store.docs.get('inventory/p1')?.stock, 3);
  assert.equal(store.docs.get('products/p2')?.stock, 1);
  assert.equal(store.docs.get('repairs/r1')?.lastPartsActionId, 'act_1');

  const retry = await store.runTransaction((ops) =>
    runPartsAllocationTx(ops, {
      ticketId: 'r1',
      actionId: 'act_1',
      deltas: [{ productId: 'p1', name: 'Screen', delta: 1 }],
      fields: { partsUsed: [], updatedAt: '2026-11-25T10:00:00Z' },
    })
  );
  assert.equal(retry.adopted, true);
  assert.equal(store.docs.get('inventory/p1')?.stock, 3);
});

test('commitSaleEffects reads all products and customer profile before writes and rejects shortfall when strict', async () => {
  const store = createStrictStore({
    'transactions/s1': { stockApplied: false, profileApplied: false },
    'inventory/p1': { stock: 5, lowStockThreshold: 1 },
    'products/p2': { stock: 2, lowStockThreshold: 1 },
    'customers/c1': { totalPurchases: 1, totalSpent: 1000, totalDebt: 0 },
  });

  const ok = await store.runTransaction((ops) =>
    runSaleEffectsTx(ops, {
      saleId: 's1',
      lines: [
        { productId: 'p1', name: 'A', quantity: 2 },
        { productId: 'p2', name: 'B', quantity: 1 },
      ],
      profile: { customerId: 'c1', paid: 500, charged: 200 },
      rejectShortfall: true,
    })
  );

  assert.equal(ok.adopted, false);
  assert.equal(ok.failed.length, 0);
  assert.equal(store.docs.get('inventory/p1')?.stock, 3);
  assert.equal(store.docs.get('products/p2')?.stock, 1);
  assert.equal(store.docs.get('customers/c1')?.totalSpent, 1500);
  assert.equal(store.docs.get('customers/c1')?.totalDebt, 200);
  assert.equal(store.docs.get('transactions/s1')?.stockApplied, true);

  store.docs.set('transactions/s2', { stockApplied: false });
  await assert.rejects(
    store.runTransaction((ops) =>
      runSaleEffectsTx(ops, {
        saleId: 's2',
        lines: [{ productId: 'missing', name: 'Missing', quantity: 1 }, { productId: 'p2', name: 'B', quantity: 5 }],
        rejectShortfall: true,
      })
    ),
    /INSUFFICIENT_STOCK/
  );
  assert.equal(store.docs.get('products/p2')?.stock, 1);
});

test('runPosCheckoutTx rejects overselling before writing transaction or debt documents', async () => {
  const store = createStrictStore({
    'inventory/p1': { stock: 1, lowStockThreshold: 1 },
    'customers/c1': { totalPurchases: 0, totalSpent: 0, totalDebt: 0 },
  });

  await assert.rejects(
    store.runTransaction((ops) =>
      runPosCheckoutTx(ops, {
        saleId: 'tx_over',
        lines: [{ productId: 'p1', name: 'Phone', quantity: 2 }],
        saleData: { total: 2000, status: 'completed' },
        profile: { customerId: 'c1', paid: 1000, charged: 1000 },
        debtId: 'debt_over',
        debtData: { remainingBalance: 1000 },
      })
    ),
    /INSUFFICIENT_STOCK/
  );

  assert.equal(store.docs.has('transactions/tx_over'), false);
  assert.equal(store.docs.has('customer_debts/debt_over'), false);
  assert.equal(store.docs.get('inventory/p1')?.stock, 1);
});

test('runStoreCreditShiftTx enforces server balance, idempotency, and reads before writes', async () => {
  const store = createStrictStore({
    'customers/c1': { name: 'Ali', storeCredit: 100 },
  });

  await assert.rejects(
    store.runTransaction((ops) =>
      runStoreCreditShiftTx(ops, {
        customerId: 'c1',
        delta: -120,
        note: 'Over-spend',
        operationId: 'op_over',
      })
    ),
    /Insufficient Avoir/
  );
  assert.equal(store.docs.get('customers/c1')?.storeCredit, 100);

  const first = await store.runTransaction((ops) =>
    runStoreCreditShiftTx(ops, {
      customerId: 'c1',
      delta: -60,
      note: 'Redeemed',
      operationId: 'op_1',
    })
  );
  assert.equal(first, 40);

  // Replay same operationId must adopt cleanly without subtracting again
  const replay = await store.runTransaction((ops) =>
    runStoreCreditShiftTx(ops, {
      customerId: 'c1',
      delta: -60,
      note: 'Redeemed',
      operationId: 'op_1',
    })
  );
  assert.equal(replay, 40);
  assert.equal(store.docs.get('customers/c1')?.storeCredit, 40);

  // Reusing same operationId with a different delta must be rejected
  await assert.rejects(
    store.runTransaction((ops) =>
      runStoreCreditShiftTx(ops, {
        customerId: 'c1',
        delta: -30,
        note: 'Mismatch',
        operationId: 'op_1',
      })
    ),
    /different movement/
  );
});

test('runSaleEditClaimAndStockTx blocks closed or stale-revision edits and overselling atomically', async () => {
  const store = createStrictStore({
    'transactions/tx1': { status: 'completed', financialRevision: 1, total: 1000 },
    'inventory/p1': { stock: 2, lowStockThreshold: 1 },
  });

  // Stale caller still holding financialRevision 0 cannot overwrite desktop edit
  await assert.rejects(
    store.runTransaction((ops) =>
      runSaleEditClaimAndStockTx(ops, {
        txId: 'tx1',
        expectedRevision: 0,
        restockLines: [],
        deductLines: [{ productId: 'p1', name: 'Phone', quantity: 1 }],
        saleUpdates: { total: 2000 },
      })
    ),
    /changed on another device/
  );
  assert.equal(store.docs.get('inventory/p1')?.stock, 2);

  // Insufficient stock rejects atomically without modifying transaction header
  await assert.rejects(
    store.runTransaction((ops) =>
      runSaleEditClaimAndStockTx(ops, {
        txId: 'tx1',
        expectedRevision: 1,
        restockLines: [],
        deductLines: [{ productId: 'p1', name: 'Phone', quantity: 5 }],
        saleUpdates: { total: 5000 },
      })
    ),
    /INSUFFICIENT_STOCK/
  );
  assert.equal(store.docs.get('transactions/tx1')?.total, 1000);
  assert.equal(store.docs.get('inventory/p1')?.stock, 2);

  // Matching revision and sufficient stock bumps revision cleanly
  await store.runTransaction((ops) =>
    runSaleEditClaimAndStockTx(ops, {
      txId: 'tx1',
      expectedRevision: 1,
      restockLines: [],
      deductLines: [{ productId: 'p1', name: 'Phone', quantity: 1 }],
      saleUpdates: { total: 2000 },
    })
  );
  assert.equal(store.docs.get('transactions/tx1')?.financialRevision, 2);
  assert.equal(store.docs.get('transactions/tx1')?.total, 2000);
  assert.equal(store.docs.get('inventory/p1')?.stock, 1);
});

test('runSaleVoidClaimTx rejects stale financialRevision and restores Avoir store_credit atomically', async () => {
  const store = createStrictStore({
    'transactions/tx1': { status: 'completed', financialRevision: 1, total: 1500 },
    'customers/c1': { name: 'Client', storeCredit: 200 },
  });

  await assert.rejects(
    store.runTransaction((ops) =>
      runSaleVoidClaimTx(ops, {
        txId: 'tx1',
        expectedRevision: 0,
        reason: 'Void test',
        now: '2026-11-25T10:00:00Z',
        voidedBy: { uid: 'u1', name: 'Tech' },
        customerId: 'c1',
        storeCreditToRestore: 500,
      })
    ),
    /changed on another device/
  );
  assert.equal(store.docs.get('customers/c1')?.storeCredit, 200);

  const outcome = await store.runTransaction((ops) =>
    runSaleVoidClaimTx(ops, {
      txId: 'tx1',
      expectedRevision: 1,
      reason: 'Void test',
      now: '2026-11-25T10:00:00Z',
      voidedBy: { uid: 'u1', name: 'Tech' },
      customerId: 'c1',
      storeCreditToRestore: 500,
    })
  );

  assert.equal(outcome.voided, true);
  assert.equal(outcome.restoredCredit, 500);
  assert.equal(store.docs.get('transactions/tx1')?.status, 'voided');
  assert.equal(store.docs.get('transactions/tx1')?.financialRevision, 2);
  assert.equal(store.docs.get('customers/c1')?.storeCredit, 700);
});
