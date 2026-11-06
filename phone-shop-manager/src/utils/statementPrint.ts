import { useSettingsStore } from '../store/settingsStore';
import { formatCurrency } from './formatCurrency';
import i18n from '../i18n';
import type { Customer } from '../types';
import type { LedgerEvent } from '../features/customers/AccountStatementModal';
import { errorMessage } from './errorUtils';
import { creditUnit, isReturnLine } from './saleEditLines';

const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;

const PRINT_SERVER_URL = (() => {
  if (electronAPI?.printServerUrl) return electronAPI.printServerUrl;
  if (import.meta.env.VITE_PRINT_SERVER_URL) return import.meta.env.VITE_PRINT_SERVER_URL;
  if (typeof window !== 'undefined' && window.location.hostname) {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.') || h.startsWith('10.') || h.startsWith('172.')) {
      return `http://${h}:3355`;
    }
  }
  return 'http://127.0.0.1:3355';
})();

export interface OperationReceiptItem {
  name: string;
  detail?: string;
  /** Units handed back off the invoice, as a positive number the surface draws with a −. */
  quantity: number;
  price: number;
  total: number;
  isReturn?: boolean;
}

export interface ReceiptPrintItem {
  product: { name?: string; model?: string; price?: number };
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
  customReturnPrice?: number;
  isReturn?: boolean;
}

export interface ReceiptPrintTransaction {
  id?: string;
  date?: string;
  customerName?: string;
  processedByName?: string;
  items: ReceiptPrintItem[];
  subtotal?: number;
  discount?: number | { type: 'percent' | 'flat'; value: number };
  total?: number;
  payments: { method: string; amount: number }[];
  status?: string;
}

export interface PrintServerReceiptPayload {
  storeName?: string;
  currency?: string;
  transaction?: ReceiptPrintTransaction | null;
  headerMessage?: string;
  footerMessage?: string;
  logo?: string;
}

export interface OperationReceiptPreviewData {
  storeName: string;
  storePhone?: string;
  storeAddress?: string;
  currency: string;
  logo?: string;
  headerMessage: string;
  footerMessage: string;
  referenceNumber: string;
  dateStr: string;
  customerDisplayName: string;
  customerPhone?: string;
  items: OperationReceiptItem[];
  subtotal: number;
  discount?: number;
  total: number;
  paidAmount: number;
  paymentMethod: string;
  currentTotalDebt: number;
  repairDetails?: {
    deviceBrand?: string;
    deviceModel?: string;
    imei?: string;
    issueDescription?: string;
    status?: string;
    intakeDate?: string;
    notes?: string;
  };
  debtDetails?: {
    productOrService?: string;
    dueDate?: string;
    notes?: string;
  };
  payload: PrintServerReceiptPayload;
}

interface BuildReceiptParams {
  event: LedgerEvent;
  customer: Customer;
  currentTotalDebt?: number;
}

/**
 * Constructs the complete preview data and print server payload for any operation.
 */
