import React, { useEffect, useState } from 'react';
import { Phone, Mail, Clock, Smartphone, MessageCircle, Wrench, ShoppingCart, FileText, Store, User, GitMerge, Trash2, MoreVertical } from 'lucide-react';
import type { Customer } from '../../types';
import { isShopCustomer } from '../../types';
import { usePermissions } from '../../hooks/usePermissions';
import { useTranslation } from 'react-i18next';
import { formatPrivateCurrency } from '../../utils/formatCurrency';
import { formatWhatsAppUrl } from '../../utils/phoneUtils';
import styles from './CustomerProfile.module.css';

interface CustomerProfileMoreMenuProps {
  customer: Customer;
  setIsSwitchTypeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsMergeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsActivityModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsDeleteCustomerOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const CustomerProfileMoreMenu: React.FC<CustomerProfileMoreMenuProps> = ({
  customer,
  setIsSwitchTypeOpen,
  setIsMergeOpen,
  setIsActivityModalOpen,
  setIsDeleteCustomerOpen,
}) => {
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = React.useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  // Close more menu on click outside
  useEffect(() => {
    if (!isMoreMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMoreMenuOpen]);

  return (
    <div className={styles.moreMenuContainer} ref={moreMenuRef}>
      <button
        type="button"
        className={styles.actionBtn}
        onClick={() => setIsMoreMenuOpen(prev => !prev)}
        title="Account Actions & Settings"
        style={{ padding: '6px 8px' }}
      >
        <MoreVertical size={15} />
      </button>

      {isMoreMenuOpen && (
        <div className={styles.moreMenuDropdown}>
          <button
            type="button"
            className={styles.moreMenuItem}
            onClick={() => {
              setIsMoreMenuOpen(false);
              setIsSwitchTypeOpen(true);
            }}
          >
            {isShopCustomer(customer) ? <User size={14} /> : <Store size={14} />}
            <span>{isShopCustomer(customer) ? t('customers.switchToRetail', 'Switch to Retail') : t('customers.switchToShop', 'Switch to B2B Shop')}</span>
          </button>

          <button
            type="button"
            className={styles.moreMenuItem}
            onClick={() => {
              setIsMoreMenuOpen(false);
              setIsMergeOpen(true);
            }}
          >
            <GitMerge size={14} />
            <span>{t('customers.mergeAccount', 'Merge Account')}</span>
          </button>

          <button
            type="button"
            className={styles.moreMenuItem}
            onClick={() => {
              setIsMoreMenuOpen(false);
              setIsActivityModalOpen(true);
            }}
          >
            <Clock size={14} />
            <span>{t('customers.viewAudit', 'View Audit & Activity Log')}</span>
          </button>

          <div style={{ height: '1px', background: '#e2e8f0', margin: '4px 0' }} />

          <button
            type="button"
            className={[styles.moreMenuItem, styles.moreMenuItemDanger].join(' ')}
            onClick={() => {
              setIsMoreMenuOpen(false);
              setIsDeleteCustomerOpen(true);
            }}
          >
            <Trash2 size={14} />
            <span>{t('customers.deleteClient', 'Delete Client')}</span>
          </button>
        </div>
      )}
    </div>
  );
};

interface CustomerProfileHeaderCardProps {
  customer: Customer;
  handleStartRepair: () => void;
  handleStartPartsOrder: () => void;
  handleStartSale: () => void;
  setIsStatementOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setNewPhoneBrand: React.Dispatch<React.SetStateAction<string>>;
  setNewPhoneModel: React.Dispatch<React.SetStateAction<string>>;
  setNewPhoneImei: React.Dispatch<React.SetStateAction<string>>;
  setNewPhoneNotes: React.Dispatch<React.SetStateAction<string>>;
  setCreateTicketForNewPhone: React.Dispatch<React.SetStateAction<boolean>>;
  setIsAddPhoneOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSwitchTypeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsMergeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsActivityModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsDeleteCustomerOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export const CustomerProfileHeaderCard: React.FC<CustomerProfileHeaderCardProps> = ({
  customer,
  handleStartRepair,
  handleStartPartsOrder,
  handleStartSale,
  setIsStatementOpen,
  setNewPhoneBrand,
  setNewPhoneModel,
  setNewPhoneImei,
  setNewPhoneNotes,
  setCreateTicketForNewPhone,
  setIsAddPhoneOpen,
  setIsSwitchTypeOpen,
  setIsMergeOpen,
  setIsActivityModalOpen,
  setIsDeleteCustomerOpen,
}) => {
  const permissions = usePermissions();
  const { t } = useTranslation();

  return (
    <div className={styles.header}>
      <div className={styles.headerTop}>
        <div className={styles.headerLeft}>
          <div className={styles.avatar} style={customer.shopName ? { background: '#eff6ff', color: '#2563eb' } : undefined}>
            {customer.shopName ? <Store size={22} /> : customer.name[0]}
          </div>
          <div className={styles.headerInfo}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h2 className={styles.name}>{customer.shopName ? customer.shopName : customer.name}</h2>
              {customer.shopName && (
                <span style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  background: '#dbeafe',
                  color: '#1e40af',
                  padding: '2px 8px',
                  borderRadius: '6px',
                }}>
                  {t('common.b2bShop', 'B2B Shop')}
                </span>
              )}
              {customer.wholesaleDiscountPercent && customer.wholesaleDiscountPercent > 0 && (
                <span style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  background: '#dcfce7',
                  color: '#15803d',
                  padding: '2px 8px',
                  borderRadius: '6px',
                }} title={`Automatic ${customer.wholesaleDiscountPercent}% wholesale discount applied in POS and Parts`}>
                  🏷️ {customer.wholesaleDiscountPercent}% Wholesale
                </span>
              )}
              {customer.id.startsWith('offline_') && (
                <span style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  background: '#fef3c7',
                  color: '#b45309',
                  border: '1px solid #fde68a',
                  padding: '2px 8px',
                  borderRadius: '6px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }} title="Created offline. Queued to sync to Firestore automatically.">
                  ☁️ Offline
                </span>
              )}
            </div>

