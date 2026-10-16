import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Store, User, ArrowRightLeft, AlertCircle } from 'lucide-react';
import { useCustomerStore } from '../../store/customerStore';
import { useToast } from '../../components/ui/Toast';
import type { Customer } from '../../types';
import { isShopCustomer } from '../../types';

interface SwitchAccountTypeModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: Customer | null;
}

export const SwitchAccountTypeModal: React.FC<SwitchAccountTypeModalProps> = ({
  isOpen,
  onClose,
  customer,
}) => {
  const { switchAccountType } = useCustomerStore();
  const toast = useToast();

  const isCurrentShop = customer ? isShopCustomer(customer) : false;
  const targetType = isCurrentShop ? 'retail' : 'shop_repairer';

  const [shopName, setShopName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (customer) {
      setShopName(customer.shopName || `${customer.name}'s Workshop`);
      setError(null);
    }
  }, [customer, isOpen]);

  if (!customer) return null;

  const handleSwitch = async () => {
    if (targetType === 'shop_repairer' && !shopName.trim()) {
      setError('Please provide a workshop or shop name');
      return;
    }

    setIsSubmitting(true);
    try {
      await switchAccountType(customer.id, targetType, shopName.trim());
      toast.success(
        'Account Converted',
        targetType === 'shop_repairer'
          ? `${customer.name} converted to B2B Shop "${shopName.trim()}".`
          : `${customer.name} converted to Retail Customer.`
      );
      onClose();
    } catch (err) {
      toast.error('Failed to convert account', 'An error occurred during account conversion.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCurrentShop ? 'Convert to Retail Client' : 'Convert to B2B Shop Account'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSwitch}
            isLoading={isSubmitting}
            leftIcon={<ArrowRightLeft size={16} />}
          >
            {isCurrentShop ? 'Convert to Retail' : 'Convert to Shop'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{
          background: isCurrentShop ? '#eff6ff' : '#fef3c7',
          border: `1px solid ${isCurrentShop ? '#bfdbfe' : '#fde68a'}`,
          borderRadius: '10px',
          padding: '14px',
          display: 'flex',
          gap: '12px',
          alignItems: 'flex-start',
        }}>
          <div style={{
            background: isCurrentShop ? '#dbeafe' : '#fef08a',
            color: isCurrentShop ? '#1e40af' : '#b45309',
            padding: '8px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {isCurrentShop ? <User size={20} /> : <Store size={20} />}
          </div>
          <div>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
              {isCurrentShop
                ? 'Convert Shop to Retail Client'
                : 'Upgrade Client to B2B Shop / Workshop'}
            </h4>
            <p style={{ margin: 0, fontSize: '13px', color: '#475569', lineHeight: 1.4 }}>
              {isCurrentShop
                ? `Account "${customer.shopName || customer.name}" will be moved from the B2B Shops directory to the regular Retail Clients list. History & debts remain preserved.`
                : `Account "${customer.name}" will gain B2B wholesale pricing, parts catalog ordering, and appear under Shops & Workshops.`}
            </p>
          </div>
        </div>

        {!isCurrentShop && (
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
              Shop / Workshop Name <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <Input
              value={shopName}
              onChange={(v) => { setShopName(v); setError(null); }}
              placeholder="e.g. AP Phone Repair, Benali GSM"
              autoFocus
            />
            {error && (
              <p style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <AlertCircle size={13} /> {error}
              </p>
            )}
          </div>
        )}

        <div style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          padding: '12px',
          fontSize: '12.5px',
          color: '#64748b',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span>Account:</span>
            <strong style={{ color: '#0f172a' }}>{customer.name}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span>Phone:</span>
            <span style={{ color: '#0f172a' }}>{customer.phone || 'None'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Active Debt:</span>
            <span style={{ color: (customer.totalDebt || 0) > 0 ? '#d97706' : '#16a34a', fontWeight: 600 }}>
              {(customer.totalDebt || 0) > 0 ? `${customer.totalDebt} DZD` : 'None'}
            </span>
          </div>
        </div>
      </div>
    </Modal>
  );
};
