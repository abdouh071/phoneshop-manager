#!/usr/bin/env node
/**
 * Isolated UI fixture & emulator dev server.
 * Never reads or falls back to production Firebase projects or .env credentials.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const DEMO_PROJECT_ID = 'demo-phoneshop-ui';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);
const insideEmulator = process.argv.includes('--inside-emulator');
const seedOnly = process.argv.includes('--seed-only');
const portArgIndex = process.argv.indexOf('--port');
const uiPort = portArgIndex >= 0 && process.argv[portArgIndex + 1]
  ? process.argv[portArgIndex + 1]
  : process.env.UI_FIXTURE_PORT || '5179';

const prependHomebrewJava = (env) => {
  const candidates = [
    '/opt/homebrew/opt/openjdk/bin',
    '/opt/homebrew/opt/openjdk@25/bin',
    '/opt/homebrew/opt/openjdk@21/bin',
  ];
  const existing = candidates.filter((dir) => existsSync(`${dir}/java`));
  if (!existing.length) return env;
  return { ...env, PATH: `${existing.join(':')}:${env.PATH || ''}` };
};

if (!insideEmulator) {
  const args = [
    'emulators:exec',
    '--only',
    'auth,firestore',
    '--project',
    DEMO_PROJECT_ID,
    `node scripts/ui-fixture-server.mjs --inside-emulator --port ${uiPort}${seedOnly ? ' --seed-only' : ''}`,
  ];
  const child = spawn('firebase', args, {
    stdio: 'inherit',
    env: prependHomebrewJava({ ...process.env }),
  });
  child.on('exit', (code) => process.exit(code ?? 1));
} else {
  const firestoreHostPort = process.env.FIRESTORE_EMULATOR_HOST;
  const authHostPort = process.env.FIREBASE_AUTH_EMULATOR_HOST;

  if (!firestoreHostPort || !authHostPort) {
    throw new Error('Both FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST must be set inside emulator.');
  }

  const assertLoopback = (hostPort, name) => {
    const colon = hostPort.lastIndexOf(':');
    const host = colon > 0 ? hostPort.slice(0, colon) : hostPort;
    const port = Number(colon > 0 ? hostPort.slice(colon + 1) : '');
    if (!LOOPBACK_HOSTS.has(host) || !Number.isInteger(port) || port < 1) {
      throw new Error(`Refusing non-loopback ${name}: "${hostPort}"`);
    }
    return { host, port };
  };

  const firestore = assertLoopback(firestoreHostPort, 'FIRESTORE_EMULATOR_HOST');
  assertLoopback(authHostPort, 'FIREBASE_AUTH_EMULATOR_HOST');

  const createAuthUser = async (email, password, displayName) => {
    const res = await fetch(
      `http://${authHostPort}/identitytoolkit.googleapis.com/v1/projects/${DEMO_PROJECT_ID}/accounts?key=demo-phoneshop-emulator-api-key`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer owner',
        },
        body: JSON.stringify({ email, password, displayName, emailVerified: true }),
      }
    );
    if (!res.ok) {
      throw new Error(`Failed to create emulator user ${email}: ${await res.text()}`);
    }
    const payload = await res.json();
    return payload.localId;
  };

  await fetch(`http://${authHostPort}/emulator/v1/projects/${DEMO_PROJECT_ID}/accounts`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer owner' },
  });

  const env = await initializeTestEnvironment({
    projectId: DEMO_PROJECT_ID,
    firestore: {
      host: firestore.host,
      port: firestore.port,
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  });

  await env.clearFirestore();

  const adminUid = await createAuthUser('admin@demo.local', 'DemoPass123!', 'Demo Admin');
  const salesUid = await createAuthUser('sales@demo.local', 'DemoPass123!', 'Demo Cashier');
  const techUid = await createAuthUser('tech@demo.local', 'DemoPass123!', 'Demo Tech');

  const now = new Date().toISOString();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await Promise.all([
      setDoc(doc(db, 'users', adminUid), { id: adminUid, name: 'Demo Admin', email: 'admin@demo.local', role: 'admin', status: 'active', isSuperAdmin: false }),
      setDoc(doc(db, 'users', salesUid), { id: salesUid, name: 'Demo Cashier', email: 'sales@demo.local', role: 'sales_agent', status: 'active', isSuperAdmin: false }),
      setDoc(doc(db, 'users', techUid), { id: techUid, name: 'Demo Tech', email: 'tech@demo.local', role: 'repair_agent', status: 'active', isSuperAdmin: false }),
      setDoc(doc(db, 'settings', 'general'), {
        storeName: 'Fixture Phone Shop',
        currency: 'DZD',
        updatedAt: now,
      }),
      setDoc(doc(db, 'inventory', 'fixture_phone_1'), {
        id: 'fixture_phone_1', name: 'Fixture Phone X', model: '128GB', category: 'Smartphone',
        price: 25000, costPrice: 20000, stock: 5, lowStockThreshold: 1, stockStatus: 'in_stock', createdAt: now,
      }),
      setDoc(doc(db, 'inventory', 'fixture_part_1'), {
        id: 'fixture_part_1', name: 'Fixture Screen', model: 'Phone X', category: 'Parts',
        partCategory: 'Ecran', compatibleModels: ['Phone X'],
        price: 4500, costPrice: 2500, stock: 4, lowStockThreshold: 1, stockStatus: 'in_stock', createdAt: now,
      }),
      setDoc(doc(db, 'customers', 'fixture_cust_a'), {
        id: 'fixture_cust_a', name: 'Fixture Client Alpha', phone: '0555111111',
        accountType: 'regular', storeCredit: 2000, totalDebt: 0, totalSpent: 0, totalPurchases: 0, createdAt: now,
      }),
      setDoc(doc(db, 'customers', 'fixture_cust_b'), {
        id: 'fixture_cust_b', name: 'Fixture Client Beta', phone: '0555222222',
        accountType: 'shop_repairer', shopName: 'Fixture Repair Shop', storeCredit: 0, totalDebt: 3000, creditLimit: 20000, totalSpent: 15000, totalPurchases: 1, createdAt: now,
      }),
      setDoc(doc(db, 'customer_debts', 'fixture_debt_1'), {
        id: 'fixture_debt_1', customerId: 'fixture_cust_b', customerName: 'Fixture Client Beta',
        customerPhone: '0555222222', productOrService: 'Fixture Parts Tab', itemsSummary: '1x Fixture Screen',
        totalAmount: 5000, amountPaid: 2000, remainingBalance: 3000, date: now, status: 'partially_paid',
        type: 'parts_b2b', payments: [], createdAt: now, updatedAt: now,
      }),
      setDoc(doc(db, 'repairs', 'fixture_repair_1'), {
        id: 'fixture_repair_1', ticketNumber: 'REP-FIX-001', customerId: 'fixture_cust_a',
        customerName: 'Fixture Client Alpha', customerPhone: '0555111111',
        deviceBrand: 'FixtureBrand', deviceModel: 'Phone X', issueDescription: 'Cracked glass',
        status: 'repaired', estimatedCost: 3500, partsCost: 1000, finalPrice: 3500, paidAmount: 0,
        partsUsed: [], createdAt: now, updatedAt: now,
      }),
    ]);
  });

  await env.cleanup();
  console.log(`[ui-fixture] Seeded isolated demo project "${DEMO_PROJECT_ID}" on auth=${authHostPort}, firestore=${firestoreHostPort}`);

  if (seedOnly) {
    process.exit(0);
  }

  const viteEnv = {
    ...process.env,
    VITE_USE_FIREBASE_EMULATOR: 'true',
    VITE_FIREBASE_PROJECT_ID: DEMO_PROJECT_ID,
    VITE_FIRESTORE_EMULATOR_HOST: firestoreHostPort,
    VITE_AUTH_EMULATOR_URL: `http://${authHostPort}`,
    VITE_FIREBASE_API_KEY: 'demo-phoneshop-emulator-api-key',
    VITE_FIREBASE_AUTH_DOMAIN: `${DEMO_PROJECT_ID}.firebaseapp.com`,
    VITE_FIREBASE_APP_ID: `1:000000000000:web:${DEMO_PROJECT_ID}`,
    VITE_FIREBASE_STORAGE_BUCKET: `${DEMO_PROJECT_ID}.appspot.com`,
    VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
    VITE_SUPER_ADMIN_EMAIL: 'owner@demo.local',
  };

  console.log(`[ui-fixture] Starting Vite on http://127.0.0.1:${uiPort} (emulator-only, no prod fallback)`);
  const result = spawnSync('npx', ['vite', '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], {
    stdio: 'inherit',
    env: viteEnv,
  });
  process.exit(result.status ?? 0);
}
