'use strict';

/**
 * Server-side enforcement for the money path.
 *
 * Two kinds of function, and the difference matters:
 *
 *  - `verifyApprovalPin` and `sealEndOfDay` are callables. The client opts into them, so they
 *    can REFUSE (wrong PIN, day already sealed, day in the future). They run only when
 *    deployed AND reached; both have a local fallback, so an undeployed project behaves
 *    exactly as it did before.
 *  - the `guard*` triggers watch writes. A background trigger cannot reject the write it was
 *    notified about - by then the document is already committed. So guards DETECT and record
 *    to `moneyPathViolations`, which admins read. They never repair, never delete, and never
 *    write back into the collection they watch.
 *
 * Each guard fires only on a change that can actually move a closed day's numbers. A guard
 * that flags every edit of an old ticket is noise, and noise gets ignored.
 *
 * The day's arithmetic is NOT re-derived here. It lives in `src/utils/dayFigures.ts`; a
 * second copy of it in this folder would drift from the first, which is the bug the unified
 * formula closed. `sealSelfCheck` only asks whether a seal agrees with its own bookkeeping.
 */

const functions = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const inv = require('./lib/invariants');

const { onInit, setGlobalOptions, logger, https, firestore } = functions;
const { onCall, HttpsError } = https;
const { onDocumentWritten } = firestore;

/** Deploy-time choices: edit these, then `firebase deploy --only functions`. */
const REGION = 'us-central1';
const SHOP_TIME_ZONE = process.env.SHOP_TIME_ZONE || 'Africa/Algiers';

/** How far back a till may seal a day. Older than this is a data question, not a closing. */
const MAX_SEAL_AGE_DAYS = 400;
/** Verifiers cost 210k PBKDF2 rounds each, so bound the fan-out per request. */
const MAX_PIN_HOLDERS_CHECKED = 25;

const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 8;

/** Fields whose change moves a day's money. Anything else can be edited freely. */
const SALE_MONEY_FIELDS = ['total', 'subtotal', 'status', 'payments', 'items', 'date', 'saleType'];
const REPAIR_MONEY_FIELDS = ['paymentStatus', 'paidAmount', 'handoverAmountPaid', 'depositAmount', 'partsUsed', 'completedAt', 'actualCost'];

setGlobalOptions({ region: REGION, maxInstances: 5 });

onInit(() => {
  initializeApp();
});

const col = name => getFirestore().collection(name);
const dataOf = snapshot => (snapshot && snapshot.exists ? snapshot.data() || {} : null);

/** A guard must not fail the request that triggered it, and must not throw into the retry queue. */
async function recordViolation(violation) {
  try {
    await col('moneyPathViolations').add(violation);
    logger.warn(`money-path ${violation.type}`, {
      collection: violation.collection,
      docId: violation.docId,
      severity: violation.severity,
    });
  } catch (err) {
    logger.error('could not record money-path violation', { type: violation.type, error: err });
  }
}

function guard(name, handler) {
  return async event => {
    try {
      await handler(event);
    } catch (err) {
      logger.error(`money-path guard ${name} failed`, { docId: event.params.docId, error: err });
    }
  };
}

async function sealForDate(dateStr) {
  if (!dateStr) return null;
  const snapshot = await col('end_of_day').where('date', '==', dateStr).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

/** The seal over the day this timestamp falls on, in the shop's own time zone. */
async function sealCoveringTimestamp(value) {
  return sealForDate(inv.localDateOf(value, SHOP_TIME_ZONE));
}

/** Did any field that carries money change between these two versions of a document? */
function changedMoneyFields(before, after, fields) {
  if (!before) return [];
  return fields.filter(field => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null));
}

// ─── Callables ────────────────────────────────────────────────────────────────────

/** uid -> { count, firstAt }. Per instance, so it is a brake rather than a guarantee. */
const pinAttempts = new Map();

