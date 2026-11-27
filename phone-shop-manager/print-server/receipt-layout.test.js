/**
 * 80mm French thermal receipt layout tests (software-only — no printer involved).
 */
process.env.PORT = '3398';
process.env.PRINT_SERVER_TOKEN = 'unit-test-token-0123456789abcdef';
process.env.PRINTER_NAME = 'TestQueue_AAA';
process.env.LABEL_PRINTER_NAME = 'TestQueue_BBB';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { internals } = require('./server.js');
const {
  formatReceiptAmount,
  formatReceiptDateTime,
  formatTicketCode,
  threeColumnRowLines,
  receiptSummaryParts,
  buildReceiptPrinter,
} = internals;

test('formatReceiptAmount prints space-separated thousands and two decimals without currency suffix', () => {
  assert.equal(formatReceiptAmount(38000), '38 000.00');
  assert.equal(formatReceiptAmount(30000), '30 000.00');
  assert.equal(formatReceiptAmount(8000), '8 000.00');
  assert.equal(formatReceiptAmount(0), '0.00');
  assert.equal(formatReceiptAmount(-500), '-500.00');
});

test('threeColumnRowLines keeps 42-char width and wraps long product names', () => {
  const shortRow = threeColumnRowLines('credit', '1', '0.00', 42, true);
  assert.equal(shortRow.length, 1);
  assert.equal(shortRow[0].length, 42);
  assert.match(shortRow[0], /^credit\s+1\s+0\.00$/);

  const wrappedRow = threeColumnRowLines('Samsung Galaxy S24 Ultra 256GB Titanium', '2', '145 000.00', 42, true);
  assert.ok(wrappedRow.length >= 2);
  assert.ok(wrappedRow.at(-1).endsWith('145 000.00'));
});

test('receiptSummaryParts aligns colon column cleanly within 42 characters', () => {
  const r1 = receiptSummaryParts('NBRE ARTICLE : 1', 'TOTAL :', '0.00');
  const r2 = receiptSummaryParts('', 'TTC A PAYER:', '0.00');
  const r3 = receiptSummaryParts('', 'Anc. solde:', '38 000.00');
  assert.equal((r1.prefix + r1.amount).length, 42);
  assert.equal((r2.prefix + r2.amount).length, 42);
  assert.equal((r3.prefix + r3.amount).length, 42);
  assert.equal(r1.prefix.length, r2.prefix.length);
  assert.equal(r2.prefix.length, r3.prefix.length);
});

test('formatTicketCode strips INV prefix and respects width limits', () => {
  assert.equal(formatTicketCode('INV-261126-002977'), '261126-002977');
  assert.equal(formatTicketCode('002977'), '002977');
});

test('formatReceiptDateTime prints DD/MM/YYYY-HH:MM:SS', () => {
  const iso = new Date(2026, 10, 24, 12, 46, 22).toISOString();
  assert.equal(formatReceiptDateTime(iso), '24/11/2026-12:46:22');
});

test('buildReceiptPrinter generates full French 80mm buffer with Code128 barcode', () => {
  const { printer, ticketCode } = buildReceiptPrinter({
    storeName: 'ZH MOBILE ZEMMOURI',
    storePhone: '0776 66 42 42',
    currency: 'DZD',
    transaction: {
      id: 'tx_2977',
      invoiceNumber: '002977',
      date: new Date(2026, 10, 24, 12, 46, 22).toISOString(),
      customerName: 'hmed phone',
      customerAddress: 'jama3 zemmouri',
      customerPhone: '0561475540',
      processedByName: 'VENDEUR',
      isCreditPayment: true,
      items: [{ product: { name: 'credit', model: '', price: 0 }, quantity: 1 }],
      subtotal: 0,
      total: 0,
      payments: [{ method: 'cash', amount: 30000 }],
      balanceSnapshot: {
        previousBalance: 38000,
        purchaseTotal: 0,
        paymentAmount: 30000,
        newBalance: 8000,
      },
    },
  });

  assert.equal(ticketCode, '002977');
  const buf = printer.getBuffer();
  const ascii = buf.toString('latin1');

  assert.ok(ascii.includes('ZH MOBILE ZEMMOURI'));
  assert.ok(ascii.includes('0776 66 42 42'));
  assert.ok(ascii.includes('Client :hmed phone'));
  assert.ok(ascii.includes('jama3 zemmouri'));
  assert.ok(ascii.includes('0561475540'));
  assert.ok(ascii.includes('LIBELLE'));
  assert.ok(ascii.includes('QTE'));
  assert.ok(ascii.includes('P.U'));
  assert.ok(ascii.includes('credit'));
  assert.ok(ascii.includes('NBRE ARTICLE : 1'));
  assert.ok(ascii.includes('TTC A PAYER:'));
  assert.ok(ascii.includes('Anc. solde:'));
  assert.ok(ascii.includes('38 000.00'));
  assert.ok(ascii.includes('Total achat:'));
  assert.ok(ascii.includes('Versement :'));
  assert.ok(ascii.includes('30 000.00'));
  assert.ok(ascii.includes('Nouv. solde:'));
  assert.ok(ascii.includes('8 000.00'));
  // GS k 73 (0x1D 0x6B 0x49) Code128 barcode command bytes + ticket footer
  assert.ok(buf.includes(Buffer.from([0x1d, 0x6b, 73])));
  assert.ok(ascii.includes('Ticket : 002977'));
  assert.ok(ascii.includes('24/11/2026-12:46:22'));
  assert.ok(ascii.includes('Caissier : VENDEUR'));
});