export function buildOperationReceiptData({
  event,
  customer,
  currentTotalDebt = 0,
}: BuildReceiptParams): OperationReceiptPreviewData {
  const settings = useSettingsStore.getState();
  const storeName = settings.storeName || 'PhoneShop Pro';
  const currency = settings.currency || 'DZD';
  const logo = settings.logoUrl || '';
  const storePhone = settings.storePhone || '';
  const storeAddress = settings.storeAddress || '';

  const customerDisplayName = customer.shopName || customer.name;
  const customerPhone = customer.phone || '';

  const lang = i18n.language || 'en';
  const locale = lang.startsWith('ar') ? 'ar-DZ' : lang.startsWith('fr') ? 'fr-FR' : 'en-US';

  let transactionData: ReceiptPrintTransaction | null = null;
  let headerMessage = i18n.t('statementModal.operationReceipt', "TRANSACTION RECEIPT");
  let footerMessage = `${i18n.t('statementModal.currentAccountBalance', 'Current Account Balance')} : ${formatCurrency(currentTotalDebt, !!currency)}\n${i18n.t('statementModal.thankYouTrust', 'Thank you for your business!')}`;
  const items: OperationReceiptItem[] = [];
  let subtotal = 0;
  let discount: number | undefined = undefined;
  let total = 0;
  let paidAmount = 0;
  let paymentMethod = i18n.t('statementModal.cashPayment', 'Cash');
  let repairDetails: OperationReceiptPreviewData['repairDetails'] = undefined;
  let debtDetails: OperationReceiptPreviewData['debtDetails'] = undefined;

  const dateStr = new Date(event.date).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  // 1. REPAIR TICKET
  if (event.rawTicket || event.type === 'repair') {
    const t = event.rawTicket;
    headerMessage = i18n.t('statementModal.repairDeliveryReceipt', 'REPAIR / DELIVERY RECEIPT');
    const totalCost = t ? (t.actualCost ?? t.estimatedCost ?? event.debit) : event.debit;
    paidAmount = t?.paidAmount ?? (event.credit || totalCost);
    total = totalCost;
    subtotal = totalCost;

    const deviceName = t ? `${t.deviceBrand || ''} ${t.deviceModel || ''}`.trim() : i18n.t('statementModal.device', 'Device');
    const issueSummary = t?.issueDescription ? `(${t.issueDescription})` : '';

    paymentMethod = paidAmount >= totalCost
      ? i18n.t('statementModal.cashPaid', 'CASH (PAID)')
      : (paidAmount > 0 ? i18n.t('statementModal.partialCredit', 'PARTIAL + CREDIT') : i18n.t('statementModal.creditTabReceipt', 'CREDIT TAB'));

    if (t) {
      repairDetails = {
        deviceBrand: t.deviceBrand,
        deviceModel: t.deviceModel,
        imei: t.imei,
        issueDescription: t.issueDescription,
        status: t.status,
        intakeDate: t.createdAt ? new Date(t.createdAt).toLocaleDateString(locale) : undefined,
        notes: t.notes,
      };
    }

    // Breakdown parts vs labor
    if (t?.partsUsed && t.partsUsed.length > 0) {
      let partsCostSum = 0;
      t.partsUsed.forEach(p => {
        const pCost = p.cost || 0;
        const pQty = p.quantity || 1;
        const lineTotal = pCost * pQty;
        partsCostSum += lineTotal;
        items.push({
          name: `${i18n.t('statementModal.partPrefix', 'Part:')} ${p.name}`,
          quantity: pQty,
          price: pCost,
          total: lineTotal,
        });
      });

      const laborCost = Math.max(0, totalCost - partsCostSum);
      items.unshift({
        name: deviceName,
        detail: `${issueSummary} - ${i18n.t('statementModal.labor', 'Labor')}`.trim(),
        quantity: 1,
        price: laborCost,
        total: laborCost,
      });
    } else {
      items.push({
        name: deviceName,
        detail: issueSummary,
        quantity: 1,
        price: totalCost,
        total: totalCost,
      });
    }

    transactionData = {
      id: t?.ticketNumber || event.refNumber,
      date: t?.completedAt || event.date,
      customerName: customerDisplayName,
      processedByName: t?.assignedTechnician || 'Atelier',
      items: items.map(it => ({
        product: { name: it.name, model: it.detail || '', price: it.price },
        quantity: it.quantity,
      })),
      subtotal: totalCost,
      total: totalCost,
      payments: [
        {
          method: paymentMethod,
          amount: paidAmount > 0 ? paidAmount : totalCost,
        },
      ],
      status: t?.status || 'completed',
    };
  }
  // 2. POS SALE OR WHOLESALE INVOICE
  else if (event.rawTransaction || event.type === 'invoice') {
    const tx = event.rawTransaction;
    headerMessage = tx?.saleType === 'parts_b2b'
      ? i18n.t('statementModal.commercialPartsInvoice', 'COMMERCIAL PARTS INVOICE')
      : i18n.t('statementModal.cashReceipt', 'POS CASH RECEIPT');

    if (tx) {
      subtotal = tx.subtotal;
      total = tx.total;
      discount = typeof tx.discount === 'number' ? tx.discount : undefined;
      paidAmount = tx.payments?.reduce((s, p) => s + (p.amount || 0), 0) || tx.total;
      paymentMethod = tx.payments && tx.payments.length > 0
        ? tx.payments.map(p => p.method.toUpperCase()).join(' + ')
        : 'CASH';

      tx.items.forEach(it => {
        const returned = isReturnLine(it);
        // A stored line carries `unitPrice` only once the receipt was corrected, so the
        // price the customer actually paid is the written one or the price on the goods.
        const unit = returned ? creditUnit(it) : (it.unitPrice ?? it.product?.price ?? 0);
        items.push({
          name: it.product?.name || i18n.t('statementModal.item', 'Item'),
          detail: it.product?.model || '',
          quantity: Math.abs(it.quantity),
          price: unit,
          total: Math.abs(it.totalPrice ?? unit * it.quantity),
          ...(returned ? { isReturn: true } : {}),
        });
      });

      transactionData = {
        id: tx.invoiceNumber || tx.id,
        date: tx.date,
        customerName: customerDisplayName,
        processedByName: tx.processedByName,
        items: tx.items,
        subtotal: tx.subtotal,
        discount: tx.discount,
        total: tx.total,
        payments: tx.payments && tx.payments.length > 0 ? tx.payments : [{ method: 'CASH', amount: tx.total }],
        status: tx.status,
      };
    } else {
      total = event.debit;
      subtotal = event.debit;
      paidAmount = event.credit || 0;
      paymentMethod = event.credit > 0 ? 'CASH' : i18n.t('statementModal.creditTabReceipt', 'CREDIT TAB');
      items.push({
        name: event.description,
        quantity: 1,
        price: event.debit,
        total: event.debit,
      });

      transactionData = {
        id: event.refNumber,
        date: event.date,
        customerName: customerDisplayName,
        items: [{ product: { name: event.description, model: '', price: event.debit }, quantity: 1 }],
        subtotal: event.debit,
        total: event.debit,
        payments: [{ method: paymentMethod, amount: paidAmount || event.debit }],
      };
    }
  }
  // 3. CREDIT TAB / DEBT ENTRY
  else if (event.rawDebt && !event.rawPayment) {
    const d = event.rawDebt;
    headerMessage = i18n.t('statementModal.creditTabReceipt', 'CREDIT TAB VOUCHER (DEBT)');
    const totalAmount = d.totalAmount || event.debit;
    subtotal = totalAmount;
    total = totalAmount;
    paidAmount = 0;
    paymentMethod = i18n.t('statementModal.creditTabReceipt', 'CREDIT TAB');

    debtDetails = {
      productOrService: d.productOrService,
      dueDate: d.dueDate ? new Date(d.dueDate).toLocaleDateString(locale) : undefined,
      notes: d.notes,
    };

    items.push({
      name: d.productOrService || i18n.t('statementModal.debtOnTab', 'Credit Tab Debt'),
      detail: d.dueDate ? `${i18n.t('statementModal.dueDatePrefix', 'Due Date:')} ${new Date(d.dueDate).toLocaleDateString(locale)}` : undefined,
      quantity: 1,
      price: totalAmount,
      total: totalAmount,
    });

    transactionData = {
      id: d.invoiceNumber || event.refNumber,
      date: d.date || d.createdAt || event.date,
      customerName: customerDisplayName,
      items: [
        {
          product: {
            name: d.productOrService || i18n.t('statementModal.debtOnTab', 'Credit Tab Debt'),
            model: d.dueDate ? `(${i18n.t('statementModal.dueDatePrefix', 'Due Date:')} ${new Date(d.dueDate).toLocaleDateString(locale)})` : '',
            price: totalAmount,
          },
          quantity: 1,
        },
      ],
      subtotal: totalAmount,
      total: totalAmount,
      payments: [
        { method: paymentMethod, amount: totalAmount },
      ],
    };
  }
  // 4. PAYMENT SETTLEMENT
  else {
    headerMessage = i18n.t('statementModal.paymentReceiptTitle', 'PAYMENT RECEIPT');
    const pay = event.rawPayment;
    const amount = event.credit || pay?.amount || 0;
    const methodStr = (event.method || pay?.method || 'CASH').toUpperCase();
    subtotal = amount;
    total = amount;
    paidAmount = amount;
    paymentMethod = methodStr;

    items.push({
      name: i18n.t('statementModal.paymentOnAccount', 'Payment / Settlement on Account'),
      detail: event.rawDebt?.productOrService ? `${i18n.t('statementModal.forPrefix', 'For:')} ${event.rawDebt.productOrService}` : undefined,
      quantity: 1,
      price: amount,
      total: amount,
    });

    transactionData = {
      id: event.refNumber,
      date: pay?.date || event.date,
      customerName: customerDisplayName,
      items: [
        {
          product: {
            name: i18n.t('statementModal.paymentOnAccount', 'Payment / Settlement on Account'),
            model: event.rawDebt?.productOrService ? `(${i18n.t('statementModal.forPrefix', 'For:')} ${event.rawDebt.productOrService})` : '',
            price: amount,
          },
          quantity: 1,
        },
      ],
      subtotal: amount,
      total: amount,
      payments: [
        { method: methodStr, amount },
      ],
    };
  }

  const payload = {
    storeName,
    currency,
    transaction: transactionData,
    headerMessage,
    footerMessage,
    logo: logo || undefined,
  };

  return {
    storeName,
    storePhone,
    storeAddress,
    currency,
    logo: logo || undefined,
    headerMessage,
    footerMessage,
    referenceNumber: event.refNumber,
    dateStr,
    customerDisplayName,
    customerPhone: customerPhone || undefined,
    items,
    subtotal,
    discount,
    total,
    paidAmount,
    paymentMethod,
    currentTotalDebt,
    repairDetails,
    debtDetails,
    payload,
  };
}

