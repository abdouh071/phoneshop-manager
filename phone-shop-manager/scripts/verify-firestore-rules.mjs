// Runs the Firestore rules against the LOCAL emulator only (demo- project, no
// production contact). Start it with: npm run test:rules
// Every check mirrors a write path verified in both apps; "allow" cases are the
// flows the shop runs daily, "deny" cases are the forgeries the old rules let
// through. A single failure exits non-zero so the slice cannot be committed green.
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  addDoc,
  collection,
  query,
  limit,
  where,
  getDocs,
} from 'firebase/firestore';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');

const env = await initializeTestEnvironment({
  projectId: 'demo-phoneshop-rules',
  firestore: { host, port: Number(port), rules },
});

let passed = 0;
let failed = 0;
const check = async (name, expect, promise) => {
  try {
    if (expect === 'allow') await assertSucceeds(promise);
    else await assertFails(promise);
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}\n     ${err.message}`);
  }
};

const seed = (path, data) =>
  env.withSecurityRulesDisabled(async (ctx) => {
    const [col, id] = path.split('/');
    await setDoc(doc(ctx.firestore(), col, id), data);
  });

const seedPath = (path, data) =>
  env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), ...path.split('/')), data);
  });

// Personas: role presets, per-key overrides, a revoked flag, a legacy null map,
// a non-boolean override (falls back to the preset), and a view-only account.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const users = {
    admin: { role: 'admin', name: 'Owner', email: 'owner@shop.dz' },
    superadmin: { role: 'admin', name: 'SuperOwner', isSuperAdmin: true },
    sales: { role: 'sales_agent', name: 'Seller' },
    repair: { role: 'repair_agent', name: 'Technician' },
    viewonly: {
      role: 'sales_agent',
      name: 'Viewer',
      permissions: {
        dashboard: true, pos: false, repairs: false, repair_add: false,
        repair_edit: false, repair_status: false, repair_assign: false,
        inventory_products: false, inventory_parts: false, inventory_edit: false,
        inventory_delete: false, parts_sell: false, customers: false,
        customers_debt: false, reports: true, activity: true,
      },
    },
    customseller: { role: 'repair_agent', name: 'Custom', permissions: { pos: true } },
    repaironly: { role: 'repair_agent', name: 'NoPartsSell', permissions: { parts_sell: false } },
    revokedsales: { role: 'sales_agent', name: 'Revoked', permissions: { pos: false } },
    legacysales: { role: 'sales_agent', name: 'Legacy', permissions: null },
    nonbool: { role: 'sales_agent', name: 'NonBool', permissions: { pos: 'yes' } },
  };
  for (const [uid, data] of Object.entries(users)) {
    await setDoc(doc(db, 'users', uid), data);
  }
});

await seed('transactions/tx1', { total: 1000, status: 'completed', customerId: 'c1' });
await seed('inventory/p1', { name: 'Phone', price: 100000, stock: 5, stockStatus: 'in_stock', lowStockThreshold: 1 });
await seed('products/p2', { name: 'Part', price: 5000, stock: 3, stockStatus: 'in_stock' });
await seed('customer_debts/d1', { customerId: 'c1', totalAmount: 1000, amountPaid: 0, remainingBalance: 1000, status: 'unpaid', payments: [] });
await seed('customers/c1', { name: 'Client', phone: '0550000000' });
await seed('repairs/r1', { ticketNumber: 'TKT-0001', status: 'pending' });
await seed('counters/repairs', { lastNumber: 1 });
await seed('suppliers/s1', { name: 'Supplier' });
await seed('purchaseOrders/po1', { poNumber: 'PO-1', status: 'draft' });
await seed('end_of_day/eod1', { date: '2026-11-09', totalRevenue: 1000, notes: '' });
await seed('activityLogs/log1', { timestamp: new Date(), action: 'seed' });
await seed('customer_activity_logs/clog1', { customerId: 'c1', customerName: 'Client', action: 'seed', amount: 5 });
await seed('settings/general', { storeName: 'Shop' });
await seed('approvalRequests/ap1', { status: 'pending', requestedBy: { uid: 'sales' }, actionType: 'discount' });
await seed('approvalRequests/ap2', { status: 'pending', requestedBy: { uid: 'sales' }, actionType: 'void_sale' });

const dbs = Object.fromEntries(
  ['admin', 'superadmin', 'sales', 'repair', 'viewonly', 'customseller', 'repaironly', 'revokedsales', 'legacysales', 'nonbool']
    .map((uid) => [uid, env.authenticatedContext(uid).firestore()])
);
const anon = env.unauthenticatedContext().firestore();

console.log('— transactions: sellers only —');
await check('sales rings a sale', 'allow', addDoc(collection(dbs.sales, 'transactions'), { total: 500, status: 'completed' }));
await check('admin rings a sale', 'allow', addDoc(collection(dbs.admin, 'transactions'), { total: 500, status: 'completed' }));
await check('technician rings a parts sale (preset parts_sell)', 'allow', addDoc(collection(dbs.repair, 'transactions'), { total: 500, status: 'completed' }));
await check('repair-only forges a sale', 'deny', addDoc(collection(dbs.repaironly, 'transactions'), { total: 500, status: 'completed' }));
await check('view-only forges a sale', 'deny', addDoc(collection(dbs.viewonly, 'transactions'), { total: 500, status: 'completed' }));
await check('revoked pos cannot sell', 'deny', addDoc(collection(dbs.revokedsales, 'transactions'), { total: 500, status: 'completed' }));
await check('repair role granted pos may sell', 'allow', addDoc(collection(dbs.customseller, 'transactions'), { total: 500, status: 'completed' }));
await check('legacy null permissions keep preset', 'allow', addDoc(collection(dbs.legacysales, 'transactions'), { total: 500, status: 'completed' }));
await check('non-boolean override falls back to preset', 'allow', addDoc(collection(dbs.nonbool, 'transactions'), { total: 500, status: 'completed' }));
await check('sales refunds (admin-unlock flow)', 'allow', updateDoc(doc(dbs.sales, 'transactions', 'tx1'), { status: 'refunded', refundedAt: new Date().toISOString() }));
await check('sales stamps sale effects', 'allow', updateDoc(doc(dbs.sales, 'transactions', 'tx1'), { stockApplied: true, profileApplied: true }));
await check('sales stamps void request', 'allow', updateDoc(doc(dbs.sales, 'transactions', 'tx1'), { status: 'pending_approval', approvalRequestId: 'ap2' }));
await check('repair-only forges a refund', 'deny', updateDoc(doc(dbs.repaironly, 'transactions', 'tx1'), { status: 'refunded' }));
await check('view-only forges a refund', 'deny', updateDoc(doc(dbs.viewonly, 'transactions', 'tx1'), { status: 'refunded' }));
await check('nobody deletes a transaction', 'deny', deleteDoc(doc(dbs.admin, 'transactions', 'tx1')));

console.log('— inventory & products: the shelf —');
await check('sales deducts stock (sale)', 'allow', updateDoc(doc(dbs.sales, 'inventory', 'p1'), { stock: 4, stockStatus: 'in_stock' }));
await check('sales stock delta carries replay keys', 'allow', updateDoc(doc(dbs.sales, 'inventory', 'p1'), { stock: 3, stockStatus: 'in_stock', appliedStockKeys: ['tx_1'] }));
await check('repair deducts stock (parts allocation)', 'allow', updateDoc(doc(dbs.repair, 'inventory', 'p1'), { stock: 2, stockStatus: 'low_stock' }));
await check('sales applies approved price edit', 'allow', updateDoc(doc(dbs.sales, 'inventory', 'p1'), { price: 90000, costPrice: 60000, lowStockThreshold: 2, stockStatus: 'in_stock', updatedAt: new Date().toISOString() }));
await check('view-only zeroes a price', 'deny', updateDoc(doc(dbs.viewonly, 'inventory', 'p1'), { price: 0 }));
await check('view-only moves stock', 'deny', updateDoc(doc(dbs.viewonly, 'inventory', 'p1'), { stock: 999, stockStatus: 'in_stock' }));
await check('sales adds a product (unlock flow)', 'allow', addDoc(collection(dbs.sales, 'inventory'), { name: 'New', price: 100, stock: 1, stockStatus: 'in_stock' }));
await check('repair adds a part', 'allow', addDoc(collection(dbs.repair, 'inventory'), { name: 'Part', price: 100, stock: 1, stockStatus: 'in_stock', category: 'repair_part' }));
await check('view-only adds a product', 'deny', addDoc(collection(dbs.viewonly, 'inventory'), { name: 'New', price: 100, stock: 1 }));
await seed('inventory/pdel1', { name: 'Doomed', price: 1, stock: 0 });
await check('sales deletes via edit-panel unlock', 'allow', deleteDoc(doc(dbs.sales, 'inventory', 'pdel1')));
await seed('inventory/pdel2', { name: 'Doomed', price: 1, stock: 0 });
await check('view-only deletes a product', 'deny', deleteDoc(doc(dbs.viewonly, 'inventory', 'pdel2')));
await check('phone products fallback: sales stock', 'allow', updateDoc(doc(dbs.sales, 'products', 'p2'), { stock: 2, stockStatus: 'in_stock' }));
await check('phone products fallback: repair stock', 'allow', updateDoc(doc(dbs.repair, 'products', 'p2'), { stock: 1, stockStatus: 'low_stock' }));
await check('phone products fallback: view-only denied', 'deny', updateDoc(doc(dbs.viewonly, 'products', 'p2'), { stock: 99 }));

console.log('— customer debts —');
await check('credit sale creates a debt', 'allow', addDoc(collection(dbs.sales, 'customer_debts'), { customerId: 'c1', totalAmount: 500, amountPaid: 0, remainingBalance: 500, status: 'unpaid', payments: [] }));
await check('repair settlement creates a debt', 'allow', addDoc(collection(dbs.repair, 'customer_debts'), { customerId: 'c1', totalAmount: 500, amountPaid: 0, remainingBalance: 500, status: 'unpaid', payments: [] }));
await check('view-only forges a debt', 'deny', addDoc(collection(dbs.viewonly, 'customer_debts'), { customerId: 'c1', totalAmount: 500 }));
await check('sales zeroes balance on credit refund', 'allow', updateDoc(doc(dbs.sales, 'customer_debts', 'd1'), { totalAmount: 0, amountPaid: 0, remainingBalance: 0, status: 'paid', updatedAt: new Date().toISOString() }));
await check('repair records settlement payment', 'allow', updateDoc(doc(dbs.repair, 'customer_debts', 'd1'), { amountPaid: 500, remainingBalance: 500, status: 'partially_paid' }));
await check('view-only erases a debt', 'deny', updateDoc(doc(dbs.viewonly, 'customer_debts', 'd1'), { remainingBalance: 0, status: 'paid' }));
await check('sales cannot delete a debt row', 'deny', deleteDoc(doc(dbs.sales, 'customer_debts', 'd1')));
await seed('customer_debts/ddel', { customerId: 'c1', totalAmount: 10 });
await check('admin deletes a debt row', 'allow', deleteDoc(doc(dbs.admin, 'customer_debts', 'ddel')));

console.log('— customers —');
await check('till creates a walk-in', 'allow', addDoc(collection(dbs.sales, 'customers'), { name: 'Walk-in', phone: '0551111111' }));
await check('intake creates a customer', 'allow', addDoc(collection(dbs.repair, 'customers'), { name: 'Intake', phone: '0552222222' }));
await check('view-only creates a customer', 'deny', addDoc(collection(dbs.viewonly, 'customers'), { name: 'Ghost' }));
await check('sale moves customer totals', 'allow', updateDoc(doc(dbs.sales, 'customers', 'c1'), { totalSpent: 500, lastVisitDate: new Date().toISOString() }));
await check('view-only rewrites a customer', 'deny', updateDoc(doc(dbs.viewonly, 'customers', 'c1'), { name: 'Hacked' }));
await seed('customers/cdel', { name: 'Doomed' });
await check('sales cannot delete a customer', 'deny', deleteDoc(doc(dbs.sales, 'customers', 'cdel')));
await check('admin deletes a customer', 'allow', deleteDoc(doc(dbs.admin, 'customers', 'cdel')));

console.log('— counters —');
await check('seller claims an invoice number', 'allow', setDoc(doc(dbs.sales, 'counters', 'invoices_retail_261110'), { lastNumber: 2 }, { merge: true }));
await check('intake claims a ticket number', 'allow', setDoc(doc(dbs.repair, 'counters', 'repairs'), { lastNumber: 5 }, { merge: true }));
await check('view-only burns counter numbers', 'deny', setDoc(doc(dbs.viewonly, 'counters', 'repairs'), { lastNumber: 9999 }, { merge: true }));

console.log('— repairs —');
await check('intake creates a ticket', 'allow', addDoc(collection(dbs.repair, 'repairs'), { ticketNumber: 'TKT-9001', status: 'pending' }));
await check('counter creates ticket from customer profile', 'allow', addDoc(collection(dbs.sales, 'repairs'), { ticketNumber: 'TKT-9002', status: 'pending' }));
await check('view-only creates a ticket', 'deny', addDoc(collection(dbs.viewonly, 'repairs'), { ticketNumber: 'TKT-9003', status: 'pending' }));
await check('technician moves status', 'allow', updateDoc(doc(dbs.repair, 'repairs', 'r1'), { status: 'in_progress', updatedAt: new Date().toISOString() }));
await check('counter edits device from customer profile', 'allow', updateDoc(doc(dbs.sales, 'repairs', 'r1'), { deviceBrand: 'Samsung', deviceModel: 'A15' }));
await check('view-only rewrites a ticket', 'deny', updateDoc(doc(dbs.viewonly, 'repairs', 'r1'), { status: 'completed' }));
await seed('repairs/rdel1', { ticketNumber: 'TKT-9004', status: 'pending' });
await check('merge deletes the secondary ticket', 'allow', deleteDoc(doc(dbs.repair, 'repairs', 'rdel1')));
await seed('repairs/rdel2', { ticketNumber: 'TKT-9005', status: 'pending' });
await check('customer profile deletes a device ticket', 'allow', deleteDoc(doc(dbs.sales, 'repairs', 'rdel2')));
await seed('repairs/rdel3', { ticketNumber: 'TKT-9006', status: 'pending' });
await check('view-only deletes a ticket', 'deny', deleteDoc(doc(dbs.viewonly, 'repairs', 'rdel3')));

console.log('— purchasing —');
await check('purchasing editor writes a supplier', 'allow', updateDoc(doc(dbs.admin, 'suppliers', 's1'), { name: 'Updated' }));
await check('sales cannot write suppliers', 'deny', updateDoc(doc(dbs.sales, 'suppliers', 's1'), { name: 'Hacked' }));
await check('repair cannot write suppliers', 'deny', updateDoc(doc(dbs.repair, 'suppliers', 's1'), { name: 'Hacked' }));
await check('restock assistant raises a PO (parts staff)', 'allow', updateDoc(doc(dbs.repair, 'purchaseOrders', 'po1'), { status: 'ordered', updatedAt: new Date().toISOString() }));
await check('admin receives a PO', 'allow', updateDoc(doc(dbs.admin, 'purchaseOrders', 'po1'), { status: 'received' }));
await check('sales cannot write POs', 'deny', updateDoc(doc(dbs.sales, 'purchaseOrders', 'po1'), { status: 'received' }));
await check('view-only cannot write POs', 'deny', updateDoc(doc(dbs.viewonly, 'purchaseOrders', 'po1'), { status: 'received' }));

console.log('— unchanged guards still hold —');
await check('sales saves a cart', 'allow', setDoc(doc(dbs.sales, 'carts', 'cart1'), { items: [] }));
await check('sales pushes a print job', 'allow', addDoc(collection(dbs.sales, 'printQueue'), { status: 'pending', html: '<div/>' }));
await check('sales seals the day', 'allow', addDoc(collection(dbs.sales, 'end_of_day'), { date: '2026-11-10', totalRevenue: 10 }));
await check('sales edits only seal notes', 'allow', updateDoc(doc(dbs.sales, 'end_of_day', 'eod1'), { notes: 'till counted' }));
await check('sales cannot rewrite sealed figures', 'deny', updateDoc(doc(dbs.sales, 'end_of_day', 'eod1'), { totalRevenue: 1 }));
await check('admin corrects a seal', 'allow', updateDoc(doc(dbs.admin, 'end_of_day', 'eod1'), { totalRevenue: 2000 }));
await check('sales appends an activity log', 'allow', addDoc(collection(dbs.sales, 'activityLogs'), { timestamp: new Date(), action: 'sale' }));
await check('nobody edits the audit trail', 'deny', updateDoc(doc(dbs.admin, 'activityLogs', 'log1'), { action: 'rewritten' }));
await check('customer log merge re-point only', 'allow', updateDoc(doc(dbs.sales, 'customer_activity_logs', 'clog1'), { customerId: 'c2', customerName: 'Merged' }));
await check('customer log amount frozen', 'deny', updateDoc(doc(dbs.sales, 'customer_activity_logs', 'clog1'), { amount: 999 }));
await check('sales cannot write settings', 'deny', setDoc(doc(dbs.sales, 'settings', 'general'), { storeName: 'Hacked' }, { merge: true }));
await check('admin writes settings', 'allow', setDoc(doc(dbs.admin, 'settings', 'general'), { storeName: 'Shop' }, { merge: true }));
await check('staff cannot write violations log', 'deny', setDoc(doc(dbs.admin, 'moneyPathViolations', 'v1'), { note: 'fake' }));
await check('sales requests an approval', 'allow', addDoc(collection(dbs.sales, 'approvalRequests'), { status: 'pending', requestedBy: { uid: 'sales' }, actionType: 'discount' }));
await check('request must name its requester', 'deny', addDoc(collection(dbs.sales, 'approvalRequests'), { status: 'pending', requestedBy: { uid: 'admin' }, actionType: 'discount' }));
await check('sales cannot self-approve', 'deny', updateDoc(doc(dbs.sales, 'approvalRequests', 'ap2'), { status: 'approved' }));
await check('requester cancels own request', 'allow', updateDoc(doc(dbs.sales, 'approvalRequests', 'ap1'), { status: 'cancelled' }));
await check('admin resolves a request', 'allow', updateDoc(doc(dbs.admin, 'approvalRequests', 'ap2'), { status: 'approved' }));
await check('staff reads staff profiles', 'allow', getDoc(doc(dbs.sales, 'users', 'admin')));
await check('self push-token update', 'allow', updateDoc(doc(dbs.sales, 'users', 'sales'), { pushToken: 'tok' }));
await check('self role escalation blocked', 'deny', updateDoc(doc(dbs.sales, 'users', 'sales'), { role: 'admin' }));

console.log('— approval PIN secrets: owner and admins only —');
await seedPath('users/admin/secrets/approvalPin', { verifier: 'v2:210000:aaaa:bbbb' });
await seedPath('users/superadmin/secrets/approvalPin', { verifier: 'v2:210000:cccc:dddd' });
await seedPath('users/sales/secrets/approvalPin', { verifier: 'v2:210000:eeee:ffff' });
await check('staff reads own verifier', 'allow', getDoc(doc(dbs.sales, 'users', 'sales', 'secrets', 'approvalPin')));
await check('staff cannot read an admin verifier', 'deny', getDoc(doc(dbs.sales, 'users', 'admin', 'secrets', 'approvalPin')));
await check('staff cannot read the owner verifier', 'deny', getDoc(doc(dbs.sales, 'users', 'superadmin', 'secrets', 'approvalPin')));
await check('technician cannot read an admin verifier', 'deny', getDoc(doc(dbs.repair, 'users', 'admin', 'secrets', 'approvalPin')));
await check('admin reads a staff verifier (approval prompt)', 'allow', getDoc(doc(dbs.admin, 'users', 'sales', 'secrets', 'approvalPin')));
await check('admin reads the owner verifier', 'allow', getDoc(doc(dbs.admin, 'users', 'superadmin', 'secrets', 'approvalPin')));
await check('staff sets own verifier', 'allow', setDoc(doc(dbs.sales, 'users', 'sales', 'secrets', 'approvalPin'), { verifier: 'v2:210000:1111:2222' }));
await check('staff cannot overwrite an admin verifier', 'deny', setDoc(doc(dbs.sales, 'users', 'admin', 'secrets', 'approvalPin'), { verifier: 'forged' }));
await check('staff cannot delete an admin verifier', 'deny', deleteDoc(doc(dbs.sales, 'users', 'admin', 'secrets', 'approvalPin')));
await check('admin resets a staff verifier', 'allow', setDoc(doc(dbs.admin, 'users', 'sales', 'secrets', 'approvalPin'), { verifier: 'v2:210000:3333:4444' }));
await check('admin cannot overwrite the owner verifier', 'deny', setDoc(doc(dbs.admin, 'users', 'superadmin', 'secrets', 'approvalPin'), { verifier: 'forged' }));
await check('owner sets any verifier', 'allow', setDoc(doc(dbs.superadmin, 'users', 'admin', 'secrets', 'approvalPin'), { verifier: 'v2:210000:5555:6666' }));
await check('staff deletes own verifier (PIN removal)', 'allow', deleteDoc(doc(dbs.sales, 'users', 'sales', 'secrets', 'approvalPin')));
await check('self clears the legacy profile field (migration)', 'allow', updateDoc(doc(dbs.sales, 'users', 'sales'), { hasApprovalPin: true, approvalPin: deleteField() }));
await check('admin clears a staff legacy field (migration)', 'allow', updateDoc(doc(dbs.admin, 'users', 'repair'), { hasApprovalPin: true, approvalPin: deleteField() }));

console.log('— unauthenticated surface —');
await check('anon cannot read a transaction', 'deny', getDoc(doc(anon, 'transactions', 'tx1')));
await check('anon cannot read a ticket by id', 'deny', getDoc(doc(anon, 'repairs', 'r1')));
await check('anon cannot read a PIN verifier', 'deny', getDoc(doc(anon, 'users', 'admin', 'secrets', 'approvalPin')));
await check('anon cannot write a PIN verifier', 'deny', setDoc(doc(anon, 'users', 'admin', 'secrets', 'approvalPin'), { verifier: 'forged' }));
await check('anon cannot page repairs with limit(1) (A2 closed)', 'deny', getDocs(query(collection(anon, 'repairs'), limit(1))));
await check('anon cannot list repairs unfiltered', 'deny', getDocs(collection(anon, 'repairs')));
await check('anon cannot read a ticket by ticketNumber query', 'deny', getDocs(query(collection(anon, 'repairs'), where('ticketNumber', '==', 'TKT-0001'), limit(1))));
await check('anon reads public store settings', 'allow', getDoc(doc(anon, 'settings', 'general')));

console.log('— public tracking mirror —');
await seed('repair_tracking/m1', { ticketNumber: 'TKT-0001', status: 'pending', deviceBrand: 'Samsung', deviceModel: 'A15', createdAt: '2026-11-10T08:00:00.000Z', issueDescription: 'Screen', statusTimestamps: { pending: '2026-11-10T08:00:00.000Z' } });
await check('anon reads a mirror by id (the id is the PIN proof)', 'allow', getDoc(doc(anon, 'repair_tracking', 'm1')));
await check('anon cannot enumerate mirrors', 'deny', getDocs(collection(anon, 'repair_tracking')));
await check('anon cannot enumerate mirrors with limit(1)', 'deny', getDocs(query(collection(anon, 'repair_tracking'), limit(1))));
await check('anon cannot write a mirror', 'deny', setDoc(doc(anon, 'repair_tracking', 'm1'), { status: 'completed' }));
await check('anon cannot delete a mirror', 'deny', deleteDoc(doc(anon, 'repair_tracking', 'm1')));
await check('technician writes a mirror', 'allow', setDoc(doc(dbs.repair, 'repair_tracking', 'm2'), { ticketNumber: 'TKT-0002', status: 'ready' }));
await check('counter writes a mirror (customers flag)', 'allow', setDoc(doc(dbs.sales, 'repair_tracking', 'm3'), { ticketNumber: 'TKT-0003', status: 'pending' }));
await check('view-only cannot write a mirror', 'deny', setDoc(doc(dbs.viewonly, 'repair_tracking', 'm4'), { ticketNumber: 'TKT-0004', status: 'pending' }));
await check('admin lists mirrors for the rebuild', 'allow', getDocs(collection(dbs.admin, 'repair_tracking')));
await check('technician deletes a stale mirror (rebuild)', 'allow', deleteDoc(doc(dbs.repair, 'repair_tracking', 'm2')));
await check('staff still reads the full ticket', 'allow', getDoc(doc(dbs.repair, 'repairs', 'r1')));

await env.cleanup();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);