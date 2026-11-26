import { readFileSync } from 'node:fs';
import { locks } from 'node:worker_threads';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import type { PhoneModel, SaleTransaction } from '../types';
import { partsCheckoutService } from './partsCheckoutService';
import { retailCheckoutService } from './retailCheckoutService';
import { customerService } from './customerService';
import { commitStockDelta } from './inventoryService';
import { transactionService } from './transactionService';

const context = vi.hoisted(() => ({ db: null as unknown as Firestore }));
vi.mock('../lib/firebase', () => ({ get db() { return context.db; } }));
vi.mock('./offlineQueueMirror', () => ({
  offlineQueueMirror: { write: vi.fn(), onRestored: vi.fn(() => () => undefined) },
}));
vi.mock('./offlineCustomerSyncService', () => ({ offlineCustomerSyncService: {} }));
vi.mock('./offlineQueue', () => ({ offlineQueue: {} }));

const endpoint = process.env.FIRESTORE_EMULATOR_HOST;
if (endpoint && !/^127\.0\.0\.1:\d+$/.test(endpoint)) throw new Error('Financial tests require a loopback demo emulator.');
const audit = { actionDescription: 'Emulator movement', actorId: 'seller', actorName: 'Fixture', actorRole: 'sales_agent' };
const part = (id: string): PhoneModel => ({ id, name: id, stock: 999, price: 100, costPrice: 50, lowStockThreshold: 1 } as PhoneModel);
const sale = (actorId = 'seller', credit = false): Omit<SaleTransaction, 'id'> => ({
  date: '2026-11-17T10:00:00Z', processedById: actorId, processedByName: 'Emulator cashier',
  invoiceNumber: 'EMULATOR-1', saleType: 'parts_b2b', status: 'completed',
  items: ['A', 'B'].map(id => ({ product: part(id), quantity: 1 })), subtotal: 200, total: 200,
  payments: [{ method: credit ? 'card' : 'cash', amount: credit ? 50 : 200 }],
  ...(credit ? { customerId: 'customer', customerName: 'Emulator customer', accountSettlement: { type: 'partial_payment' as const, paidAmount: 50, chargedAmount: 150 } } : {}),
});
const checkout = (actor = 'seller', credit = false) => partsCheckoutService.checkout(sale(actor, credit), { draftKey: actor, actorRole: 'sales_agent' });
const read = async (collection: string, id: string) => (await getDocFromServer(doc(context.db, collection, id))).data();
const count = async (name: string) => (await getDocsFromServer(collection(context.db, name))).size;

