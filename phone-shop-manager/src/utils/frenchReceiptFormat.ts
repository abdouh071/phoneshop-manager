import type { Customer, SaleTransaction } from '../types';
import { creditUnit, isReturnLine } from './saleEditLines';
import type { OperationReceiptPreviewData } from './statementPrint';

export interface UnifiedReceiptItem {
  label: string;
  qty: number;
  unitPrice: number;
  isReturn?: boolean;
}

export interface UnifiedReceiptData {
  storeName: string;
  storePhone: string;
  clientName: string;
  clientAddress: string;
  clientPhone: string;
  items: UnifiedReceiptItem[];
  articleCount: number;
  totalBeforeDiscount: number;
  discountAmount: number;
  netPayable: number;
  previousBalance: number;
  purchaseTotal: number;
  paymentAmount: number;
  newBalance: number;
  ticketCode: string;
  formattedDate: string;
  cashierName: string;
  status?: string;
}

export interface ReceiptSettingsInfo {
  storeName?: string;
  storePhone?: string;
}

export const FRENCH_RECEIPT_LABELS = {
  clientPrefix: 'Client :',
  libelle: 'LIBELLE',
  qte: 'QTE',
  pu: 'P.U',
  nbreArticle: 'NBRE ARTICLE :',
  total: 'TOTAL :',
  remise: 'REMISE :',
  ttcAPayer: 'TTC A PAYER:',
  ancSolde: 'Anc. solde:',
  totalAchat: 'Total achat:',
  versement: 'Versement :',
  nouvSolde: 'Nouv. solde:',
  ticketPrefix: 'Ticket :',
  caissierPrefix: 'Caissier :',
} as const;

const round2 = (n: number): number => {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  const rounded = Math.round(num * 100) / 100;
  return Object.is(rounded, -0) || Math.abs(rounded) < 0.005 ? 0 : rounded;
};

/**
 * Formats numbers using space-separated thousands and 2 fixed decimals
 * without currency suffix (e.g. `38000` -> `38 000.00`, `0` -> `0.00`).
 */
export function formatReceiptAmount(amount: number): string {
  const clean = round2(amount);
  const sign = clean < 0 ? '-' : '';
  const absFixed = Math.abs(clean).toFixed(2);
  const [intPart, decPart] = absFixed.split('.');
  const spacedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${spacedInt}.${decPart}`;
}

/**
 * Formats an ISO timestamp into `DD/MM/YYYY-HH:MM:SS` (e.g. `24/11/2026-12:46:22`).
 */
export function formatReceiptDateTime(isoString?: string): string {
  const d = isoString ? new Date(isoString) : new Date();
  const valid = Number.isNaN(d.getTime()) ? new Date() : d;
  const dd = String(valid.getDate()).padStart(2, '0');
  const mm = String(valid.getMonth() + 1).padStart(2, '0');
  const yyyy = valid.getFullYear();
  const hh = String(valid.getHours()).padStart(2, '0');
  const min = String(valid.getMinutes()).padStart(2, '0');
  const ss = String(valid.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy}-${hh}:${min}:${ss}`;
}

/**
 * Normalizes an invoice or reference ID into a compact printable Code128 / ticket number
 * that fits on an 80mm thermal row next to `DD/MM/YYYY-HH:MM:SS`.
 */
export function formatTicketCode(rawRef?: string, fallbackId?: string): string {
  const candidate = (rawRef || fallbackId || '000001').trim();
  // Strip verbose leading prefixes so daily counter references (e.g. INV-261126-0001) fit cleanly
  let clean = candidate.replace(/^INV-(?:PARTS-)?/i, '');
  clean = clean.replace(/[^\x20-\x7E]/g, '');
  if (clean.length > 20) {
    clean = clean.slice(-10);
  }
  return clean || '000001';
}

export interface ReceiptDiscountSource {
  subtotal: number;
  total: number;
  discount?: { type: 'percent' | 'flat'; value: number } | number;
  exchangeSummary?: { purchasedTotal: number; returnedTotal: number };
}

