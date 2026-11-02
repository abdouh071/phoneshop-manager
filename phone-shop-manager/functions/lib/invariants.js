'use strict';

/**
 * Money-path invariants, kept free of the Firebase SDK so they can be run anywhere -
 * unit tests, a Cloud Function, or a one-off audit script. `index.js` only decides when
 * to call these; what a rule *means* lives here.
 */

const crypto = require('crypto');

const PIN_ITERATION_CEILING = 2000000;
const LEGACY_PIN_SALT = 'phone-shop-admin-approval-v1-salt';
const LEGACY_HEX_RE = /^[0-9a-f]{64}$/i;

/** `v2:<iterations>:<saltHex>:<keyHex>` - the shape `src/utils/security.ts` writes. */
function parsePinVerifier(verifier) {
  if (typeof verifier !== 'string') return null;
  const trimmed = verifier.trim();
  if (!trimmed) return null;

  if (LEGACY_HEX_RE.test(trimmed)) return { version: 1, keyHex: trimmed.toLowerCase() };

  const parts = trimmed.split(':');
  if (parts.length !== 4 || parts[0] !== 'v2') return null;
  const iterations = Number(parts[1]);
  const saltHex = parts[2].toLowerCase();
  const keyHex = parts[3].toLowerCase();
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PIN_ITERATION_CEILING) return null;
  if (!/^[0-9a-f]{32}$/.test(saltHex)) return null;
  if (!/^[0-9a-f]{64}$/.test(keyHex)) return null;
  return { version: 2, iterations, saltHex, keyHex };
}

function timingSafeEqualHex(aHex, bHex) {
  if (aHex.length !== bHex.length) return false;
  return crypto.timingSafeEqual(Buffer.from(aHex, 'hex'), Buffer.from(bHex, 'hex'));
}

/**
 * Does this PIN match this verifier? Legacy SHA-256 verifiers still pass so no admin is
 * locked out mid-migration; a match on a legacy verifier is the signal to upgrade it.
 */
async function verifyPinVerifier(pin, verifier) {
  const parsed = parsePinVerifier(verifier);
  if (!parsed) return { ok: false, isLegacy: false };
  const normalized = String(pin == null ? '' : pin).trim();
  if (!normalized) return { ok: false, isLegacy: parsed.version === 1 };

  if (parsed.version === 1) {
    const digest = crypto.createHash('sha256').update(normalized + LEGACY_PIN_SALT).digest('hex');
    return { ok: timingSafeEqualHex(digest, parsed.keyHex), isLegacy: true };
  }

  const derived = (await pbkdf2(normalized, parsed.saltHex, parsed.iterations)).toString('hex');
  return { ok: timingSafeEqualHex(derived, parsed.keyHex), isLegacy: false };
}

function pbkdf2(pin, saltHex, iterations) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(pin, Buffer.from(saltHex, 'hex'), iterations, 32, 'sha256', (err, buf) =>
      err ? reject(err) : resolve(buf)
    );
  });
}

/** New verifier in the same format the till writes, so both sides stay interchangeable. */
async function buildPinVerifier(pin) {
  const normalized = String(pin == null ? '' : pin).trim();
  const iterations = 210000;
  const saltHex = crypto.randomBytes(16).toString('hex');
  const keyHex = (await pbkdf2(normalized, saltHex, iterations)).toString('hex');
  return `v2:${iterations}:${saltHex}:${keyHex}`;
}

// ─── Dates ────────────────────────────────────────────────────────────────────────

/** YYYY-MM-DD in the shop's own time zone, the way the till labels a day. */
function localDateOf(value, timeZone = process.env.SHOP_TIME_ZONE || 'Africa/Algiers') {
  if (value == null) return null;
  const ms =
    typeof value === 'number'
      ? value
      : value.toDate
        ? value.toDate().getTime()
        : typeof value === 'string' || value instanceof Date
          ? new Date(value).getTime()
          : NaN;
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const pick = t => (parts.find(p => p.type === t) || {}).value;
  const y = pick('year');
  const m = pick('month');
  const d = pick('day');
  return y && m && d ? `${y}-${m}-${d}` : null;
}

/** The seal that covers this timestamp's day, or null when the day is still open. */
function sealCovering(seals, dateStr) {
  if (!dateStr) return null;
  return seals.find(s => s && s.date === dateStr) || null;
}

// ─── Customers ────────────────────────────────────────────────────────────────────

/** Digits only, country prefix noise dropped, so 0555… / +213 555… / 213555… collide. */
function normalizePhone(phone) {
  const digits = String(phone == null ? '' : phone).replace(/\D/g, '');
  if (!digits) return '';
  const stripped = digits.replace(/^00/, '').replace(/^213/, '');
  return stripped.replace(/^0+/, '').slice(-9);
}

function phonesCollide(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na.length >= 6 && na === nb;
}

/** Whitespace and case cannot hide a duplicated SKU. */
function skuKey(sku) {
  return String(sku == null ? '' : sku).trim().toUpperCase();
}

function isDuplicateSku(sku, existingSkus) {
  const key = skuKey(sku);
  if (!key) return false;
  return existingSkus.some(existing => skuKey(existing) === key);
}

// ─── Money ────────────────────────────────────────────────────────────────────────

function isNegativeStock(quantity) {
  const n = Number(quantity);
  return Number.isFinite(n) && n < 0;
}

function creditLimitBreached(previousOutstanding, newDebtAmount, creditLimit) {
  const limit = Number(creditLimit);
  if (!Number.isFinite(limit) || limit <= 0) return false; // no limit configured
  return Number(previousOutstanding || 0) + Number(newDebtAmount || 0) > limit;
}

