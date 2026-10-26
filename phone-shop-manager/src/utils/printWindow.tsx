import React from 'react';
import { renderToString } from 'react-dom/server';
import JsBarcode from 'jsbarcode';
import html2canvas from 'html2canvas';
import { formatCurrency, formatCurrencyWith } from './formatCurrency';
import { useSettingsStore } from '../store/settingsStore';
import { QRCodeSVG } from 'qrcode.react';
import i18n from '../i18n';
import { printFormattedReport } from './exportUtils';

// ============================================================
// ESC/POS Direct Printing via Local Print Server
// ============================================================

// Detect Electron desktop app (preload.cjs exposes window.electronAPI)
const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;

// Helper to safely call Electron IPC with a 12-second timeout safeguard so buttons never hang indefinitely
function callElectronPrint<T>(fn: () => Promise<T>, timeoutMs = 12000): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Print IPC timeout safeguard exceeded')), timeoutMs)
    ),
  ]);
}

// Priority: Electron embedded server > env var > local hostname > fallback to localhost
const PRINT_SERVER_URL = (() => {
  if (electronAPI?.printServerUrl) return electronAPI.printServerUrl;
  if (import.meta.env.VITE_PRINT_SERVER_URL) return import.meta.env.VITE_PRINT_SERVER_URL;
  if (typeof window !== 'undefined' && window.location.hostname) {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.') || h.startsWith('10.') || h.startsWith('172.')) {
      return `http://${h}:3355`;
    }
  }
  return 'http://localhost:3355';
})();

function getTranslations() {
  const t = i18n.t.bind(i18n);
  return {
    customer: t('ticket.customer', 'Customer:'),
    cashier: t('pos.cashier', 'Cashier:'),
    item: t('ticket.item', 'Item'),
    price: t('ticket.price', 'Price'),
    subtotal: t('common.subtotal', 'Subtotal'),
    discount: t('common.discount', 'Discount'),
    fullyRefunded: t('pos.fullyRefunded', '*** FULLY REFUNDED ***'),
    partiallyRefunded: t('pos.partiallyRefunded', '*** PARTIALLY REFUNDED ***'),
    total: t('common.total', 'TOTAL'),
    payment: t('pos.payment', 'Payment:'),
    thanks: t('ticket.thanks', 'Thank you for your purchase!'),
    client: t('ticket.customer', 'Client:'),
    noPhone: t('common.na', 'No tel'),
    issue: t('ticket.issue', 'Issue:'),
    diagnostic: t('ticket.diagnostic', 'Diagnostic'),
    paid: t('common.paid', 'Payé'),
    dep: t('ticket.deposit', 'Dep:'),
    repairIntake: t('ticket.repairTicket', '*** REPAIR INTAKE TICKET ***'),
    pin: t('ticket.pin', 'PIN:'),
    phone: t('common.phone', 'Phone:'),
    device: t('ticket.device', 'Device:'),
    pattern: t('ticket.pattern', 'Pattern:'),
    pinLabel: t('ticket.pinLabel', 'PIN:'),
    security: t('ticket.security', 'Security:'),
    technician: t('ticket.assignedTo', 'Technician:'),
    intakeBy: t('ticket.intakeBy', 'Intake By:'),
    reportedProblem: t('ticket.issueDescription', 'Reported Problem:'),
    diagnosticRequired: t('ticket.diagnostic', 'Diagnostic required'),
    estimatedCost: t('ticket.estimatedCost', 'Estimated Cost:'),
    depositPaid: t('ticket.depositAmount', 'Deposit Paid:'),
    balanceDue: t('ticket.balanceDue', 'BALANCE DUE:'),
    paidInFull: t('ticket.paidInFull', 'PAID IN FULL'),
    scanTrack: t('ticket.scanTrack', 'Scan to track repair online'),
    presentTicket: t('ticket.presentTicket', 'Please present this ticket when picking up your device.'),
    thanksRepair: t('ticket.thanks', 'Thank you for trusting us with your repair!'),
    zReport: t('reports.zReport', '*** END-OF-DAY Z-REPORT ***'),
    shiftDate: t('reports.shiftDate', 'Shift Date:'),
    printed: t('reports.printed', 'Printed:'),
    salesSummary: t('reports.salesSummary', 'SALES SUMMARY'),
    grossSales: t('reports.grossSales', 'Gross Sales'),
    txs: t('reports.txs', 'txs'),
    discountsGiven: t('reports.discountsGiven', 'Discounts Given:'),
    unitsSold: t('reports.unitsSold', 'Units / Items Sold:'),
    pcs: t('reports.pcs', 'pcs'),
    averageTicket: t('reports.averageTicket', 'Average Ticket:'),
    returnsRefunds: t('reports.returnsRefunds', 'RETURNS & REFUNDS'),
    refundsGiven: t('reports.refundsGiven', 'Refunds Given'),
    cashDrawerRec: t('reports.cashDrawerRec', 'CASH DRAWER RECONCILIATION'),
    cashCollected: t('reports.cashCollected', 'Cash Collected:'),
    cashPaidOut: t('reports.cashPaidOut', 'Cash Paid Out (Refunds):'),
    netCashDrawer: t('reports.netCashDrawer', 'NET CASH IN DRAWER:'),
    staffBreakdown: t('reports.staffBreakdown', 'STAFF BREAKDOWN'),
    endOfReport: t('reports.endOfReport', '*** END OF REPORT ***'),
  };
}

/**
 * Check if the local ESC/POS print server is running and the printer is connected.
 */
export async function checkPrintServer(): Promise<{
  ok: boolean;
  connected: boolean;
  printer?: string;
  hasCutter?: boolean;
  error?: string;
}> {
  // ── IPC path (Electron desktop) ──
  if (electronAPI?.checkStatus) {
    try {
      const data = await electronAPI.checkStatus();
      if (data) return { ...data, ok: true, connected: true };
    } catch (e) {
      console.warn('[checkPrintServer] IPC failed, trying HTTP:', e);
    }
  }
  // ── HTTP path (web browser) ──
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${PRINT_SERVER_URL}/status`, { signal: controller.signal });
    clearTimeout(t);
    return await res.json();
  } catch {
    return { ok: false, connected: false, error: 'Print server not reachable' };
  }
}

/**
 * Send a receipt directly to the thermal printer via the local print server.
 * Falls back to browser print if the server is not available.
 * 
 * Returns { method: 'direct' | 'browser', error?: string }
 */
export async function printReceiptDirect(
  transaction: {
    id: string;
    date: string;
    customerName?: string;
    processedByName?: string;
    items: { product: { name: string; model: string; price: number }; quantity: number }[];
    subtotal: number;
    discount?: { type: 'percent' | 'flat'; value: number };
    total: number;
    payments: { method: string; amount: number }[];
    status?: string;
  },
  storeName: string,
  currency: string = 'USD',
  options?: {
    headerMessage?: string;
    footerMessage?: string;
    logoUrl?: string;
  },
): Promise<{ method: 'direct' | 'browser'; error?: string }> {
  // Resolve logo: passed option > settings store
  const settingsState = useSettingsStore.getState();
  const logo = options?.logoUrl ?? settingsState.logoUrl ?? '';
  const headerMessage = options?.headerMessage ?? settingsState.receiptHeader;
  const footerMessage = options?.footerMessage ?? settingsState.receiptFooter;

  const payload = {
    storeName,
    currency,
    transaction,
    headerMessage,
    footerMessage,
    logo: logo || undefined,
    translations: getTranslations(),
  };

  // ── IPC path (Electron desktop) ──
  if (electronAPI?.printReceipt) {
    try {
      const data = await callElectronPrint(() => electronAPI.printReceipt(payload));
      if (data?.ok) return { method: 'direct' as const };
      console.warn('[Print] IPC receipt error:', data?.error);
      return { method: 'direct' as const, error: data?.error };
    } catch (e: any) {
      console.warn('[Print] IPC receipt failed:', e);
      return { method: 'direct' as const, error: e?.message || 'Print failed' };
    }
  }

  // ── HTTP path (web browser) ──
  try {
    const res = await fetch(`${PRINT_SERVER_URL}/print-receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (data.ok) {
      return { method: 'direct' };
    }
    console.warn('[Print] Server error, falling back to browser:', data.error);
  } catch (err) {
    console.warn('[Print] Server not reachable, falling back to browser:', err);
  }

  // Fallback: browser print
  const html = buildReceiptHTML(transaction, storeName, headerMessage, footerMessage);
  openPrintWindow(html, 'Receipt');
  return { method: 'browser' };
}

/**
 * Send a repair ticket label directly to the thermal printer.
 * Falls back silently to window.print() style if server is unavailable.
 */
