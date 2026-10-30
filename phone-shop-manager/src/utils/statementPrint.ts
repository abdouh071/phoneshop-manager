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

interface PrintOperationParams {
  event: LedgerEvent;
  customer: Customer;
  currentTotalDebt?: number;
  toast?: {
    success: (title: string, message?: string) => void;
    error: (title: string, message?: string) => void;
  };
}

/**
 * Direct print function for customer statement operations.
 * Sends the ticket exclusively to the local print server / Electron IPC.
 * Strictly executes via the thermal printer; does NOT open the browser print dialog.
 */
export async function printOperationReceipt({
  event,
  customer,
  currentTotalDebt = 0,
  toast,
}: PrintOperationParams): Promise<{ success: boolean; error?: string }> {
  const settings = useSettingsStore.getState();
  const storeName = settings.storeName || 'PhoneShop Pro';
  const currency = settings.currency || 'DZD';
  const logo = settings.logoUrl || '';

  const customerDisplayName = customer.shopName || customer.name;

  let transactionData: any = null;
  let headerMessage = "REÇU D'OPÉRATION";
  let footerMessage = `Solde actuel du compte : ${formatCurrency(currentTotalDebt)}\nMerci de votre confiance !`;

  // 1. REPAIR TICKET
  if (event.rawTicket || event.type === 'repair') {
    const t = event.rawTicket;
    headerMessage = 'REÇU DE RÉPARATION / LIVRAISON';
    const totalCost = t ? (t.actualCost ?? t.estimatedCost ?? event.debit) : event.debit;
    const paidAmount = t?.paidAmount ?? (event.credit || totalCost);

    const deviceName = t ? `${t.deviceBrand || ''} ${t.deviceModel || ''}`.trim() : 'Appareil';
    const issueSummary = t?.issueDescription ? `(${t.issueDescription})` : '';

    const items: any[] = [];

    // If parts were used, break them down
    if (t?.partsUsed && t.partsUsed.length > 0) {
      let partsCostSum = 0;
      t.partsUsed.forEach(p => {
        const pCost = p.cost || 0;
        const pQty = p.quantity || 1;
        partsCostSum += pCost * pQty;
        items.push({
          product: { name: `Pièce: ${p.name}`, model: '', price: pCost },
          quantity: pQty,
        });
      });

      const laborCost = Math.max(0, totalCost - partsCostSum);
      items.unshift({
        product: { name: deviceName, model: `${issueSummary} - Main d'œuvre`.trim(), price: laborCost },
        quantity: 1,
      });
    } else {
      items.push({
        product: { name: deviceName, model: issueSummary, price: totalCost },
        quantity: 1,
      });
    }

    transactionData = {
      id: t?.ticketNumber || event.refNumber,
      date: t?.completedAt || event.date,
      customerName: customerDisplayName,
      processedByName: t?.assignedTechnician || 'Atelier',
      items,
      subtotal: totalCost,
      total: totalCost,
      payments: [
        {
          method: paidAmount >= totalCost ? 'CASH' : (paidAmount > 0 ? 'PARTIEL' : 'CARNET DETTE'),
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
      transactionData = {
        id: event.refNumber,
        date: event.date,
        customerName: customerDisplayName,
        items: [{ product: { name: event.description, model: '', price: event.debit }, quantity: 1 }],
        subtotal: event.debit,
        total: event.debit,
        payments: [{ method: event.credit > 0 ? 'CASH' : 'CARNET DETTE', amount: event.credit || event.debit }],
      };
    }
  }
  // 3. CREDIT TAB / DEBT ENTRY
  else if (event.rawDebt && !event.rawPayment) {
    const d = event.rawDebt;
    headerMessage = 'BON DE CARNET DE CRÉDIT (DETTE)';
    const totalAmount = d.totalAmount || event.debit;

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

  // ── 1. Priority: Direct Native Electron IPC (Inside macOS Desktop App) ──
  if (electronAPI?.printReceipt) {
    try {
      const data = await electronAPI.printReceipt(payload);
      if (data?.ok) {
        toast?.success(
          'Reçu imprimé',
          `Ticket #${transactionData.id} imprimé sur l'imprimante thermique.`
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
        `Ticket #${transactionData.id} imprimé sur l'imprimante thermique.`
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