/**
 * Sends a structured receipt payload directly to the internal print server (ESC/POS thermal printer).
 */
export async function sendPayloadToPrintServer(
  payload: PrintServerReceiptPayload,
  toast?: {
    success: (title: string, message?: string) => void;
    error: (title: string, message?: string) => void;
  }
): Promise<{ success: boolean; error?: string }> {
  // ── 1. Priority: Direct Native Electron IPC (Inside macOS Desktop App) ──
  if (electronAPI?.printReceipt) {
    try {
      const data = await electronAPI.printReceipt(payload);
      if (data?.ok) {
        toast?.success(
          i18n.t('statementModal.receiptPrinted', 'Receipt Printed'),
          i18n.t('statementModal.receiptPrintedDesc', {
            id: payload.transaction?.id || '',
            defaultValue: `Ticket #${payload.transaction?.id || ''} printed on thermal printer.`,
          })
        );
        return { success: true };
      }
      console.warn('[Print Server IPC] error:', data?.error);
      toast?.error(
        i18n.t('statementModal.printerError', 'Printer Error'),
        data?.error || i18n.t('statementModal.printerErrorDesc', 'Print server returned an error.')
      );
      return { success: false, error: data?.error };
    } catch (e: unknown) {
      console.warn('[Print Server IPC] failed:', e);
      toast?.error(
        i18n.t('statementModal.printerError', 'Printer Error'),
        errorMessage(e) || i18n.t('statementModal.printerErrorDesc', 'Print server communication failed.')
      );
      return { success: false, error: errorMessage(e) };
    }
  }

  // ── 2. Fallback: Embedded Print Server via HTTP (port 3355) ──
  try {
    const res = await fetch(`${PRINT_SERVER_URL}/print-receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(6000),
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (data.ok) {
      toast?.success(
        i18n.t('statementModal.receiptPrinted', 'Receipt Printed'),
        i18n.t('statementModal.receiptPrintedDesc', {
          id: payload.transaction?.id || '',
          defaultValue: `Ticket #${payload.transaction?.id || ''} printed on thermal printer.`,
        })
      );
      return { success: true };
    }
    toast?.error(
      i18n.t('statementModal.printerError', 'Printer Error'),
      data.error || i18n.t('statementModal.printerErrorDesc', 'Print server error.')
    );
    return { success: false, error: data.error };
  } catch (err: unknown) {
    console.error('[Print Server Error]', err);
    toast?.error(
      i18n.t('statementModal.printerUnreachable', 'Print Server Unreachable'),
      i18n.t('statementModal.printerCheckConnection', 'Please verify that the thermal printer is connected.')
    );
    return { success: false, error: 'Serveur d\'impression non disponible.' };
  }
}