/** A debt payment counted on a day the shop already sealed. */
function paymentsOnSealedDays(payments, seals, timeZone) {
  const dated = [];
  for (const payment of payments || []) {
    const dateStr = localDateOf(payment && payment.date, timeZone);
    const seal = sealCovering(seals, dateStr);
    if (seal) dated.push({ paymentId: (payment && payment.id) || null, date: dateStr, sealId: seal.id });
  }
  return dated;
}

// ─── Seals ────────────────────────────────────────────────────────────────────────

/** A cent, allowing for the float noise of summing stored decimals. */
const MONEY_TOLERANCE = 0.01;

const finiteNumber = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Does this seal agree with itself?
 *
 * The server deliberately does NOT re-derive a day from raw documents: that arithmetic
 * lives in `src/utils/dayFigures.ts` and a second copy of it would drift from the first,
 * which is the exact bug the unified formula closed. What can be checked without a second
 * formula is the seal's own bookkeeping - profit against revenue minus cost, totals against
 * the three streams, non-negative drawer money. Those catch a truncated, hand-edited or
 * half-written seal, and nothing else.
 */
function sealSelfCheck(record) {
  const problems = [];
  if (!record || typeof record !== 'object') return ['seal payload is not an object'];

  const date = typeof record.date === 'string' ? record.date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push('date must be YYYY-MM-DD');
  if (Number.isNaN(new Date(record.closedAt).getTime())) problems.push('closedAt is not a readable timestamp');

  const moneyFields = [
    'salesTotalRevenue', 'salesCogs', 'salesNetProfit', 'salesCash', 'salesCard', 'salesMobile',
    'salesTransfer', 'salesStoreCredit', 'salesDebt', 'refundsCash',
    'repairsTotalRevenue', 'repairsPartsCost', 'repairsNetProfit', 'repairsCash', 'repairsDebt',
    'repairHandoversCash', 'repairDepositsCash',
    'partsSalesRevenue', 'partsCogs', 'partsCash', 'partsCard', 'partsMobile', 'partsTransfer',
    'debtCollectedCash', 'totalRevenue', 'totalNetProfit', 'totalCash', 'totalCard', 'totalMobile',
  ];
  const missing = moneyFields.filter(f => record[f] !== undefined && finiteNumber(record[f]) === null);
  if (missing.length) problems.push(`non-numeric money fields: ${missing.join(', ')}`);

  const countFields = ['salesCount', 'repairsCompleted', 'partsSalesCount'];
  const badCounts = countFields.filter(f => {
    const n = finiteNumber(record[f]);
    return n !== null && (!Number.isInteger(n) || n < 0);
  });
  if (badCounts.length) problems.push(`impossible counts: ${badCounts.join(', ')}`);

  const drawers = ['salesCash', 'repairsCash', 'partsCash', 'debtCollectedCash', 'refundsCash', 'totalCash'];
  const negatives = drawers.filter(f => {
    const n = finiteNumber(record[f]);
    return n !== null && n < -MONEY_TOLERANCE;
  });
  if (negatives.length) problems.push(`drawer money below zero: ${negatives.join(', ')}`);

  const eq = (label, left, right) => {
    const a = finiteNumber(left);
    const b = finiteNumber(right);
    if (a === null || b === null) return;
    if (Math.abs(a - b) > MONEY_TOLERANCE) problems.push(`${label}: ${a} ≠ ${b}`);
  };

  eq('salesNetProfit', record.salesNetProfit, (record.salesTotalRevenue || 0) - (record.salesCogs || 0));
  eq('repairsNetProfit', record.repairsNetProfit, (record.repairsTotalRevenue || 0) - (record.repairsPartsCost || 0));
  eq(
    'totalRevenue',
    record.totalRevenue,
    (record.salesTotalRevenue || 0) + (record.repairsTotalRevenue || 0) + (record.partsSalesRevenue || 0)
  );
  eq(
    'totalNetProfit',
    record.totalNetProfit,
    (record.totalRevenue || 0) -
      ((record.salesCogs || 0) + (record.repairsPartsCost || 0) + (record.partsCogs || 0))
  );
  if (record.repairHandoversCash !== undefined && record.repairDepositsCash !== undefined) {
    eq('repairsCash', record.repairsCash, (record.repairHandoversCash || 0) + (record.repairDepositsCash || 0));
  }

  return problems;
}

// ─── Violation records ────────────────────────────────────────────────────────────

/**
 * What a guard writes to `moneyPathViolations`. Guards detect and record; they never roll
 * a write back, because a till mid-sale must not fail because a background checker decided
 * to start enforcing rules the client has not been taught yet. Enforcement is the job of a
 * callable the client opts into, once the log shows the rule holds.
 */
function violation({ type, collection, docId, detail, severity = 'warning' }) {
  if (!type || !collection) throw new Error('violation needs a type and a collection');
  return {
    type,
    collection,
    docId: docId || null,
    detail: detail || null,
    severity,
    observedAt: new Date().toISOString(),
  };
}

module.exports = {
  PIN_ITERATION_CEILING,
  parsePinVerifier,
  verifyPinVerifier,
  buildPinVerifier,
  localDateOf,
  sealCovering,
  normalizePhone,
  phonesCollide,
  skuKey,
  isDuplicateSku,
  isNegativeStock,
  creditLimitBreached,
  paymentsOnSealedDays,
  sealSelfCheck,
  violation,
};