function enforcePinRateLimit(uid) {
  const now = Date.now();
  const entry = pinAttempts.get(uid);
  if (!entry || now - entry.firstAt > ATTEMPT_WINDOW_MS) {
    if (pinAttempts.size > 1000) {
      for (const [key, value] of pinAttempts) {
        if (now - value.firstAt > ATTEMPT_WINDOW_MS) pinAttempts.delete(key);
      }
    }
    pinAttempts.set(uid, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS_PER_WINDOW) {
    throw new HttpsError('resource-exhausted', 'Too many PIN attempts. Wait a few minutes and try again.');
  }
}

const isAdminUser = data => data.role === 'admin' || data.isSuperAdmin === true;

const isApprovalHolder = data =>
  typeof data.approvalPin === 'string' && data.approvalPin.trim() !== '' && isAdminUser(data) && data.status !== 'revoked';

async function loadPinHolders(adminId) {
  const db = getFirestore();
  if (adminId) {
    const snapshot = await db.collection('users').doc(adminId).get();
    if (!snapshot.exists || !isApprovalHolder(snapshot.data() || {})) return [];
    return [{ id: snapshot.id, ...(snapshot.data() || {}) }];
  }

  // Two indexed equality queries instead of a scan: a shop with more users than the scan
  // limit would otherwise have admins whose PIN is never even read, and a correct PIN
  // would be reported as wrong.
  const found = new Map();
  const lookups = await Promise.all([
    col('users').where('role', '==', 'admin').limit(MAX_PIN_HOLDERS_CHECKED).get(),
    col('users').where('isSuperAdmin', '==', true).limit(MAX_PIN_HOLDERS_CHECKED).get(),
  ]);
  for (const snapshot of lookups) {
    snapshot.docs.forEach(docSnap => {
      const data = docSnap.data() || {};
      if (isApprovalHolder(data)) found.set(docSnap.id, { id: docSnap.id, ...data });
    });
  }
  return Array.from(found.values()).slice(0, MAX_PIN_HOLDERS_CHECKED);
}

/**
 * Verifies an approval PIN against the stored verifiers. The till no longer needs to read
 * every admin's verifier to answer the question, and a legacy SHA-256 verifier is upgraded
 * with privileges a staff device does not have.
 */
exports.verifyApprovalPin = onCall(async request => {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in before approving.');

  const pin = typeof request.data.pin === 'string' ? request.data.pin.trim() : '';
  if (pin.length < 4 || pin.length > 12) {
    throw new HttpsError('invalid-argument', 'An approval PIN is 4 to 12 characters.');
  }
  enforcePinRateLimit(auth.uid);

  const requestedId = typeof request.data.adminId === 'string' ? request.data.adminId : null;
  const holders = await loadPinHolders(requestedId);
  if (holders.length === 0) {
    throw new HttpsError('not-found', 'No administrator has configured an approval PIN.');
  }

  for (const holder of holders) {
    const result = await inv.verifyPinVerifier(pin, holder.approvalPin);
    if (!result.ok) continue;

    let upgraded = false;
    if (result.isLegacy) {
      try {
        await getFirestore()
          .collection('users')
          .doc(holder.id)
          .set({ approvalPin: await inv.buildPinVerifier(pin) }, { merge: true });
        upgraded = true;
        logger.info('upgraded a legacy approval PIN verifier', { adminId: holder.id });
      } catch (err) {
        // The approval is already valid; a failed upgrade only delays the hardening.
        logger.error('legacy approval verifier upgrade failed', { adminId: holder.id, error: err });
      }
    }

    return {
      verified: true,
      adminId: holder.id,
      adminName: typeof holder.name === 'string' ? holder.name : '',
      legacyVerifierUpgraded: upgraded,
    };
  }

  throw new HttpsError('permission-denied', 'Incorrect approval PIN.');
});

/**
 * Seals a day through a per-date lock document, so two tills closing the same day - or one
 * till closing it twice - cannot leave two different seals for reports to choose between.
 */
exports.sealEndOfDay = onCall(async request => {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in before closing a day.');

  const record = request.data && request.data.record;
  if (!record || typeof record !== 'object') {
    throw new HttpsError('invalid-argument', 'sealEndOfDay needs a seal record.');
  }

  const problems = inv.sealSelfCheck(record);
  if (problems.length) {
    throw new HttpsError('failed-precondition', `This seal is internally inconsistent: ${problems.join('; ')}`);
  }

  const today = inv.localDateOf(new Date(), SHOP_TIME_ZONE);
  if (record.date > today) {
    throw new HttpsError('invalid-argument', `Cannot seal ${record.date}: that day has not closed yet.`);
  }
  const ageDays = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${record.date}T00:00:00Z`)) / 86400000);
  if (ageDays > MAX_SEAL_AGE_DAYS) {
    throw new HttpsError('invalid-argument', `${record.date} is ${ageDays} days old; too far back to close.`);
  }

  const db = getFirestore();
  const sealRef = db.collection('end_of_day').doc();
  const lockRef = db.collection('eod_seal_locks').doc(record.date);

  const outcome = await db.runTransaction(async tx => {
    const lock = await tx.get(lockRef);
    const sealedId = lock.exists && lock.data() ? lock.data().sealedId : null;
    if (sealedId) return { status: 'already_sealed', sealId: sealedId };

    tx.set(sealRef, {
      ...record,
      sealVersion: record.sealVersion || 2,
      sealedAt: record.sealedAt || record.closedAt,
      sealedByUid: auth.uid,
      sealSource: 'server',
    });
    tx.set(lockRef, { date: record.date, sealedId: sealRef.id, sealedAt: record.closedAt });
    return { status: 'sealed', sealId: sealRef.id };
  });

  if (outcome.status === 'already_sealed') {
    logger.info('refused a second seal for a closed day', { date: record.date, sealId: outcome.sealId });
  }
  return { ...outcome, date: record.date };
});

// ─── Guards ───────────────────────────────────────────────────────────────────────

/** Negative stock and duplicated SKUs are both silent money errors: one sells what is not there, the other splits a part's cost history. */
exports.guardInventory = onDocumentWritten(
  'inventory/{docId}',
  guard('inventory', async event => {
    const after = dataOf(event.data.after);
    if (!after) return;
    const docId = event.params.docId;

    if (inv.isNegativeStock(after.stock)) {
      await recordViolation(
        inv.violation({
          type: 'negative_stock',
          collection: 'inventory',
          docId,
          severity: 'critical',
          detail: { stock: after.stock, sku: after.sku || null, name: after.name || null },
        })
      );
    }

    const rawSku = typeof after.sku === 'string' ? after.sku : '';
    const key = inv.skuKey(rawSku);
    if (!key) return;
    const before = dataOf(event.data.before);
    if (before && before.sku === after.sku) return;

    // Firestore equality is case-sensitive, so look up both the stored form and the
    // normalized one; that catches "IP15" next to "ip15" without scanning the collection.
    const lookups = rawSku === key ? [key] : [key, rawSku];
    const others = new Set();
    for (const value of lookups) {
      const snapshot = await col('inventory').where('sku', '==', value).limit(5).get();
      snapshot.docs.forEach(docSnap => {
        if (docSnap.id !== docId) others.add(docSnap.id);
      });
    }
    if (others.size > 0) {
      await recordViolation(
        inv.violation({
          type: 'duplicate_sku',
          collection: 'inventory',
          docId,
          detail: { sku: rawSku, otherDocIds: Array.from(others) },
        })
      );
    }
  })
);

/** Two customer records for one phone split a debt history in half. */
exports.guardCustomer = onDocumentWritten(
  'customers/{docId}',
  guard('customer', async event => {
    const after = dataOf(event.data.after);
    if (!after || after.mergedIntoId) return; // merged records are archives, not duplicates
    const before = dataOf(event.data.before);
    if (before && before.phone === after.phone && before.normalizedPhone === after.normalizedPhone) return;

    const phone = typeof after.phone === 'string' ? after.phone : '';
    if (inv.normalizePhone(phone).length < 6) return;

    const normalized = inv.normalizePhone(phone);
    const candidates = new Map();
    const lookups = [
      col('customers').where('normalizedPhone', '==', normalized).limit(10).get(),
      col('customers').where('phone', '==', phone).limit(10).get(),
    ];
    for (const snapshot of await Promise.all(lookups)) {
      snapshot.docs.forEach(docSnap => candidates.set(docSnap.id, docSnap.data() || {}));
    }

    const docId = event.params.docId;
    const others = Array.from(candidates.entries())
      .filter(([id, data]) => id !== docId && !data.mergedIntoId && inv.phonesCollide(data.phone, phone))
      .map(([id]) => id);

    if (others.length) {
      await recordViolation(
        inv.violation({
          type: 'duplicate_phone',
          collection: 'customers',
          docId,
          detail: { phone, normalized, otherCustomerIds: others },
        })
      );
    }
  })
);

/**
 * A debt is where credit limits are set and where a payment can land on a day the shop
 * already closed, so both are read from the same write.
 */
exports.guardCustomerDebt = onDocumentWritten(
  'customer_debts/{docId}',
  guard('customer_debt', async event => {
    const after = dataOf(event.data.after);
    if (!after) return;
    const before = dataOf(event.data.before);
    const docId = event.params.docId;

    if (!before) {
      const seal = await sealCoveringTimestamp(after.date);
      if (seal) {
        await recordViolation(
          inv.violation({
            type: 'debt_backdated_past_close',
            collection: 'customer_debts',
            docId,
            detail: { date: seal.date, sealId: seal.id, customerId: after.customerId || null },
          })
        );
      }
    }

    const previousRemaining = before ? Number(before.remainingBalance) || 0 : 0;
    const newRemaining = Number(after.remainingBalance) || 0;
    if (after.customerId && newRemaining > previousRemaining) {
      const customerSnap = await col('customers').doc(after.customerId).get();
      if (customerSnap.exists) {
        const customer = customerSnap.data() || {};
        // What the customer owed before this document grew, plus what it owes now.
        const owedBefore = Math.max(0, (Number(customer.debt) || 0) - previousRemaining);
        if (inv.creditLimitBreached(owedBefore, newRemaining, customer.creditLimit)) {
          await recordViolation(
            inv.violation({
              type: 'credit_limit_breached',
              collection: 'customer_debts',
              docId,
              detail: {
                customerId: after.customerId,
                customerName: after.customerName || null,
                creditLimit: Number(customer.creditLimit),
                previousOutstanding: owedBefore,
                newOutstanding: newRemaining,
              },
            })
          );
        }
      }
    }

    const moneyChanged = changedMoneyFields(before, after, ['payments', 'remainingBalance', 'amountPaid']);
    if (moneyChanged.length) {
      const seal = await sealCoveringTimestamp(after.date);
      const sealed = await sealsForDays(
        (after.payments || []).map(payment => inv.localDateOf(payment && payment.date, SHOP_TIME_ZONE))
      );
      const onSealedDay = inv.paymentsOnSealedDays(after.payments || [], sealed, SHOP_TIME_ZONE);
      for (const entry of onSealedDay) {
        await recordViolation(
          inv.violation({
            type: 'payment_on_sealed_day',
            collection: 'customer_debts',
            docId,
            detail: { ...entry, customerId: after.customerId || null },
          })
        );
      }
      // The debt itself belongs to a day that is closed, and its balance moved: that day's
      // collected cash is no longer what the seal says it was.
      if (seal && newRemaining !== previousRemaining) {
        await recordViolation(
          inv.violation({
            type: 'debt_changed_on_closed_day',
            collection: 'customer_debts',
            docId,
            detail: { date: seal.date, sealId: seal.id, previousRemaining, newRemaining },
          })
        );
      }
    }
  })
);

/** A sale recorded or edited onto a day the shop already closed - a refund, a fix, or a late sync. */
exports.guardSale = onDocumentWritten(
  'transactions/{docId}',
  guard('sale', async event => {
    const after = dataOf(event.data.after);
    if (!after) return;
    const before = dataOf(event.data.before);
    const docId = event.params.docId;

    const touched = before ? changedMoneyFields(before, after, SALE_MONEY_FIELDS) : ['(created)'];
    if (!touched.length) return;

    const seal = await sealCoveringTimestamp(after.date);
    if (!seal) return;
    await recordViolation(
      inv.violation({
        type: before ? 'sale_changed_on_closed_day' : 'sale_recorded_on_closed_day',
        collection: 'transactions',
        docId,
        detail: {
          date: seal.date,
          sealId: seal.id,
          changed: touched,
          total: after.total ?? null,
          status: after.status ?? null,
          invoiceNumber: after.invoiceNumber ?? null,
        },
      })
    );
  })
);

/** Only the fields that decide a repair's revenue or cash can move a closed day. */
exports.guardRepair = onDocumentWritten(
  'repairs/{docId}',
  guard('repair', async event => {
    const after = dataOf(event.data.after);
    if (!after) return;
    const before = dataOf(event.data.before);
    const docId = event.params.docId;

    const touched = before ? changedMoneyFields(before, after, REPAIR_MONEY_FIELDS) : ['(created)'];
    if (!touched.length) return;

    const seal = await sealCoveringTimestamp(after.completedAt || after.updatedAt);
    if (seal) {
      await recordViolation(
        inv.violation({
          type: before ? 'repair_changed_on_closed_day' : 'repair_recorded_on_closed_day',
          collection: 'repairs',
          docId,
          detail: { date: seal.date, sealId: seal.id, changed: touched, ticketNumber: after.ticketNumber ?? null },
        })
      );
      return;
    }

    // A deposit is recognised on the day the phone came in, so that day matters too.
    const intakeSeal = await sealCoveringTimestamp(after.createdAt);
    if (intakeSeal && touched.includes('depositAmount')) {
      await recordViolation(
        inv.violation({
          type: 'repair_deposit_changed_on_closed_day',
          collection: 'repairs',
          docId,
          detail: { date: intakeSeal.date, sealId: intakeSeal.id, depositAmount: after.depositAmount ?? null },
        })
      );
    }
  })
);

/** An approval is only an approval if an administrator resolved it, and not their own request. */
exports.guardApprovalRequest = onDocumentWritten(
  'approvalRequests/{docId}',
  guard('approvalRequest', async event => {
    const after = dataOf(event.data.after);
    if (!after) return;
    const before = dataOf(event.data.before);
    if (after.status !== 'approved' && after.status !== 'rejected') return;
    if (before && before.status === after.status) return;

    const docId = event.params.docId;
    const resolverId = after.resolvedBy && after.resolvedBy.uid ? String(after.resolvedBy.uid) : '';
    if (!resolverId) {
      await recordViolation(
        inv.violation({
          type: 'approval_without_resolver',
          collection: 'approvalRequests',
          docId,
          detail: { status: after.status },
        })
      );
      return;
    }

    const resolverSnap = await col('users').doc(resolverId).get();
    const resolver = resolverSnap.exists ? resolverSnap.data() || {} : {};
    if (!isAdminUser(resolver)) {
      await recordViolation(
        inv.violation({
          type: 'approval_by_non_admin',
          collection: 'approvalRequests',
          docId,
          severity: 'critical',
          detail: {
            resolverId,
            resolverName: (after.resolvedBy && after.resolvedBy.name) || resolver.name || null,
            resolverRole: resolver.role || null,
            status: after.status,
          },
        })
      );
    }

    const requesterId = after.requestedBy && after.requestedBy.uid ? String(after.requestedBy.uid) : '';
    if (requesterId && requesterId === resolverId) {
      await recordViolation(
        inv.violation({
          type: 'self_approval',
          collection: 'approvalRequests',
          docId,
          detail: { uid: resolverId, status: after.status, actionLabel: after.actionLabel || null },
        })
      );
    }
  })
);

/** The seals over a set of already-computed days, deduped, one read each. */
async function sealsForDays(dateStrings) {
  const unique = Array.from(new Set(dateStrings.filter(Boolean)));
  const seals = [];
  for (const dateStr of unique) {
    const seal = await sealForDate(dateStr);
    if (seal) seals.push(seal);
  }
  return seals;
}
