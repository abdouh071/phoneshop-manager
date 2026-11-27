import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PaymentMethod, RepairTicket } from '../types/index.ts';
import {
  getClaimedRepairHandoverByTender,
  getClaimedRepairHandoverCash,
} from './repairFinancials.ts';

const makeTicket = (over: Partial<RepairTicket> = {}): RepairTicket => ({
  id: 't1',
  ticketNumber: 'TKT-0001',
  customerName: 'Customer',
  deviceBrand: 'Apple',
  deviceModel: 'iPhone 12',
  issueDescription: 'Screen',
  status: 'completed',
  estimatedCost: 0,
  createdAt: '2026-11-02T09:00:00.000Z',
  updatedAt: '2026-11-02T18:00:00.000Z',
  ...over,
});

const row = (amount: number, method: string) =>
  ({ amount, method: method as PaymentMethod, date: '2026-11-02T17:00:00.000Z' });

test('a card handover never enters the physical drawer', () => {
  const t = makeTicket({
    paymentStatus: 'paid',
    actualCost: 5000,
    depositAmount: 1000,
    handoverAmountPaid: 4000,
    handoverPayments: [row(4000, 'card')],
  });
  assert.equal(getClaimedRepairHandoverCash(t), 0);
  assert.equal(getClaimedRepairHandoverByTender(t, 'card'), 4000);
  assert.equal(getClaimedRepairHandoverByTender(t, 'transfer'), 0);
});

test('a re-settled handover splits across the tenders actually taken', () => {
  const t = makeTicket({
    paymentStatus: 'paid',
    actualCost: 5000,
    handoverAmountPaid: 5000,
    handoverPayments: [row(3000, 'cash'), row(2000, 'card')],
  });
  assert.equal(getClaimedRepairHandoverCash(t), 3000);
  assert.equal(getClaimedRepairHandoverByTender(t, 'card'), 2000);
});

test('handover money collected before the stamp existed stays cash', () => {
  const t = makeTicket({
    paymentStatus: 'paid',
    actualCost: 6000,
    depositAmount: 1000,
    handoverAmountPaid: 5000,
    handoverPayments: [row(2000, 'card')],
  });
  assert.equal(getClaimedRepairHandoverCash(t), 3000);
  assert.equal(getClaimedRepairHandoverByTender(t, 'card'), 2000);
});

test('a ticket settled before tenders were stamped keeps the cash reading', () => {
  const t = makeTicket({
    paymentStatus: 'paid',
    actualCost: 5000,
    depositAmount: 1000,
    handoverAmountPaid: 4000,
  });
  assert.equal(getClaimedRepairHandoverCash(t), 4000);
  assert.equal(getClaimedRepairHandoverByTender(t, 'card'), 0);
});

test('an empty rows list is the same legacy case as no rows', () => {
  const t = makeTicket({
    paymentStatus: 'paid',
    actualCost: 5000,
    handoverAmountPaid: 5000,
    handoverPayments: [],
  });
  assert.equal(getClaimedRepairHandoverCash(t), 5000);
  assert.equal(getClaimedRepairHandoverByTender(t, 'card'), 0);
});

test('a transfer handover counts only under transfer', () => {
  const t = makeTicket({
    paymentStatus: 'paid',
    actualCost: 5000,
    handoverAmountPaid: 5000,
    handoverPayments: [row(5000, 'transfer')],
  });
  assert.equal(getClaimedRepairHandoverCash(t), 0);
  assert.equal(getClaimedRepairHandoverByTender(t, 'card'), 0);
  assert.equal(getClaimedRepairHandoverByTender(t, 'transfer'), 5000);
});

test('a mobile handover counts under mobile, not the till', () => {
  const t = makeTicket({
    paymentStatus: 'paid',
    actualCost: 1500,
    handoverAmountPaid: 1500,
    handoverPayments: [row(1500, 'mobile')],
  });
  assert.equal(getClaimedRepairHandoverCash(t), 0);
  assert.equal(getClaimedRepairHandoverByTender(t, 'mobile'), 1500);
});

test('tender matching ignores case', () => {
  const t = makeTicket({
    paymentStatus: 'paid',
    actualCost: 5000,
    handoverAmountPaid: 5000,
    handoverPayments: [row(2000, 'CARD'), row(3000, 'Cash')],
  });
  assert.equal(getClaimedRepairHandoverByTender(t, 'card'), 2000);
  assert.equal(getClaimedRepairHandoverCash(t), 3000);
});

test('a derived handover (no explicit amount) still splits by tender', () => {
  const t = makeTicket({
    paymentStatus: 'paid',
    actualCost: 5000,
    depositAmount: 1000,
    handoverPayments: [row(4000, 'card')],
  });
  assert.equal(getClaimedRepairHandoverCash(t), 0);
  assert.equal(getClaimedRepairHandoverByTender(t, 'card'), 4000);
});

test('a partial handover counts only what was paid at handover', () => {
  const t = makeTicket({
    paymentStatus: 'partial',
    actualCost: 5000,
    depositAmount: 1000,
    paidAmount: 3000,
    handoverPayments: [row(2000, 'mobile')],
  });
  assert.equal(getClaimedRepairHandoverCash(t), 0);
  assert.equal(getClaimedRepairHandoverByTender(t, 'mobile'), 2000);
});

test('a pure-debt ticket counts no handover money', () => {
  const t = makeTicket({ paymentStatus: 'debt', handoverAmountPaid: 0 });
  assert.equal(getClaimedRepairHandoverCash(t), 0);
  assert.equal(getClaimedRepairHandoverByTender(t, 'card'), 0);
});

test('an unclaimed ticket counts no handover money', () => {
  const t = makeTicket({
    status: 'ready',
    paymentStatus: 'paid',
    actualCost: 5000,
    handoverAmountPaid: 4000,
    handoverPayments: [row(4000, 'card')],
  });
  assert.equal(getClaimedRepairHandoverCash(t), 0);
  assert.equal(getClaimedRepairHandoverByTender(t, 'card'), 0);
});