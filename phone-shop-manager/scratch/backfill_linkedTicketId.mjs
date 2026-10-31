/**
 * BACKFILL SCRIPT — linkedTicketId on CustomerDebtEntry
 * -------------------------------------------------------
 * Purpose: For every existing CustomerDebtEntry in Firestore that has
 *   type === 'repair' (or productOrService containing 'Repair #TKT-')
 *   but is missing linkedTicketId, this script:
 *     1. Extracts the ticketNumber from productOrService
 *     2. Looks up the matching RepairTicket by ticketNumber
 *     3. Writes linkedTicketId + linkedTicketNumber to the debt document
 *
 * Usage:
 *   node scratch/backfill_linkedTicketId.mjs
 *
 * Requirements:
 *   - Firebase service account key at ./serviceAccountKey.json
 *     OR env var GOOGLE_APPLICATION_CREDENTIALS pointing to one
 *   - npm i firebase-admin (already in devDependencies if available)
 *
 * Run ONCE, then delete or archive this file.
 * Safe to re-run — only writes to docs that are missing linkedTicketId.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ─── Config ────────────────────────────────────────────────────────────────
const SA_KEY_PATH = resolve('./serviceAccountKey.json');

if (!getApps().length) {
  if (existsSync(SA_KEY_PATH)) {
    initializeApp({ credential: cert(JSON.parse(readFileSync(SA_KEY_PATH, 'utf8'))) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp();
  } else {
    console.error('❌  No service account key found. Provide ./serviceAccountKey.json or set GOOGLE_APPLICATION_CREDENTIALS.');
    process.exit(1);
  }
}

const db = getFirestore();

// Regex to extract ticketNumber like "TKT-0169" from productOrService strings
const TICKET_NUM_RE = /#(TKT-[\w]+)/i;

async function run() {
  console.log('🔍  Fetching all repair-type debt entries...');

  // Fetch all debts with type === 'repair'
  const debtsSnap = await db.collection('customer_debts')
    .where('type', '==', 'repair')
    .get();

  console.log(`   Found ${debtsSnap.size} repair debts total.`);

  // Fetch all repair tickets (to build ticketNumber → id map)
  console.log('🔍  Fetching all repair tickets...');
  const ticketsSnap = await db.collection('repair_tickets').get();

  /** @type {Map<string, string>} ticketNumber → ticket.id */
  const ticketNumberToId = new Map();
  ticketsSnap.forEach(doc => {
    const data = doc.data();
    if (data.ticketNumber) {
      ticketNumberToId.set(data.ticketNumber.toUpperCase(), doc.id);
    }
  });
  console.log(`   Indexed ${ticketNumberToId.size} ticket numbers.`);

  let toWrite = 0;
  let written = 0;
  let skipped = 0;
  let noMatch = 0;

  const batch = db.batch();
  let batchCount = 0;

  for (const doc of debtsSnap.docs) {
    const data = doc.data();

    // Skip if already has linkedTicketId
    if (data.linkedTicketId) {
      skipped++;
      continue;
    }

    // Try to extract ticketNumber from productOrService
    const productOrService = data.productOrService || '';
    const match = TICKET_NUM_RE.exec(productOrService);
    if (!match) {
      noMatch++;
      continue;
    }

    const ticketNumber = match[1].toUpperCase();
    const ticketId = ticketNumberToId.get(ticketNumber);

    if (!ticketId) {
      console.warn(`   ⚠️  Debt ${doc.id}: found ticketNumber "${ticketNumber}" but no matching ticket in DB.`);
      noMatch++;
      continue;
    }

    // Write linkedTicketId + linkedTicketNumber
    batch.update(doc.ref, {
      linkedTicketId: ticketId,
      linkedTicketNumber: ticketNumber,
    });
    toWrite++;
    batchCount++;

    // Firestore batches are limited to 500 ops — commit and start fresh
    if (batchCount >= 490) {
      await batch.commit();
      console.log(`   ✅  Committed batch of ${batchCount} writes.`);
      batchCount = 0;
      written += batchCount;
    }
  }

  // Commit remaining
  if (batchCount > 0) {
    await batch.commit();
    written += batchCount;
    console.log(`   ✅  Committed final batch of ${batchCount} writes.`);
  }

  console.log('\n─────────────────────────────────────────');
  console.log(`✅  Done.`);
  console.log(`   Written:  ${toWrite} debts backfilled with linkedTicketId`);
  console.log(`   Skipped:  ${skipped} debts already had linkedTicketId`);
  console.log(`   No match: ${noMatch} debts (no ticketNumber found or ticket not in DB)`);
  console.log('─────────────────────────────────────────\n');
}

run().catch(err => {
  console.error('❌  Backfill failed:', err);
  process.exit(1);
});

