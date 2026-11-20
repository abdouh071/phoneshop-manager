import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Store, AlertCircle } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { useCustomerStore } from '../../store/customerStore';
import { useAuthStore } from '../../store/authStore';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { useToast } from '../../components/ui/Toast';
import type { Customer } from '../../types';
import styles from '../inventory/ProductForm.module.css';
import { errorMessage } from '../../utils/errorUtils';

interface QuickAddShopModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCustomerCreated: (customer: Customer) => void;
}

export const QuickAddShopModal: React.FC<QuickAddShopModalProps> = ({
  isOpen,
  onClose,
  onCustomerCreated,
}) => {
  const [shopName, setShopName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [notes, setNotes] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdminUnlock, setShowAdminUnlock] = useState(false);
  const [creditLimitApproved, setCreditLimitApproved] = useState(false);

  const { t } = useTranslation();
  const { addCustomer } = useCustomerStore();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const toast = useToast();

  const handleClose = () => {
    if (submittingRef.current) return;
    setShopName('');
    setContactName('');
    setPhone('');
    setCreditLimit('');
    setNotes('');
    setEmail('');
    setError(null);
    setCreditLimitApproved(false);
    setShowAdminUnlock(false);
    onClose();
  };

  const executeSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);

    try {
      const limitNum = parseFloat(creditLimit);
      const newCustomer = await addCustomer({
        name: contactName.trim(),
        shopName: shopName.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        accountType: 'shop_repairer',
        creditLimit: !isNaN(limitNum) && limitNum > 0 ? limitNum : undefined,
        notes: notes.trim() || undefined,
      });

      toast.success(
        t('parts.quickAdd.registeredTitle'),
        t('parts.quickAdd.registeredBody', { shopName, contactName })
      );

      onCustomerCreated(newCustomer);
      submittingRef.current = false;
      handleClose();
    } catch (err: unknown) {
      setError(errorMessage(err) || t('parts.quickAdd.submitFailed'));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (!shopName.trim()) {
      setError(t('parts.quickAdd.errorShopName'));
      return;
    }
    if (!contactName.trim()) {
      setError(t('parts.quickAdd.errorContactName'));
      return;
    }
    const phoneDigits = phone.replace(/\D/g, '');
    if (!phone.trim() || phoneDigits.length < 7) {
      setError(t('parts.quickAdd.errorPhone'));
      return;
    }

    const limitNum = parseFloat(creditLimit);
    if (!isNaN(limitNum) && limitNum > 0 && !isAdmin && !creditLimitApproved) {
      setShowAdminUnlock(true);
      return;
    }

    executeSubmit();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      closeOnEscape={!isSubmitting && !showAdminUnlock}
      closeOnOverlayClick={!isSubmitting && !showAdminUnlock}
      title={t('parts.quickAdd.quickAddTitle')}
      subtitle={t('parts.quickAdd.quickAddSubtitle')}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} isLoading={isSubmitting} leftIcon={<Store size={16} />}>
            {t('parts.quickAdd.openAccountButton')}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {error && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 12px',
              borderRadius: '8px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#dc2626',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <Input
            label={t('parts.quickAdd.shopNameLabel')}
            placeholder={t('parts.quickAdd.shopNamePlaceholder')}
            value={shopName}
            onChange={e => {
              setShopName(e.target.value);
              setError(null);
            }}
            autoFocus
          />

          <Input
            label={t('parts.quickAdd.contactNameLabel')}
            placeholder={t('parts.quickAdd.contactNamePlaceholder')}
            value={contactName}
            onChange={e => {
              setContactName(e.target.value);
              setError(null);
            }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <Input
            label={t('parts.quickAdd.phoneLabel')}
            placeholder={t('parts.quickAdd.phonePlaceholder')}
            value={phone}
            onChange={e => {
              setPhone(e.target.value);
              setError(null);
            }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <Input
              label={t('parts.quickAdd.creditLimitLabel')}
              type="number"
              min="0"
              placeholder={t('parts.quickAdd.creditLimitPlaceholder')}
              value={creditLimit}
              onChange={e => {
                setCreditLimit(e.target.value);
                setCreditLimitApproved(false);
              }}
            />
            {parseFloat(creditLimit) > 0 && (
              creditLimitApproved ? (
                <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600 }}>
                  {t('parts.quickAdd.adminOverrideApproved')}
                </span>
              ) : !isAdmin && (
                <span style={{ fontSize: '11px', color: '#dc2626', fontWeight: 500 }}>
                  {t('parts.quickAdd.adminApprovalRequired')}
                </span>
              )
            )}
          </div>
        </div>

        <Input
          label={t('parts.quickAdd.emailLabel')}
          placeholder={t('parts.quickAdd.emailPlaceholder')}
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />

        <Textarea
          label={t('parts.quickAdd.notesLabel')}
          placeholder={t('parts.quickAdd.notesPlaceholder')}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
        />
      </div>

      <AdminUnlockModal
        isOpen={showAdminUnlock}
        onClose={() => setShowAdminUnlock(false)}
        onSuccess={() => {
          setCreditLimitApproved(true);
          setShowAdminUnlock(false);
          void executeSubmit();
        }}
        actionName={t('parts.quickAdd.adminUnlockAction', {
          creditLimit,
          shop: shopName || t('parts.quickAdd.newB2BAccount'),
        })}
      />
    </Modal>
  );
};
