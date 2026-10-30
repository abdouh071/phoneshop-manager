import { useSettingsStore } from '../store/settingsStore';
import { formatCurrency } from './formatCurrency';
import type { Customer, CustomerDebtEntry, RepairTicket, SaleTransaction } from '../types';
import type { LedgerEvent } from '../features/customers/AccountStatementModal';

const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;

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
  quantity: number;
  price: number;
  total: number;
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
  payload: any;
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

  let transactionData: any = null;
  let headerMessage = "REÇU D'OPÉRATION";
  let footerMessage = `Solde actuel du compte : ${formatCurrency(currentTotalDebt, currency)}\nMerci de votre confiance !`;
  const items: OperationReceiptItem[] = [];
  let subtotal = 0;
  let discount: number | undefined = undefined;
  let total = 0;
  let paidAmount = 0;
  let paymentMethod = 'ESPÈCES';
  let repairDetails: OperationReceiptPreviewData['repairDetails'] = undefined;
  let debtDetails: OperationReceiptPreviewData['debtDetails'] = undefined;

  const dateStr = new Date(event.date).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  // 1. REPAIR TICKET
  if (event.rawTicket || event.type === 'repair') {
    const t = event.rawTicket;
    headerMessage = 'REÇU DE RÉPARATION / LIVRAISON';
    const totalCost = t ? (t.actualCost ?? t.estimatedCost ?? event.debit) : event.debit;
    paidAmount = t?.paidAmount ?? (event.credit || totalCost);
    total = totalCost;
    subtotal = totalCost;

    const deviceName = t ? `${t.deviceBrand || ''} ${t.deviceModel || ''}`.trim() : 'Appareil';
    const issueSummary = t?.issueDescription ? `(${t.issueDescription})` : '';

    paymentMethod = paidAmount >= totalCost ? 'CASH (COMPTANT)' : (paidAmount > 0 ? 'PARTIEL + CRÉDIT' : 'CARNET DETTE');

    if (t) {
      repairDetails = {
        deviceBrand: t.deviceBrand,
        deviceModel: t.deviceModel,
        imei: t.imei,
        issueDescription: t.issueDescription,
        status: t.status,
        intakeDate: t.createdAt ? new Date(t.createdAt).toLocaleDateString('fr-FR') : undefined,
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
          name: `Pièce: ${p.name}`,
          quantity: pQty,
          price: pCost,
          total: lineTotal,
        });
      });

      const laborCost = Math.max(0, totalCost - partsCostSum);
      items.unshift({
        name: deviceName,
        detail: `${issueSummary} - Main d'œuvre`.trim(),
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
    headerMessage = tx?.saleType === 'parts_b2b' ? 'FACTURE COMMERCIALE PIÈCES' : 'TICKET DE CAISSE';

    if (tx) {
      subtotal = tx.subtotal;
      total = tx.total;
      discount = typeof tx.discount === 'number' ? tx.discount : undefined;
      paidAmount = tx.payments?.reduce((s, p) => s + (p.amount || 0), 0) || tx.total;
      paymentMethod = tx.payments && tx.payments.length > 0
        ? tx.payments.map(p => p.method.toUpperCase()).join(' + ')
        : 'CASH';

      tx.items.forEach(it => {
        items.push({
          name: it.product?.name || 'Article',
          detail: it.product?.model || '',
          quantity: it.quantity,
          price: it.unitPrice,
          total: it.totalPrice,
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
      paymentMethod = event.credit > 0 ? 'CASH' : 'CARNET DETTE';
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
    headerMessage = 'BON DE CARNET DE CRÉDIT (DETTE)';
    const totalAmount = d.totalAmount || event.debit;
    subtotal = totalAmount;
    total = totalAmount;
    paidAmount = 0;
    paymentMethod = 'CARNET DE CRÉDIT';

    debtDetails = {
      productOrService: d.productOrService,
      dueDate: d.dueDate ? new Date(d.dueDate).toLocaleDateString('fr-FR') : undefined,
      notes: d.notes,
    };

    items.push({
      name: d.productOrService || 'Dette au carnet',
      detail: d.dueDate ? `Échéance: ${new Date(d.dueDate).toLocaleDateString('fr-FR')}` : undefined,
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
            name: d.productOrService || 'Dette au carnet',
            model: d.dueDate ? `(Échéance: ${new Date(d.dueDate).toLocaleDateString('fr-FR')})` : '',
            price: totalAmount,
          },
          quantity: 1,
        },
      ],
      subtotal: totalAmount,
      total: totalAmount,
      payments: [
        { method: 'CARNET DE CRÉDIT', amount: totalAmount },
      ],
    };
  }
  // 4. PAYMENT SETTLEMENT
  else {
    headerMessage = 'REÇU DE VERSEMENT / PAIEMENT';
    const pay = event.rawPayment;
    const amount = event.credit || pay?.amount || 0;
    const methodStr = (event.method || pay?.method || 'CASH').toUpperCase();
    subtotal = amount;
    total = amount;
    paidAmount = amount;
    paymentMethod = methodStr;

    items.push({
      name: 'Règlement / Versement en compte',
      detail: event.rawDebt?.productOrService ? `Pour: ${event.rawDebt.productOrService}` : undefined,
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
            name: 'Règlement / Versement en compte',
            model: event.rawDebt?.productOrService ? `(Pour: ${event.rawDebt.productOrService})` : '',
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
  payload: any,
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
          'Reçu imprimé',
          `Ticket #${payload.transaction?.id || ''} imprimé sur l'imprimante thermique.`
        );
        return { success: true };
      }
      console.warn('[Print Server IPC] error:', data?.error);
      toast?.error(
        'Erreur imprimante',
        data?.error || 'Le serveur d\'impression a renvoyé une erreur.'
      );
      return { success: false, error: data?.error };
    } catch (e: any) {
      console.warn('[Print Server IPC] failed:', e);
      toast?.error('Erreur imprimante', e?.message || 'Échec de communication avec l\'imprimante.');
      return { success: false, error: e?.message };
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
        'Reçu imprimé',
        `Ticket #${payload.transaction?.id || ''} imprimé sur l'imprimante thermique.`
      );
      return { success: true };
    }
    toast?.error('Erreur imprimante', data.error || 'Erreur serveur d\'impression.');
    return { success: false, error: data.error };
  } catch (err: any) {
    console.error('[Print Server Error]', err);
    toast?.error(
      'Serveur d\'impression inaccessible',
      'Veuillez vérifier que l\'imprimante thermique est connectée.'
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
    `Réf: *#${data.referenceNumber}*`,
    `Date: ${data.dateStr}`,
    `Client: ${data.customerDisplayName}`,
    `────────────────────────`,
  ];

  if (data.repairDetails) {
    lines.push(`📱 *Appareil:* ${data.repairDetails.deviceBrand || ''} ${data.repairDetails.deviceModel || ''}`.trim());
    if (data.repairDetails.imei) lines.push(`🔢 *IMEI:* ${data.repairDetails.imei}`);
    if (data.repairDetails.issueDescription) lines.push(`🔧 *Panne:* ${data.repairDetails.issueDescription}`);
    if (data.repairDetails.status) lines.push(`📌 *Statut:* ${data.repairDetails.status.toUpperCase()}`);
    lines.push(`────────────────────────`);
  }

  lines.push(`*Détails des prestations :*`);
  data.items.forEach(it => {
    lines.push(`• ${it.name}${it.detail ? ` (${it.detail})` : ''} x${it.quantity} — ${formatCurrency(it.total, data.currency)}`);
  });

  lines.push(`────────────────────────`);
  lines.push(`*Total:* *${formatCurrency(data.total, data.currency)}*`);
  lines.push(`*Règlement:* ${data.paymentMethod} (${formatCurrency(data.paidAmount, data.currency)})`);

  if (data.currentTotalDebt !== undefined) {
    lines.push(`────────────────────────`);
    lines.push(`*Solde actuel restant dû:* *${formatCurrency(data.currentTotalDebt, data.currency)}*`);
  }

  lines.push(``);
  lines.push(data.footerMessage || 'Merci de votre confiance !');
  return lines.join('\n');
}
