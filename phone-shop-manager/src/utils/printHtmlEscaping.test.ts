// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildLabelsHTML, buildReceiptHTML } from './printWindow';
import { buildCustomTicketHTML } from '../features/customTicket/customTicketTemplate';
import type { CustomTicketData } from '../features/customTicket/customTicketTypes';

const hostile = '<img src=x onerror=alert(1)>';

const receipt = (overrides: Record<string, unknown> = {}) =>
  buildReceiptHTML(
    {
      id: 'abc123',
      date: '2026-11-10T10:00:00.000Z',
      items: [{ product: { name: 'Screen', model: 'X1', price: 5000 }, quantity: 1 }],
      subtotal: 5000,
      total: 5000,
      payments: [{ method: 'cash', amount: 5000 }],
      ...overrides,
    },
    'Test Shop'
  );

const customTicketData = (overrides: Partial<CustomTicketData> = {}): CustomTicketData => ({
  title: 'Specs',
  subtitle: '',
  deviceModel: '',
  condition: '',
  storage: '',
  ram: '',
  color: '',
  batteryHealth: '',
  price: '',
  warranty: '',
  imei: '',
  specs: [],
  notes: '',
  includeBarcode: false,
  barcodeValue: '',
  barcodeType: 'barcode',
  showStoreHeader: false,
  showStoreFooter: false,
  customFooter: '',
  format: '80mm',
  copies: 1,
  ...overrides,
});

describe('label prices', () => {
  const priceStyle = 'font-size:13px;font-weight:800;height:4mm';

  it('omits an absent price instead of printing an invented zero', () => {
    const html = buildLabelsHTML([{ sku: 'ACC-1', name: 'Cable' }], 'Fixture Shop');
    expect(html).not.toContain(priceStyle);
    expect(html).not.toContain('NaN');
  });

  it.each([0, 500])('preserves an explicitly supplied price of %s', price => {
    const html = buildLabelsHTML([{ sku: 'ACC-1', name: 'Cable', price }], 'Fixture Shop');
    expect(html).toContain(priceStyle);
  });

  it('keeps repair-part prices hidden', () => {
    const html = buildLabelsHTML([{ sku: 'PRT-1', name: 'Screen', price: 500, category: 'repair_part' }]);
    expect(html).not.toContain(priceStyle);
  });
});

describe('print HTML builders escape user data', () => {
  it('a hostile customer name cannot inject markup into a sale receipt', () => {
    const html = receipt({ customerName: hostile });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('renders the French 80mm receipt sections and escapes address/cashier fields', () => {
    const html = receipt({
      invoiceNumber: 'INV-261126-002977',
      customerName: 'hmed phone',
      customerAddress: hostile,
      customerPhone: '0561475540',
      processedByName: 'VENDEUR',
      balanceSnapshot: {
        previousBalance: 38000,
        purchaseTotal: 5000,
        paymentAmount: 5000,
        newBalance: 38000,
      },
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    expect(html).toContain('LIBELLE');
    expect(html).toContain('QTE');
    expect(html).toContain('P.U');
    expect(html).toContain('NBRE ARTICLE :');
    expect(html).toContain('TTC A PAYER:');
    expect(html).toContain('Anc. solde:');
    expect(html).toContain('38 000.00');
    expect(html).toContain('Ticket : 261126-002977');
    expect(html).toContain('Caissier : VENDEUR');
    expect(html).toContain('<svg');
  });

  it('a hostile product name cannot inject markup into a sale receipt', () => {
    const html = receipt({
      items: [{ product: { name: hostile, model: 'X1', price: 5000 }, quantity: 1 }],
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('a hostile custom-ticket title, model and notes cannot inject markup', () => {
    const html = buildCustomTicketHTML(
      customTicketData({ title: hostile, deviceModel: hostile, notes: hostile }),
      'My Shop'
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('a hostile free-text sticker cannot inject markup', () => {
    const html = buildCustomTicketHTML(
      customTicketData({ mode: 'free_text', freeText: hostile, format: 'sticker' }),
      'My Shop'
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('a hostile barcode caption cannot inject markup', () => {
    const html = buildCustomTicketHTML(
      customTicketData({
        includeBarcode: true,
        barcodeType: 'qr',
        barcodeValue: hostile,
        format: '80mm',
      }),
      'My Shop'
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});
