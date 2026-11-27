import React from 'react';
import Barcode from 'react-barcode';
import {
  formatReceiptAmount,
  FRENCH_RECEIPT_LABELS,
  type UnifiedReceiptData,
} from '../../utils/frenchReceiptFormat';
import styles from './FrenchThermalReceipt.module.css';

interface FrenchThermalReceiptProps {
  data: UnifiedReceiptData;
  className?: string;
}

/**
 * Shared 80mm thermal receipt layout matching the French POS slip style.
 * Used across POS checkout, Transaction History reprints, Customer Operation
 * previews, and post-payment debt settlement tickets.
 */
export const FrenchThermalReceipt: React.FC<FrenchThermalReceiptProps> = ({ data, className }) => {
  const L = FRENCH_RECEIPT_LABELS;

  return (
    <div className={[styles.paper, 'printable-receipt', className].filter(Boolean).join(' ')}>
      <div className={styles.dashedRule} />

      {/* Store Header */}
      <div className={styles.storeHeader}>
        <div className={styles.storeName}>{data.storeName || 'PHONESHOP PRO'}</div>
        {data.storePhone && <div className={styles.storePhone}>{data.storePhone}</div>}
      </div>

      {/* Centered Client Block */}
      <div className={styles.clientBlock}>
        <div>
          {L.clientPrefix}
          {data.clientName || 'Client comptoir'}
        </div>
        {data.clientAddress && <div>{data.clientAddress}</div>}
        {data.clientPhone && <div className={styles.tabular}>{data.clientPhone}</div>}
      </div>

      {/* Optional Refund Status */}
      {data.status === 'refunded' && (
        <div className={styles.statusNotice} data-variant="danger">
          *** REMBOURSE ***
        </div>
      )}
      {data.status === 'partially_refunded' && (
        <div className={styles.statusNotice} data-variant="warning">
          *** RETOUR PARTIEL ***
        </div>
      )}

      <div className={styles.dashedRule} />

      {/* 3-Column Items Table */}
      <table className={styles.itemsTable}>
        <thead>
          <tr>
            <th className={styles.colLibelle}>{L.libelle}</th>
            <th className={styles.colQte}>{L.qte}</th>
            <th className={styles.colPu}>{L.pu}</th>
          </tr>
        </thead>
        <tbody>
          <tr className={styles.headerRuleRow}>
            <td colSpan={3}>
              <div className={styles.dashedRule} />
            </td>
          </tr>
          {data.items.map((item, idx) => {
            const puDisplay = item.isReturn && item.unitPrice > 0
              ? `-${formatReceiptAmount(Math.abs(item.unitPrice))}`
              : formatReceiptAmount(item.unitPrice);
            return (
              <tr key={`${item.label}-${idx}`} className={styles.itemRow}>
                <td className={styles.cellLibelle}>{item.label}</td>
                <td className={styles.cellQte}>{item.qty}</td>
                <td className={styles.cellPu}>{puDisplay}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className={styles.dashedRule} />

      {/* NBRE ARTICLE + Totals Block */}
      <div className={styles.totalsSplit}>
        <div className={styles.articleCount}>
          {L.nbreArticle} {data.articleCount}
        </div>
        <table className={styles.amountsTable}>
          <tbody>
            <tr>
              <td className={styles.amountLabel}>{L.total}</td>
              <td className={styles.amountValue}>{formatReceiptAmount(data.totalBeforeDiscount)}</td>
            </tr>
            <tr>
              <td className={styles.amountLabel}>{L.remise}</td>
              <td className={styles.amountValue}>{formatReceiptAmount(data.discountAmount)}</td>
            </tr>
            <tr>
              <td className={styles.amountLabel}>{L.ttcAPayer}</td>
              <td className={styles.amountValue}>{formatReceiptAmount(data.netPayable)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className={styles.dashedRule} />

      {/* Customer Solde / Balance Summary */}
      <div className={styles.balanceWrap}>
        <table className={styles.amountsTable}>
          <tbody>
            <tr>
              <td className={styles.balanceLabel}>{L.ancSolde}</td>
              <td className={styles.balanceValueBold}>{formatReceiptAmount(data.previousBalance)}</td>
            </tr>
            <tr>
              <td className={styles.balanceLabel}>{L.totalAchat}</td>
              <td className={styles.balanceValue}>{formatReceiptAmount(data.purchaseTotal)}</td>
            </tr>
            <tr>
              <td className={styles.balanceLabel}>{L.versement}</td>
              <td className={styles.balanceValueBold}>{formatReceiptAmount(data.paymentAmount)}</td>
            </tr>
            <tr>
              <td className={styles.balanceLabel}>{L.nouvSolde}</td>
              <td className={styles.balanceValueBold}>{formatReceiptAmount(data.newBalance)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className={styles.dashedRule} />

      {/* Centered Code128 Barcode + Ticket Number */}
      <div className={styles.barcodeBlock}>
        <div className={styles.barcodeSvgWrap}>
          <Barcode
            value={data.ticketCode || '000001'}
            format="CODE128"
            renderer="svg"
            width={1.55}
            height={42}
            margin={0}
            displayValue={false}
            background="transparent"
            lineColor="#111111"
          />
        </div>
        <div className={styles.barcodeDigits}>{data.ticketCode}</div>
      </div>

      {/* Footer Meta + Cashier */}
      <div className={styles.footerMeta}>
        <span>
          {L.ticketPrefix} {data.ticketCode}
        </span>
        <span>{data.formattedDate}</span>
      </div>

      <div className={styles.cashierLine}>
        {L.caissierPrefix} {data.cashierName || 'VENDEUR'}
      </div>
    </div>
  );
};
