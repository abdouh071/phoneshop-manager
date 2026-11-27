import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clockInvoiceNumber,
  invoiceCounterDocId,
  invoiceDayKey,
  nextInvoiceNumber,
} from './invoiceNumber.ts';

test('the day key is the shop’s own calendar day', () => {
  // 23:30 on 4 Nov 2026 local is still 4 Nov in the shop, whatever UTC says.
  assert.equal(invoiceDayKey(new Date(2026, 10, 4, 23, 30, 0)), '261104');
  assert.equal(invoiceDayKey(new Date(2026, 0, 9, 8, 0, 0)), '260109');
});

test('the phone writes into the counter’s retail book', () => {
  // The desktop counts `invoices_retail_261104`; a phone that renamed the document
  // would run its own sequence and the two devices would collide again.
  assert.equal(invoiceCounterDocId('261104'), 'invoices_retail_261104');
});

test('the number keeps the shape the paper already reads', () => {
  assert.equal(nextInvoiceNumber('261104', 0), 'INV-261104-0001');
  assert.equal(nextInvoiceNumber('261104', 41), 'INV-261104-0042');
  assert.equal(nextInvoiceNumber('261104', 12339), 'INV-261104-12340');
});

test('a counter nobody had written starts the day again', () => {
  assert.equal(nextInvoiceNumber('261104', undefined), 'INV-261104-0001');
  assert.equal(nextInvoiceNumber('261104', null), 'INV-261104-0001');
});

test('a counter value that is not a number mints nothing', () => {
  // A hand-edited counter doc can hold anything; the sequence must not print `NaN`.
  assert.equal(nextInvoiceNumber('261104', Number.NaN), 'INV-261104-0001');
  assert.equal(nextInvoiceNumber('261104', -5), 'INV-261104-0001');
});

test('the clock still makes a reference when the counter cannot be reached', () => {
  assert.equal(clockInvoiceNumber(1_770_482_913_000), 'INV-913000');
});
