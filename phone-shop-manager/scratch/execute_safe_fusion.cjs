const { initializeApp } = require('firebase/app');
const {
  getFirestore,
  collection,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  writeBatch
} = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyCYQopJt3Ppyd8BV-o0c1pd-AONwEqBFXw",
  authDomain: "phoneshop-mgr-pro-2026.firebaseapp.com",
  projectId: "phoneshop-mgr-pro-2026",
  storageBucket: "phoneshop-mgr-pro-2026.firebasestorage.app",
  messagingSenderId: "382569044952",
  appId: "1:382569044952:web:3081c612d39e1f7fc2f0ad"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const GENERIC_NAMES = new Set([
  'client', 'client pos', 'customer', 'passager', 'inconnu', 'unknown',
  'walk-in', 'pos', 'comptoir', '...', ',,', '---', '???', 'none', 'n/a', 'no name'
]);

function isDummyPhone(phone) {
  if (!phone) return true;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 7) return true;
  const unique = new Set(digits.split(''));
  if (unique.size === 1) return true;
  if (digits.replace(/0/g, '').length < 3) return true;
  return false;
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

function isPhoneMatch(a, b) {
  if (isDummyPhone(a) || isDummyPhone(b)) return false;
  const dA = normalizePhoneDigits(a);
  const dB = normalizePhoneDigits(b);
  if (!dA || !dB || dA.length < 7 || dB.length < 7) return false;
  if (dA === dB) return true;
  if (dA.length >= 8 && dB.length >= 8) {
    const cLen = Math.min(dA.length, dB.length, 9);
    return dA.slice(-cLen) === dB.slice(-cLen);
  }
  return false;
}

function isValidNameForDeduplication(name) {
  if (!name) return false;
  const clean = name.trim().toLowerCase();
  if (GENERIC_NAMES.has(clean)) return false;
  const alphaNum = clean.replace(/[^a-z0-9]/gi, '');
  if (alphaNum.length < 3) return false;
  return true;
}

