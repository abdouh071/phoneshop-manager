const fs = require('fs');
const path = require('path');
const os = require('os');

const p = path.join(os.homedir(), '.config/configstore/firebase-tools.json');
const data = JSON.parse(fs.readFileSync(p, 'utf8'));
let accessToken = data.tokens.access_token;

async function getAccessToken() {
  if (data.tokens.refresh_token) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho859e1.apps.googleusercontent.com',
        grant_type: 'refresh_token',
        refresh_token: data.tokens.refresh_token
      })
    });
    const json = await res.json();
    if (json.access_token) {
      accessToken = json.access_token;
    }
  }
}

function parseFirestoreValue(val) {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return parseFloat(val.doubleValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue' in val) return null;
  if ('mapValue' in val) {
    const obj = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      obj[k] = parseFirestoreValue(v);
    }
    return obj;
  }
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(parseFirestoreValue);
  }
  return val;
}

function docToObj(doc) {
  const id = doc.name.split('/').pop();
  const obj = { id };
  for (const [k, v] of Object.entries(doc.fields || {})) {
    obj[k] = parseFirestoreValue(v);
  }
  return obj;
}

async function fetchAll(collectionName) {
  let all = [];
  let pageToken = '';
  do {
    const url = `https://firestore.googleapis.com/v1/projects/phoneshop-mgr-pro-2026/databases/(default)/documents/${collectionName}?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const json = await res.json();
    if (json.documents) {
      all.push(...json.documents.map(docToObj));
    }
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return all;
}

function normalizePhoneDigits(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('002130') && digits.length >= 13) digits = digits.slice(5);
  else if (digits.startsWith('00213') && digits.length >= 12) digits = digits.slice(5);
  else if (digits.startsWith('2130') && digits.length >= 12) digits = digits.slice(3);
  else if (digits.startsWith('213') && digits.length >= 11) digits = digits.slice(3);

  if (digits.length === 9 && (digits.startsWith('5') || digits.startsWith('6') || digits.startsWith('7'))) {
    digits = '0' + digits;
  }
  return digits;
}

function isPhoneMatch(p1, p2) {
  const d1 = normalizePhoneDigits(p1);
  const d2 = normalizePhoneDigits(p2);
  if (!d1 || !d2 || d1.length < 7 || d2.length < 7) return false;
  if (d1 === d2) return true;
  if (d1.length >= 8 && d2.length >= 8) {
    const minLen = Math.min(d1.length, d2.length, 9);
    return d1.slice(-minLen) === d2.slice(-minLen);
  }
  return false;
}

const GENERIC_NAMES = new Set([
  'client', 'client pos', 'customer', 'passager', 'inconnu', 'unknown', 'walk-in', 'pos', 'comptoir'
]);

async function run() {
  await getAccessToken();
  console.log('Fetching customers...');
  const customers = await fetchAll('customers');
  console.log(`Fetched ${customers.length} total customers.`);

  console.log('Fetching repairs...');
  const repairs = await fetchAll('repairs');
  console.log(`Fetched ${repairs.length} total repairs.`);

  // Analyze duplicate customers
  const activeCustomers = customers.filter(c => !c.mergedIntoId);
  const alreadyMergedCustomers = customers.filter(c => c.mergedIntoId);
  console.log(`Active customers: ${activeCustomers.length}, already merged customers: ${alreadyMergedCustomers.length}`);

  const customerDuplicates = [];
  const seenCustPairs = new Set();

  for (let i = 0; i < activeCustomers.length; i++) {
    for (let j = i + 1; j < activeCustomers.length; j++) {
      const a = activeCustomers[i];
      const b = activeCustomers[j];
      const pairKey = [a.id, b.id].sort().join(':::');
      if (seenCustPairs.has(pairKey)) continue;

      const phoneMatch = isPhoneMatch(a.phone, b.phone);
      const nameA = (a.name || '').toLowerCase().trim();
      const nameB = (b.name || '').toLowerCase().trim();
      const shopA = (a.shopName || '').toLowerCase().trim();
      const shopB = (b.shopName || '').toLowerCase().trim();

      const nameMatch = (nameA && nameB && nameA === nameB && !GENERIC_NAMES.has(nameA)) ||
                        (shopB && nameA && shopB === nameA && !GENERIC_NAMES.has(nameA)) ||
                        (shopA && nameB && shopA === nameB && !GENERIC_NAMES.has(nameB));

      if (phoneMatch && nameMatch) {
        customerDuplicates.push({ a, b, reason: 'Identical Name & Phone Match' });
        seenCustPairs.add(pairKey);
      } else if (phoneMatch) {
        customerDuplicates.push({ a, b, reason: `Phone Match (${a.phone} vs ${b.phone})` });
        seenCustPairs.add(pairKey);
      } else if (nameMatch && nameA.length >= 3 && !GENERIC_NAMES.has(nameA) && a.phone && b.phone && normalizePhoneDigits(a.phone) === normalizePhoneDigits(b.phone)) {
        customerDuplicates.push({ a, b, reason: `Name Match ("${a.name}")` });
        seenCustPairs.add(pairKey);
      }
    }
  }

  console.log(`\n=== DUPLICATE CUSTOMERS FOUND: ${customerDuplicates.length} ===`);
  customerDuplicates.forEach((dup, idx) => {
    console.log(`\n[Customer Dup #${idx + 1}] Reason: ${dup.reason}`);
    console.log(`  Account A: [${dup.a.id}] "${dup.a.name}" | Shop: "${dup.a.shopName || 'N/A'}" | Phone: "${dup.a.phone}" | Type: ${dup.a.accountType} | Spent: ${dup.a.totalSpent}`);
    console.log(`  Account B: [${dup.b.id}] "${dup.b.name}" | Shop: "${dup.b.shopName || 'N/A'}" | Phone: "${dup.b.phone}" | Type: ${dup.b.accountType} | Spent: ${dup.b.totalSpent}`);
  });

  // Analyze duplicate repairs
  const activeRepairs = repairs.filter(r => !r.mergedIntoId);
  const alreadyMergedRepairs = repairs.filter(r => r.mergedIntoId);
  console.log(`\nActive repairs: ${activeRepairs.length}, already merged repairs: ${alreadyMergedRepairs.length}`);

  const repairDuplicates = [];
  const seenRepairPairs = new Set();

  for (let i = 0; i < activeRepairs.length; i++) {
    for (let j = i + 1; j < activeRepairs.length; j++) {
      const r1 = activeRepairs[i];
      const r2 = activeRepairs[j];
      const pairKey = [r1.id, r2.id].sort().join(':::');
      if (seenRepairPairs.has(pairKey)) continue;

      const tkt1 = (r1.ticketNumber || '').trim().toUpperCase();
      const tkt2 = (r2.ticketNumber || '').trim().toUpperCase();

      // 1. Same ticket number
      if (tkt1 && tkt2 && tkt1 === tkt2) {
        repairDuplicates.push({ r1, r2, reason: `Same Ticket Number (${tkt1})` });
        seenRepairPairs.add(pairKey);
        continue;
      }

      // 2. Near-simultaneous duplicate or exact match on customer, phone, device brand, model, issue
      const norm = s => (s || '').trim().toLowerCase();
      const sameCust = norm(r1.customerName) && norm(r1.customerName) === norm(r2.customerName);
      const sameBrand = norm(r1.deviceBrand) && norm(r1.deviceBrand) === norm(r2.deviceBrand);
      const sameModel = norm(r1.deviceModel) && norm(r1.deviceModel) === norm(r2.deviceModel);
      const sameIssue = norm(r1.issueDescription) && norm(r1.issueDescription) === norm(r2.issueDescription);
      const phoneMatch = isPhoneMatch(r1.customerPhone, r2.customerPhone) || (!r1.customerPhone && !r2.customerPhone);

      if (sameCust && sameBrand && sameModel && sameIssue && phoneMatch) {
        const time1 = new Date(r1.createdAt).getTime();
        const time2 = new Date(r2.createdAt).getTime();
        const diffMs = Math.abs(time1 - time2);
        repairDuplicates.push({
          r1,
          r2,
          reason: `Identical Customer (${r1.customerName}), Device (${r1.deviceBrand} ${r1.deviceModel}), and Issue ("${r1.issueDescription}"). Time diff: ${Math.round(diffMs / 1000)}s`
        });
        seenRepairPairs.add(pairKey);
      }
    }
  }

  console.log(`\n=== DUPLICATE REPAIRS FOUND: ${repairDuplicates.length} ===`);
  repairDuplicates.forEach((dup, idx) => {
    console.log(`\n[Repair Dup #${idx + 1}] Reason: ${dup.reason}`);
    console.log(`  Repair 1: [${dup.r1.id}] #${dup.r1.ticketNumber} | "${dup.r1.customerName}" (${dup.r1.customerPhone}) | ${dup.r1.deviceBrand} ${dup.r1.deviceModel} | Status: ${dup.r1.status} | Cost: ${dup.r1.cost} | Price: ${dup.r1.price} | Created: ${dup.r1.createdAt}`);
    console.log(`  Repair 2: [${dup.r2.id}] #${dup.r2.ticketNumber} | "${dup.r2.customerName}" (${dup.r2.customerPhone}) | ${dup.r2.deviceBrand} ${dup.r2.deviceModel} | Status: ${dup.r2.status} | Cost: ${dup.r2.cost} | Price: ${dup.r2.price} | Created: ${dup.r2.createdAt}`);
  });
}

run().catch(console.error);
