const assert = require('assert');

// Logic to be implemented in src/utils/customerFinancials.ts

const GENERIC_NAMES = new Set([
  'client',
  'client pos',
  'customer',
  'passager',
  'inconnu',
  'unknown',
  'walk-in',
  'pos',
  'comptoir',
  'anonyme',
  'anonymous',
]);

function normalizePhoneDigits(phone) {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('002130') && digits.length >= 13) digits = digits.slice(5);
  else if (digits.startsWith('00213') && digits.length >= 12) digits = digits.slice(5);
  else if (digits.startsWith('2130') && digits.length >= 12) digits = digits.slice(3);
  else if (digits.startsWith('213') && digits.length >= 11) digits = digits.slice(3);
  if (digits.length === 9 && (digits.startsWith('5') || digits.startsWith('6') || digits.startsWith('7'))) {
    digits = '0' + digits;
  }
  return digits;
}

function isPhoneMatch(phoneA, phoneB) {
  const digitsA = normalizePhoneDigits(phoneA);
  const digitsB = normalizePhoneDigits(phoneB);
  if (!digitsA || !digitsB) return false;
  if (digitsA.length < 7 || digitsB.length < 7) return false;
  if (digitsA === digitsB) return true;
  if (digitsA.length >= 8 && digitsB.length >= 8) {
    const compareLen = Math.min(digitsA.length, digitsB.length, 9);
    return digitsA.slice(-compareLen) === digitsB.slice(-compareLen);
  }
  return false;
}

function isGenericCustomerName(name) {
  if (!name) return true;
  return GENERIC_NAMES.has(name.trim().toLowerCase());
}

function matchesCustomer(customer, entity) {
  if (entity.customerId && entity.customerId === customer.id) return true;
  if (entity.customerPhone && customer.phone && isPhoneMatch(entity.customerPhone, customer.phone)) return true;
  if (
    !entity.customerId &&
    entity.customerName &&
    customer.name &&
    !isGenericCustomerName(customer.name) &&
    customer.name.trim().length >= 3
  ) {
    const eName = entity.customerName.trim().toLowerCase();
    const cName = customer.name.trim().toLowerCase();
    const cShop = (customer.shopName || '').trim().toLowerCase();
    if (eName === cName || (cShop && eName === cShop)) {
      if (
        entity.customerPhone &&
        customer.phone &&
        normalizePhoneDigits(entity.customerPhone).length >= 7 &&
        normalizePhoneDigits(customer.phone).length >= 7 &&
        !isPhoneMatch(entity.customerPhone, customer.phone)
      ) {
        return false;
      }
      return true;
    }
  }
  return false;
}

function calculateCustomerFinancials(customer, tickets = [], transactions = [], debts = []) {
  const matchedDebts = debts.filter(d => matchesCustomer(customer, d));
  const matchedTickets = tickets.filter(t => matchesCustomer(customer, t));
  const matchedTxs = transactions.filter(tx => matchesCustomer(customer, tx));

  const totalDebt = matchedDebts.reduce((sum, d) => {
    if (d.status !== 'paid' && d.remainingBalance > 0) {
      return sum + d.remainingBalance;
    }
    return sum;
  }, 0);

  const linkedDebtIds = new Set();

  let salesPaid = 0;
  let completedSalesCount = 0;

  for (const tx of matchedTxs) {
    if (tx.status === 'refunded') continue;
    completedSalesCount++;

    const linkedDebt = matchedDebts.find(d => d.transactionId === tx.id || (tx.invoiceNumber && d.invoiceNumber === tx.invoiceNumber));
    if (linkedDebt) {
      linkedDebtIds.add(linkedDebt.id);
      const txTotal = tx.total || 0;
      const unpaid = linkedDebt.remainingBalance || 0;
      salesPaid += Math.max(0, txTotal - unpaid);
      continue;
    }

    if (tx.accountSettlement) {
      salesPaid += (tx.accountSettlement.paidAmount || 0);
      if (tx.accountSettlement.debtEntryId) {
        linkedDebtIds.add(tx.accountSettlement.debtEntryId);
      }
      continue;
    }

    if (tx.payments && tx.payments.length > 0) {
      const nonDebtPaid = tx.payments
        .filter(p => p.method !== 'debt')
        .reduce((s, p) => s + (Number(p.amount) || 0), 0);
      salesPaid += Math.max(0, nonDebtPaid);
      continue;
    }

    salesPaid += (tx.total || 0);
  }

  let repairsPaid = 0;
  let completedRepairsCount = 0;

  for (const tk of matchedTickets) {
    const totalCost = tk.actualCost != null && tk.actualCost > 0 ? tk.actualCost : (tk.estimatedCost || 0);
    const deposit = tk.depositAmount || 0;

    if (tk.status === 'completed') {
      completedRepairsCount++;
    }

    const linkedDebt = matchedDebts.find(d => 
      (d.metadata && d.metadata.ticketId === tk.id) ||
      d.id === tk.debtEntryId ||
      (d.productOrService && tk.ticketNumber && d.productOrService.includes(tk.ticketNumber))
    );

    if (linkedDebt) {
      linkedDebtIds.add(linkedDebt.id);
      if (linkedDebt.status === 'paid' || linkedDebt.remainingBalance <= 0) {
        repairsPaid += totalCost;
      } else {
        repairsPaid += Math.max(0, totalCost - linkedDebt.remainingBalance);
      }
      continue;
    }

    if (tk.paymentStatus === 'debt') {
      repairsPaid += deposit;
    } else if (tk.paymentStatus === 'partial') {
      repairsPaid += (tk.paidAmount ?? deposit);
    } else if (tk.paymentStatus === 'paid') {
      repairsPaid += (tk.paidAmount ?? totalCost);
    } else if (tk.status === 'completed') {
      repairsPaid += (tk.paidAmount ?? totalCost);
    } else {
      repairsPaid += deposit;
    }
  }

  let generalDebtPaid = 0;
  for (const d of matchedDebts) {
    if (!linkedDebtIds.has(d.id) && !d.transactionId) {
      const paidOnDebt = d.amountPaid || (d.payments ? d.payments.reduce((s, p) => s + (p.amount || 0), 0) : 0);
      generalDebtPaid += Math.max(0, paidOnDebt);
    }
  }

  const computedTotalSpent = Math.max(0, Math.round((salesPaid + repairsPaid + generalDebtPaid) * 100) / 100);
  const totalPurchases = completedSalesCount + completedRepairsCount;

  return {
    totalSpent: computedTotalSpent,
    totalPurchases,
    totalDebt,
    ticketsCount: matchedTickets.length,
  };
}

