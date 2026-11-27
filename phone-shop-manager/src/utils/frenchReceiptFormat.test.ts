import { describe, it, expect } from 'vitest';
import {
  formatReceiptAmount,
  formatReceiptDateTime,
  formatTicketCode,
  computeSaleDiscount,
  buildUnifiedReceiptFromSale,
  buildUnifiedReceiptFromOperation,
} from './frenchReceiptFormat';
import type { Customer, SaleTransaction } from '../types';
import type { OperationReceiptPreviewData } from './statementPrint';

describe('frenchReceiptFormat', () => {
  it('formats numbers with space-separated thousands and two fixed decimals', () => {
    expect(formatReceiptAmount(38000)).toBe('38 000.00');
    expect(formatReceiptAmount(30000)).toBe('30 000.00');
    expect(formatReceiptAmount(8000)).toBe('8 000.00');
    expect(formatReceiptAmount(0)).toBe('0.00');
    expect(formatReceiptAmount(-1250.5)).toBe('-1 250.50');
    expect(formatReceiptAmount(-0.001)).toBe('0.00');
  });

  it('formats timestamps as DD/MM/YYYY-HH:MM:SS', () => {
    const sample = new Date(2026, 10, 24, 12, 46, 22).toISOString();
    expect(formatReceiptDateTime(sample)).toBe('24/11/2026-12:46:22');
  });

  it('normalizes ticket codes for thermal barcodes and footer alignment', () => {
    expect(formatTicketCode('INV-261126-0001')).toBe('261126-0001');
    expect(formatTicketCode('002977')).toBe('002977');
    expect(formatTicketCode('INV-PARTS-261126-0003')).toBe('261126-0003');
  });

  it('builds a POS sale receipt showing unit prices under P.U and balance snapshot', () => {
    const tx: SaleTransaction = {
      id: 'sale_1',
      invoiceNumber: 'INV-261126-0029',
      date: new Date(2026, 10, 24, 12, 46, 22).toISOString(),
      customerName: 'hmed phone',
      customerPhone: '0561475540',
      customerAddress: 'jama3 zemmouri',
      processedByName: 'VENDEUR',
      items: [
        {
          product: { id: 'p1', name: 'Ecran', model: 'iPhone 13', price: 8500 } as never,
          quantity: 2,
          unitPrice: 8500,
          totalPrice: 17000,
        },
      ],
      subtotal: 17000,
      discount: { type: 'flat', value: 1000 },
      total: 16000,
      payments: [
        { method: 'cash', amount: 10000 },
        { method: 'debt', amount: 6000 },
      ],
      balanceSnapshot: {
        previousBalance: 2000,
        purchaseTotal: 16000,
        paymentAmount: 10000,
        newBalance: 8000,
      },
    };

    const receipt = buildUnifiedReceiptFromSale(tx, {
      storeName: 'ZH Mobile Zemmouri',
      storePhone: '0776 66 42 42',
    });

    expect(receipt.storeName).toBe('ZH MOBILE ZEMMOURI');
    expect(receipt.storePhone).toBe('0776 66 42 42');
    expect(receipt.clientName).toBe('hmed phone');
    expect(receipt.clientAddress).toBe('jama3 zemmouri');
    expect(receipt.clientPhone).toBe('0561475540');
    expect(receipt.items).toEqual([{ label: 'Ecran iPhone 13', qty: 2, unitPrice: 8500, isReturn: false }]);
    expect(receipt.articleCount).toBe(1);
    expect(receipt.totalBeforeDiscount).toBe(17000);
    expect(receipt.discountAmount).toBe(1000);
    expect(receipt.netPayable).toBe(16000);
    expect(receipt.previousBalance).toBe(2000);
    expect(receipt.purchaseTotal).toBe(16000);
    expect(receipt.paymentAmount).toBe(10000);
    expect(receipt.newBalance).toBe(8000);
    expect(receipt.ticketCode).toBe('261126-0029');
    expect(receipt.formattedDate).toBe('24/11/2026-12:46:22');
    expect(receipt.cashierName).toBe('VENDEUR');
  });

  it('builds a credit payment (Versement) receipt matching credit | 1 | 0.00', () => {
    const customer = {
      id: 'cust1',
      name: 'hmed phone',
      phone: '0561475540',
      address: 'jama3 zemmouri',
    } as Customer;

    const op: OperationReceiptPreviewData = {
      storeName: 'ZH MOBILE ZEMMOURI',
      storePhone: '0776 66 42 42',
      currency: 'DZD',
      headerMessage: 'PAYMENT RECEIPT',
      footerMessage: '',
      referenceNumber: '002977',
      dateStr: '24 Nov 2026',
      customerDisplayName: customer.name,
      customerPhone: customer.phone,
      clientAddress: customer.address,
      items: [{ name: 'Payment', quantity: 1, price: 30000, total: 30000 }],
      subtotal: 30000,
      total: 30000,
      paidAmount: 30000,
      paymentMethod: 'CASH',
      currentTotalDebt: 8000,
      unifiedReceipt: null as never,
      payload: {},
    };

    const receipt = buildUnifiedReceiptFromOperation(op, {
      clientAddress: customer.address,
      rawDateIso: new Date(2026, 10, 24, 12, 46, 22).toISOString(),
      cashierName: 'VENDEUR',
      isCreditPayment: true,
      previousBalance: 38000,
      purchaseTotal: 0,
      paymentAmount: 30000,
      newBalance: 8000,
    });

    expect(receipt.items).toEqual([{ label: 'credit', qty: 1, unitPrice: 0 }]);
    expect(receipt.articleCount).toBe(1);
    expect(receipt.totalBeforeDiscount).toBe(0);
    expect(receipt.discountAmount).toBe(0);
    expect(receipt.netPayable).toBe(0);
    expect(receipt.previousBalance).toBe(38000);
    expect(receipt.purchaseTotal).toBe(0);
    expect(receipt.paymentAmount).toBe(30000);
    expect(receipt.newBalance).toBe(8000);
    expect(receipt.ticketCode).toBe('002977');
  });

  it('computes percentage discounts safely', () => {
    expect(computeSaleDiscount({ subtotal: 10000, discount: { type: 'percent', value: 15 }, total: 8500 })).toBe(1500);
  });
});
