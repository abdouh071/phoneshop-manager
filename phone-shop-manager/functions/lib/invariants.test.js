'use strict';

/**
 * Run with `npm test` inside functions/ (plain `node --test`, no emulator, no credentials).
 *
 * The PIN tests double as the browser/server contract check: the verifier string is built
 * here with WebCrypto - the same API `src/utils/security.ts` uses in the till - and must be
 * accepted by the node `crypto.pbkdf2` implementation the function runs on.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const inv = require('./invariants');

/** What `hashApprovalPin` writes: v2:<iterations>:<saltHex>:<keyHex>, derived with WebCrypto. */
async function buildVerifierTheWayTheTillDoes(pin, iterations = 1000) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const saltHex = Array.from(salt, b => b.toString(16).padStart(2, '0')).join('');
  const key = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  );
  const keyHex = Buffer.from(bits).toString('hex');
  return `v2:${iterations}:${saltHex}:${keyHex}`;
}

const legacyVerifier = pin =>
  crypto.createHash('sha256').update(pin + 'phone-shop-admin-approval-v1-salt').digest('hex');

const seal = (overrides = {}) => ({
  date: '2026-02-10',
  closedAt: '2026-02-10T23:55:00.000Z',
  salesCount: 2,
  salesTotalRevenue: 1500,
  salesCogs: 700,
  salesNetProfit: 800,
  salesCash: 600,
  salesCard: 400,
  salesMobile: 0,
  salesTransfer: 0,
  salesDebt: 500,
  refundsCash: 0,
  repairsCompleted: 1,
  repairsTotalRevenue: 700,
  repairsPartsCost: 200,
  repairsNetProfit: 500,
  repairsCash: 850,
  repairHandoversCash: 600,
  repairDepositsCash: 250,
  repairsDebt: 0,
  partsSalesCount: 1,
  partsSalesRevenue: 800,
  partsCogs: 500,
  partsCash: 300,
  debtCollectedCash: 250,
  totalRevenue: 3000,
  totalNetProfit: 1600,
  totalCash: 2000,
  totalCard: 400,
  totalMobile: 0,
  ...overrides,
});

test('a verifier built by the till is accepted by the function', async () => {
  const verifier = await buildVerifierTheWayTheTillDoes('2468');
  const result = await inv.verifyPinVerifier('2468', verifier);
  assert.equal(result.ok, true);
  assert.equal(result.isLegacy, false);
});

test('a wrong PIN fails, and so does a truncated or hand-edited verifier', async () => {
  const verifier = await buildVerifierTheWayTheTillDoes('2468');
  assert.equal((await inv.verifyPinVerifier('2469', verifier)).ok, false);
  assert.equal((await inv.verifyPinVerifier('2468', verifier.replace('v2:', 'v3:'))).ok, false);
  assert.equal((await inv.verifyPinVerifier('2468', 'v2:0:zz:00')).ok, false);
  assert.equal((await inv.verifyPinVerifier('2468', null)).ok, false);
});

test('an absurd iteration count in a stored verifier is refused, not derived', async () => {
  const saltHex = '00'.repeat(16);
  const forged = `v2:999999999:${saltHex}:${'0'.repeat(64)}`;
  assert.equal(inv.parsePinVerifier(forged), null);
  assert.equal((await inv.verifyPinVerifier('1234', forged)).ok, false);
});

test('a legacy verifier still matches and is reported as legacy', async () => {
  const verifier = legacyVerifier('2468');
  const result = await inv.verifyPinVerifier('2468', verifier);
  assert.equal(result.ok, true);
  assert.equal(result.isLegacy, true);
  assert.equal((await inv.verifyPinVerifier('1111', verifier)).ok, false);
});

test('buildPinVerifier writes the format the till reads back', async () => {
  const verifier = await inv.buildPinVerifier('13579');
  assert.match(verifier, /^v2:210000:[0-9a-f]{32}:[0-9a-f]{64}$/);
  assert.equal(inv.parsePinVerifier(verifier).iterations, 210000);
  assert.equal((await inv.verifyPinVerifier('13579', verifier)).ok, true);
  assert.equal((await inv.verifyPinVerifier('13579 ', verifier)).ok, true); // trimmed either side
});

test('localDateOf reads a day in the shop zone from whatever the document stored', () => {
  assert.equal(inv.localDateOf('2026-02-10', 'Africa/Algiers'), '2026-02-10');
  // 23:30 UTC on the 10th is already the 11th in UTC+1: the shop closed a different day than
  // a UTC read would name, which is why the seal and the reports use the shop zone.
  assert.equal(inv.localDateOf('2026-02-10T23:30:00.000Z', 'Africa/Algiers'), '2026-02-11');
  assert.equal(inv.localDateOf('2026-02-10T23:30:00.000Z', 'UTC'), '2026-02-10');
  assert.equal(inv.localDateOf({ toDate: () => new Date('2026-02-10T22:00:00.000Z') }, 'UTC'), '2026-02-10');
  assert.equal(inv.localDateOf(null), null);
  assert.equal(inv.localDateOf('not a date'), null);
});

