import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, MessageCircle } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatWhatsAppUrl } from '../../utils/phoneUtils';
import type { Customer } from '../../types';
import type { LedgerEvent } from './AccountStatementModal';
import {
  buildOperationReceiptData,
  sendPayloadToPrintServer,
  buildReceiptWhatsAppText,
} from '../../utils/statementPrint';
import styles from './OperationReceiptModal.module.css';
import { errorMessage } from '../../utils/errorUtils';

interface OperationReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: LedgerEvent | null;
  customer: Customer | null;
  currentTotalDebt?: number;
}

export const OperationReceiptModal: React.FC<OperationReceiptModalProps> = ({
  isOpen,
  onClose,
  event,
  customer,
  currentTotalDebt = 0,
}) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [isPrinting, setIsPrinting] = useState(false);

  const receiptData = useMemo(() => {
    if (!event || !customer) return null;
    return buildOperationReceiptData({ event, customer, currentTotalDebt });
  }, [event, customer, currentTotalDebt]);

  if (!isOpen || !receiptData) return null;

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      const res = await sendPayloadToPrintServer(receiptData.payload, toast);
      if (res.success) {
        onClose();
      }
    } catch (err: unknown) {
      console.error('Print failure:', err);
      toast.error(t('statementModal.printError', 'Print error'), errorMessage(err) || 'Failed to send to print server.');
    } finally {
      setIsPrinting(false);
    }
  };

  const handleWhatsApp = () => {
    const text = buildReceiptWhatsAppText(receiptData);
    const url = formatWhatsAppUrl(receiptData.customerPhone, text) || `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${t('statementModal.receiptPreview', 'Receipt Preview #')}${receiptData.referenceNumber}`}
      subtitle={t('statementModal.checkBeforePrint', 'Check details before sending to thermal printer')}
      size="sm"
      footer={
        <div style={{ display: 'flex', gap: '8px', width: '100%', justifyContent: 'flex-end', alignItems: 'center' }}>
          <Button variant="ghost" onClick={onClose}>
            {t('statementModal.close', 'Close')}
          </Button>
          <Button
            variant="outline"
            onClick={handleWhatsApp}
            leftIcon={<MessageCircle size={15} style={{ color: '#25D366' }} />}
            title={t('statementModal.sendWhatsApp', 'Send receipt summary via WhatsApp')}
          >
            WhatsApp
          </Button>
          <Button
            onClick={handlePrint}
            leftIcon={<Printer size={15} />}
            isLoading={isPrinting}
            disabled={isPrinting}
          >
            {t('statementModal.printReceipt', 'Print Receipt')}
          </Button>
        </div>
      }
    >
      <div className={styles.receiptPaper}>
        {/* Header */}
        <div className={styles.header}>
          {receiptData.logo && (
            <img src={receiptData.logo} alt="Store Logo" className={styles.logo} />
          )}
          <h3 className={styles.storeName}>{receiptData.storeName}</h3>
          {receiptData.storeAddress && (
            <p className={styles.storeSub}>{receiptData.storeAddress}</p>
          )}
          {receiptData.storePhone && (
            <p className={styles.storeSub}>{t('statementModal.phone', 'Phone:')} {receiptData.storePhone}</p>
          )}

          <div className={styles.badgePill}>{receiptData.headerMessage}</div>
          <div className={styles.refTag}>#{receiptData.referenceNumber}</div>
          <div className={styles.dateText}>{receiptData.dateStr}</div>
        </div>

        <div className={styles.dashedRule} />

        {/* Customer Information */}
        <div className={styles.metaBox}>
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>{t('statementModal.customerLabel', 'Customer:')}</span>
            <span className={styles.metaValue}>{receiptData.customerDisplayName}</span>
          </div>
          {receiptData.customerPhone && (
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>{t('statementModal.phone', 'Phone:')}</span>
              <span className={styles.metaValue}>{receiptData.customerPhone}</span>
            </div>
          )}
        </div>

        {/* Highlighted Repair Device Info */}
        {receiptData.repairDetails && (
          <div className={styles.repairCard}>
            <div className={styles.repairDeviceTitle}>
              📱 {receiptData.repairDetails.deviceBrand} {receiptData.repairDetails.deviceModel}
              {receiptData.repairDetails.imei ? ` (IMEI: ${receiptData.repairDetails.imei})` : ''}
            </div>
            {receiptData.repairDetails.issueDescription && (
              <div className={styles.repairIssue}>
                🔧 <strong>{t('statementModal.issueLabel', 'Issue:')}</strong> {receiptData.repairDetails.issueDescription}
              </div>
            )}
            {receiptData.repairDetails.status && (
              <span className={styles.repairStatusTag}>
                {t('statementModal.status', 'Status:')} {receiptData.repairDetails.status}
              </span>
            )}
          </div>
        )}

        {/* Highlighted Debt Tab Info */}
        {receiptData.debtDetails?.productOrService && (
          <div className={styles.repairCard}>
            <div className={styles.repairDeviceTitle}>
              📝 {t('statementModal.reason', 'Reason:')} {receiptData.debtDetails.productOrService}
            </div>
            {receiptData.debtDetails.dueDate && (
              <div className={styles.repairIssue}>
                ⏳ {t('statementModal.dueDate2', 'Due Date:')} {receiptData.debtDetails.dueDate}
              </div>
            )}
          </div>
        )}

        <div className={styles.dashedRule} />

        {/* Items Section */}
        <div className={styles.itemsSection}>
          <div className={styles.itemsHeader}>
            <span>{t('statementModal.designation', 'Designation / Service')}</span>
            <span>{t('statementModal.totalSale', 'Total')}</span>
          </div>
          {receiptData.items.map((it, idx) => (
            <div key={idx} className={styles.itemRow}>
              <div className={styles.itemLeft}>
                <div className={styles.itemName} style={it.isReturn ? { color: '#b91c1c' } : undefined}>
                  {it.isReturn ? '−' : ''}{it.name}
                  {it.isReturn && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#b91c1c' }}>
                      {' '}({t('statementModal.returnedLine', 'handed back')})
                    </span>
                  )}
                </div>
                {it.detail && <div className={styles.itemDetail}>{it.detail}</div>}
                {(it.quantity > 1 || it.isReturn) && (
                  <div className={styles.itemQty}>
                    {it.isReturn ? '−' : ''}{it.quantity} × {formatCurrency(it.price, !!receiptData.currency)}
                  </div>
                )}
              </div>
              <div className={styles.itemRight}>
                <div
                  className={styles.itemPrice}
                  style={it.isReturn ? { color: '#b91c1c' } : undefined}
                >
                  {it.isReturn ? '−' : ''}{formatCurrency(it.total, !!receiptData.currency)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.dashedRule} />

        {/* Totals Section */}
        <div className={styles.totalsSection}>
          {receiptData.discount && receiptData.discount > 0 && (
            <div className={styles.totalRow}>
              <span>{t('statementModal.discount', 'Discount:')}</span>
              <strong style={{ color: '#16a34a' }}>
                -{formatCurrency(receiptData.discount, !!receiptData.currency)}
              </strong>
            </div>
          )}

          <div className={styles.grandTotalRow}>
            <span>{t('statementModal.total', 'TOTAL:')}</span>
            <span>{formatCurrency(receiptData.total, !!receiptData.currency)}</span>
          </div>

          <div className={styles.totalRow} style={{ marginTop: 4 }}>
            <span>{t('statementModal.paymentLine', 'Payment')} ({receiptData.paymentMethod}) :</span>
            <strong>{formatCurrency(receiptData.paidAmount, !!receiptData.currency)}</strong>
          </div>
        </div>

        {/* Overall Customer Running Debt */}
        <div
          className={[
            styles.balanceDueBox,
            receiptData.currentTotalDebt > 0 ? styles.balancePending : styles.balanceSettled,
          ].join(' ')}
        >
          <span>{t('statementModal.currentBalance', 'CURRENT ACCOUNT BALANCE:')}</span>
          <span className={styles.balanceAmount}>
            {formatCurrency(receiptData.currentTotalDebt, !!receiptData.currency)}
          </span>
        </div>

        <div className={styles.dashedRule} />

        {/* Signatures Row */}
        <div className={styles.signatures}>
          <div className={styles.sigBlock}>{t('statementModal.storeStamp', 'Store Stamp')}</div>
          <div className={styles.sigBlock}>{t('statementModal.customerSignature', 'Customer Signature')}</div>
        </div>

        {/* Footer Text */}
        <div className={styles.footerText}>
          {t('statementModal.thankYou', 'Thank you for your trust!')}<br />
          {t('statementModal.keepForReference', 'Keep this receipt for warranty and follow-up.')}
        </div>
      </div>
    </Modal>
  );
};