export async function printRepairLabelDirect(
  ticket: {
    ticketNumber: string;
    deviceBrand: string;
    deviceModel: string;
    customerName: string;
    customerPhone?: string;
    createdAt: string;
    lockType?: string;
    lockValue?: string;
  },
  storeName: string,
  copies: number = 1
): Promise<{ method: 'direct' | 'browser'; error?: string }> {
  const payload = { storeName, ticket, copies, translations: getTranslations() };

  // ── IPC path (Electron desktop) ──
  if (electronAPI?.printRepairLabel) {
    try {
      const data = await callElectronPrint(() => electronAPI.printRepairLabel(payload));
      if (data?.ok) return { method: 'direct' as const };
      console.warn('[Print] IPC label error:', data?.error);
      return { method: 'direct' as const, error: data?.error };
    } catch (e: any) {
      console.warn('[Print] IPC label failed:', e);
      return { method: 'direct' as const, error: e?.message || 'Print failed' };
    }
  }

  // ── HTTP path (web browser) ──
  try {
    const res = await fetch(`${PRINT_SERVER_URL}/print-repair-label`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (data.ok) {
      return { method: 'direct' };
    }
    console.warn('[Print] Label server error, falling back to browser:', data.error);
  } catch (err) {
    console.warn('[Print] Label server not reachable, falling back to browser:', err);
  }

  // Fallback: browser print (existing behavior)
  return { method: 'browser' };
}

/**
 * Send a repair intake receipt directly to the thermal POS printer (80mm).
 */
export async function printRepairIntakeTicketDirect(
  ticket: any,
  storeName: string,
  currency: string = 'DZD'
): Promise<{ method: 'direct' | 'browser'; error?: string }> {
  const settingsState = useSettingsStore.getState();
  const logo = settingsState.logoUrl || '';

  const pinSnippet = ticket.trackingPin || ticket.customerPhone?.slice(-4) || '';
  const trackingUrl = `${settingsState.trackingBaseUrl || `${window.location.origin}/track`}/${(ticket.ticketNumber || '').trim()}?pin=${pinSnippet}`;
  const payload = { storeName, currency, ticket: { ...ticket, trackingUrl }, logo: logo || undefined, translations: getTranslations() };

  // ── IPC path (Electron desktop) ──
  if (electronAPI?.printRepairTicket) {
    try {
      const data = await callElectronPrint(() => electronAPI.printRepairTicket(payload));
      if (data?.ok) return { method: 'direct' as const };
      console.warn('[Print] IPC repair ticket error:', data?.error);
      return { method: 'direct' as const, error: data?.error };
    } catch (e: any) {
      console.warn('[Print] IPC repair ticket failed:', e);
      return { method: 'direct' as const, error: e?.message || 'Print failed' };
    }
  }

  // ── HTTP path (web browser) ──
  try {
    const res = await fetch(`${PRINT_SERVER_URL}/print-repair-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (data.ok) {
      return { method: 'direct' };
    }
    console.warn('[Print] Repair ticket server error, falling back to browser:', data.error);
  } catch (err) {
    console.warn('[Print] Repair ticket server not reachable, falling back to browser:', err);
  }

  return { method: 'browser' };
}

/**
 * Automatically print both:
 * 1. The normal drop-off ticket on the 80mm receipt printer (for customer)
 * 2. The phone back label on the label printer (to stick on the device)
 */
export async function printRepairBothDirect(
  ticket: any,
  storeName: string,
  currency: string = 'DZD'
): Promise<{ ticketResult: 'direct' | 'browser'; labelResult: 'direct' | 'browser' }> {
  const [ticketRes, labelRes] = await Promise.all([
    printRepairIntakeTicketDirect(ticket, storeName, currency),
    printRepairLabelDirect(ticket, storeName, 1),
  ]);

  return {
    ticketResult: ticketRes.method,
    labelResult: labelRes.method,
  };
}

/**
 * Send a barcode label directly to the thermal printer.
 * Falls back silently to window.print() style if server is unavailable.
 */
export async function printBarcodeDirect(
  products: any[],
  storeName: string,
  currency: string
): Promise<{ method: 'direct' | 'browser'; error?: string }> {
  const payload = { storeName, currency, products };

  // ── IPC path (Electron desktop) ──
  if (electronAPI?.printBarcode) {
    try {
      const data = await callElectronPrint(() => electronAPI.printBarcode(payload));
      if (data?.ok) return { method: 'direct' as const };
      console.warn('[Print] IPC barcode error:', data?.error);
      return { method: 'direct' as const, error: data?.error };
    } catch (e: any) {
      console.warn('[Print] IPC barcode failed:', e);
      return { method: 'direct' as const, error: e?.message || 'Print failed' };
    }
  }

  // ── HTTP path (web browser) ──
  try {
    const res = await fetch(`${PRINT_SERVER_URL}/print-barcode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (data.ok) {
      return { method: 'direct' };
    }
    console.warn('[Print] Barcode server error, falling back to browser:', data.error);
  } catch (err) {
    console.warn('[Print] Barcode server not reachable, falling back to browser:', err);
  }

  // Fallback: browser print (existing behavior)
  return { method: 'browser' };
}

// ============================================================
// Browser-Based Print (Fallback)
// ============================================================

/**
 * Opens a new browser window with the given HTML content and triggers print.
 * Rasterizes the HTML into an image to prevent garbled text on thermal printers.
 */
export function openPrintWindow(htmlContent: string, title = 'Print') {
  // Open a real popup window
  const printWin = window.open('', '_blank', 'width=400,height=600,menubar=no,toolbar=no,location=no,status=no');
  if (!printWin) {
    alert('Please allow popups for this site to print.');
    return;
  }

  printWin.document.open();
  printWin.document.write(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    @page { margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      background: #fff;
      color: #000;
      padding: 0;
      width: 100%;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    @media print {
      body { 
        padding: 2mm; 
        height: max-content; 
      }
    }
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>
  `);
  printWin.document.close();

  // Wait for the content to fully render, then trigger print
  printWin.onload = () => {
    try {
      if (printWin.document.body) {
        // Convert pixel height to physical millimeters (96 DPI standard)
        const pxHeight = printWin.document.body.scrollHeight;
        const mmHeight = Math.ceil(pxHeight * 0.264583) + 10; // add 10mm buffer for the cutter
        
        const style = printWin.document.createElement('style');
        style.textContent = `@page { size: 80mm ${mmHeight}mm; margin: 0; }`;
        printWin.document.head.appendChild(style);
      }
      printWin.focus();
      printWin.print();
    } catch (err) {
      console.error('Print failed', err);
    }
  };
  
  // Fallback in case onload doesn't fire
  setTimeout(() => {
    try {
      printWin.focus();
      printWin.print();
    } catch (err) {
      console.error('Print failed', err);
    }
  }, 600);
}

/**
 * Builds a receipt HTML string from a transaction object.
 */
export function buildReceiptHTML(transaction: {
  id: string;
  date: string;
  customerName?: string;
  processedByName?: string;
  items: {
    product: { name: string; model: string; price: number };
    quantity: number;
    isReturn?: boolean;
    customReturnPrice?: number;
  }[];
  subtotal: number;
  discount?: { type: 'percent' | 'flat'; value: number };
  total: number;
  payments: { method: string; amount: number }[];
  status?: string;
  exchangeSummary?: {
    purchasedTotal: number;
    returnedTotal: number;
    netDifference: number;
  };
}, storeName: string, receiptHeader?: string, receiptFooter?: string) {
  const { receiptHeader: defaultHeader, receiptFooter: defaultFooter } = useSettingsStore.getState();
  const activeHeader = receiptHeader || defaultHeader;
  const activeFooter = receiptFooter || defaultFooter || 'Thank you for your purchase!';

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  const discount = transaction.discount;
  let discountAmount = 0;
  if (discount && Number(discount.value) > 0) {
    const base = transaction.exchangeSummary?.purchasedTotal ?? transaction.subtotal;
    discountAmount =
      discount.type === 'percent'
        ? (base * Number(discount.value)) / 100
        : Number(discount.value);
  } else if (!transaction.exchangeSummary && transaction.subtotal > transaction.total && transaction.total >= 0) {
    discountAmount = transaction.subtotal - transaction.total;
  }

  const itemsHTML = transaction.items.map(item => {
    const isReturn = Boolean(item.isReturn);
    const unitPrice = item.customReturnPrice ?? item.product.price;
    const lineTotal = unitPrice * item.quantity;
    return `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:3px 0;font-size:12px;line-height:1.35;">
        <span style="flex:1;padding-right:8px;color:#111827;">
          ${isReturn ? '<span style="display:inline-block;background:#fee2e2;color:#b91c1c;font-size:9.5px;font-weight:700;padding:0 3px;border-radius:2px;margin-right:3px;">RETURN</span>' : ''}
          <strong style="color:#374151;">${item.quantity}×</strong> ${item.product.name} ${item.product.model || ''}
        </span>
        <span style="white-space:nowrap;font-variant-numeric:tabular-nums;${isReturn ? 'color:#b91c1c;font-weight:600;' : 'color:#111827;'}">
          ${isReturn ? '−' : ''}${formatCurrency(Math.abs(lineTotal))}
        </span>
      </div>
    `;
  }).join('');

  const formatMethodName = (m: string) => {
    switch (m) {
      case 'debt': return 'Credit Tab (Dette)';
      case 'store_credit': return 'Store Credit (Avoir)';
      case 'cash': return 'Cash';
      case 'card': return 'Card';
      case 'mobile': return 'BaridiMob';
      case 'transfer': return 'Transfer';
      default: return m.charAt(0).toUpperCase() + m.slice(1);
    }
  };

  const logoDataUrl = useSettingsStore.getState().logoUrl || '';

  return `
    <div style="max-width:74mm;margin:0 auto;padding:8px 4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;font-size:12px;line-height:1.45;background:#ffffff;">
      <!-- Store Header -->
      <div style="text-align:center;margin-bottom:8px;">
        ${logoDataUrl ? `<div style="text-align:center;margin-bottom:6px;"><img src="${logoDataUrl}" alt="Logo" style="max-width:140px;max-height:50px;object-fit:contain;" /></div>` : ''}
        <h2 style="font-size:15px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;margin:0 0 2px 0;color:#111827;">${storeName || 'PhoneShop'}</h2>
        ${activeHeader ? `<p style="font-size:11px;color:#6b7280;margin:2px 0;">${activeHeader}</p>` : ''}
        <div style="border-top:1px dashed #d1d5db;margin:8px 0;"></div>
        <p style="font-size:11px;color:#6b7280;margin:0;">${formatDate(transaction.date)}</p>
        <p style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:10.5px;color:#4b5563;font-weight:600;margin:2px 0 0 0;">#${transaction.id}</p>
      </div>

      <!-- Customer & Cashier Metadata -->
      ${(transaction.customerName || transaction.processedByName) ? `
        <div style="border-top:1px dashed #d1d5db;margin:8px 0;"></div>
        <div style="font-size:11.5px;line-height:1.4;">
          ${transaction.customerName ? `
            <div style="display:flex;justify-content:space-between;padding:1px 0;">
              <span style="color:#6b7280;">Customer</span><span style="font-weight:600;color:#1f2937;">${transaction.customerName}</span>
            </div>
          ` : ''}
          ${transaction.processedByName ? `
            <div style="display:flex;justify-content:space-between;padding:1px 0;">
              <span style="color:#6b7280;">Cashier</span><span style="font-weight:600;color:#1f2937;">${transaction.processedByName}</span>
            </div>
          ` : ''}
        </div>
      ` : ''}

      <!-- Status Badge -->
      ${transaction.status === 'refunded' ? `
        <div style="background:#fee2e2;color:#991b1b;border:1px solid #fecaca;padding:3px;text-align:center;font-size:10px;font-weight:700;letter-spacing:0.06em;border-radius:4px;margin:8px 0;">
          FULLY REFUNDED
        </div>
      ` : ''}
      ${transaction.status === 'partially_refunded' ? `
        <div style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;padding:3px;text-align:center;font-size:10px;font-weight:700;letter-spacing:0.06em;border-radius:4px;margin:8px 0;">
          PARTIALLY REFUNDED
        </div>
      ` : ''}

      <!-- Item Table -->
      <div style="border-top:1px dashed #d1d5db;margin:8px 0;"></div>
      <div style="font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#9ca3af;display:flex;justify-content:space-between;padding-bottom:3px;border-bottom:1px solid #f3f4f6;">
        <span>Item</span><span>Price</span>
      </div>
      <div style="padding:4px 0;">
        ${itemsHTML}
      </div>

      <!-- Totals & Discount -->
      <div style="border-top:1px dashed #d1d5db;margin:6px 0;"></div>
      <div style="font-size:12px;font-variant-numeric:tabular-nums;">
        <div style="display:flex;justify-content:space-between;padding:2px 0;color:#4b5563;">
          <span>Subtotal</span><span>${formatCurrency(transaction.subtotal)}</span>
        </div>

        ${discountAmount > 0 ? `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 6px;margin:3px 0;background:#ecfdf5;border:1px dashed #a7f3d0;border-radius:4px;color:#047857;font-weight:600;">
            <span>
              Discount
              ${discount?.type === 'percent' ? `<span style="background:#059669;color:#fff;font-size:9.5px;font-weight:700;padding:1px 4px;border-radius:2px;margin-left:3px;">${discount.value}%</span>` : ''}
            </span>
            <span>−${formatCurrency(discountAmount)}</span>
          </div>
        ` : ''}

        ${transaction.exchangeSummary ? `
          <div style="display:flex;justify-content:space-between;font-size:11px;color:#6b7280;font-style:italic;padding:1px 0;">
            <span>Exchange adj.</span>
            <span>${formatCurrency(transaction.exchangeSummary.purchasedTotal - transaction.exchangeSummary.returnedTotal)}</span>
          </div>
        ` : ''}

        <div style="display:flex;justify-content:space-between;align-items:center;font-size:15px;font-weight:800;padding:7px 0 3px 0;border-top:1.5px solid #111827;margin-top:5px;color:#111827;">
          <span>${transaction.total < 0 ? 'REFUND DUE' : 'TOTAL'}</span>
          <span>${transaction.total < 0 ? `−${formatCurrency(Math.abs(transaction.total))}` : formatCurrency(transaction.total)}</span>
        </div>
      </div>

      <!-- Payment Breakdown -->
      <div style="border-top:1px dashed #d1d5db;margin:8px 0;"></div>
      <div style="font-size:11.5px;color:#4b5563;font-variant-numeric:tabular-nums;">
        ${transaction.payments.map(p => `
          <div style="display:flex;justify-content:space-between;padding:1px 0;">
            <span>${p.method === 'cash' && p.amount < 0 ? 'Cash Refund' : formatMethodName(p.method)}</span>
            <span style="${p.amount < 0 ? 'color:#b91c1c;font-weight:600;' : ''}">${p.amount < 0 ? '−' : ''}${formatCurrency(Math.abs(p.amount))}</span>
          </div>
        `).join('')}
      </div>

      <!-- Footer Policy -->
      <div style="border-top:1px dashed #d1d5db;margin:10px 0 8px 0;"></div>
      <div style="text-align:center;font-size:11px;color:#6b7280;line-height:1.4;">
        <p style="margin:0;">${activeFooter}</p>
      </div>
    </div>
  `;
}

/**
 * Builds barcode label HTML for an array of products.
 * Uses pure HTML/CSS (no React-barcode dependency in the print window).
 */
export function buildLabelsHTML(products: {
  id: string;
  name: string;
  model: string;
  sku: string;
  price: number;
  category: string;
  storage?: string;
  color?: string;
  location?: string;
  hidePrice?: boolean;
}[], storeName?: string) {
  const { storeName: defaultStoreName } = useSettingsStore.getState();
  const activeStoreName = storeName || defaultStoreName || 'PhoneShop Pro';
  
  const labelStyle = `
    border: 1px solid #ccc;
    border-radius: 6px;
    padding: 8px 0;
    text-align: center;
    break-inside: avoid;
    page-break-inside: avoid;
    overflow: hidden;
    background: #fff;
  `;

  const labelsHTML = products.map(p => {
    let specs: string[] = [];
    if (p.category === 'smartphone' || p.category === 'tablet') {
      if (p.storage && p.storage !== 'N/A') specs.push(p.storage);
      if (p.color) specs.push(p.color);
    } else if (p.category === 'repair_part') {
      // NO location on repair parts! Model contains the compatible device(s)
    } else {
      if (p.color) specs.push(p.color);
      if (p.location) specs.push(p.location);
      if (specs.length === 0 && p.category) specs.push(p.category.replace('_', ' '));
    }

    const isPart = p.category === 'repair_part';
    let fullText = '';
    if (isPart) {
      // Remove dash between part name and first compatible device, separated by space
      fullText = `${p.name || ''}${p.model ? ` ${p.model}` : ''}`.trim();
    } else {
      const specsPart = specs.slice(0, 2).join(' - ');
      fullText = `${p.name || ''} ${p.model || ''}${specsPart ? ` - ${specsPart}` : ''}`.trim();
    }

    const isLong = fullText.length > (isPart ? 20 : 28);
    const shiftMm = isLong ? 6 : 5;
    const maxChars = isPart ? 26 : 34;

    let textLines: string[] = [];
    if (isLong && fullText.length > maxChars) {
      const words = fullText.split(' ');
      let line1 = '';
      let line2 = '';
      for (const w of words) {
        const test = line1 ? `${line1} ${w}` : w;
        if (test.length <= maxChars) {
          line1 = test;
        } else {
          line2 = line2 ? `${line2} ${w}` : w;
        }
      }
      textLines = line2 ? [line1, line2] : [fullText];
    } else {
      textLines = [fullText];
    }

    // Determine barcode height to match 20mm physical label space
    const barcodeH = p.hidePrice ? (textLines.length > 1 ? 18 : 22) : 15;

    const cleanSku = (p.sku || '').trim();
    const modules = (cleanSku.length + 3) * 11 + 2;
    // Target physical barcode width: ~30mm (~112px) so all barcodes have consistent width
    const targetPx = 112;
    const barcodeWidth = Math.max(0.7, Math.min(1.1, Number((targetPx / modules).toFixed(2))));

    // Generate barcode SVG string directly using JsBarcode
    const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(svgNode, cleanSku, {
      width: barcodeWidth,
      height: barcodeH,
      margin: 0,
      displayValue: false
    });
    const barcodeSvg = svgNode.outerHTML;

    // Font size: Store name is Font 2 (~11px bold), Parts are Font 2 (~11px regular), Products are Font 1 (~9.5px)
    const fontSize = isPart ? '11px' : '9.5px';
    const fontWeight = '400';

    const linesHtml = textLines.map(line => `
      <div style="font-size:${fontSize};font-weight:${fontWeight};color:#111;line-height:1.15;padding:0 2px;transform:translateX(-${shiftMm}mm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;text-align:center;">${line}</div>
    `).join('');

    return `
      <div class="ticket-label" style="box-sizing:border-box;width:50mm;height:20mm;max-height:20mm;background:#fff;border:1px solid #94a3b8;border-radius:2px;padding:0.6mm 1mm;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.12);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <div style="font-weight:700;font-size:11px;letter-spacing:0.3px;text-transform:uppercase;line-height:1;margin-top:0.4mm;transform:translateX(-2mm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;">${activeStoreName}</div>
        <div style="border-top:1.5px solid #000;width:100%;margin:1mm 0 1.2mm 0;"></div>
        ${linesHtml}
        <div style="margin-top:${p.hidePrice ? (textLines.length > 1 ? '0.4mm' : '0.8mm') : '0.4mm'};display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;width:100%;">
          <div style="display:flex;justify-content:center;align-items:center;max-width:34mm;overflow:hidden;">${barcodeSvg}</div>
          <div style="font-size:8px;font-weight:500;color:#222;margin-top:0.3mm;letter-spacing:0.4px;line-height:1;text-align:center;">${cleanSku}</div>
        </div>
        ${!p.hidePrice ? `<div style="font-size:13px;font-weight:800;height:4mm;line-height:4mm;margin-top:0.6mm;letter-spacing:0.3px;">${formatCurrency(p.price)}</div>` : ''}
      </div>
    `;
  }).join('');

  return `
    <style>
      body {
        margin: 0;
        padding: 16px;
        background: #f1f5f9;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .labels-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        justify-content: center;
      }
      @media print {
        body { padding: 0; background: none; }
        .preview-title { display: none; }
        .labels-grid { display: block; gap: 0; }
        .ticket-label { page-break-after: always; break-after: page; margin: 0; border: none !important; box-shadow: none !important; }
      }
    </style>
    <div class="preview-title" style="font-family:sans-serif;font-size:14px;font-weight:600;margin-bottom:14px;color:#334155;text-align:center;">
      Label Preview (50mm × 20mm) — ${products.length} label${products.length > 1 ? 's' : ''}
    </div>
    <div class="labels-grid">
      ${labelsHTML}
    </div>
  `;
}

/**
 * Print End-of-Day Z-Report directly to the thermal printer via print server,
 * with fallback to browser print preview.
 */
export async function printZReportDirect(
  data: {
    date: string;
    generatedBy: string;
    summary: {
      grossSales: number;
      salesCount: number;
      refundsAmount: number;
      refundsCount: number;
      netCash: number;
      unitsSold: number;
      discountsTotal: number;
      avgTicket: number;
      staffBreakdown: { name: string; count: number; total: number }[];
    };
  },
  storeName: string,
  currency: string = 'USD'
): Promise<{ method: 'direct' | 'browser'; error?: string }> {
  const payload = {
    storeName,
    currency,
    date: data.date,
    generatedBy: data.generatedBy,
    summary: data.summary,
    translations: getTranslations(),
  };

  // ── IPC path (Electron desktop) ──
  if (electronAPI?.printZReport) {
    try {
      const resData = await callElectronPrint(() => electronAPI.printZReport(payload));
      if (resData?.ok) return { method: 'direct' as const };
      console.warn('[Print] IPC Z-Report error:', resData?.error);
      return { method: 'direct' as const, error: resData?.error };
    } catch (e: any) {
      console.warn('[Print] IPC Z-Report failed:', e);
      return { method: 'direct' as const, error: e?.message || 'Print failed' };
    }
  }

  // ── HTTP path (web browser) ──
  try {
    const res = await fetch(`${PRINT_SERVER_URL}/print-z-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify(payload),
    });

    const resData = await res.json();
    if (resData.ok) {
      return { method: 'direct' };
    }
    console.warn('[Print] Z-Report server error, falling back to browser:', resData.error);
  } catch (err) {
    console.warn('[Print] Z-Report server unreachable, falling back to browser:', err);
  }

  // Fallback: browser print
  openZReportPrintWindow(data, storeName, currency);
  return { method: 'browser' };
}

/**
 * Open Z-Report in a formatted browser window for preview/PDF/printing.
 */
export function openZReportPrintWindow(
  data: {
    date: string;
    generatedBy: string;
    summary: {
      grossSales: number;
      salesCount: number;
      refundsAmount: number;
      refundsCount: number;
      netCash: number;
      unitsSold: number;
      discountsTotal: number;
      avgTicket: number;
      staffBreakdown: { name: string; count: number; total: number }[];
    };
  },
  storeName: string,
  currency: string = 'USD'
) {
  const html = buildZReportHTML(data, storeName, currency);
  openPrintWindow(html, 'Z-Report (End-of-Day Summary)');
}

/**
 * Build HTML for Z-Report thermal receipt display
 */
export function buildZReportHTML(
  data: {
    date: string;
    generatedBy: string;
    summary: {
      grossSales: number;
      salesCount: number;
      refundsAmount: number;
      refundsCount: number;
      netCash: number;
      unitsSold: number;
      discountsTotal: number;
      avgTicket: number;
      staffBreakdown: { name: string; count: number; total: number }[];
    };
  },
  storeName: string,
  currency: string = 'USD'
) {
  const { summary } = data;
  const staffRows = summary.staffBreakdown.map(s => `
    <div style="display:flex;justify-content:space-between;font-size:12px;margin:2px 0;">
      <span>${s.name} (${s.count} txs)</span>
      <strong>${formatCurrency(s.total)}</strong>
    </div>
  `).join('');

  return `
    <div style="font-family:'Courier New',Courier,monospace;font-size:12px;max-width:300px;margin:0 auto;padding:12px;background:#fff;color:#000;">
      <div style="text-align:center;margin-bottom:8px;">
        <h2 style="font-size:16px;font-weight:bold;margin:0 0 4px 0;text-transform:uppercase;">${storeName || 'PhoneShop Pro'}</h2>
        <div style="font-size:13px;font-weight:bold;margin:4px 0;">*** END-OF-DAY Z-REPORT ***</div>
        <div style="font-size:11px;color:#333;">Date: ${data.date}</div>
        <div style="font-size:11px;color:#333;">Cashier: ${data.generatedBy}</div>
        <div style="font-size:10px;color:#666;">Generated: ${new Date().toLocaleTimeString()}</div>
      </div>

      <div style="border-top:1px dashed #000;margin:8px 0;"></div>

      <div style="font-weight:bold;margin:6px 0 4px 0;">${i18n.t('reports.salesSummary', 'SALES SUMMARY')}</div>
      <div style="display:flex;justify-content:space-between;margin:2px 0;">
        <span>${i18n.t('reports.grossSales', 'Gross Sales')} (${summary.salesCount} ${i18n.t('reports.txs', 'txs')}):</span>
        <strong>${formatCurrency(summary.grossSales)}</strong>
      </div>
      ${summary.discountsTotal > 0 ? `
        <div style="display:flex;justify-content:space-between;margin:2px 0;color:#dc2626;">
          <span>${i18n.t('reports.discountsGiven', 'Discounts Given:')}</span>
          <span>-${formatCurrency(summary.discountsTotal)}</span>
        </div>
      ` : ''}
      <div style="display:flex;justify-content:space-between;margin:2px 0;">
        <span>${i18n.t('reports.unitsSold', 'Units / Items Sold:')}</span>
        <span>${summary.unitsSold} ${i18n.t('reports.pcs', 'pcs')}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin:2px 0;">
        <span>${i18n.t('reports.averageTicket', 'Average Ticket:')}</span>
        <span>${formatCurrency(summary.avgTicket)}</span>
      </div>

      <div style="border-top:1px dashed #000;margin:8px 0;"></div>

      <div style="font-weight:bold;margin:6px 0 4px 0;">${i18n.t('reports.returnsRefunds', 'RETURNS & REFUNDS')}</div>
      <div style="display:flex;justify-content:space-between;margin:2px 0;color:#dc2626;">
        <span>${i18n.t('reports.refundsGiven', 'Refunds')} (${summary.refundsCount} ${i18n.t('reports.txs', 'txs')}):</span>
        <strong>-${formatCurrency(summary.refundsAmount)}</strong>
      </div>

      <div style="border-top:1px dashed #000;margin:8px 0;"></div>

      <div style="font-weight:bold;margin:6px 0 4px 0;">${i18n.t('reports.cashDrawerRec', 'CASH DRAWER RECONCILIATION')}</div>
      <div style="display:flex;justify-content:space-between;margin:2px 0;">
        <span>${i18n.t('reports.cashCollected', 'Total Cash In:')}</span>
        <span>${formatCurrency(summary.grossSales)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin:2px 0;">
        <span>${i18n.t('reports.cashPaidOut', 'Total Cash Out (Refunds):')}</span>
        <span>-${formatCurrency(summary.refundsAmount)}</span>
      </div>

      <div style="border:2px solid #000;border-radius:4px;padding:8px;margin:10px 0;text-align:center;background:#f9f9f9;">
        <div style="font-size:11px;font-weight:bold;text-transform:uppercase;">${i18n.t('reports.netCashDrawer', 'NET CASH IN DRAWER')}</div>
        <div style="font-size:18px;font-weight:bold;margin-top:2px;">${formatCurrency(summary.netCash)}</div>
      </div>

      ${summary.staffBreakdown.length > 0 ? `
        <div style="border-top:1px dashed #000;margin:8px 0;"></div>
        <div style="font-weight:bold;margin:6px 0 4px 0;">${i18n.t('reports.staffBreakdown', 'STAFF BREAKDOWN')}</div>
        ${staffRows}
      ` : ''}

      <div style="border-top:1px dashed #000;margin:12px 0 8px 0;"></div>
      <div style="text-align:center;font-size:11px;font-weight:bold;">
        ${i18n.t('reports.endOfReport', '*** END OF REPORT ***')}
      </div>
    </div>
  `;
}

/**
 * Builds HTML preview for a single 50mm x 20mm thermal repair device label.
 */
export function buildRepairLabelHTML(ticket: {
  ticketNumber: string;
  deviceBrand: string;
  deviceModel: string;
  customerName?: string;
  customerPhone?: string;
  issueDescription?: string;
  estimatedCost?: number;
  depositAmount?: number;
  actualCost?: number;
  lockType?: string;
  lockValue?: string;
  createdAt?: string;
}, storeName?: string) {
  const { storeName: defaultStoreName, currency } = useSettingsStore.getState();
  const activeStoreName = storeName || defaultStoreName || 'PhoneShop Pro';

  const ticketNum = (ticket.ticketNumber || '').trim();
  const phoneName = `${ticket.deviceBrand || ''} ${ticket.deviceModel || ''}`.trim();
  const custName = (ticket.customerName || '').trim();
  const custPhone = (ticket.customerPhone || '').trim();
  const phoneHeader = `${phoneName}${custPhone ? ` ${custPhone}` : ''}`;
  const issueDesc = (ticket.issueDescription || '').trim();
  const costVal = ticket.actualCost ?? ticket.estimatedCost ?? 0;
  const depositVal = ticket.depositAmount || 0;
  const isPaid = depositVal > 0 && depositVal >= costVal;
  const priceText = isPaid
    ? `${formatCurrencyWith(costVal, currency, false)} (${i18n.t('common.paid', 'Payé')})`
    : formatCurrencyWith(costVal, currency, false);

  // Generate barcode SVG using JsBarcode
  let barcodeSvg = '';
  try {
    const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(svgNode, ticketNum, {
      width: 1.1,
      height: 20,
      margin: 0,
      displayValue: false
    });
    barcodeSvg = svgNode.outerHTML;
  } catch (e) {
    barcodeSvg = `<div style="font-size:11px;font-weight:bold;">${ticketNum}</div>`;
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>Phone Back Label - ${ticketNum}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          margin: 0;
          padding: 20px;
          background: #f1f5f9;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          min-height: 100vh;
        }
        .preview-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .label-card {
          width: 50mm;
          min-height: 25mm;
          background: #ffffff;
          border: 1px solid #94a3b8;
          border-radius: 4px;
          padding: 1.2mm 1.5mm;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
          transform: scale(2.3);
          transform-origin: center center;
          margin: 45px 0;
          color: #0f172a;
        }
        .header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 4px;
          line-height: 1;
        }
        .ticket-badge {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.5px;
          color: #1e293b;
          white-space: nowrap;
        }
        .phone-name {
          font-size: 11px;
          font-weight: 800;
          color: #0f172a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-align: left;
          width: 100%;
        }
        .divider {
          border-top: 1px solid #000;
          width: 100%;
          margin: 0.8mm 0;
        }
        .info-row {
          display: flex;
          font-size: 8.8px;
          line-height: 1.25;
          margin-bottom: 0.4mm;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .info-label {
          font-weight: 700;
          color: #334155;
          margin-right: 3px;
          flex-shrink: 0;
        }
        .info-val {
          color: #0f172a;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .price-val {
          font-weight: 800;
          color: #0f172a;
        }
        .barcode-wrap {
          margin-top: 3.8mm;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          line-height: 1;
          width: 100%;
        }
        .barcode-svg {
          display: flex;
          justify-content: center;
          align-items: center;
          max-width: 38mm;
          overflow: hidden;
        }
        .ticket-num {
          font-size: 7.5px;
          font-weight: 600;
          color: #334155;
          margin-top: 0.3mm;
          letter-spacing: 0.5px;
          line-height: 1;
          text-align: center;
        }
        .badge {
          font-size: 11px;
          font-weight: 600;
          color: #64748b;
          background: #e2e8f0;
          padding: 4px 10px;
          border-radius: 6px;
        }
        @media print {
          body {
            margin: 0;
            padding: 0;
            background: #fff;
            min-height: auto;
          }
          .label-card {
            border: none;
            box-shadow: none;
            transform: none;
            margin: 0;
          }
          .badge {
            display: none;
          }
          @page {
            size: 50mm 25mm;
            margin: 0;
          }
        }
      </style>
    </head>
    <body>
      <div class="preview-wrapper">
        <div class="label-card">
          <div class="header-row">
            <span class="phone-name">${phoneHeader}</span>
          </div>
          <div class="divider"></div>
          <div class="info-row">
            <span class="info-label">${i18n.t('ticket.customer', 'Client')}&nbsp;:&nbsp;</span>
            <span class="info-val">${custName}</span>
          </div>
          <div class="info-row">
            <span class="info-label">${i18n.t('ticket.issue', 'Prob')}&nbsp;:&nbsp;</span>
            <span class="info-val">${issueDesc || 'Diagnostic'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">${i18n.t('ticket.cost', 'Prix')}&nbsp;:&nbsp;</span>
            <span class="info-val price-val">${priceText}</span>
          </div>
          <div class="barcode-wrap">
            <div class="barcode-svg">${barcodeSvg}</div>
            <div class="ticket-num">${ticketNum}</div>
          </div>
        </div>
        <div class="badge">🏷️ ${i18n.t('ticket.deviceLabel', 'Device Back Sticker')}</div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Builds HTML preview for a full 80mm customer repair intake slip / receipt.
 */
export function buildRepairReceiptHTML(ticket: {
  ticketNumber: string;
  customerName: string;
  customerPhone?: string;
  deviceBrand: string;
  deviceModel: string;
  issueDescription?: string;
  estimatedCost?: number;
  depositAmount?: number;
  actualCost?: number;
  lockType?: string;
  lockValue?: string;
  trackingPin?: string;
  assignedTechnician?: string;
  createdByName?: string;
  createdAt: string;
  estimatedCompletionDate?: string;
}, storeName?: string) {
  const { storeName: defaultStoreName, currency, receiptHeader, receiptFooter, trackingBaseUrl } = useSettingsStore.getState();
  const activeStoreName = storeName || defaultStoreName || 'PhoneShop Pro';
  const pinSnippet = ticket.trackingPin || ticket.customerPhone?.slice(-4) || '';
  
  const ticketNum = (ticket.ticketNumber || '').trim();
  const formattedDate = new Date(ticket.createdAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const totalCost = ticket.actualCost ?? ticket.estimatedCost ?? 0;
  const deposit = ticket.depositAmount || 0;
  const balanceDue = Math.max(0, totalCost - deposit);

  const lockSnippet = ticket.lockValue ? `${ticket.lockType === 'pattern' ? i18n.t('ticket.pattern', 'Pattern Lock') : i18n.t('ticket.pinLabel', 'PIN / Passcode')}: ${ticket.lockValue}` : i18n.t('common.none', 'None');

  // Generate QR Code SVG manually (using renderToString as this returns an HTML string)
  let qrCodeSvg = '';
  try {
    const trackingUrl = `${trackingBaseUrl || `${window.location.origin}/track`}/${ticketNum}?pin=${pinSnippet}`;
    qrCodeSvg = renderToString(
      <QRCodeSVG 
        value={trackingUrl} 
        size={110} 
        level="M" 
        marginSize={0}
      />
    );
  } catch (e) {
    qrCodeSvg = `<div style="font-size:12px;font-weight:bold;">${ticketNum}</div>`;
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>Repair Intake Slip - ${ticketNum}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          margin: 0;
          padding: 16px;
          background: #f1f5f9;
          display: flex;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          color: #111827;
          font-size: 12px;
          line-height: 1.55;
        }
        .slip-container {
          width: 78mm;
          background: #ffffff;
          padding: 18px 16px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.08);
          border: 1px solid #e5e7eb;
          border-radius: 8px;
        }
        .center { text-align: center; }
        .rule { border: none; border-top: 1px solid #e5e7eb; margin: 12px 0; }
        .rule-dashed { border: none; border-top: 1px dashed #d1d5db; margin: 10px 0; }
        .section-label { font-size: 9px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #9ca3af; margin-bottom: 6px; }
        .row { display: flex; justify-content: space-between; align-items: flex-start; margin: 5px 0; font-size: 11.5px; font-variant-numeric: tabular-nums; }
        .row-label { color: #6b7280; flex-shrink: 0; padding-right: 8px; }
        .row-value { color: #111827; font-weight: 600; text-align: right; }
        .issue-block { background: #f9fafb; border-radius: 5px; padding: 8px 10px; margin: 4px 0; }
        .issue-title { font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #9ca3af; margin-bottom: 4px; }
        .issue-text { font-size: 11.5px; color: #1f2937; line-height: 1.45; }
        .fin-row { display: flex; justify-content: space-between; font-size: 11.5px; color: #4b5563; padding: 4px 0; font-variant-numeric: tabular-nums; }
        .balance-row { display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: 800; color: #111827; padding-top: 8px; margin-top: 4px; border-top: 2px solid #111827; font-variant-numeric: tabular-nums; }
        .paid-badge { font-size: 11px; font-weight: 700; background: #dcfce7; color: #15803d; padding: 2px 8px; border-radius: 4px; letter-spacing: 0.04em; }
        .store-name { font-size: 16px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #111827; }
        .header-msg { font-size: 10.5px; color: #6b7280; margin-top: 2px; }
        .ticket-label { font-size: 9.5px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #6b7280; margin: 10px 0 4px 0; }
        .ticket-num { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 15px; font-weight: 800; letter-spacing: 0.05em; color: #111827; background: #f3f4f6; padding: 3px 12px; border-radius: 5px; display: inline-block; }
        .pin-row { font-size: 11px; color: #374151; font-weight: 600; margin-top: 4px; }
        .date-row { font-size: 10.5px; color: #6b7280; margin-top: 3px; }
        .qr-caption { font-size: 9.5px; font-weight: 600; letter-spacing: 0.06em; color: #6b7280; text-transform: uppercase; margin-top: 5px; }
        .qr-id { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 10px; color: #9ca3af; margin-top: 2px; letter-spacing: 0.04em; }
        .footer-msg { text-align: center; font-size: 10px; color: #9ca3af; font-style: italic; line-height: 1.45; margin-top: 4px; }
        @media print {
          body { background: #fff; padding: 0; display: block; }
          .slip-container { border: none; box-shadow: none; width: 100%; padding: 6px 4px; border-radius: 0; }
          @page { size: 80mm auto; margin: 2mm; }
        }
      </style>
    </head>
    <body>
      <div class="slip-container">

        <!-- Header -->
        <div class="center">
          <div class="store-name">${activeStoreName}</div>
          ${receiptHeader ? `<div class="header-msg">${receiptHeader}</div>` : ''}
          <div class="ticket-label">${i18n.t('ticket.repairTicket', 'Repair Intake Ticket')}</div>
          <div><span class="ticket-num">${ticketNum}</span></div>
          ${pinSnippet ? `<div class="pin-row">${i18n.t('ticket.pin', 'PIN:')} ${pinSnippet}</div>` : ''}
          <div class="date-row">${formattedDate}</div>
        </div>

        <div class="rule"></div>

        <!-- Customer -->
        <div class="section-label">${i18n.t('ticket.customerInfo', 'Customer')}</div>
        <div class="row">
          <span class="row-label">${i18n.t('ticket.customer', 'Name')}</span>
          <span class="row-value">${ticket.customerName}</span>
        </div>
        ${ticket.customerPhone ? `<div class="row"><span class="row-label">${i18n.t('common.phone', 'Phone')}</span><span class="row-value">${ticket.customerPhone}</span></div>` : ''}

        <div class="rule"></div>

        <!-- Device -->
        <div class="section-label">${i18n.t('ticket.deviceInfo', 'Device')}</div>
        <div class="row">
          <span class="row-label">${i18n.t('ticket.device', 'Model')}</span>
          <span class="row-value">${ticket.deviceBrand} ${ticket.deviceModel}</span>
        </div>
        <div class="row">
          <span class="row-label">${i18n.t('ticket.security', 'Security')}</span>
          <span class="row-value">${lockSnippet}</span>
        </div>
        ${ticket.assignedTechnician ? `<div class="row"><span class="row-label">${i18n.t('ticket.assignedTo', 'Technician')}</span><span class="row-value">${ticket.assignedTechnician}</span></div>` : ''}
        ${ticket.createdByName ? `<div class="row"><span class="row-label">${i18n.t('ticket.intakeBy', 'Intake By')}</span><span class="row-value">${ticket.createdByName}</span></div>` : ''}
        ${ticket.estimatedCompletionDate ? `<div class="row"><span class="row-label">${i18n.t('ticket.estReady', 'Est. Ready')}</span><span class="row-value">${new Date(ticket.estimatedCompletionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>` : ''}

        <div class="rule"></div>

        <!-- Issue -->
        <div class="issue-block">
          <div class="issue-title">${i18n.t('ticket.issueDescription', 'Reported Problem')}</div>
          <div class="issue-text">${ticket.issueDescription || i18n.t('ticket.diagnostic', 'Diagnostic required')}</div>
        </div>

        <div class="rule"></div>

        <!-- Financials -->
        <div class="section-label">${i18n.t('ticket.financial', 'Financial Summary')}</div>
        <div class="fin-row">
          <span>${i18n.t('ticket.estimatedCost', 'Estimated Cost')}</span>
          <span>${formatCurrencyWith(totalCost, currency, false)}</span>
        </div>
        <div class="fin-row">
          <span>${i18n.t('ticket.depositAmount', 'Deposit Paid')}</span>
          <span>${formatCurrencyWith(deposit, currency, false)}</span>
        </div>
        <div class="balance-row">
          <span>${i18n.t('ticket.balanceDue', 'Balance Due')}</span>
          ${balanceDue <= 0
            ? `<span class="paid-badge">${i18n.t('ticket.paidInFull', 'PAID IN FULL')}</span>`
            : `<span>${formatCurrencyWith(balanceDue, currency, false)}</span>`}
        </div>

        <div class="rule"></div>

        <!-- QR -->
        <div class="center" style="margin:4px 0;">
          <div style="display:flex;justify-content:center;">${qrCodeSvg}</div>
          <div class="qr-caption">${i18n.t('ticket.scanTrack', 'Scan to track repair online')}</div>
          <div class="qr-id">${ticketNum}</div>
        </div>

        <div class="rule-dashed"></div>

        <!-- Footer -->
        <div class="footer-msg">
          ${receiptFooter || i18n.t('ticket.presentTicket', 'Please present this ticket when picking up your device.')}
        </div>

      </div>
    </body>
    </html>
  `;
}

/**
 * Direct print function for Custom Tickets / Spec Slips.
 * Sends the ticket exclusively to the local print server on port 3355.
 * Strictly executes via print server; does NOT open the browser print dialog.
 */
export async function printCustomTicketDirect(
  ticketData: import('../features/customTicket/customTicketTypes').CustomTicketData,
  storeName: string,
  currency: string = 'DZD',
  storeAddress?: string,
  storePhone?: string
): Promise<{ success: boolean; error?: string }> {
  const payload = {
    storeName,
    currency,
    storeAddress,
    storePhone,
    ticketData,
    copies: ticketData.copies || 1,
  };

  // ── IPC path (Electron desktop) ──
  if (electronAPI?.printCustomTicket) {
    try {
      const data = await callElectronPrint(() => electronAPI.printCustomTicket(payload));
      if (data?.ok) return { success: true };
      return { success: false, error: data?.error || 'IPC print returned an error.' };
    } catch (e: any) {
      console.warn('[Print] IPC custom ticket failed:', e);
      return { success: false, error: e?.message || 'Print failed' };
    }
  }

  // ── HTTP path (web browser) ──
  try {
    const res = await fetch(`${PRINT_SERVER_URL}/print-custom-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (data.ok) {
      return { success: true };
    }
    return { success: false, error: data.error || 'Print server returned an error.' };
  } catch (err: any) {
    console.error('[Print Server Error] Custom ticket print failed:', err);
    return {
      success: false,
      error: 'Print server is unreachable (http://localhost:3355). Please ensure the print server is running (cd print-server && npm start).'
    };
  }
}

/**
 * Recalibrates the label printer gap sensor via TSPL GAPDETECT command.
 * Synchronizes the printer's mechanical feed with the physical label gap.
 */
export async function calibrateLabelPrinter(): Promise<{ success: boolean; message?: string; error?: string }> {
  // ── IPC path (Electron desktop) ──
  if (electronAPI?.calibrateLabels) {
    try {
      const data = await callElectronPrint(() => electronAPI.calibrateLabels({}));
      if (data?.ok) return { success: true, message: data.message };
      return { success: false, error: data?.error || 'IPC calibration returned an error.' };
    } catch (e: any) {
      console.warn('[Print] IPC calibrate failed:', e);
      return { success: false, error: e?.message || 'Calibration failed' };
    }
  }

  // ── HTTP path (web browser) ──
  try {
    const res = await fetch(`${PRINT_SERVER_URL}/calibrate-labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (data.ok) {
      return { success: true, message: data.message };
    }
    return { success: false, error: data.error || 'Calibration command rejected by print server.' };
  } catch (err: any) {
    return {
      success: false,
      error: 'Print server is unreachable (http://localhost:3355). Please check that the print server is running.'
    };
  }
}

export interface LowStockReportPrintPayload {
  storeName?: string;
  currency?: string;
  category?: string;
  subCategory?: string;
  totalUnitsNeeded?: number;
  totalRestockCost?: number;
  canViewCosts?: boolean;
  products: Array<{
    name: string;
    model: string;
    category?: string;
    accessorySubCategory?: string;
    sku?: string;
    stock: number;
    lowStockThreshold?: number;
    supplier?: string;
    costPrice?: number;
    price?: number;
  }>;
}

function formatTwoCol(left: string, right: string, width = 42): string {
  const space = width - left.length - right.length;
  if (space > 0) {
    return left + ' '.repeat(space) + right;
  }
  return `${left} ${right}`.substring(0, width);
}

function getCategoryGroupHeader(p: LowStockProductItem): string {
  const cat = (p.category || 'other').toLowerCase();
  if (cat === 'smartphone') return '📱 SMARTPHONES';
  if (cat === 'tablet') return '📟 TABLETS';
  if (cat === 'wearable') return '⌚ WEARABLES';
  if (cat === 'accessory') {
    const sub = p.accessorySubCategory || 'other';
    const subLabels: Record<string, string> = {
      case: 'CASES & COVERS',
      glass: 'SCREEN PROTECTORS',
      cable: 'CABLES',
      charger: 'CHARGERS',
      earphone: 'EARPHONES',
      powerbank: 'POWER BANKS',
      holder: 'HOLDERS & MOUNTS',
      other: 'OTHER ACCESSORIES',
    };
    const subText = subLabels[sub] || sub.toUpperCase();
    return `🎧 ACCESSORIES: ${subText}`;
  }
  return `📦 ${(p.category || 'OTHER').toUpperCase()}`;
}

function sortLowStockProducts(products: LowStockProductItem[]): LowStockProductItem[] {
  const catRank: Record<string, number> = {
    smartphone: 1,
    tablet: 2,
    wearable: 3,
    accessory: 4,
  };

  return [...products].sort((a, b) => {
    const rankA = catRank[(a.category || '').toLowerCase()] || 99;
    const rankB = catRank[(b.category || '').toLowerCase()] || 99;
    if (rankA !== rankB) return rankA - rankB;

    if ((a.category || '').toLowerCase() === 'accessory' && (b.category || '').toLowerCase() === 'accessory') {
      const subA = a.accessorySubCategory || 'other';
      const subB = b.accessorySubCategory || 'other';
      if (subA !== subB) return subA.localeCompare(subB);
    }

    const nameA = `${a.name || ''} ${a.model || ''}`.toLowerCase();
    const nameB = `${b.name || ''} ${b.model || ''}`.toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

function buildLowStockThermalSlipText(payload: LowStockReportPrintPayload): string {
  const width = 42;
  const line = '-'.repeat(width);
  const doubleLine = '='.repeat(width);
  const {
    currency = 'DZD',
    category = 'all',
    subCategory = 'all',
    totalUnitsNeeded = 0,
    totalRestockCost = 0,
    canViewCosts = true,
    products = [],
  } = payload;

  const now = new Date();
  const dateStr = now.toLocaleDateString();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let scope = category === 'all' ? 'ALL CATEGORIES' : category.toUpperCase();
  if (category === 'accessory' && subCategory !== 'all') {
    scope += ` (${subCategory.toUpperCase()})`;
  }

  const out: string[] = [];
  out.push(doubleLine);
  out.push('*** LOW STOCK REPLENISHMENT ***');
  out.push(`Date: ${dateStr} ${timeStr}`);
  out.push(`Scope: ${scope}`);
  out.push(line);
  out.push('REPLENISHMENT SUMMARY');
  out.push(formatTwoCol('Products Below Min:', `${products.length} items`, width));
  out.push(formatTwoCol('Total Units to Order:', `+${totalUnitsNeeded} pcs`, width));
  if (canViewCosts && totalRestockCost > 0) {
    out.push(formatTwoCol('Est. Restock Budget:', `${totalRestockCost.toLocaleString()} ${currency}`, width));
  }
  out.push(line);
  out.push('ITEMIZED ORDER LIST (BY CATEGORY)');
  out.push(line);

  const sorted = sortLowStockProducts(products);
  let currentGroup = '';

  sorted.forEach((p, idx) => {
    const groupName = getCategoryGroupHeader(p);
    if (groupName !== currentGroup) {
      currentGroup = groupName;
      out.push('');
      out.push(`[ ${groupName} ]`);
      out.push(line);
    }

    const threshold = p.lowStockThreshold || 1;
    const deficit = Math.max(1, threshold - (p.stock || 0));
    const title = `${idx + 1}. ${p.name} ${p.model}`.trim().substring(0, width);
    out.push(title);

    let meta = p.category || '';
    if (p.accessorySubCategory) meta += ` (${p.accessorySubCategory})`;
    if (p.sku) meta += ` | ${p.sku}`;
    out.push(meta.substring(0, width));

    out.push(`Stock: ${p.stock}/${threshold}  --> REORDER: +${deficit}`);
    if (p.supplier) {
      out.push(`Supplier: ${p.supplier}`.substring(0, width));
    }
    if (canViewCosts && p.costPrice) {
      const unitStr = `Unit: ${(p.costPrice).toLocaleString()} ${currency}`;
      const subStr = `Sub: ${(p.costPrice * deficit).toLocaleString()} ${currency}`;
      out.push(formatTwoCol(unitStr, subStr, width));
    }
    if (idx < sorted.length - 1) {
      out.push(line);
    }
  });

  out.push(doubleLine);
  out.push('*** END OF REPORT ***');

  return out.join('\n');
}

function buildLowStockReportHTML(payload: LowStockReportPrintPayload): string {
  const {
    storeName = 'PhoneShop Pro',
    currency = 'DZD',
    category = 'all',
    subCategory = 'all',
    totalUnitsNeeded = 0,
    totalRestockCost = 0,
    canViewCosts = true,
    products = [],
  } = payload;

  const dateStr = new Date().toLocaleDateString();
  const catLabel = category === 'all' ? 'All Inventory Categories' : category.toUpperCase();
  const subLabel = category === 'accessory' && subCategory !== 'all' ? ` (${subCategory})` : '';

  const sorted = sortLowStockProducts(products);
  let lastGroup = '';
  const rowsHtml = sorted
    .map((p, idx) => {
      const groupName = getCategoryGroupHeader(p);
      let groupHeaderHtml = '';
      if (groupName !== lastGroup) {
        lastGroup = groupName;
        groupHeaderHtml = `
          <tr style="background-color: #f1f5f9; font-weight: bold;">
            <td colspan="${canViewCosts ? 11 : 9}" style="padding: 8px 12px; font-size: 13px; color: #1e293b; border-top: 2px solid #cbd5e1;">
              ${groupName}
            </td>
          </tr>
        `;
      }
      const threshold = p.lowStockThreshold || 1;
      const deficit = Math.max(1, threshold - (p.stock || 0));
      const subMeta = p.accessorySubCategory || '-';
      return `
        ${groupHeaderHtml}
        <tr>
          <td>${idx + 1}</td>
          <td><strong>${p.name} ${p.model}</strong></td>
          <td>${p.category || ''} ${subMeta !== '-' ? `(${subMeta})` : ''}</td>
          <td class="font-mono">${p.sku || '-'}</td>
          <td class="text-danger" style="font-weight: bold;">${p.stock}</td>
          <td>${threshold}</td>
          <td style="font-weight: bold; color: #b91c1c;">+${deficit}</td>
          ${canViewCosts ? `<td>${(p.costPrice || 0).toLocaleString()} ${currency}</td><td>${((p.costPrice || 0) * deficit).toLocaleString()} ${currency}</td>` : ''}
          <td>${p.supplier || '-'}</td>
          <td>[ &nbsp; &nbsp; &nbsp; ]</td>
        </tr>
      `;
    })
    .join('');

  return `
    <div class="report-header">
      <div>
        <div class="shop-name">${storeName}</div>
        <div class="report-title">Low Stock Replenishment & Reorder Sheet</div>
        <div style="font-size: 12px; color: #64748b; margin-top: 2px;">
          Filter Scope: <strong>${catLabel}${subLabel}</strong>
        </div>
      </div>
      <div class="meta-info">
        <div><strong>Date:</strong> ${dateStr}</div>
        <div><strong>Products Below Min:</strong> ${products.length}</div>
        <div><strong>Units to Reorder:</strong> ${totalUnitsNeeded}</div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Deficit Products</div>
        <div class="kpi-value">${products.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Units Needed</div>
        <div class="kpi-value text-danger">${totalUnitsNeeded}</div>
      </div>
      ${
        canViewCosts
          ? `
        <div class="kpi-card">
          <div class="kpi-label">Est. Restock Budget</div>
          <div class="kpi-value">${totalRestockCost.toLocaleString()} ${currency}</div>
        </div>
      `
          : ''
      }
    </div>

    <div class="section-title">Itemized Replenishment List (Grouped by Category)</div>
    <table>
      <thead>
        <tr>
          <th style="width: 30px;">#</th>
          <th>Product & Model</th>
          <th>Category & Sub</th>
          <th>SKU</th>
          <th>Stock</th>
          <th>Min</th>
          <th>Order Qty</th>
          ${canViewCosts ? '<th>Unit Cost</th><th>Est. Cost</th>' : ''}
          <th>Supplier</th>
          <th>Received</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <div class="signature-box" style="margin-top: 32px;">
      <div>
        <div class="sig-line">Prepared By</div>
      </div>
      <div>
        <div class="sig-line">Manager Approval</div>
      </div>
      <div>
        <div class="sig-line">Supplier Order Confirmation</div>
      </div>
    </div>
  `;
}

/**
 * Sends a low stock replenishment report to the thermal print server.
 * Uses 4 tiers — each returns immediately on success, NO browser fallback:
 *   1. Electron native IPC dedicated (print:low-stock-report)
 *   2. Electron native IPC receipt engine (print:receipt) — 100% active on all desktop app versions
 *   3. HTTP POST /print-low-stock-report (dedicated endpoint for web browsers)
 *   4. HTTP POST /print-custom-ticket (free text endpoint for web browsers)
 */
export async function printLowStockReportDirect(
  payload: LowStockReportPrintPayload
): Promise<{ method: 'direct' | 'browser'; error?: string }> {
  const sortedProducts = sortLowStockProducts(payload.products);
  const sortedPayload = { ...payload, products: sortedProducts };

  // ── Tier 1: Electron IPC Dedicated Path (Desktop app with new build) ──
  if (electronAPI?.printLowStockReport) {
    try {
      const res = await callElectronPrint(() => electronAPI.printLowStockReport(sortedPayload));
      if (res?.ok) return { method: 'direct' };
      console.warn('[Print] IPC Low Stock Report error:', res?.error);
    } catch (err) {
      console.warn('[Print] IPC Low Stock Report failed:', err);
    }
  }

  // ── Tier 2: Electron IPC Universal Fallback (Desktop app running current/existing build) ──
  // If running inside the macOS desktop app, use the built-in IPC receipt engine which
  // is guaranteed to be running in-process and connected to the 80mm thermal printer.
  if (electronAPI?.printReceipt) {
    try {
      const now = new Date();
      const catLabel =
        (payload.category === 'all' ? 'ALL CATEGORIES' : payload.category.toUpperCase()) +
        (payload.category === 'accessory' && payload.subCategory !== 'all' ? ` (${payload.subCategory.toUpperCase()})` : '');

      let lastGroup = '';
      const receiptItems = sortedProducts.map((p, idx) => {
        const currentGroup = getCategoryGroupHeader(p);
        const isNewGroup = currentGroup !== lastGroup;
        lastGroup = currentGroup;

        const threshold = p.lowStockThreshold || 1;
        const deficit = Math.max(1, threshold - (p.stock || 0));
        const sub = p.accessorySubCategory ? ` [${p.accessorySubCategory}]` : '';
        const sku = p.sku ? ` (${p.sku})` : '';
        const supplier = p.supplier ? ` • ${p.supplier}` : '';

        return {
          quantity: deficit,
          product: {
            name: `${isNewGroup ? `\n[ ${currentGroup} ]\n` : ''}${idx + 1}. ${p.name} ${p.model}${sub}${sku}`,
            model: `[Stock: ${p.stock}/${threshold}${supplier}]`,
            price: payload.canViewCosts ? (p.costPrice || 0) : 0,
          },
        };
      });

      const lowStockTransaction = {
        id: `LOW-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`,
        date: now.toISOString(),
        customerName: `Scope: ${catLabel}`,
        processedByName: `Reorder List (${sortedProducts.length} items)`,
        items: receiptItems,
        subtotal: payload.canViewCosts ? payload.totalRestockCost : 0,
        total: payload.canViewCosts ? payload.totalRestockCost : 0,
        payments: [
          {
            method: `REORDER DEFICIT: +${payload.totalUnitsNeeded} PCS`,
            amount: payload.canViewCosts ? payload.totalRestockCost : 0,
          },
        ],
      };

      const receiptPayload = {
        storeName: payload.storeName || 'PhoneShop Pro',
        currency: payload.currency || 'DZD',
        transaction: lowStockTransaction,
        headerMessage: '*** LOW STOCK REPLENISHMENT ***',
        footerMessage: '*** END OF REPORT ***',
        translations: getTranslations(),
      };

      const res = await callElectronPrint(() => electronAPI.printReceipt(receiptPayload));
      if (res?.ok) return { method: 'direct' };
      console.warn('[Print] IPC Receipt fallback error:', res?.error);
    } catch (err) {
      console.warn('[Print] IPC Receipt fallback failed:', err);
    }
  }

  // ── Tier 3: HTTP /print-low-stock-report (for web browser clients connected to print server) ──
  try {
    const res = await fetch(`${PRINT_SERVER_URL}/print-low-stock-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify(sortedPayload),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.ok) return { method: 'direct' };
      console.warn('[Print] /print-low-stock-report returned error:', data.error);
    } else {
      console.warn(`[Print] /print-low-stock-report returned ${res.status}, trying /print-custom-ticket...`);
    }
  } catch (err) {
    console.warn('[Print] /print-low-stock-report failed, trying /print-custom-ticket:', err);
  }

  // ── Tier 4: HTTP /print-custom-ticket (HTTP fallback for web browsers) ──
  try {
    const customPayload = {
      storeName: payload.storeName || 'PhoneShop Pro',
      currency: payload.currency || 'DZD',
      ticketData: {
        title: '*** LOW STOCK REPLENISHMENT ***',
        format: '80mm',
        mode: 'free_text',
        freeText: buildLowStockThermalSlipText(sortedPayload),
        showStoreNameOnSticker: true,
        textAlign: 'left',
        isBold: false,
        fontSize: 'normal',
        copies: 1,
      },
    };

    const res = await fetch(`${PRINT_SERVER_URL}/print-custom-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify(customPayload),
    });

    const data = await res.json();
    if (data.ok) return { method: 'direct' };
    console.warn('[Print] /print-custom-ticket returned error:', data.error);
  } catch (err) {
    console.warn('[Print] /print-custom-ticket also failed:', err);
  }

  // If both IPC and HTTP failed, notify user with error toast — NEVER open browser dialog
  throw new Error('Print server unreachable. Please ensure the print server or desktop app is active.');
}