async function runFusion() {
  console.log('--- Starting Safe Customer & Repair Deduplication & Fusion ---');

  // 1. Fetch Customers
  console.log('Fetching customers from Firestore...');
  const customerSnap = await getDocs(collection(db, 'customers'));
  console.log(`Fetched ${customerSnap.size} total customer documents.`);
  const customers = [];
  customerSnap.forEach(d => customers.push({ id: d.id, ...d.data() }));

  // 2. Fetch Debts
  console.log('Fetching customer debts...');
  const debtSnap = await getDocs(collection(db, 'customer_debts'));
  console.log(`Fetched ${debtSnap.size} debt records.`);
  const debts = [];
  debtSnap.forEach(d => debts.push({ id: d.id, ...d.data() }));

  // 3. Fetch Repairs
  console.log('Fetching repairs...');
  const repairSnap = await getDocs(collection(db, 'repairs'));
  console.log(`Fetched ${repairSnap.size} repair tickets.`);
  const repairs = [];
  repairSnap.forEach(d => repairs.push({ id: d.id, ...d.data() }));

  // 4. Identify Customer Duplicates
  const activeCustomers = customers.filter(c => !c.mergedIntoId);
  console.log(`Active non-merged customers: ${activeCustomers.length}`);

  const duplicateCustomerPairs = [];
  const seenPairs = new Set();

  for (let i = 0; i < activeCustomers.length; i++) {
    for (let j = i + 1; j < activeCustomers.length; j++) {
      const a = activeCustomers[i];
      const b = activeCustomers[j];
      const pairKey = [a.id, b.id].sort().join(':::');
      if (seenPairs.has(pairKey)) continue;

      const aPhone = a.phone || '';
      const bPhone = b.phone || '';
      const phoneMatch = isPhoneMatch(aPhone, bPhone);
      const aHasRealPhone = !isDummyPhone(aPhone);
      const bHasRealPhone = !isDummyPhone(bPhone);

      // Distinct real phones -> different people
      if (aHasRealPhone && bHasRealPhone && !phoneMatch) continue;

      const aName = (a.name || '').trim().toLowerCase();
      const bName = (b.name || '').trim().toLowerCase();
      const aShop = (a.shopName || '').trim().toLowerCase();
      const bShop = (b.shopName || '').trim().toLowerCase();

      const exactNameMatch = aName && bName && aName === bName;
      const exactShopMatch = (aShop && bShop && aShop === bShop) ||
                             (aName && bShop && aName === bShop) ||
                             (bName && aShop && bName === aShop);

      if (phoneMatch && (exactNameMatch || exactShopMatch)) {
        duplicateCustomerPairs.push({ a, b, reason: 'Identical Name & Phone Number' });
        seenPairs.add(pairKey);
      } else if (phoneMatch) {
        duplicateCustomerPairs.push({ a, b, reason: `Matching Phone (${a.phone})` });
        seenPairs.add(pairKey);
      } else if (exactNameMatch || exactShopMatch) {
        const targetName = exactNameMatch ? aName : (aShop || bShop);
        if (isValidNameForDeduplication(targetName)) {
          const isMultiWord = targetName.includes(' ') && targetName.trim().split(/\s+/).filter(Boolean).length >= 2;
          if (isMultiWord) {
            duplicateCustomerPairs.push({ a, b, reason: `Matching Name ("${a.name || a.shopName}")` });
            seenPairs.add(pairKey);
          }
        }
      }
    }
  }

  console.log(`\nIdentified ${duplicateCustomerPairs.length} duplicate customer pairs to fuse:`);
  duplicateCustomerPairs.forEach((pair, idx) => {
    console.log(`  [${idx + 1}] "${pair.a.name}" (ID: ${pair.a.id}, Phone: ${pair.a.phone || 'none'}) <-> "${pair.b.name}" (ID: ${pair.b.id}, Phone: ${pair.b.phone || 'none'}) [${pair.reason}]`);
  });

  // 5. Execute Safe Customer Fusion
  let fusedCustomersCount = 0;
  for (const pair of duplicateCustomerPairs) {
    // Check if either was already merged in this run
    const currentA = customers.find(c => c.id === pair.a.id);
    const currentB = customers.find(c => c.id === pair.b.id);
    if (!currentA || !currentB || currentA.mergedIntoId || currentB.mergedIntoId) {
      console.log(`Skipping already merged pair: ${pair.a.id} / ${pair.b.id}`);
      continue;
    }

    // Determine primary & secondary
    // Prefer the one with a non-dummy phone, or B2B shop, or more purchases/spent
    let primary = currentA;
    let secondary = currentB;

    const aHasRealPhone = !isDummyPhone(currentA.phone);
    const bHasRealPhone = !isDummyPhone(currentB.phone);
    const aIsShop = (currentA.customerType || currentA.type) === 'shop_repairer';
    const bIsShop = (currentB.customerType || currentB.type) === 'shop_repairer';

    if (!aHasRealPhone && bHasRealPhone) {
      primary = currentB;
      secondary = currentA;
    } else if (!aIsShop && bIsShop) {
      primary = currentB;
      secondary = currentA;
    } else if ((currentB.totalPurchases || 0) > (currentA.totalPurchases || 0)) {
      primary = currentB;
      secondary = currentA;
    }

    console.log(`\nFusing: Keeping Primary ID=${primary.id} ("${primary.name}"), Archiving Secondary ID=${secondary.id} ("${secondary.name}")`);

    // Calculate consolidated fields
    const mergedName = (primary.name || secondary.name || '').trim();
    const mergedPhone = (!isDummyPhone(primary.phone) ? primary.phone : secondary.phone) || primary.phone || '';
    const mergedShopName = primary.shopName || secondary.shopName || '';
    const mergedEmail = primary.email || secondary.email || '';
    const mergedAddress = primary.address || secondary.address || '';
    const mergedType = (primary.customerType === 'shop_repairer' || secondary.customerType === 'shop_repairer') ? 'shop_repairer' : 'retail';

    // Combine notes non-destructively
    let mergedNotes = primary.notes || '';
    if (secondary.notes && secondary.notes.trim() && !mergedNotes.includes(secondary.notes.trim())) {
      mergedNotes = mergedNotes ? `${mergedNotes}\n[Merged Note]: ${secondary.notes.trim()}` : secondary.notes.trim();
    }

    // Combined financial stats
    const combinedPurchases = (primary.totalPurchases || 0) + (secondary.totalPurchases || 0);
    const combinedSpent = (primary.totalSpent || 0) + (secondary.totalSpent || 0);

    // Reassign secondary's debts to primary
    const secondaryDebts = debts.filter(d => d.customerId === secondary.id);
    for (const d of secondaryDebts) {
      console.log(`  Transferring debt ID=${d.id} (${d.remainingBalance} DZD) from ${secondary.id} -> ${primary.id}`);
      await updateDoc(doc(db, 'customer_debts', d.id), {
        customerId: primary.id,
        customerName: mergedName,
        customerPhone: mergedPhone,
      });
      d.customerId = primary.id;
    }

    // Reassign secondary's repair tickets to primary
    const secondaryRepairs = repairs.filter(r => r.customerId === secondary.id);
    for (const r of secondaryRepairs) {
      console.log(`  Transferring repair ticket #${r.ticketNumber} from ${secondary.id} -> ${primary.id}`);
      await updateDoc(doc(db, 'repairs', r.id), {
        customerId: primary.id,
        customerName: mergedName,
        customerPhone: mergedPhone,
      });
      r.customerId = primary.id;
    }

    // Update primary customer
    const primaryUpdates = {
      name: mergedName,
      phone: mergedPhone,
      notes: mergedNotes,
      totalPurchases: combinedPurchases,
      totalSpent: combinedSpent,
      updatedAt: new Date().toISOString(),
    };
    if (mergedShopName) primaryUpdates.shopName = mergedShopName;
    if (mergedEmail) primaryUpdates.email = mergedEmail;
    if (mergedAddress) primaryUpdates.address = mergedAddress;
    if (mergedType === 'shop_repairer') primaryUpdates.customerType = 'shop_repairer';

    await updateDoc(doc(db, 'customers', primary.id), primaryUpdates);

    // Archive secondary customer (non-destructive safe fusion)
    await updateDoc(doc(db, 'customers', secondary.id), {
      mergedIntoId: primary.id,
      mergedAt: new Date().toISOString(),
      notes: `[ARCHIVED & MERGED INTO CUSTOMER ID: ${primary.id} on ${new Date().toISOString()}]\n${secondary.notes || ''}`.trim()
    });

    secondary.mergedIntoId = primary.id;
    fusedCustomersCount++;
    console.log(`  ✔ Successfully fused "${secondary.name}" into "${primary.name}"!`);
  }

  // 6. Identify & Fuse Duplicate Repair Tickets (maziri redmi A1+, amine m31, etc.)
  console.log('\n--- Checking for Duplicate Repair Tickets ---');
  const activeTickets = repairs.filter(t => !t.mergedIntoTicketId);
  const duplicateTicketPairs = [];
  const seenTicketPairs = new Set();

  for (let i = 0; i < activeTickets.length; i++) {
    for (let j = i + 1; j < activeTickets.length; j++) {
      const a = activeTickets[i];
      const b = activeTickets[j];
      const tPairKey = [a.id, b.id].sort().join(':::');
      if (seenTicketPairs.has(tPairKey)) continue;

      const sameCustomer = (a.customerName || '').trim().toLowerCase() === (b.customerName || '').trim().toLowerCase();
      const sameBrand = (a.deviceBrand || '').trim().toLowerCase() === (b.deviceBrand || '').trim().toLowerCase();
      const sameModel = (a.deviceModel || '').trim().toLowerCase() === (b.deviceModel || '').trim().toLowerCase();

      if (sameCustomer && sameBrand && sameModel && a.customerName && a.deviceBrand) {
        const timeA = new Date(a.createdAt).getTime();
        const timeB = new Date(b.createdAt).getTime();
        const diffSec = Math.abs(timeA - timeB) / 1000;
        if (diffSec <= 180) { // within 3 minutes
          duplicateTicketPairs.push({ a, b, diffSec });
          seenTicketPairs.add(tPairKey);
        }
      }
    }
  }

  console.log(`Identified ${duplicateTicketPairs.length} duplicate repair ticket pairs:`);
  let fusedTicketsCount = 0;
  for (const pair of duplicateTicketPairs) {
    let primaryT = pair.a;
    let secondaryT = pair.b;

    // Prefer active/completed over cancelled
    if (pair.a.status === 'cancelled' && pair.b.status !== 'cancelled') {
      primaryT = pair.b;
      secondaryT = pair.a;
    }

    console.log(`Fusing Ticket #${secondaryT.ticketNumber} (${secondaryT.status}) into Primary #${primaryT.ticketNumber} (${primaryT.status})`);

    // Combine remarks and parts
    const combinedRemark = [primaryT.remark, secondaryT.remark].filter(Boolean).join('\n---\n');
    const partsMap = new Map();
    (primaryT.partsUsed || []).forEach(p => partsMap.set(p.partId || p.partName, p));
    (secondaryT.partsUsed || []).forEach(p => {
      const k = p.partId || p.partName;
      if (!partsMap.has(k)) partsMap.set(k, p);
    });

    await updateDoc(doc(db, 'repairs', primaryT.id), {
      remark: combinedRemark,
      partsUsed: Array.from(partsMap.values()),
      updatedAt: new Date().toISOString(),
    });

    await updateDoc(doc(db, 'repairs', secondaryT.id), {
      mergedIntoTicketId: primaryT.id,
      mergedAt: new Date().toISOString(),
      status: secondaryT.status || 'cancelled',
      notes: `[ARCHIVED & MERGED INTO TICKET #${primaryT.ticketNumber} (${primaryT.id})]\n${secondaryT.notes || ''}`.trim()
    });

    fusedTicketsCount++;
    console.log(`  ✔ Successfully fused Ticket #${secondaryT.ticketNumber} into #${primaryT.ticketNumber}!`);
  }

  console.log(`\n==============================================`);
  console.log(`SAFE FUSION COMPLETED SUCCESSFULLY!`);
  console.log(`Customers Fused: ${fusedCustomersCount}`);
  console.log(`Repair Tickets Fused: ${fusedTicketsCount}`);
  console.log(`Data Deleted: 0 records deleted. All secondary records archived with full traceability.`);
  console.log(`==============================================\n`);
}

runFusion().catch(console.error);