/**
 * Computes flat discount amount cleanly across UI previews, HTML fallback, and ESC/POS server.
 */
export function computeSaleDiscount(tx: ReceiptDiscountSource): number {
  const { subtotal, total, discount, exchangeSummary } = tx;
  if (typeof discount === 'number' && discount > 0) {
    return round2(discount);
  }
  if (discount && typeof discount === 'object' && Number(discount.value) > 0) {
    const base = exchangeSummary?.purchasedTotal ?? subtotal;
    return discount.type === 'percent'
      ? round2((base * Number(discount.value)) / 100)
      : round2(Number(discount.value));
  }
  if (!exchangeSummary && subtotal > total && total >= 0) {
    return round2(subtotal - total);
  }
  return 0;
}

export type SaleReceiptInput = Pick<
  SaleTransaction,
  | 'id'
  | 'date'
  | 'items'
  | 'subtotal'
  | 'total'
  | 'payments'
  | 'discount'
  | 'customerName'
  | 'customerPhone'
  | 'customerAddress'
  | 'customerId'
  | 'invoiceNumber'
  | 'processedByName'
  | 'status'
  | 'accountSettlement'
  | 'exchangeSummary'
  | 'balanceSnapshot'
>;

/**
 * Derives `Anc. solde`, `Total achat`, `Versement`, and `Nouv. solde` for a sale transaction,
 * preferring the immutable checkout `balanceSnapshot` when present.
 */
export function resolveSaleBalanceSummary(
  transaction: SaleReceiptInput,
  customerLookup?: Pick<Customer, 'totalDebt' | 'debt'> | null
): {
  previousBalance: number;
  purchaseTotal: number;
  paymentAmount: number;
  newBalance: number;
} {
  if (transaction.balanceSnapshot) {
    return {
      previousBalance: round2(transaction.balanceSnapshot.previousBalance),
      purchaseTotal: round2(transaction.balanceSnapshot.purchaseTotal),
      paymentAmount: round2(transaction.balanceSnapshot.paymentAmount),
      newBalance: round2(transaction.balanceSnapshot.newBalance),
    };
  }

  const purchaseTotal = round2(transaction.total);
  const isVoided = transaction.status === 'refunded' || transaction.status === 'voided';
  let paidNow = 0;

  if (!isVoided) {
    if (transaction.accountSettlement) {
      paidNow = round2(transaction.accountSettlement.paidAmount || 0);
    } else if (Array.isArray(transaction.payments) && transaction.payments.length > 0) {
      paidNow = round2(
        transaction.payments
          .filter(p => p.method !== 'debt')
          .reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
      );
    } else {
      paidNow = purchaseTotal;
    }
  }

  const chargedOnThisTx = isVoided ? 0 : Math.max(0, round2(purchaseTotal - paidNow));
  if (customerLookup) {
    const currentDebt = Math.max(0, round2(customerLookup.totalDebt ?? customerLookup.debt ?? chargedOnThisTx));
    const prevDebt = Math.max(0, round2(currentDebt - chargedOnThisTx));
    return {
      previousBalance: prevDebt,
      purchaseTotal,
      paymentAmount: paidNow,
      newBalance: currentDebt,
    };
  }

  return {
    previousBalance: 0,
    purchaseTotal,
    paymentAmount: paidNow,
    newBalance: chargedOnThisTx,
  };
}

/**
 * Converts a POS/history `SaleTransaction` into the unified French receipt model.
 */
