import { describe, it, expect } from 'vitest';
import { buildReceiptHTML } from './printWindow';
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

describe('print HTML builders escape user data', () => {
  it('a hostile customer name cannot inject markup into a sale receipt', () => {
    const html = receipt({ customerName: hostile });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
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
