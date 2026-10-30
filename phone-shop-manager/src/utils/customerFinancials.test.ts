/**
 * Unit tests for customerFinancials.ts
 *
 * Protects the customer financial aggregation logic that powers totalSpent,
 * totalDebt, and purchase counts shown on every customer profile card.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import type { Customer, RepairTicket, SaleTransaction, CustomerDebtEntry } from '../types';
import {
  isGenericCustomerName,
  matchesCustomer,
  calculateCustomerFinancials,
  normalizeDeviceDetails,
} from './customerFinancials';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeCustomer = (overrides: Partial<Customer> = {}): Customer => ({
  id: 'cust-1',
  name: 'Ali Benali',
  phone: '0550123456',
  normalizedPhone: '0550123456',
  totalPurchases: 0,
  totalSpent: 0,
  lastVisitDate: new Date().toISOString(),
  joinDate: new Date().toISOString(),
  ...overrides,
});

const makeTx = (overrides: Partial<SaleTransaction> = {}): SaleTransaction => ({
  id: 'tx-1',
  date: new Date().toISOString(),
  items: [],
  subtotal: 5000,
  total: 5000,
  payments: [{ method: 'cash', amount: 5000 }],
  saleType: 'retail',
  status: 'completed',
  ...overrides,
});

const makeTicket = (overrides: Partial<RepairTicket> = {}): RepairTicket => ({
  id: 'tkt-1',
  ticketNumber: 'TKT-0001',
  customerName: 'Ali Benali',
  customerPhone: '0550123456',
  deviceBrand: 'Samsung',
  deviceModel: 'Galaxy A54',
  issueDescription: 'Screen replacement',
  estimatedCost: 4000,
  status: 'completed',
  paymentStatus: 'paid',
  paidAmount: 4000,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const makeDebt = (overrides: Partial<CustomerDebtEntry> = {}): CustomerDebtEntry => ({
  id: 'debt-1',
  customerId: 'cust-1',
  customerName: 'Ali Benali',
  customerPhone: '0550123456',
  productOrService: 'Screen replacement',
  totalAmount: 4000,
  amountPaid: 0,
  remainingBalance: 4000,
  date: new Date().toISOString(),
  status: 'unpaid',
  payments: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

// ─── isGenericCustomerName ────────────────────────────────────────────────────

describe('isGenericCustomerName', () => {
  it('returns true for common generic names', () => {
    expect(isGenericCustomerName('client')).toBe(true);
    expect(isGenericCustomerName('Client POS')).toBe(true);
    expect(isGenericCustomerName('UNKNOWN')).toBe(true);
    expect(isGenericCustomerName('Walk-In')).toBe(true);
    expect(isGenericCustomerName('Anonyme')).toBe(true);
  });

  it('returns true for null/empty', () => {
    expect(isGenericCustomerName(null)).toBe(true);
    expect(isGenericCustomerName('')).toBe(true);
    expect(isGenericCustomerName(undefined)).toBe(true);
  });

  it('returns false for real names', () => {
    expect(isGenericCustomerName('Ali Benali')).toBe(false);
    expect(isGenericCustomerName('Samir Khelil')).toBe(false);
  });
});

// ─── matchesCustomer ─────────────────────────────────────────────────────────

describe('matchesCustomer', () => {
  const cust = makeCustomer();

  it('matches by direct customerId', () => {
    expect(matchesCustomer(cust, { customerId: 'cust-1' })).toBe(true);
  });

  it('does NOT match mismatching customerId', () => {
    expect(matchesCustomer(cust, { customerId: 'cust-99' })).toBe(false);
  });

  it('matches by phone number', () => {
    expect(matchesCustomer(cust, { customerPhone: '0550123456' })).toBe(true);
  });

  it('does NOT match wrong phone', () => {
    expect(matchesCustomer(cust, { customerPhone: '0660999999' })).toBe(false);
  });

  it('matches by name when no phone or ID mismatch', () => {
    const c = makeCustomer({ id: 'cust-2', phone: '' });
    expect(matchesCustomer(c, { customerName: 'Ali Benali' })).toBe(true);
  });

  it('does NOT match by generic name', () => {
    const c = makeCustomer({ name: 'Client POS' });
    expect(matchesCustomer(c, { customerName: 'Client POS' })).toBe(false);
  });

  it('does NOT match by name when phones differ', () => {
    const c = makeCustomer();
    // Same name, different phone → should NOT match
    expect(matchesCustomer(c, { customerName: 'Ali Benali', customerPhone: '0660999999' })).toBe(false);
  });

  it('matches by shopName', () => {
    const c = makeCustomer({ shopName: 'AP Phone' });
    expect(matchesCustomer(c, { shopName: 'AP Phone' })).toBe(true);
    expect(matchesCustomer(c, { customerName: 'AP Phone' })).toBe(true);
  });
});

// ─── calculateCustomerFinancials ──────────────────────────────────────────────

describe('calculateCustomerFinancials', () => {
  it('returns zeroes for empty records', () => {
    const result = calculateCustomerFinancials(makeCustomer(), [], [], []);
    expect(result.totalSpent).toBe(0);
    expect(result.totalDebt).toBe(0);
    expect(result.totalPurchases).toBe(0);
  });

  it('counts parts B2B wholesale transaction in customer financials', () => {
    const cust = makeCustomer({ shopName: 'AP Phone' });
    const b2bTx = makeTx({
      customerId: 'cust-1',
      saleType: 'parts_b2b',
      invoiceNumber: 'INV-00123',
      subtotal: 12000,
      total: 12000,
      payments: [{ method: 'cash', amount: 12000 }],
    });
    const result = calculateCustomerFinancials(cust, [], [b2bTx], []);
    expect(result.totalSpent).toBe(12000);
    expect(result.totalPurchases).toBe(1);
  });

  it('counts completed retail sale into totalSpent and totalPurchases', () => {
    const cust = makeCustomer();
    const tx = makeTx({ customerId: 'cust-1' });
    const result = calculateCustomerFinancials(cust, [], [tx], []);
    expect(result.totalSpent).toBe(5000);
    expect(result.totalPurchases).toBe(1);
  });

  it('excludes refunded transaction from totalSpent', () => {
    const cust = makeCustomer();
    const tx = makeTx({ customerId: 'cust-1', status: 'refunded' });
    const result = calculateCustomerFinancials(cust, [], [tx], []);
    expect(result.totalSpent).toBe(0);
  });

  it('counts completed fully-paid repair ticket into totalSpent', () => {
    const cust = makeCustomer();
    const ticket = makeTicket({ customerId: 'cust-1', paymentStatus: 'paid', paidAmount: 4000, actualCost: 4000 });
    const result = calculateCustomerFinancials(cust, [ticket], [], []);
    expect(result.totalSpent).toBe(4000);
    expect(result.totalPurchases).toBe(1);
  });

  it('counts deposit only for in-progress repair (not yet claimed)', () => {
    const cust = makeCustomer();
    const ticket = makeTicket({
      customerId: 'cust-1',
      status: 'in_progress',
      depositAmount: 1000,
      paymentStatus: undefined,
    });
    const result = calculateCustomerFinancials(cust, [ticket], [], []);
    expect(result.totalSpent).toBe(1000); // only deposit counted
  });

  it('counts only paid portion for partial payment', () => {
    const cust = makeCustomer();
    const ticket = makeTicket({
      customerId: 'cust-1',
      paymentStatus: 'partial',
      actualCost: 5000,
      paidAmount: 2000,
    });
    const result = calculateCustomerFinancials(cust, [ticket], [], []);
    expect(result.totalSpent).toBe(2000);
  });

  it('accumulates remaining debt from open debt entries', () => {
    const cust = makeCustomer();
    const debt = makeDebt({ remainingBalance: 3000, status: 'partially_paid', amountPaid: 1000 });
    const result = calculateCustomerFinancials(cust, [], [], [debt]);
    expect(result.totalDebt).toBe(3000);
  });

  it('does NOT count paid debt in totalDebt', () => {
    const cust = makeCustomer();
    const debt = makeDebt({ remainingBalance: 0, status: 'paid' });
    const result = calculateCustomerFinancials(cust, [], [], [debt]);
    expect(result.totalDebt).toBe(0);
  });

  it('does NOT double-count transaction linked to a debt entry', () => {
    const cust = makeCustomer();
    const tx = makeTx({ id: 'tx-link', customerId: 'cust-1', total: 5000 });
    const debt = makeDebt({
      transactionId: 'tx-link',
      totalAmount: 5000,
      amountPaid: 3000,
      remainingBalance: 2000,
      status: 'partially_paid',
    });
    const result = calculateCustomerFinancials(cust, [], [tx], [debt]);
    // Paid portion from linked debt = 5000 - 2000 = 3000 (not 5000 from tx)
    expect(result.totalSpent).toBe(3000);
    expect(result.totalDebt).toBe(2000);
  });

  it('totalSpent never goes negative', () => {
    const cust = makeCustomer();
    const result = calculateCustomerFinancials(cust, [], [], []);
    expect(result.totalSpent).toBeGreaterThanOrEqual(0);
  });

  it('matches customer by phone when no customerId set', () => {
    const cust = makeCustomer({ id: 'cust-1' });
    // Transaction has no customerId but matching phone
    const tx = makeTx({ customerId: undefined, customerPhone: '0550123456' });
    const result = calculateCustomerFinancials(cust, [], [tx], []);
    expect(result.totalSpent).toBe(5000);
  });

  it('deduplicates identical transactions and tickets by ID so no data is counted twice', () => {
    const cust = makeCustomer({ id: 'cust-1' });
    const tx = makeTx({ id: 'tx-dup-1', customerId: 'cust-1', total: 3000, payments: [{ method: 'cash', amount: 3000 }] });
    const ticket = makeTicket({ id: 'tkt-dup-1', customerId: 'cust-1', actualCost: 2000, paymentStatus: 'paid', paidAmount: 2000 });
    const debt = makeDebt({ id: 'debt-dup-1', customerId: 'cust-1', totalAmount: 1500, remainingBalance: 1500 });

    // Pass duplicate copies in arrays
    const result = calculateCustomerFinancials(cust, [ticket, ticket], [tx, tx], [debt, debt]);

    expect(result.totalSpent).toBe(5000); // 3000 (tx) + 2000 (ticket), NOT 10000
    expect(result.totalDebt).toBe(1500);  // 1500, NOT 3000
    expect(result.totalPurchases).toBe(2); // 1 sale + 1 completed repair
    expect(result.ticketsCount).toBe(1);   // 1 ticket
  });
});

// ─── normalizeDeviceDetails ──────────────────────────────────────────────────

describe('normalizeDeviceDetails', () => {
  it('strips redundant brand prefix from model and generates canonical key', () => {
    const res1 = normalizeDeviceDetails('Apple', 'Apple iPhone 12 Pro');
    expect(res1.cleanBrand).toBe('Apple');
    expect(res1.cleanModel).toBe('iPhone 12 Pro');
    expect(res1.displayName).toBe('Apple iPhone 12 Pro');
    expect(res1.canonicalKey).toBe('apple iphone 12 pro');

    const res2 = normalizeDeviceDetails('Samsung', 'Galaxy S23');
    expect(res2.cleanBrand).toBe('Samsung');
    expect(res2.cleanModel).toBe('Galaxy S23');
    expect(res2.displayName).toBe('Samsung Galaxy S23');
    expect(res2.canonicalKey).toBe('samsung galaxy s23');
  });

  it('handles empty or undefined values gracefully', () => {
    const res = normalizeDeviceDetails('', undefined);
    expect(res.cleanBrand).toBe('');
    expect(res.cleanModel).toBe('');
    expect(res.displayName).toBe('Unknown Device');
    expect(res.canonicalKey).toBe('unknown');
  });
});

