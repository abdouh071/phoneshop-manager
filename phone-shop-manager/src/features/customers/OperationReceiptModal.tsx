import React, { useState, useMemo } from 'react';
import { Printer, MessageCircle, CheckCircle2, Wrench, ShoppingBag, FileText, CreditCard } from 'lucide-react';
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
    } catch (err: any) {
      console.error('Print failure:', err);
      toast.error('Erreur d\'impression', err?.message || 'Échec de transmission au serveur d\'impression.');
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
      title={`Aperçu du Reçu #${receiptData.referenceNumber}`}
      subtitle="Vérifiez les informations avant l'envoi vers l'imprimante thermique"
      size="sm"
      footer={
        <div style={{ display: 'flex', gap: '8px', width: '100%', justifyContent: 'flex-end', alignItems: 'center' }}>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
          <Button
            variant="outline"
            onClick={handleWhatsApp}
            leftIcon={<MessageCircle size={15} style={{ color: '#25D366' }} />}
            title="Envoyer le résumé du ticket par WhatsApp"
          >
            WhatsApp
          </Button>
          <Button
            onClick={handlePrint}
            leftIcon={<Printer size={15} />}
            isLoading={isPrinting}
            disabled={isPrinting}
          >
            Imprimer Reçu
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
            <p className={styles.storeSub}>Tél: {receiptData.storePhone}</p>
          )}

          <div className={styles.badgePill}>{receiptData.headerMessage}</div>
          <div className={styles.refTag}>#{receiptData.referenceNumber}</div>
          <div className={styles.dateText}>{receiptData.dateStr}</div>
        </div>

        <div className={styles.dashedRule} />

        {/* Customer Information */}
        <div className={styles.metaBox}>
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>Client :</span>
            <span className={styles.metaValue}>{receiptData.customerDisplayName}</span>
          </div>
          {receiptData.customerPhone && (
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Téléphone :</span>
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
                🔧 <strong>Panne :</strong> {receiptData.repairDetails.issueDescription}
              </div>
            )}
            {receiptData.repairDetails.status && (
              <span className={styles.repairStatusTag}>
                Statut : {receiptData.repairDetails.status}
              </span>
            )}
          </div>
        )}

        {/* Highlighted Debt Tab Info */}
        {receiptData.debtDetails?.productOrService && (
          <div className={styles.repairCard}>
            <div className={styles.repairDeviceTitle}>
              📝 Motif : {receiptData.debtDetails.productOrService}
            </div>
            {receiptData.debtDetails.dueDate && (
              <div className={styles.repairIssue}>
                ⏳ Échéance : {receiptData.debtDetails.dueDate}
              </div>
            )}
          </div>
        )}

        <div className={styles.dashedRule} />

        {/* Items Section */}
        <div className={styles.itemsSection}>
          <div className={styles.itemsHeader}>
            <span>Désignation / Prestation</span>
            <span>Total</span>
          </div>
          {receiptData.items.map((it, idx) => (
            <div key={idx} className={styles.itemRow}>
              <div className={styles.itemLeft}>
                <div className={styles.itemName}>{it.name}</div>
                {it.detail && <div className={styles.itemDetail}>{it.detail}</div>}
                {it.quantity > 1 && (
                  <div className={styles.itemQty}>
                    {it.quantity} × {formatCurrency(it.price, receiptData.currency)}
                  </div>
                )}
              </div>
              <div className={styles.itemRight}>
                <div className={styles.itemPrice}>
                  {formatCurrency(it.total, receiptData.currency)}
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
              <span>Remise :</span>
              <strong style={{ color: '#16a34a' }}>
                -{formatCurrency(receiptData.discount, receiptData.currency)}
              </strong>
            </div>
          )}

          <div className={styles.grandTotalRow}>
            <span>TOTAL :</span>
            <span>{formatCurrency(receiptData.total, receiptData.currency)}</span>
          </div>

          <div className={styles.totalRow} style={{ marginTop: 4 }}>
            <span>Règlement ({receiptData.paymentMethod}) :</span>
            <strong>{formatCurrency(receiptData.paidAmount, receiptData.currency)}</strong>
          </div>
        </div>

        {/* Overall Customer Running Debt */}
        <div
          className={[
            styles.balanceDueBox,
            receiptData.currentTotalDebt > 0 ? styles.balancePending : styles.balanceSettled,
          ].join(' ')}
        >
          <span>SOLDE ACTUEL DU COMPTE :</span>
          <span className={styles.balanceAmount}>
            {formatCurrency(receiptData.currentTotalDebt, receiptData.currency)}
          </span>
        </div>

        <div className={styles.dashedRule} />

        {/* Signatures Row */}
        <div className={styles.signatures}>
          <div className={styles.sigBlock}>Cachet Magasin</div>
          <div className={styles.sigBlock}>Signature Client</div>
        </div>

        {/* Footer Text */}
        <div className={styles.footerText}>
          Merci de votre confiance !<br />
          À conserver pour tout suivi ou garantie.
        </div>
      </div>
    </Modal>
  );
};
