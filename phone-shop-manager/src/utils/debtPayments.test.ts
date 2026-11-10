/**
 * The opening-row rule for customer debts.
 *
 * A debt raised by a sale or a repair opens with a row for money already handed over,
 * and that money is counted on the sale's tender lines or the repair's figures. These
 * tests lock which rows the drawer must skip (new `countedOn` flag + the legacy
 * id/note shapes) and which it must keep: a manual debt's opening row is the only
 * record of that money, and a genuine later collection is new money.
 */
import { describe, it, expect } from 'vitest';
import { saleOpeningPayments, isDebtPaymentCountedElsewhere } from './debtPayments';
import type { CustomerDebtEntry, CustomerDebtPayment, PaymentMethod } from '../types';

const DATE = '2026-02-10T10:00:00.000Z';

const payment = (overrides: Partial<CustomerDebtPayment> = {}): CustomerDebtPayment => ({
  id: 'pay_1700000000_abcd',
  date: DATE,
  amount: 3000,
  method: 'cash',
  ...overrides,
});

const debtOf = (overrides: Partial<CustomerDebtEntry> = {}): Pick<
  CustomerDebtEntry,
  'transactionId' | 'invoiceNumber' | 'linkedTicketId' | 'type'
> => ({ ...overrides });

describe('saleOpeningPayments', () => {
  it('keeps the real tender rows and drops the debt row and non-positive amounts', () => {
    const rows = saleOpeningPayments(
      [
        { method: 'cash', amount: 3000 },
        { method: 'debt', amount: 2000 },
        { method: 'card', amount: 0 },
        { method: 'mobile', amount: -5 },
      ],
      DATE,
      'Yacine'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].method).toBe('cash');
    expect(rows[0].amount).toBe(3000);
  });

  it('stamps every row as counted on the sale, with the sale date and real tender', () => {
    const rows = saleOpeningPayments(
      [{ method: 'card' as PaymentMethod, amount: 3000 }, { method: 'debt' as PaymentMethod, amount: 2000 }],
      DATE,
      'Yacine'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: DATE,
      amount: 3000,
      method: 'card',
      note: 'Initial down payment',
      receivedByName: 'Yacine',
      countedOn: 'sale',
    });
    expect(rows[0].id.startsWith('pay_down_')).toBe(true);
  });

  it('returns no rows for a fully charged invoice and defaults the actor to Staff', () => {
    expect(saleOpeningPayments([{ method: 'debt', amount: 5000 }], DATE)).toEqual([]);
    const rows = saleOpeningPayments([{ method: 'cash', amount: 100 }], DATE);
    expect(rows[0].receivedByName).toBe('Staff');
  });
});

describe('isDebtPaymentCountedElsewhere', () => {
  it('skips any row explicitly flagged as counted on another document', () => {
    expect(isDebtPaymentCountedElsewhere(debtOf(), payment({ countedOn: 'sale' }))).toBe(true);
    expect(isDebtPaymentCountedElsewhere(debtOf(), payment({ countedOn: 'repair' }))).toBe(true);
  });

  it('skips the legacy fabricated down payment when a sale document is linked', () => {
    const row = payment({ id: 'pay_down_1700000000_ab12', note: 'Initial down payment' });
    expect(isDebtPaymentCountedElsewhere(debtOf({ transactionId: 'tx-1' }), row)).toBe(true);
    // B2B debts carry only the invoice number.
    expect(isDebtPaymentCountedElsewhere(debtOf({ invoiceNumber: 'INV-PARTS-0001' }), row)).toBe(true);
  });

  it('keeps the opening row of a manual debt — it is the only record of that money', () => {
    const row = payment({ id: 'pay_down_1700000000_ab12', note: 'Initial down payment' });
    expect(isDebtPaymentCountedElsewhere(debtOf(), row)).toBe(false);
  });

  it('skips the settlement modal deposit and handover rows', () => {
    expect(isDebtPaymentCountedElsewhere(debtOf(), payment({ id: 'pay_dep_1700000000' }))).toBe(true);
    expect(isDebtPaymentCountedElsewhere(debtOf(), payment({ id: 'pay_handover_1700000000' }))).toBe(true);
  });

  it('skips the mobile handover row and the price-edit prior-payment row on repair debts', () => {
    const mobile = payment({ note: 'Handover payment for Repair #TKT-0042' });
    const priceEdit = payment({ note: 'Prior payment before price edit' });
    expect(isDebtPaymentCountedElsewhere(debtOf({ linkedTicketId: 't-1' }), mobile)).toBe(true);
    expect(isDebtPaymentCountedElsewhere(debtOf({ type: 'repair' }), priceEdit)).toBe(true);
    // The same note on a debt with no repair link is not enough to skip it.
    expect(isDebtPaymentCountedElsewhere(debtOf(), mobile)).toBe(false);
  });

  it('keeps genuine later collections, even on linked sale and repair debts', () => {
    const collection = payment({ id: 'pay_1700000000_efgh', note: 'Partial settlement' });
    expect(isDebtPaymentCountedElsewhere(debtOf({ transactionId: 'tx-1' }), collection)).toBe(false);
    expect(isDebtPaymentCountedElsewhere(debtOf({ linkedTicketId: 't-1', type: 'repair' }), collection)).toBe(false);
  });
});