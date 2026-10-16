import React from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useCartStore } from '../../store/cartStore';
import { useToast } from '../../components/ui/Toast';
import type { SaleTransaction } from '../../types';
import { formatCurrency } from '../../utils/formatCurrency';

interface RefundModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: SaleTransaction | null;
}

export const RefundModal: React.FC<RefundModalProps> = ({ isOpen, onClose, transaction }) => {
  const { refundTransaction } = useCartStore();
  const toast = useToast();
  const [isProcessing, setIsProcessing] = React.useState(false);

  if (!transaction) return null;

  const handleRefund = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    await refundTransaction(transaction.id);
    toast.success('Refund Processed', `Transaction ${transaction.id} has been refunded.`);
    setIsProcessing(false);
    onClose();
  };

  
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Refund Transaction"
      subtitle={`Order ${transaction.id}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isProcessing}>Cancel</Button>
          <Button variant="danger" onClick={handleRefund} isLoading={isProcessing}>Process Refund</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', fontSize: 'var(--text-body-sm-size)' }}>
        <p>Are you sure you want to refund this transaction?</p>
        
        <div style={{ background: 'var(--color-surface-container-lowest)', padding: 'var(--space-3)', borderRadius: 'var(--radius)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
            <span style={{ color: 'var(--color-on-surface-variant)' }}>Customer:</span>
            <strong>{transaction.customerName || 'Walk-in'}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
            <span style={{ color: 'var(--color-on-surface-variant)' }}>Payment Method:</span>
            <strong style={{ textTransform: 'capitalize' }}>{transaction.payments.map(p => p.method).join(' + ')}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--color-outline-variant)', paddingTop: 'var(--space-2)' }}>
            <span>Refund Amount:</span>
            <strong style={{ color: 'var(--color-danger-text)', fontSize: 'var(--text-body-md-size)' }}>
              {formatCurrency(transaction.total)}
            </strong>
          </div>
        </div>

        <p style={{ color: 'var(--color-on-surface-variant)', fontSize: 'var(--text-label-sm-size)' }}>
          This action will mark the transaction as refunded, automatically restore purchased items to inventory (or reverse returned items), void linked debt entries, and update customer spending records.
        </p>
      </div>
    </Modal>
  );
};