export function buildUnifiedReceiptFromSale(
  transaction: SaleReceiptInput,
  settings: ReceiptSettingsInfo,
  customerLookup?: Customer | null
): UnifiedReceiptData {
  const items: UnifiedReceiptItem[] = (transaction.items || []).map(item => {
    const returned = isReturnLine(item);
    const unitPrice = returned
      ? creditUnit(item)
      : (item.customReturnPrice ?? item.unitPrice ?? item.price ?? item.product?.price ?? 0);
    const baseName = item.product?.name
      ? `${item.product.name} ${item.product.model || ''}`.trim()
      : (item.productName || 'Article');
    const qty = Math.abs(Number(item.quantity) || 1);
    return {
      label: returned ? `[RETOUR] ${baseName}` : baseName,
      qty: returned ? -qty : qty,
      unitPrice: round2(unitPrice),
      isReturn: returned,
    };
  });

  const discountAmount = computeSaleDiscount(transaction);
  const balance = resolveSaleBalanceSummary(transaction, customerLookup);

  return {
    storeName: (settings.storeName || 'PhoneShop Pro').toUpperCase(),
    storePhone: (settings.storePhone || '').trim(),
    clientName: (transaction.customerName || customerLookup?.shopName || customerLookup?.name || 'Client comptoir').trim(),
    clientAddress: (transaction.customerAddress || customerLookup?.address || '').trim(),
    clientPhone: (transaction.customerPhone || customerLookup?.phone || '').trim(),
    items,
    articleCount: items.length,
    totalBeforeDiscount: round2(transaction.subtotal),
    discountAmount,
    netPayable: round2(transaction.total),
    previousBalance: balance.previousBalance,
    purchaseTotal: balance.purchaseTotal,
    paymentAmount: balance.paymentAmount,
    newBalance: balance.newBalance,
    ticketCode: formatTicketCode(transaction.invoiceNumber, transaction.id),
    formattedDate: formatReceiptDateTime(transaction.date),
    cashierName: (transaction.processedByName || 'VENDEUR').trim(),
    status: transaction.status,
  };
}

/**
 * Converts a Customer Account Statement / Debt Payment operation preview into
 * the unified French receipt model. Pure debt payments render as `credit | 1 | 0.00`
 * with `Anc. solde`, `Total achat: 0.00`, `Versement`, and `Nouv. solde`.
 */
export function buildUnifiedReceiptFromOperation(
  data: OperationReceiptPreviewData,
  options?: {
    clientAddress?: string;
    rawDateIso?: string;
    cashierName?: string;
    isCreditPayment?: boolean;
    previousBalance?: number;
    purchaseTotal?: number;
    paymentAmount?: number;
    newBalance?: number;
  }
): UnifiedReceiptData {
  const isCreditPayment = options?.isCreditPayment ?? false;

  const items: UnifiedReceiptItem[] = isCreditPayment
    ? [{ label: 'credit', qty: 1, unitPrice: 0 }]
    : data.items.map(it => ({
        label: it.isReturn ? `[RETOUR] ${it.name}` : (it.detail ? `${it.name} ${it.detail}` : it.name),
        qty: it.isReturn ? -Math.abs(it.quantity || 1) : (it.quantity || 1),
        unitPrice: round2(it.price),
        isReturn: it.isReturn,
      }));

  const purchaseTotal = round2(
    options?.purchaseTotal ?? (isCreditPayment ? 0 : data.total)
  );
  const paymentAmount = round2(options?.paymentAmount ?? data.paidAmount);
  const newBalance = round2(options?.newBalance ?? data.currentTotalDebt);
  const previousBalance = round2(
    options?.previousBalance ?? Math.max(0, newBalance + paymentAmount - purchaseTotal)
  );

  return {
    storeName: (data.storeName || 'PhoneShop Pro').toUpperCase(),
    storePhone: (data.storePhone || '').trim(),
    clientName: (data.customerDisplayName || 'Client comptoir').trim(),
    clientAddress: (options?.clientAddress || '').trim(),
    clientPhone: (data.customerPhone || '').trim(),
    items,
    articleCount: items.length,
    totalBeforeDiscount: isCreditPayment ? 0 : round2(data.subtotal),
    discountAmount: isCreditPayment ? 0 : round2(data.discount || 0),
    netPayable: isCreditPayment ? 0 : round2(data.total),
    previousBalance,
    purchaseTotal,
    paymentAmount,
    newBalance,
    ticketCode: formatTicketCode(data.referenceNumber),
    formattedDate: formatReceiptDateTime(options?.rawDateIso || data.payload?.transaction?.date),
    cashierName: (options?.cashierName || data.payload?.transaction?.processedByName || 'VENDEUR').trim(),
  };
}