// No production app initialization is imported; without the demo emulator these tests skip.
describe.skipIf(!endpoint)('financial services with real Firestore transactions and rules', () => {
  let env: RulesTestEnvironment;
  beforeAll(async () => {
    const [host, port] = endpoint!.split(':');
    env = await initializeTestEnvironment({
      projectId: 'demo-phoneshop-rules',
      firestore: { host, port: Number(port), rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
    });
  }, 20000);
  afterAll(async () => { await env?.cleanup(); vi.unstubAllGlobals(); });
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await Promise.all([
        setDoc(doc(db, 'users', 'seller'), { role: 'sales_agent', isSuperAdmin: false }),
        setDoc(doc(db, 'users', 'viewer'), { role: 'custom', isSuperAdmin: false, permissions: { dashboard: true } }),
        setDoc(doc(db, 'users', 'admin'), { role: 'admin', isSuperAdmin: false }),
        ...['A', 'B'].map(id => setDoc(doc(db, 'inventory', id), { name: id, stock: 1, price: 100 })),
        setDoc(doc(db, 'customers', 'customer'), { name: 'Emulator customer', storeCredit: 100, creditLimit: 250, totalDebt: 0 }),
      ]);
    });
    context.db = env.authenticatedContext('seller').firestore() as unknown as Firestore;
    const storage = new Map<string, string>();
    vi.stubGlobal('navigator', { onLine: true, locks });
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } });
  }, 20000);

  it('commits and replays a Parts credit sale with linked debt and both stock lines', async () => {
    const first = await checkout('seller', true);
    const replay = await checkout('seller', true);
    expect(replay.transaction?.id).toBe(first.transaction?.id);
    expect(await read('inventory', 'A')).toMatchObject({ stock: 0 });
    expect(await read('inventory', 'B')).toMatchObject({ stock: 0 });
    expect(await count('transactions')).toBe(1);
    expect(await count('customer_debts')).toBe(1);
    expect(first.debtEntry?.payments[0]).toMatchObject({ amount: 50, method: 'card', countedOn: 'sale' });
    expect(first.transaction?.accountSettlement?.debtEntryId).toBe(first.debtEntry?.id);
    expect(await read('customers', 'customer')).toMatchObject({ totalDebt: 150 });
  }, 20000);

  it('allows one of two competing tills to take the last units', async () => {
    const results = await Promise.allSettled([checkout('till-A'), checkout('till-B')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await count('transactions')).toBe(1);
    expect(await read('inventory', 'A')).toMatchObject({ stock: 0 });
  }, 20000);

  it('does not leave stock or a debt when the signed-in role cannot sell', async () => {
    context.db = env.authenticatedContext('viewer').firestore() as unknown as Firestore;
    await expect(checkout('viewer', true)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await count('transactions')).toBe(0);
    expect(await count('customer_debts')).toBe(0);
    expect(await read('inventory', 'A')).toMatchObject({ stock: 1 });
  }, 20000);

  it('resolves an unsaved attempt by recording a permanent cancellation', async () => {
    await updateDoc(doc(context.db, 'inventory', 'B'), { stock: 0 });
    await expect(checkout()).rejects.toThrow('INSUFFICIENT_STOCK');
    const resolved = await partsCheckoutService.resolve('seller');
    expect(resolved?.cancelled).toBe(true);
    await updateDoc(doc(context.db, 'inventory', 'B'), { stock: 1 });
    await expect(checkout()).rejects.toThrow('cancelled');
    expect(await count('transactions')).toBe(0);
    expect(await read('inventory', 'A')).toMatchObject({ stock: 1 });
    const admin = env.authenticatedContext('admin').firestore();
    const ref = doc(admin, 'operation_receipts', `parts_checkout_${resolved!.pending.transaction.id}`);
    await expect(deleteDoc(ref)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(ref, { checkoutOutcome: 'committed' })).rejects.toMatchObject({ code: 'permission-denied' });
  }, 20000);

  it('serializes Avoir redemptions against the authoritative balance', async () => {
    const results = await Promise.allSettled([
      customerService.changeStoreCredit('customer', -80, 'redeem-A', audit),
      customerService.changeStoreCredit('customer', -80, 'redeem-B', audit),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await read('customers', 'customer')).toMatchObject({ storeCredit: 20 });
    expect(await count('customer_activity_logs')).toBe(1);
  }, 20000);

  it('retains a stock receipt beyond forty later movements and forbids its deletion', async () => {
    for (let i = 0; i < 45; i++) await commitStockDelta('A', 1, `movement-${i}`);
    await commitStockDelta('A', 1, 'movement-0');
    expect(await read('inventory', 'A')).toMatchObject({ stock: 46 });
    const admin = env.authenticatedContext('admin').firestore();
    await expect(deleteDoc(doc(admin, 'operation_receipts', 'stock_movement-0'))).rejects.toMatchObject({ code: 'permission-denied' });
  }, 20000);

  it('serializes Parts credit-limit checks even when both tills have stock', async () => {
    await updateDoc(doc(context.db, 'inventory', 'A'), { stock: 5 });
    await updateDoc(doc(context.db, 'inventory', 'B'), { stock: 5 });
    const results = await Promise.allSettled([checkout('till-A', true), checkout('till-B', true)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await count('transactions')).toBe(1);
    expect(await count('customer_debts')).toBe(1);
    expect(await read('customers', 'customer')).toMatchObject({ totalDebt: 150 });
  }, 20000);

  it('reverses a confirmed Parts invoice, its stock, debt and Avoir in one refund', async () => {
    const first = await checkout('seller', true);
    const actor = { id: 'seller', name: 'Emulator cashier', role: 'sales_agent' };
    const result = await transactionService.refund(first.transaction!, actor);
    expect(result.outcome).toBe('refunded');
    expect(await read('transactions', first.transaction!.id)).toMatchObject({ status: 'refunded', financialRevision: 1 });
    expect(await read('inventory', 'A')).toMatchObject({ stock: 1 });
    expect(await read('inventory', 'B')).toMatchObject({ stock: 1 });
    expect(await read('customers', 'customer')).toMatchObject({ totalDebt: 0, storeCredit: 150 });
    expect(await read('customer_debts', first.debtEntry!.id)).toMatchObject({ status: 'paid', remainingBalance: 0 });
    // Replaying the same refund adopts the recorded outcome instead of moving twice.
    const replay = await transactionService.refund(first.transaction!, actor);
    expect(replay.outcome).toBe('refunded');
    expect(await read('inventory', 'A')).toMatchObject({ stock: 1 });
    expect(await count('transactions')).toBe(1);
  }, 20000);

  it('corrects a confirmed Parts invoice, its stock, debt and Avoir in one edit', async () => {
    const first = await checkout('seller', true);
    const expected = first.transaction!;
    const result = await transactionService.editSale(expected, {
      updates: {
        items: [{ product: part('A'), quantity: 1 }],
        subtotal: 100, total: 100,
        payments: [{ method: 'card', amount: 50 }],
        accountSettlement: { type: 'partial_payment' as const, paidAmount: 50, chargedAmount: 50, debtEntryId: first.debtEntry!.id },
        financialRevision: (expected.financialRevision ?? 0) + 1,
      },
      stockDeltas: [{ productId: 'B', delta: 1 }],
      creditShift: { customerId: 'customer', amount: 100, note: 'Over-collection held as Avoir' },
      debtUpdate: { debtId: first.debtEntry!.id, total: 100, charged: 50, itemsSummary: '1x A', expectedPaid: 50 },
    });
    expect(result.transaction).toMatchObject({ total: 100, financialRevision: 1 });
    expect(await read('transactions', expected.id)).toMatchObject({ total: 100, financialRevision: 1 });
    expect(await read('inventory', 'B')).toMatchObject({ stock: 1 });
    expect(await read('customers', 'customer')).toMatchObject({ storeCredit: 200 });
    expect(await read('customer_debts', first.debtEntry!.id)).toMatchObject({ totalAmount: 100, remainingBalance: 50 });
    // A stale till holding revision 0 is refused before anything moves.
    await expect(transactionService.editSale(expected, {
      updates: { total: 90, financialRevision: 1 },
      stockDeltas: [], debtUpdate: undefined,
    })).rejects.toThrow(/changed on another device/);
    expect(await read('inventory', 'B')).toMatchObject({ stock: 1 });
  }, 20000);

  it('recognizes the same Avoir operation and rejects conflicting reuse', async () => {
    await customerService.changeStoreCredit('customer', 10, 'issue-A', audit);
    await customerService.changeStoreCredit('customer', 10, 'issue-A', audit);
    await expect(customerService.changeStoreCredit('customer', 20, 'issue-A', audit)).rejects.toThrow('different movement');
    expect(await read('customers', 'customer')).toMatchObject({ storeCredit: 110 });
    expect(await count('customer_activity_logs')).toBe(1);
  }, 20000);

  it('prevents two retail tills from spending the same Avoir credit in parallel', async () => {
    await updateDoc(doc(context.db, 'inventory', 'A'), { stock: 5 });
    const retailSale = (actor: string): Omit<SaleTransaction, 'id'> => ({
      date: '2026-11-17T11:00:00Z',
      processedById: actor,
      processedByName: `Retail ${actor}`,
      invoiceNumber: `RET-${actor}`,
      saleType: 'retail',
      status: 'completed',
      customerId: 'customer',
      customerName: 'Emulator customer',
      items: [{ product: part('A'), quantity: 1 }],
      subtotal: 100,
      total: 100,
      payments: [
        { method: 'cash', amount: 20 },
        { method: 'store_credit', amount: 80 },
      ],
    });

    const results = await Promise.allSettled([
      retailCheckoutService.checkout(retailSale('till-A'), { draftKey: 'ret-A', actorRole: 'sales_agent', storeCreditUsed: 80 }),
      retailCheckoutService.checkout(retailSale('till-B'), { draftKey: 'ret-B', actorRole: 'sales_agent', storeCreditUsed: 80 }),
    ]);

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await read('customers', 'customer')).toMatchObject({ storeCredit: 20 });
    expect(await read('inventory', 'A')).toMatchObject({ stock: 4 });
    expect(await count('transactions')).toBe(1);
  }, 20000);

  it('refuses retail checkout overselling inside real Firestore transactions rather than clamping at zero', async () => {
    const oversellSale: Omit<SaleTransaction, 'id'> = {
      date: '2026-11-17T12:00:00Z',
      processedById: 'seller',
      processedByName: 'Emulator cashier',
      invoiceNumber: 'RET-OVER',
      saleType: 'retail',
      status: 'completed',
      items: [{ product: part('A'), quantity: 2 }],
      subtotal: 200,
      total: 200,
      payments: [{ method: 'cash', amount: 200 }],
    };

    await expect(
      retailCheckoutService.checkout(oversellSale, { draftKey: 'over-1', actorRole: 'sales_agent' })
    ).rejects.toThrow('INSUFFICIENT_STOCK');
    expect(await read('inventory', 'A')).toMatchObject({ stock: 1 });
    expect(await count('transactions')).toBe(0);
  }, 20000);
});
