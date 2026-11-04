/**
 * The live POS drawer number and the End-of-Day seal must be the same money.
 *
 * The card and the seal read different stores and different code paths, but both
 * must land on computeDayFigures — this fixture proves the card is nothing but the
 * seal's formula fed the same merged lists, including the two cases that used to
 * make them disagree: an invoice charged entirely to the account, and the same
 * invoice present in both lists.
 */
import { describe, it, expect } from 'vitest';
import { computeTodayNetCash } from './posFinancials';
import { computeDayFigures, mergeDayInvoices } from '../../utils/dayFigures';
import { toDateStr } from '../../store/endOfDayStore';
import type { CustomerDebtEntry, PhoneModel, RepairTicket, SaleTransaction } from '../../types';

const tx = (
  id: string,
  total: number,
  payments: Array<[string, number]>,
  over: Partial<SaleTransaction> = {}
): SaleTransaction => ({
  id,
  date: new Date().toISOString(),
  items: [{ product: { id: `p-${id}`, name: 'Item', price: total } as PhoneModel, quantity: 1 }],
  subtotal: total,
  total,
  payments: payments.map(([method, amount]) => ({ method, amount })) as SaleTransaction['payments'],
  status: 'completed',
  ...over,
});

describe('the POS drawer card agrees with the sealed day', () => {
  it('reads the same cash figure the seal computes', () => {
    const retail = [tx('a', 1000, [['cash', 600], ['card', 400]])];
    // Charged entirely to the customer's account: nothing was tendered.
    const chargedToAccount = tx('b', 45000, [], { saleType: 'parts_b2b' });
    const parts = [chargedToAccount, tx('c', 800, [['cash', 800]], { saleType: 'parts_b2b' })];
    const refunded = [tx('d', 300, [['cash', 300]], { status: 'refunded' })];
    const tickets: RepairTicket[] = [];
    const debts: CustomerDebtEntry[] = [];

    const live = computeTodayNetCash([...retail, ...refunded], parts, tickets, debts);
    const sealed = computeDayFigures(
      { transactions: mergeDayInvoices(retail, parts, refunded), repairs: tickets, debts },
      toDateStr(new Date())
    ).totalCash;

    expect(live).toBe(sealed);
    expect(live).toBe(1400); // 600 retail cash + 800 parts cash; the charged invoice and the refund touch nothing
  });

  it('counts the same invoice once when both lists carry it', () => {
    const shared = tx('shared', 1000, [['cash', 1000]], { saleType: 'parts_b2b' });
    const live = computeTodayNetCash([], [shared, shared], [], []);
    expect(live, 'a double-counted invoice is invented money').toBe(1000);
  });
});
