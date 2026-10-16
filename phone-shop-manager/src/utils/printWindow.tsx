import React from 'react';
import { renderToString } from 'react-dom/server';
import JsBarcode from 'jsbarcode';
import html2canvas from 'html2canvas';
import { formatCurrency, formatCurrencyWith } from './formatCurrency';
import { useSettingsStore } from '../store/settingsStore';
import { QRCodeSVG } from 'qrcode.react';
import i18n from '../i18n';

// ============================================================
// ESC/POS Direct Printing via Local Print Server
// ============================================================

const PRINT_SERVER_URL = typeof window !== 'undefined' && window.location.hostname
  ? `http://${window.location.hostname}:3355`
  : 'http://localhost:3355';

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
  try {
    const res = await fetch(`${PRINT_SERVER_URL}/status`, {
      signal: AbortSignal.timeout(2000),
    });
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

  try {
    const res = await fetch(`${PRINT_SERVER_URL}/print-receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        storeName,
        currency,
        transaction,
        headerMessage,
        footerMessage,
        logo: logo || undefined,
        translations: getTranslations(),
      }),
    });

    const data = await res.json();
    if (data.ok) {
      return { method: 'direct' };
    }
    // Server responded but printing failed — fall back
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
  try {
    const res = await fetch(`${PRINT_SERVER_URL}/print-repair-label`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ storeName, ticket, copies, translations: getTranslations() }),
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

  try {
    const pinSnippet = ticket.trackingPin || ticket.customerPhone?.slice(-4) || '';
    const trackingUrl = `${settingsState.trackingBaseUrl || `${window.location.origin}/track`}/${(ticket.ticketNumber || '').trim()}?pin=${pinSnippet}`;
    const res = await fetch(`${PRINT_SERVER_URL}/print-repair-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ storeName, currency, ticket: { ...ticket, trackingUrl }, logo: logo || undefined, translations: getTranslations() }),
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
  try {
    const res = await fetch(`${PRINT_SERVER_URL}/print-barcode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ storeName, currency, products }),
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
  items: { product: { name: string; model: string; price: number }; quantity: number }[];
  subtotal: number;
  total: number;
  payments: { method: string; amount: number }[];
}, storeName: string, receiptHeader?: string, receiptFooter?: string) {
    const { receiptHeader: defaultHeader, receiptFooter: defaultFooter } = useSettingsStore.getState();
    const activeHeader = receiptHeader || defaultHeader;
    const activeFooter = receiptFooter || defaultFooter || 'Thank you for your purchase!';

    const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  const itemsHTML = transaction.items.map(item => {
    const isReturn = Boolean(item.isReturn);
    const unitPrice = item.customReturnPrice ?? item.product.price;
    const lineTotal = unitPrice * item.quantity;
    return `
      <div style="display:flex;justify-content:space-between;padding:3px 0;">
        <span style="max-width:70%;">${isReturn ? '<strong style="color:#b45309;">[RETURN] </strong>' : ''}${item.quantity}x ${item.product.name} ${item.product.model}</span>
        <span style="${isReturn ? 'color:#dc2626;font-weight:600;' : ''}">${isReturn ? '-' : ''}${formatCurrency(lineTotal)}</span>
      </div>
    `;
  }).join('');

  const formatMethodName = (m: string) => {
    switch (m) {
      case 'debt': return 'CREDIT TAB (DETTE)';
      case 'store_credit': return 'STORE CREDIT (AVOIR)';
      case 'cash': return 'CASH';
      case 'card': return 'CARD';
      case 'mobile': return 'MOBILE';
      default: return m.toUpperCase();
    }
  };

  const paymentsText = transaction.payments
    .map(p => `${formatMethodName(p.method)} ${formatCurrency(p.amount)}`)
    .join(' + ');

  const logoDataUrl = useSettingsStore.getState().logoUrl || '';

  return `
    <div style="max-width:100%;margin:0 auto;">
      <div style="text-align:center;margin-bottom:16px;">
        ${logoDataUrl ? `<div style="text-align:center;margin-bottom:8px;"><img src="${logoDataUrl}" alt="Logo" style="max-width:200px;max-height:80px;object-fit:contain;" /></div>` : ''}
        <h2 style="font-size:20px;font-weight:700;margin-bottom:4px;">${storeName || 'PhoneShop'}</h2>
        ${activeHeader ? `<p style="font-size:12px;color:#666;margin:2px 0;">${activeHeader}</p>` : ''}
        <div style="border-top:1px dashed #999;margin:8px 0;"></div>
        <p style="font-size:12px;color:#666;">${formatDate(transaction.date)}</p>
        <p style="font-size:11px;color:#999;">Order: ${transaction.id}</p>
      </div>
      
      <div style="border-top:1px dashed #999;margin:8px 0;"></div>
      
      ${transaction.customerName ? `
        <div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;">
          <span>${i18n.t('ticket.customer', 'Customer:')}</span><span>${transaction.customerName}</span>
        </div>
      ` : ''}
      
      <div style="border-top:1px dashed #999;margin:8px 0;"></div>
      
      <div style="font-size:12px;font-weight:700;display:flex;justify-content:space-between;padding:4px 0;">
        <span>${i18n.t('ticket.item', 'Item')}</span><span>${i18n.t('ticket.price', 'Price')}</span>
      </div>
      ${itemsHTML}
      
      <div style="border-top:1px dashed #999;margin:8px 0;"></div>
      
      <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;">
        <span>${i18n.t('common.subtotal', 'Subtotal')}</span><span>${formatCurrency(transaction.subtotal)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:700;padding:8px 0;border-top:1px dashed #999;margin-top:4px;">
        <span>${i18n.t('common.total', 'Total')}</span><span>${formatCurrency(transaction.total)}</span>
      </div>
      
      <div style="border-top:1px dashed #999;margin:8px 0;"></div>
      
      <div style="text-align:center;font-size:12px;color:#666;">
        <p>${i18n.t('pos.payment', 'Payment:')} ${paymentsText}</p>
        <p style="margin-top:8px;font-weight:600;">${activeFooter}</p>
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
  try {
    const res = await fetch(`${PRINT_SERVER_URL}/print-z-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        storeName,
        currency,
        date: data.date,
        generatedBy: data.generatedBy,
        summary: data.summary,
        translations: getTranslations(),
      }),
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
          font-family: 'Courier New', Courier, monospace;
          color: #000;
        }
        .slip-container {
          width: 78mm;
          background: #ffffff;
          padding: 12px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          border: 1px solid #cbd5e1;
          border-radius: 4px;
        }
        .center { text-align: center; }
        .dashed { border-top: 1px dashed #000; margin: 8px 0; }
        .row { display: flex; justify-content: space-between; font-size: 11.5px; margin: 3px 0; }
        .bold { font-weight: bold; }
        @media print {
          body { background: #fff; padding: 0; }
          .slip-container { border: none; box-shadow: none; width: 100%; padding: 4px; }
          @page { size: 80mm auto; margin: 0; }
        }
      </style>
    </head>
    <body>
      <div class="slip-container">
        <div class="center">
          <h2 style="font-size:16px;font-weight:bold;text-transform:uppercase;">${activeStoreName}</h2>
          ${receiptHeader ? `<div style="font-size:11px;color:#444;margin-top:2px;">${receiptHeader}</div>` : ''}
          <div style="font-size:13px;font-weight:bold;margin:6px 0 2px 0;">${i18n.t('ticket.repairTicket', '*** REPAIR INTAKE TICKET ***')}</div>
          <div style="font-size:14px;font-weight:bold;letter-spacing:1px;">${ticketNum}</div>
          ${pinSnippet ? `<div style="font-size:12px;color:#333;margin-top:2px;font-weight:bold;">${i18n.t('ticket.pin', 'PIN:')} ${pinSnippet}</div>` : ''}
          <div style="font-size:10.5px;color:#555;margin-top:2px;">${formattedDate}</div>
        </div>

        <div class="dashed"></div>

        <div class="row"><span class="bold">${i18n.t('ticket.customer', 'Customer')}&nbsp;:&nbsp;</span><span>${ticket.customerName}</span></div>
        ${ticket.customerPhone ? `<div class="row"><span class="bold">${i18n.t('common.phone', 'Phone')}&nbsp;:&nbsp;</span><span>${ticket.customerPhone}</span></div>` : ''}

        <div class="dashed"></div>

        <div class="row"><span class="bold">${i18n.t('ticket.device', 'Device')}&nbsp;:&nbsp;</span><span>${ticket.deviceBrand} ${ticket.deviceModel}</span></div>
        <div class="row"><span class="bold">${i18n.t('ticket.security', 'Security')}&nbsp;:&nbsp;</span><span>${lockSnippet}</span></div>
        ${ticket.assignedTechnician ? `<div class="row"><span class="bold">${i18n.t('ticket.assignedTo', 'Technician')}&nbsp;:&nbsp;</span><span>${ticket.assignedTechnician}</span></div>` : ''}
        ${ticket.createdByName ? `<div class="row"><span class="bold">${i18n.t('ticket.intakeBy', 'Intake By')}&nbsp;:&nbsp;</span><span>${ticket.createdByName}</span></div>` : ''}

        <div class="dashed"></div>

        <div style="font-size:11.5px;margin:4px 0;">
          <div class="bold" style="margin-bottom:2px;">${i18n.t('ticket.issueDescription', 'Reported Problem:')}</div>
          <div style="font-style:italic;padding-left:4px;color:#222;">${ticket.issueDescription || i18n.t('ticket.diagnostic', 'Diagnostic required')}</div>
        </div>

        <div class="dashed"></div>

        <div class="row"><span>${i18n.t('ticket.estimatedCost', 'Estimated Cost')}&nbsp;:&nbsp;</span><span>${formatCurrencyWith(totalCost, currency, false)}</span></div>
        <div class="row"><span>${i18n.t('ticket.depositAmount', 'Deposit Paid')}&nbsp;:&nbsp;</span><span>${formatCurrencyWith(deposit, currency, false)}</span></div>
        <div class="row bold" style="font-size:13px;margin-top:4px;padding-top:4px;border-top:1px dashed #444;">
          <span>${i18n.t('ticket.balanceDue', 'BALANCE DUE')}&nbsp;:&nbsp;</span>
          <span>${balanceDue <= 0 ? i18n.t('ticket.paidInFull', 'PAID IN FULL') : formatCurrencyWith(balanceDue, currency, false)}</span>
        </div>

        <div class="dashed"></div>

        <div class="center" style="margin:8px 0 4px 0;">
          <div style="display:flex;justify-content:center;margin-bottom:4px;">${qrCodeSvg}</div>
          <div style="font-size:10px;font-weight:bold;letter-spacing:1px;margin-bottom:2px;">${i18n.t('ticket.scanTrack', 'Scan to track repair online')}</div>
          <div style="font-size:10px;letter-spacing:1px;color:#555;">${ticketNum}</div>
        </div>

        <div class="dashed"></div>

        <div class="center" style="font-size:9.5px;color:#444;line-height:1.3;margin-top:6px;">
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
  try {
    const res = await fetch(`${PRINT_SERVER_URL}/print-custom-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        storeName,
        currency,
        storeAddress,
        storePhone,
        ticketData,
        copies: ticketData.copies || 1,
      }),
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