            {customer.shopName && (
              <p style={{ fontSize: '12px', color: '#64748b', margin: '2px 0 3px 0' }}>
                Contact: <strong>{customer.name}</strong>
              </p>
            )}

            <div className={styles.contactRow}>
              <a href={`tel:${customer.phone}`} className={styles.contactItem} title="Call customer">
                <Phone size={13} /> {customer.phone}
              </a>
              {customer.email && (
                <a href={`mailto:${customer.email}`} className={styles.contactItem} title="Send email">
                  <Mail size={13} /> {customer.email}
                </a>
              )}
              {customer.creditLimit && customer.creditLimit > 0 && (
                <span style={{ fontSize: '11px', color: '#475569' }}>
                  Limit: <strong style={{ color: '#2563eb' }}>{formatPrivateCurrency(customer.creditLimit)}</strong>
                </span>
              )}
            </div>

            {/* B2B Legal IDs — only visible if shop customer has them filled */}
            {isShopCustomer(customer) && (customer.rc || customer.nif || customer.nis || customer.art) && (
              <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {customer.rc && <span>RC: <strong style={{ color: '#334155' }}>{customer.rc}</strong></span>}
                {customer.nif && <span>NIF: <strong style={{ color: '#334155' }}>{customer.nif}</strong></span>}
                {customer.nis && <span>NIS: <strong style={{ color: '#334155' }}>{customer.nis}</strong></span>}
                {customer.art && <span>Art: <strong style={{ color: '#334155' }}>{customer.art}</strong></span>}
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons Bar */}
        <div className={styles.headerActions}>
          {(() => {
            const waUrl = formatWhatsAppUrl(customer.phone);
            return waUrl ? (
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={[styles.actionBtn, styles.actionBtnWa].join(' ')}
                title="Message on WhatsApp"
              >
                <MessageCircle size={14} /> WA
              </a>
            ) : (
              <button
                type="button"
                disabled
                className={[styles.actionBtn, styles.actionBtnWa].join(' ')}
                style={{ opacity: 0.4, cursor: 'not-allowed' }}
                title="No valid phone number on file"
              >
                <MessageCircle size={14} /> WA
              </button>
            );
          })()}

          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => setIsStatementOpen(true)}
            style={{ background: '#f8fafc', color: '#0f172a', borderColor: '#cbd5e1' }}
            title={t('customers.accountStatement', 'Account Statement')}
          >
            <FileText size={14} /> {t('common.statement', 'Statement')}
          </button>

          {permissions.repairs && (
            <button
              type="button"
              className={[styles.actionBtn, styles.actionBtnPrimary].join(' ')}
              onClick={handleStartRepair}
              title={t('customers.newRepair', 'New Repair Ticket')}
            >
              <Wrench size={14} /> {t('common.repair', 'Repair')}
            </button>
          )}

          {permissions.inventory_parts && isShopCustomer(customer) && (
            <button
              type="button"
              className={styles.actionBtn}
              onClick={handleStartPartsOrder}
              style={{ background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' }}
              title={t('common.parts', 'New Parts Order')}
            >
              <Store size={14} /> {t('common.parts', 'Parts')}
            </button>
          )}

          <button
            type="button"
            className={styles.actionBtn}
            onClick={handleStartSale}
            title={t('common.pos', 'New POS Sale')}
          >
            <ShoppingCart size={14} /> {t('common.pos', 'POS')}
          </button>

          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => {
              setNewPhoneBrand('');
              setNewPhoneModel('');
              setNewPhoneImei('');
              setNewPhoneNotes('');
              setCreateTicketForNewPhone(false);
              setIsAddPhoneOpen(true);
            }}
            style={{ background: '#f5f3ff', color: '#6d28d9', borderColor: '#ddd6fe' }}
            title="Register New Phone to Customer Account"
          >
            <Smartphone size={14} /> {t('common.addPhone', '+ Phone')}
          </button>

          {/* More Options Dropdown (Administrative Actions) */}
          <CustomerProfileMoreMenu
            customer={customer}
            setIsSwitchTypeOpen={setIsSwitchTypeOpen}
            setIsMergeOpen={setIsMergeOpen}
            setIsActivityModalOpen={setIsActivityModalOpen}
            setIsDeleteCustomerOpen={setIsDeleteCustomerOpen}
          />
        </div>
      </div>
    </div>
  );
};
