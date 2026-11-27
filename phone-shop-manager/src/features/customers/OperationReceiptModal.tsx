import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, MessageCircle } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { FrenchThermalReceipt } from '../../components/receipts/FrenchThermalReceipt';
import { formatWhatsAppUrl } from '../../utils/phoneUtils';
import type { Customer } from '../../types';
import type { LedgerEvent } from './AccountStatementModal';
import {
  buildOperationReceiptData,
  sendPayloadToPrintServer,
  buildReceiptWhatsAppText,
} from '../../utils/statementPrint';
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
      <FrenchThermalReceipt data={receiptData.unifiedReceipt} />
    </Modal>
  );
};

