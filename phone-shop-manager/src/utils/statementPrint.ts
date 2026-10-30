import { openPrintWindow } from './printWindow';
import { useSettingsStore } from '../store/settingsStore';
import { formatCurrency } from './formatCurrency';
import type { Customer, CustomerDebtEntry, RepairTicket, SaleTransaction } from '../types';
import type { LedgerEvent } from '../features/customers/AccountStatementModal';

interface PrintOperationParams {
  event: LedgerEvent;
  customer: Customer;
  currentTotalDebt?: number;
}

/**
 * Builds and opens a thermal 80mm receipt paper containing EXACTLY
 * the operation done in this specific transaction.
 */
export function printOperationReceipt({
  event,
  customer,
  currentTotalDebt = 0,
}: PrintOperationParams) {
  const settings = useSettingsStore.getState();
  const storeName = settings.storeName || 'PhoneShop Pro';
  const storePhone = settings.storePhone || '';
  const storeAddress = settings.storeAddress || '';
  const logoUrl = settings.logoUrl || '';

  const customerDisplayName = customer.shopName || customer.name;
  const customerPhone = customer.phone || '';

  const formattedDate = new Date(event.date).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  let receiptTitle = "REÇU D'OPÉRATION";
  let operationDetailsHTML = '';
  let totalsHTML = '';

  // 1. REPAIR TICKET OPERATION
  if (event.rawTicket || event.type === 'repair') {
    const t = event.rawTicket;
    receiptTitle = "BON DE RÉPARATION & LIVRAISON";

    const deviceName = t ? `${t.deviceBrand || ''} ${t.deviceModel || ''}`.trim() : 'Appareil';
    const imei = t?.imei ? `(IMEI: ${t.imei})` : '';
    const issue = t?.issueDescription || event.description || 'Réparation / Maintenance';
    const statusText = t?.status === 'completed' ? 'TERMINÉ / LIVRÉ' : (t?.status?.toUpperCase() || 'LIVRÉ');

    const totalCost = t ? (t.actualCost ?? t.estimatedCost ?? event.debit) : event.debit;
    const depositPaid = t?.depositAmount || 0;
    const paidAmount = t?.paidAmount ?? (event.credit || totalCost);
    const remainingOnTicket = Math.max(0, totalCost - paidAmount);

    let partsHTML = '';
    if (t?.partsUsed && t.partsUsed.length > 0) {
      partsHTML = `
        <div style="margin-top:6px;padding-top:6px;border-top:1px dashed #d1d5db;">
          <div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;margin-bottom:3px;">Pièces installées :</div>
          ${t.partsUsed.map(p => `
            <div style="display:flex;justify-content:space-between;font-size:11px;padding:1px 0;">
              <span>• ${p.quantity}× ${p.name}</span>
              <span>${p.cost ? formatCurrency(p.cost * p.quantity) : '-'}</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    let notesHTML = '';
    if (t?.notes) {
      notesHTML = `
        <div style="margin-top:5px;font-size:10.5px;color:#4b5563;background:#f9fafb;padding:4px 6px;border-radius:4px;">
          <strong>Diagnostic / Remarque :</strong> ${t.notes}
        </div>
      `;
    }

    operationDetailsHTML = `
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;margin:8px 0;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-size:12.5px;font-weight:800;color:#111827;">${deviceName} ${imei}</span>
          <span style="font-size:9.5px;font-weight:700;background:#dcfce7;color:#15803d;padding:1px 6px;border-radius:3px;">${statusText}</span>
        </div>
        <div style="font-size:11.5px;color:#374151;margin-bottom:2px;">
          <strong>Travail effectué :</strong> ${issue}
        </div>
        ${partsHTML}
        ${notesHTML}
      </div>
    `;

    totalsHTML = `
      <div style="font-size:11.5px;font-variant-numeric:tabular-nums;line-height:1.5;">
        <div style="display:flex;justify-content:space-between;color:#4b5563;">
          <span>Coût de la réparation :</span>
          <strong>${formatCurrency(totalCost)}</strong>
        </div>
        ${depositPaid > 0 ? `
          <div style="display:flex;justify-content:space-between;color:#4b5563;">
            <span>Acompte versé à la réception :</span>
            <span>-${formatCurrency(depositPaid)}</span>
          </div>
        ` : ''}
        <div style="display:flex;justify-content:space-between;color:#15803d;font-weight:700;">
          <span>Montant payé (Encaissé) :</span>
          <span>${formatCurrency(paidAmount)}</span>
        </div>
        ${remainingOnTicket > 0 ? `
          <div style="display:flex;justify-content:space-between;color:#dc2626;font-weight:700;margin-top:2px;">
            <span>Reste à payer sur ce ticket :</span>
            <span>${formatCurrency(remainingOnTicket)}</span>
          </div>
        ` : `
          <div style="text-align:right;font-size:10.5px;color:#15803d;font-weight:700;margin-top:2px;">
            ✓ RÉGLÉ EN TOTALITÉ
          </div>
        `}
      </div>
    `;
  }
  // 2. POS SALE OR PARTS COMMERCIAL INVOICE
  else if (event.rawTransaction || event.type === 'invoice') {
    const tx = event.rawTransaction;
    receiptTitle = tx?.saleType === 'parts_b2b' ? "FACTURE COMMERCIALE PIÈCES" : "TICKET DE CAISSE / VENTE";

    const items = tx?.items || [];
    const itemsRows = items.map(it => `
      <div style="display:flex;justify-content:space-between;font-size:11.5px;padding:2px 0;">
        <span style="flex:1;padding-right:6px;"><strong>${it.quantity}×</strong> ${it.product.name} ${it.product.model || ''}</span>
        <span style="font-variant-numeric:tabular-nums;">${formatCurrency(it.unitPrice * it.quantity)}</span>
      </div>
    `).join('');

    operationDetailsHTML = `
      <div style="margin:8px 0;">
        <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;margin-bottom:4px;border-bottom:1px solid #f3f4f6;padding-bottom:2px;display:flex;justify-content:space-between;">
          <span>Article</span><span>Sous-total</span>
        </div>
        ${itemsRows || `<div style="font-size:11.5px;color:#374151;">${event.description}</div>`}
      </div>
    `;

    const total = tx?.total ?? event.debit;
    const paid = event.credit;
    const charged = Math.max(0, total - paid);

    totalsHTML = `
      <div style="font-size:11.5px;font-variant-numeric:tabular-nums;line-height:1.5;">
        <div style="display:flex;justify-content:space-between;color:#111827;font-weight:700;">
          <span>Total Vente :</span>
          <span>${formatCurrency(total)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;color:#15803d;">
          <span>Payé au comptant :</span>
          <span>-${formatCurrency(paid)}</span>
        </div>
        ${charged > 0 ? `
          <div style="display:flex;justify-content:space-between;color:#dc2626;font-weight:700;">
            <span>Ajouté au Carnet de Dette :</span>
            <span>+${formatCurrency(charged)}</span>
          </div>
        ` : ''}
      </div>
    `;
  }
  // 3. CREDIT TAB / DEBT ENTRY
  else if (event.rawDebt && !event.rawPayment) {
    const d = event.rawDebt;
    receiptTitle = "BON DE CARNET DE CRÉDIT (DETTE)";

    operationDetailsHTML = `
      <div style="background:#fefce8;border:1px solid #fef08a;border-radius:6px;padding:8px 10px;margin:8px 0;">
        <div style="font-size:12px;font-weight:700;color:#854d0e;">
          ${d.productOrService}
        </div>
        ${d.dueDate ? `
          <div style="font-size:11px;color:#a16207;margin-top:3px;">
            Échéance de paiement : <strong>${new Date(d.dueDate).toLocaleDateString('fr-FR')}</strong>
          </div>
        ` : ''}
        ${d.notes ? `
          <div style="font-size:10.5px;color:#713f12;margin-top:4px;">
            Note : ${d.notes}
          </div>
        ` : ''}
      </div>
    `;

    totalsHTML = `
      <div style="font-size:11.5px;font-variant-numeric:tabular-nums;line-height:1.5;">
        <div style="display:flex;justify-content:space-between;color:#111827;font-weight:700;">
          <span>Montant Initial de la Dette :</span>
          <span style="color:#dc2626;">+${formatCurrency(d.totalAmount)}</span>
        </div>
        ${d.amountPaid ? `
          <div style="display:flex;justify-content:space-between;color:#15803d;">
            <span>Acomptes déjà réglés :</span>
            <span>-${formatCurrency(d.amountPaid)}</span>
          </div>
        ` : ''}
        <div style="display:flex;justify-content:space-between;color:#dc2626;font-weight:800;border-top:1px dashed #d1d5db;padding-top:3px;margin-top:3px;">
          <span>Reste à payer sur ce bon :</span>
          <span>${formatCurrency(d.remainingAmount ?? (d.totalAmount - (d.amountPaid || 0)))}</span>
        </div>
      </div>
    `;
  }
  // 4. PAYMENT SETTLEMENT / VERSEMENT
  else {
    receiptTitle = "REÇU DE VERSEMENT / PAIEMENT";
    const pay = event.rawPayment;
    const methodStr = (event.method || pay?.method || 'CASH').toUpperCase();

    operationDetailsHTML = `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:8px 10px;margin:8px 0;">
        <div style="font-size:11.5px;color:#166534;margin-bottom:2px;">
          <strong>Règlement pour :</strong> ${event.rawDebt?.productOrService || event.description}
        </div>
        <div style="font-size:11px;color:#15803d;">
          Mode de règlement : <strong>${methodStr}</strong>
        </div>
        ${pay?.note ? `
          <div style="font-size:10.5px;color:#166534;margin-top:3px;">
            Note : ${pay.note}
          </div>
        ` : ''}
      </div>
    `;

    totalsHTML = `
      <div style="font-size:12px;font-variant-numeric:tabular-nums;line-height:1.5;">
        <div style="display:flex;justify-content:space-between;color:#15803d;font-size:13.5px;font-weight:800;background:#dcfce7;padding:4px 6px;border-radius:4px;">
          <span>MONTANT VERSÉ :</span>
          <span>${formatCurrency(event.credit || pay?.amount || 0)}</span>
        </div>
      </div>
    `;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>${receiptTitle} - ${event.refNumber}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          margin: 0;
          padding: 12px 6px;
          background: #f1f5f9;
          display: flex;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          color: #111827;
          font-size: 11.5px;
          line-height: 1.4;
        }
        .slip-container {
          width: 76mm;
          max-width: 100%;
          background: #ffffff;
          padding: 14px 12px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
          border: 1px solid #e5e7eb;
          border-radius: 6px;
        }
        .center { text-align: center; }
        .dashed { border: none; border-top: 1px dashed #d1d5db; margin: 8px 0; }
        .solid { border: none; border-top: 1.5px solid #111827; margin: 8px 0; }
        @media print {
          body { background: #fff; padding: 0; display: block; }
          .slip-container { border: none; box-shadow: none; width: 100%; padding: 4px; border-radius: 0; }
          @page { size: 80mm auto; margin: 2mm; }
        }
      </style>
    </head>
    <body>
      <div class="slip-container">
        <!-- Store Header -->
        <div class="center" style="margin-bottom:6px;">
          ${logoUrl ? `<img src="${logoUrl}" alt="Logo" style="max-width:130px;max-height:45px;object-fit:contain;margin-bottom:4px;" />` : ''}
          <h2 style="font-size:15px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;margin:0;color:#111827;">${storeName}</h2>
          ${storePhone ? `<p style="font-size:11px;color:#4b5563;margin:2px 0 0 0;">📞 ${storePhone}</p>` : ''}
          ${storeAddress ? `<p style="font-size:10.5px;color:#6b7280;margin:1px 0 0 0;">📍 ${storeAddress}</p>` : ''}
        </div>

        <div class="dashed"></div>

        <!-- Receipt Title & Ref -->
        <div class="center" style="margin:4px 0;">
          <div style="font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#1e293b;background:#f3f4f6;padding:3px 6px;border-radius:4px;display:inline-block;">
            ${receiptTitle}
          </div>
          <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,monospace;font-size:13px;font-weight:800;color:#0f172a;margin-top:3px;">
            ${event.refNumber}
          </div>
          <div style="font-size:10.5px;color:#6b7280;margin-top:2px;">
            ${formattedDate}
          </div>
        </div>

        <div class="dashed"></div>

        <!-- Customer Info -->
        <div style="font-size:11.5px;line-height:1.4;">
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#6b7280;">Client :</span>
            <strong style="color:#111827;">${customerDisplayName}</strong>
          </div>
          ${customerPhone ? `
            <div style="display:flex;justify-content:space-between;margin-top:1px;">
              <span style="color:#6b7280;">Téléphone :</span>
              <span style="color:#374151;">${customerPhone}</span>
            </div>
          ` : ''}
        </div>

        <div class="dashed"></div>

        <!-- Exact Operation Details -->
        <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">
          Détails de la Prestation / Opération :
        </div>
        ${operationDetailsHTML}

        <div class="dashed"></div>

        <!-- Financial Totals -->
        ${totalsHTML}

        <!-- Running / Customer Overall Balance -->
        <div style="margin-top:8px;padding-top:6px;border-top:1.5px solid #111827;display:flex;justify-content:space-between;align-items:center;font-size:12px;">
          <span style="font-weight:700;color:#4b5563;">SOLDE ACTUEL DU COMPTE :</span>
          <strong style="font-size:13.5px;color:${currentTotalDebt > 0 ? '#dc2626' : '#15803d'};">
            ${formatCurrency(currentTotalDebt)}
          </strong>
        </div>

        <div class="dashed"></div>

        <!-- Signatures Row -->
        <div style="display:flex;justify-content:space-between;margin-top:18px;font-size:10px;color:#6b7280;">
          <div style="width:45%;text-align:center;border-top:1px dashed #9ca3af;padding-top:4px;">
            Cachet Magasin
          </div>
          <div style="width:45%;text-align:center;border-top:1px dashed #9ca3af;padding-top:4px;">
            Signature Client
          </div>
        </div>

        <!-- Footer Notice -->
        <div class="center" style="margin-top:14px;font-size:10px;color:#9ca3af;line-height:1.4;">
          Merci de votre confiance !<br/>
          Veuillez conserver ce reçu pour tout suivi ou garantie.
        </div>
      </div>
    </body>
    </html>
  `;

  openPrintWindow(html, `Reçu - ${event.refNumber}`);
}
