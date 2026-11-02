import React from 'react';
import type { Customer } from '../../types';
import { Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

interface CustomerPhoneModalsProps {
  customer: Customer;
  isAddPhoneOpen: boolean;
  setIsAddPhoneOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newPhoneBrand: string;
  setNewPhoneBrand: React.Dispatch<React.SetStateAction<string>>;
  newPhoneModel: string;
  setNewPhoneModel: React.Dispatch<React.SetStateAction<string>>;
  newPhoneImei: string;
  setNewPhoneImei: React.Dispatch<React.SetStateAction<string>>;
  newPhoneNotes: string;
  setNewPhoneNotes: React.Dispatch<React.SetStateAction<string>>;
  createTicketForNewPhone: boolean;
  setCreateTicketForNewPhone: React.Dispatch<React.SetStateAction<boolean>>;
  confirmAddPhone: () => Promise<void>;
  isActionLoading: boolean;
  deviceToEdit: { id?: string; oldBrand: string; oldModel: string; brand: string; model: string; imei?: string; notes?: string } | null;
  setDeviceToEdit: React.Dispatch<React.SetStateAction<{ id?: string; oldBrand: string; oldModel: string; brand: string; model: string; imei?: string; notes?: string } | null>>;
  confirmEditDevice: () => Promise<void>;
}

export const CustomerPhoneModals: React.FC<CustomerPhoneModalsProps> = ({
  customer,
  isAddPhoneOpen,
  setIsAddPhoneOpen,
  newPhoneBrand,
  setNewPhoneBrand,
  newPhoneModel,
  setNewPhoneModel,
  newPhoneImei,
  setNewPhoneImei,
  newPhoneNotes,
  setNewPhoneNotes,
  createTicketForNewPhone,
  setCreateTicketForNewPhone,
  confirmAddPhone,
  isActionLoading,
  deviceToEdit,
  setDeviceToEdit,
  confirmEditDevice,
}) => {
  const { t } = useTranslation();

  return (
    <>
      {/* Add Phone Modal */}
      <Modal
        isOpen={isAddPhoneOpen}
        onClose={() => setIsAddPhoneOpen(false)}
        title={t('customers.registerPhoneTitle', 'Register Phone for {{name}}', { name: customer?.name })}
        subtitle={t('customers.registerPhoneSubtitle', 'Add a customer device to their registered fleet')}
        size="md"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
            <Button variant="ghost" onClick={() => setIsAddPhoneOpen(false)} disabled={isActionLoading}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button variant="primary" onClick={confirmAddPhone} isLoading={isActionLoading} leftIcon={<Smartphone size={15} />}>
              {t('customers.savePhone', 'Save Phone')}
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-on-surface)' }}>
              {t('customers.phoneBrand', 'Phone Brand')} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <Input
              placeholder="e.g. Apple, Samsung, Xiaomi..."
              value={newPhoneBrand}
              onChange={(e) => setNewPhoneBrand(e.target.value)}
              autoFocus
            />
            {/* Quick Brand Selector Chips */}
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '6px' }}>
              {['Apple', 'Samsung', 'Xiaomi', 'Oppo', 'Realme', 'Huawei', 'Infinix', 'Tecno'].map(b => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setNewPhoneBrand(b)}
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    background: newPhoneBrand.toLowerCase() === b.toLowerCase() ? 'var(--color-primary, #4f46e5)' : '#f8fafc',
                    color: newPhoneBrand.toLowerCase() === b.toLowerCase() ? '#ffffff' : '#475569',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-on-surface)' }}>
              {t('customers.phoneModel', 'Phone Model')} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <Input
              placeholder="e.g. Galaxy A54 5G, iPhone 13 Pro Max..."
              value={newPhoneModel}
              onChange={(e) => setNewPhoneModel(e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-on-surface)' }}>
              {t('customers.imeiOptional', 'IMEI / Serial Number (Optional)')}
            </label>
            <Input
              placeholder="e.g. 356789123456789"
              value={newPhoneImei}
              onChange={(e) => setNewPhoneImei(e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-on-surface)' }}>
              {t('customers.deviceNotesOptional', 'Device Notes / Condition / Color (Optional)')}
            </label>
            <Input
              placeholder="e.g. Midnight Black, cracked back glass"
              value={newPhoneNotes}
              onChange={(e) => setNewPhoneNotes(e.target.value)}
            />
          </div>

          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer'
            }}
            onClick={() => setCreateTicketForNewPhone(!createTicketForNewPhone)}
          >
            <input
              type="checkbox"
              id="createTicketCheck"
              checked={createTicketForNewPhone}
              onChange={(e) => setCreateTicketForNewPhone(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="createTicketCheck" style={{ fontSize: '12px', fontWeight: 600, cursor: 'pointer', color: '#1e293b' }}>
              {t('customers.createTicketForPhoneCheck', 'Immediately open a new repair ticket for this phone')}
            </label>
          </div>
        </div>
      </Modal>

      {/* Edit Phone Modal */}
      <Modal
        isOpen={!!deviceToEdit}
        onClose={() => setDeviceToEdit(null)}
        title={t('customers.editPhoneTitle', 'Edit Phone: {{device}}', { device: `${deviceToEdit?.oldBrand} ${deviceToEdit?.oldModel}` })}
        subtitle={t('customers.editPhoneSubtitle', 'Updates this phone and its records for {{name}}', { name: customer?.name })}
        size="md"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
            <Button variant="ghost" onClick={() => setDeviceToEdit(null)} disabled={isActionLoading}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button variant="primary" onClick={confirmEditDevice} isLoading={isActionLoading}>
              {t('customers.updatePhone', 'Update Phone')}
            </Button>
          </div>
        }
      >
        {deviceToEdit && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-on-surface)' }}>
                {t('customers.phoneBrand', 'Brand')} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <Input
                value={deviceToEdit.brand}
                onChange={(e) => setDeviceToEdit({ ...deviceToEdit, brand: e.target.value })}
              />
              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '6px' }}>
                {['Apple', 'Samsung', 'Xiaomi', 'Oppo', 'Realme', 'Huawei', 'Infinix', 'Tecno'].map(b => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setDeviceToEdit({ ...deviceToEdit, brand: b })}
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      border: '1px solid #e2e8f0',
                      background: deviceToEdit.brand.toLowerCase() === b.toLowerCase() ? 'var(--color-primary, #4f46e5)' : '#f8fafc',
                      color: deviceToEdit.brand.toLowerCase() === b.toLowerCase() ? '#ffffff' : '#475569',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-on-surface)' }}>
                {t('customers.phoneModel', 'Model')} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <Input
                value={deviceToEdit.model}
                onChange={(e) => setDeviceToEdit({ ...deviceToEdit, model: e.target.value })}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-on-surface)' }}>
                {t('customers.imeiOptional', 'IMEI / Serial Number (Optional)')}
              </label>
              <Input
                placeholder="e.g. 356789123456789"
                value={deviceToEdit.imei || ''}
                onChange={(e) => setDeviceToEdit({ ...deviceToEdit, imei: e.target.value })}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-on-surface)' }}>
                {t('customers.deviceNotesOptional', 'Device Notes / Condition / Color (Optional)')}
              </label>
              <Input
                placeholder="e.g. Midnight Black, cracked back glass"
                value={deviceToEdit.notes || ''}
                onChange={(e) => setDeviceToEdit({ ...deviceToEdit, notes: e.target.value })}
              />
            </div>
            <p style={{ fontSize: '11.5px', color: '#64748b' }}>
              {t('customers.editPhoneWarning', 'Note: Changing the brand/model here updates all repair records and registered fleet info linked to this device for this customer.')}
            </p>
          </div>
        )}
      </Modal>
    </>
  );
};
