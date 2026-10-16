import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  isLoading?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  isLoading = false,
}) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title={title}
    size="sm"
    footer={
      <>
        <Button variant="ghost" onClick={onClose} disabled={isLoading}>{cancelLabel}</Button>
        <Button variant="danger" onClick={onConfirm} isLoading={isLoading}>{confirmLabel}</Button>
      </>
    }
  >
    <div className={styles.body}>
      <div className={[styles.iconWrap, styles[variant]].join(' ')}>
        <AlertTriangle size={28} />
      </div>
      <div className={styles.message}>{message}</div>
    </div>
  </Modal>
);
