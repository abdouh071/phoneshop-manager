import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { Button } from './Button';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose?: () => void;
  onCancel?: () => void; // alias used by some callers
  onConfirm: () => void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  isDestructive?: boolean;
  isDanger?: boolean;
  isLoading?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onCancel,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant,
  isDestructive,
  isLoading = false,
}) => {
  const { t } = useTranslation();
  const handleClose = onClose ?? onCancel ?? (() => undefined);
  const effectiveVariant = variant ?? (isDestructive === false ? 'warning' : 'danger');

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      size="sm"
      describedBy="confirm-dialog-message"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={isLoading}>{cancelLabel ?? t('common.cancel')}</Button>
          <Button variant="danger" onClick={onConfirm} isLoading={isLoading}>{confirmLabel ?? t('common.confirm')}</Button>
        </>
      }
    >
      <div className={styles.body}>
        <div className={[styles.iconWrap, styles[effectiveVariant]].join(' ')}>
          <AlertTriangle size={28} />
        </div>
        <div id="confirm-dialog-message" className={styles.message}>{message}</div>
      </div>
    </Modal>
  );
};