// Test Suite
console.log('--- Running Customer Financials Calculation Tests ---');

const customerA = { id: 'cust_1', name: 'Yacine', phone: '0550 12 34 56', totalSpent: 0 };

// Test 1: Completed repair with paid ticket
const tickets1 = [
  { id: 'tk_1', customerId: 'cust_1', status: 'completed', actualCost: 5000, paidAmount: 5000 },
  { id: 'tk_2', customerId: 'cust_1', status: 'pending', estimatedCost: 3000, depositAmount: 1000 },
];
const res1 = calculateCustomerFinancials(customerA, tickets1, [], []);
assert.strictEqual(res1.totalSpent, 6000, 'Test 1 failed: Should be 5000 + 1000 deposit');
assert.strictEqual(res1.totalPurchases, 1, 'Test 1 failed: 1 completed repair');
assert.strictEqual(res1.totalDebt, 0, 'Test 1 failed: 0 debt');
console.log('✓ Test 1 Passed: Completed repair + active deposit');

// Test 2: Repair with debt
const tickets2 = [
  { id: 'tk_3', customerId: 'cust_1', ticketNumber: 'TKT-100', status: 'completed', actualCost: 10000, depositAmount: 2000, paymentStatus: 'debt' },
];
const debts2 = [
  { id: 'd_1', customerId: 'cust_1', productOrService: 'Repair TKT-100', totalAmount: 8000, remainingBalance: 8000, status: 'unpaid' }
];
const res2 = calculateCustomerFinancials(customerA, tickets2, [], debts2);
assert.strictEqual(res2.totalSpent, 2000, 'Test 2 failed: Customer only paid 2000 deposit so far');
assert.strictEqual(res2.totalDebt, 8000, 'Test 2 failed: 8000 debt');
console.log('✓ Test 2 Passed: Repair with debt excludes unpaid debt from spent');

// Test 3: Customer pays off debt
const debts3 = [
  { id: 'd_1', customerId: 'cust_1', productOrService: 'Repair TKT-100', totalAmount: 8000, remainingBalance: 3000, status: 'partially_paid' }
];
const res3 = calculateCustomerFinancials(customerA, tickets2, [], debts3);
assert.strictEqual(res3.totalSpent, 7000, 'Test 3 failed: 10000 - 3000 remaining = 7000 paid');
assert.strictEqual(res3.totalDebt, 3000, 'Test 3 failed: 3000 remaining debt');
console.log('✓ Test 3 Passed: Partial debt payment reflects in total spent');

// Test 4: POS Sale + Refund
const txs4 = [
  { id: 'tx_1', customerId: 'cust_1', total: 15000, status: 'completed' },
  { id: 'tx_2', customerId: 'cust_1', total: 4000, status: 'refunded' },
];
const res4 = calculateCustomerFinancials(customerA, [], txs4, []);
assert.strictEqual(res4.totalSpent, 15000, 'Test 4 failed: Refunded sale should not be counted');
assert.strictEqual(res4.totalPurchases, 1, 'Test 4 failed: 1 valid sale');
console.log('✓ Test 4 Passed: Refunded transaction excluded');

// Test 5: Customer with "unreal number" on old record (e.g. 500,000 DZD corrupted)
const corruptedCustomer = { id: 'cust_bad', name: 'Corrupted User', phone: '0770 99 88 77', totalSpent: 500000 };
const txs5 = [{ id: 'tx_real', customerId: 'cust_bad', total: 3500, status: 'completed' }];
const res5 = calculateCustomerFinancials(corruptedCustomer, [], txs5, []);
assert.strictEqual(res5.totalSpent, 3500, 'Test 5 failed: Must replace 500000 with real 3500');
console.log('✓ Test 5 Passed: Corrupted unreal number replaced with actual auditable sum');

console.log('All customer financials tests passed successfully!');
