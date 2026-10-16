import React, { useState } from 'react';
import { Store, User, Phone, DollarSign, FileText, AlertCircle, ShieldAlert } from 'lucide-react';
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
  const [error, setError] = useState<string | null>(null);
  const [showAdminUnlock, setShowAdminUnlock] = useState(false);
  const [creditLimitApproved, setCreditLimitApproved] = useState(false);

  const { addCustomer } = useCustomerStore();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const toast = useToast();

  const handleClose = () => {
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
        'B2B Account Registered',
        `${shopName} (${contactName}) has been opened as an active commercial account.`
      );

      onCustomerCreated(newCustomer);
      handleClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create shop account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!shopName.trim()) {
      setError('Please provide the phone shop or business name (e.g. "AP Phone").');
      return;
    }
    if (!contactName.trim()) {
      setError('Please provide the technician or owner name.');
      return;
    }
    const phoneDigits = phone.replace(/\D/g, '');
    if (!phone.trim() || phoneDigits.length < 7) {
      setError('Please enter a valid phone number (at least 7 digits).');
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
      title="Open New Shop / Repairer Account"
      subtitle="Register a phone store or repair technician for parts sales & credit ledger"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} isLoading={isSubmitting} leftIcon={<Store size={16} />}>
            Open Account & Attach
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
            label="Shop / Business Name *"
            placeholder="e.g. AP Phone, QuickFix"
            value={shopName}
            onChange={e => {
              setShopName(e.target.value);
              setError(null);
            }}
            autoFocus
          />

          <Input
            label="Owner / Contact Person *"
            placeholder="e.g. Ahmed Benali"
            value={contactName}
            onChange={e => {
              setContactName(e.target.value);
              setError(null);
            }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <Input
            label="Phone Number *"
            placeholder="e.g. 0550 12 34 56"
            value={phone}
            onChange={e => {
              setPhone(e.target.value);
              setError(null);
            }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <Input
              label="Credit Limit (DZD Optional)"
              type="number"
              min="0"
              placeholder="e.g. 50000"
              value={creditLimit}
              onChange={e => {
                setCreditLimit(e.target.value);
                setCreditLimitApproved(false);
              }}
            />
            {parseFloat(creditLimit) > 0 && (
              creditLimitApproved ? (
                <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600 }}>
                  ✓ Admin override approved
                </span>
              ) : !isAdmin && (
                <span style={{ fontSize: '11px', color: '#dc2626', fontWeight: 500 }}>
                  🔒 Admin approval required to assign credit limit
                </span>
              )
            )}
          </div>
        </div>

        <Input
          label="Email Address (Optional)"
          placeholder="e.g. contact@apphone.com"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />

        <Textarea
          label="Commercial Notes / Location (Optional)"
          placeholder="e.g. Store located in Bab Ezzouar, discounts agreed on bulk screens"
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
          setTimeout(() => executeSubmit(), 100);
        }}
        actionName={`grant credit limit of ${creditLimit} DZD to ${shopName || 'new B2B account'}`}
      />
    </Modal>
  );
};
