import React from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useCartStore } from '../../store/cartStore';
import { useToast } from '../../components/ui/Toast';
import { transactionService } from '../../services/transactionService';
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
  const submitting = React.useRef(false);
  const [error, setError] = React.useState('');

  if (!transaction) return null;
  const pendingClaim = transactionService.getPendingRefunds().find(r => r.transactionId === transaction.id);

  const handleClose = () => { if (!submitting.current) onClose(); };
  const handleRefund = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setIsProcessing(true);
    setError('');
    try {
      const warnings = await refundTransaction(transaction.id, transaction);
      if (warnings.length > 0) {
        toast.warning('Refund status', warnings.join(' '));
      } else {
        toast.success('Refund Confirmed', `Transaction ${transaction.id} is refunded. Do not hand back the same money twice.`);
      }
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not reach the server.';
      setError(`${message} Retry this same invoice to check its outcome; do not issue another refund until confirmed.`);
    } finally {
      submitting.current = false;
      setIsProcessing(false);
    }
  };

  
  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Refund Transaction"
      subtitle={`Order ${transaction.id}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isProcessing}>Cancel</Button>
          <Button variant="danger" onClick={handleRefund} isLoading={isProcessing}>
            {pendingClaim ? 'Verify & Complete Refund' : 'Process Refund'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', fontSize: 'var(--text-body-sm-size)' }}>
        <p>Are you sure you want to refund this transaction?</p>

        {pendingClaim && (
          <div
            role="status"
            style={{
              background: '#fef3c7',
              color: '#92400e',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius)',
              fontSize: 'var(--text-label-sm-size)',
              fontWeight: 600,
            }}
          >
            ⏳ A refund claim was already submitted ({pendingClaim.refundedAt.slice(0, 16).replace('T', ' ')}). Confirming below checks whether it landed on the server and finishes it once without double-refunding.
          </div>
        )}
        
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

        {error && (
          <p role="alert" style={{ color: 'var(--color-danger-text)', fontSize: 'var(--text-label-sm-size)', fontWeight: 600 }}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
};