/**
 * Direct print function for customer statement operations.
 */
export async function printOperationReceipt({
  event,
  customer,
  currentTotalDebt = 0,
  toast,
}: {
  event: LedgerEvent;
  customer: Customer;
  currentTotalDebt?: number;
  toast?: {
    success: (title: string, message?: string) => void;
    error: (title: string, message?: string) => void;
  };
}): Promise<{ success: boolean; error?: string }> {
  const data = buildOperationReceiptData({ event, customer, currentTotalDebt });
  return sendPayloadToPrintServer(data.payload, toast);
}

/**
 * Builds formatted text suitable for sharing receipt via WhatsApp.
 */
export function buildReceiptWhatsAppText(data: OperationReceiptPreviewData): string {
  const lines = [
    `🧾 *${data.storeName.toUpperCase()}*`,
    `*${data.headerMessage}*`,
    `${i18n.t('statementModal.refPrefix', 'Ref:')} *#${data.referenceNumber}*`,
    `${i18n.t('common.date', 'Date')}: ${data.dateStr}`,
    `${i18n.t('statementModal.customerLabel', 'Customer:')} ${data.customerDisplayName}`,
    `────────────────────────`,
  ];

  if (data.repairDetails) {
    lines.push(`📱 *${i18n.t('statementModal.device', 'Device')}:* ${data.repairDetails.deviceBrand || ''} ${data.repairDetails.deviceModel || ''}`.trim());
    if (data.repairDetails.imei) lines.push(`🔢 *IMEI:* ${data.repairDetails.imei}`);
    if (data.repairDetails.issueDescription) lines.push(`🔧 *${i18n.t('statementModal.issueLabel', 'Issue:')}* ${data.repairDetails.issueDescription}`);
    if (data.repairDetails.status) lines.push(`📌 *${i18n.t('statementModal.status', 'Status:')}* ${data.repairDetails.status.toUpperCase()}`);
    lines.push(`────────────────────────`);
  }

  lines.push(`*${i18n.t('statementModal.serviceDetails', 'Service Details:')}*`);
  data.items.forEach(it => {
    const sign = it.isReturn ? '−' : '';
    lines.push(`• ${sign}${it.name}${it.detail ? ` (${it.detail})` : ''} x${sign}${it.quantity} — ${sign}${formatCurrency(it.total, !!data.currency)}${it.isReturn ? ` (${i18n.t('statementModal.returnedLine', 'returned')})` : ''}`);
  });

  lines.push(`────────────────────────`);
  lines.push(`*${i18n.t('statementModal.total', 'TOTAL:')}* *${formatCurrency(data.total, !!data.currency)}*`);
  lines.push(`*${i18n.t('statementModal.settlement', 'Settlement:')}* ${data.paymentMethod} (${formatCurrency(data.paidAmount, !!data.currency)})`);

  if (data.currentTotalDebt !== undefined) {
    lines.push(`────────────────────────`);
    lines.push(`*${i18n.t('statementModal.closingBalanceLabel', 'Total Balance Due')}:* *${formatCurrency(data.currentTotalDebt, !!data.currency)}*`);
  }

  lines.push(``);
  lines.push(data.footerMessage || i18n.t('statementModal.thankYouTrust', 'Thank you for your business!'));
  return lines.join('\n');
}
