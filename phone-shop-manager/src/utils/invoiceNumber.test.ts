import { describe, expect, it } from 'vitest';
import {
  clockInvoiceNumber,
  invoiceCounterDocId,
  invoiceDayKey,
  nextInvoiceNumber,
} from './invoiceNumber';

describe('invoiceDayKey', () => {
  it('uses the shop’s own calendar day, not the server’s UTC one', () => {
    // 23:30 on 4 Nov 2026 local is still 4 Nov in the shop, whatever UTC says.
    expect(invoiceDayKey(new Date(2026, 10, 4, 23, 30, 0))).toBe('261104');
  });

  it('pads a single-digit month and day', () => {
    expect(invoiceDayKey(new Date(2026, 0, 9, 8, 0, 0))).toBe('260109');
  });
});

describe('nextInvoiceNumber', () => {
  it('keeps the prefix the paper already reads', () => {
    expect(nextInvoiceNumber('retail', '261104', 0)).toBe('INV-261104-0001');
    expect(nextInvoiceNumber('parts', '261104', 41)).toBe('INV-PARTS-261104-0042');
  });

  it('starts the day again from a counter nobody had written', () => {
    expect(nextInvoiceNumber('retail', '261104', undefined)).toBe('INV-261104-0001');
    expect(nextInvoiceNumber('retail', '261104', null)).toBe('INV-261104-0001');
  });

  it('refuses to mint from a counter value that is not a number', () => {
    // A hand-edited counter doc can hold anything; the sequence must not print `NaN`.
    expect(nextInvoiceNumber('retail', '261104', Number.NaN)).toBe('INV-261104-0001');
    expect(nextInvoiceNumber('retail', '261104', -5)).toBe('INV-261104-0001');
  });

  it('grows past four digits without breaking the shape', () => {
    expect(nextInvoiceNumber('retail', '261104', 12339)).toBe('INV-261104-12340');
  });
});

describe('invoiceCounterDocId', () => {
  it('keeps a parts line and a retail line apart', () => {
    expect(invoiceCounterDocId('retail', '261104')).toBe('invoices_retail_261104');
    expect(invoiceCounterDocId('parts', '261104')).toBe('invoices_parts_261104');
  });
});

describe('clockInvoiceNumber', () => {
  it('still makes a reference when the counter cannot be reached', () => {
    expect(clockInvoiceNumber('retail', 1_770_482_913_000)).toBe('INV-913000');
    expect(clockInvoiceNumber('parts', 1_770_482_913_000)).toBe('INV-PARTS-913000');
  });
});