test('sealCovering finds the seal for a day and nothing for an open one', () => {
  const seals = [{ id: 's-1', date: '2026-02-10' }];
  assert.deepEqual(inv.sealCovering(seals, '2026-02-10'), seals[0]);
  assert.equal(inv.sealCovering(seals, '2026-02-11'), null);
  assert.equal(inv.sealCovering(seals, null), null);
});

test('phone formats that mean the same subscriber collide', () => {
  for (const variant of ['0555-123-456', '+213 555 123 456', '00213555123456', '213555123456']) {
    assert.equal(inv.normalizePhone(variant), '555123456', variant);
  }
  assert.equal(inv.phonesCollide('0555123456', '+213555123456'), true);
  assert.equal(inv.phonesCollide('0555123456', '0555123457'), false);
  assert.equal(inv.phonesCollide('123', '123'), false); // too short to be anyone
});

test('SKU comparison survives case and padding', () => {
  assert.equal(inv.isDuplicateSku(' ip15 ', ['IP15']), true);
  assert.equal(inv.isDuplicateSku('IP15', ['IP15x']), false);
  assert.equal(inv.isDuplicateSku('', ['IP15']), false);
});

test('stock and credit limits flag exactly the breach, not the edge', () => {
  assert.equal(inv.isNegativeStock(-1), true);
  assert.equal(inv.isNegativeStock('0'), false);
  assert.equal(inv.isNegativeStock(undefined), false);

  assert.equal(inv.creditLimitBreached(80000, 20000, 100000), false); // exactly at the limit
  assert.equal(inv.creditLimitBreached(80000, 20001, 100000), true);
  assert.equal(inv.creditLimitBreached(500000, 1000, 0), false); // no limit configured
});

test('payments landing on a sealed day are named, with the seal that owns them', () => {
  const seals = [{ id: 's-1', date: '2026-02-10' }];
  const payments = [
    { id: 'p-1', date: '2026-02-10', amount: 500 },
    { id: 'p-2', date: '2026-02-12', amount: 200 },
  ];
  const found = inv.paymentsOnSealedDays(payments, seals, 'Africa/Algiers');
  assert.deepEqual(found, [{ paymentId: 'p-1', date: '2026-02-10', sealId: 's-1' }]);
});

test('a seal that adds up passes its own bookkeeping check', () => {
  assert.deepEqual(inv.sealSelfCheck(seal()), []);
});

test('a seal that does not add up is refused before it can be stored', () => {
  const problems = inv.sealSelfCheck(seal({ totalRevenue: 9999 }));
  assert.ok(problems.some(p => p.startsWith('totalRevenue')));

  assert.ok(inv.sealSelfCheck(seal({ salesNetProfit: 1 })).some(p => p.startsWith('salesNetProfit')));
  assert.ok(inv.sealSelfCheck(seal({ repairsNetProfit: 1 })).some(p => p.startsWith('repairsNetProfit')));
  assert.ok(
    inv.sealSelfCheck(seal({ totalNetProfit: 999 })).some(p => p.startsWith('totalNetProfit'))
  );
  assert.ok(inv.sealSelfCheck(seal({ totalCash: -5 })).some(p => p.includes('drawer money below zero')));
  assert.ok(inv.sealSelfCheck(seal({ salesCount: 1.5 })).some(p => p.includes('impossible counts')));
  assert.ok(inv.sealSelfCheck(seal({ salesCash: 'abc' })).some(p => p.includes('non-numeric')));
  assert.ok(inv.sealSelfCheck({ closedAt: 'nope' }).some(p => p.includes('date must be')));
});

test('float noise below a cent is not called an inconsistency', () => {
  const shaky = seal({ totalRevenue: 3000.0000000004, salesTotalRevenue: 1500.0000000002 });
  assert.deepEqual(inv.sealSelfCheck(shaky), []);
});

test('a violation always says what it observed and where', () => {
  const entry = inv.violation({ type: 'negative_stock', collection: 'inventory', docId: 'p-1', severity: 'critical' });
  assert.equal(entry.type, 'negative_stock');
  assert.equal(entry.docId, 'p-1');
  assert.equal(entry.severity, 'critical');
  assert.ok(!Number.isNaN(Date.parse(entry.observedAt)));
  assert.throws(() => inv.violation({ type: 'x' }), /needs a type and a collection/);
});
