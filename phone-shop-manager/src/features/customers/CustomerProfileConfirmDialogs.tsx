import React from 'react';
import type { Customer, RepairTicket } from '../../types';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useTranslation } from 'react-i18next';
import { formatPrivateCurrency } from '../../utils/formatCurrency';

interface CustomerProfileConfirmDialogsProps {
  customer: Customer;
  isDeleteCustomerOpen: boolean;
  setIsDeleteCustomerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  confirmDeleteCustomer: () => Promise<void>;
  totalDebtBalance: number;
  isActionLoading: boolean;
  deviceToDelete: { device: string; brand: string; model: string; tickets: RepairTicket[] } | null;
  setDeviceToDelete: React.Dispatch<React.SetStateAction<{ device: string; brand: string; model: string; tickets: RepairTicket[] } | null>>;
  deleteDeviceRepairsToo: boolean;
  setDeleteDeviceRepairsToo: React.Dispatch<React.SetStateAction<boolean>>;
  confirmDeleteDevice: () => Promise<void>;
  ticketToDelete: RepairTicket | null;
  setTicketToDelete: React.Dispatch<React.SetStateAction<RepairTicket | null>>;
  confirmDeleteSingleTicket: () => Promise<void>;
}

export const CustomerProfileConfirmDialogs: React.FC<CustomerProfileConfirmDialogsProps> = ({
  customer,
  isDeleteCustomerOpen,
  setIsDeleteCustomerOpen,
  confirmDeleteCustomer,
  totalDebtBalance,
  isActionLoading,
  deviceToDelete,
  setDeviceToDelete,
  deleteDeviceRepairsToo,
  setDeleteDeviceRepairsToo,
  confirmDeleteDevice,
  ticketToDelete,
  setTicketToDelete,
  confirmDeleteSingleTicket,
}) => {
  const { t } = useTranslation();

  return (
    <>
      {/* Delete Customer Confirmation Dialog */}
      <ConfirmDialog
        isOpen={isDeleteCustomerOpen}
        onClose={() => setIsDeleteCustomerOpen(false)}
        onConfirm={confirmDeleteCustomer}
        title={t('customers.deleteCustomerConfirmTitle', 'Delete Customer Account')}
        message={
          <div>
            <p style={{ margin: '0 0 8px 0' }}>
              {t('customers.deleteCustomerConfirmMsg', 'Are you sure you want to permanently delete {{name}}?', { name: customer?.name })}
            </p>
            {totalDebtBalance > 0 && (
              <p style={{ margin: 0, color: '#dc2626', fontWeight: 700, fontSize: '13px' }}>
                {t('customers.deleteCustomerDebtWarning', '⚠️ Warning: This customer currently has an unpaid debt of {{amount}}. Deleting the account will also remove all associated debt records.', { amount: formatPrivateCurrency(totalDebtBalance) })}
              </p>
            )}
          </div>
        }
        confirmLabel={t('customers.deleteCustomerConfirmBtn', 'Delete Customer')}
        variant="danger"
        isLoading={isActionLoading}
      />

      {/* Delete Phone Device Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deviceToDelete}
        onClose={() => { setDeviceToDelete(null); setDeleteDeviceRepairsToo(false); }}
        onConfirm={confirmDeleteDevice}
        title={t('customers.removePhoneTitle', 'Remove Phone / Device from Customer')}
        message={
          <div>
            <p style={{ margin: '0 0 10px 0' }}>
              {t('customers.deletePhoneConfirmMsg', 'Remove {{device}} from {{name}}\'s profile?', { device: deviceToDelete?.device, name: customer?.name })}
            </p>
            {deviceToDelete && deviceToDelete.tickets.length > 0 && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  marginBottom: '10px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  cursor: 'pointer',
                }}
                onClick={() => setDeleteDeviceRepairsToo(v => !v)}
              >
                <input
                  type="checkbox"
                  id="deleteRepairsCheck"
                  checked={deleteDeviceRepairsToo}
                  onChange={e => setDeleteDeviceRepairsToo(e.target.checked)}
                  style={{ marginTop: '2px', cursor: 'pointer' }}
                  onClick={e => e.stopPropagation()}
                />
                <label htmlFor="deleteRepairsCheck" style={{ fontSize: '12.5px', color: '#991b1b', fontWeight: 600, cursor: 'pointer' }}>
                  {t('customers.deletePhoneWithRepairsCheck', 'Also delete the {{count}} linked repair ticket(s)', { count: deviceToDelete.tickets.length })}
                  <span style={{ display: 'block', fontWeight: 400, color: '#b91c1c', fontSize: '11.5px', marginTop: '2px' }}>
                    {t('customers.deletePhoneRepairsCheckWarning', '⚠️ Required to fully remove the device — if unchecked, it will reappear because repair history still references it.')}
                  </span>
                </label>
              </div>
            )}
            <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
              {deleteDeviceRepairsToo
                ? t('customers.deletePhoneWillRemoveMsg', 'This will remove the device and delete all {{count}} repair record(s) permanently.', { count: deviceToDelete?.tickets.length })
                : t('customers.deletePhoneWillKeepMsg', '⚠️ The device will still appear in the list because it has linked repair tickets. To fully remove it, check the box above.')}
            </p>
          </div>
        }
        confirmLabel={deleteDeviceRepairsToo ? t('customers.deleteDeviceAndRepairs', 'Delete Device + Repairs') : t('customers.removeDevice', 'Remove Device')}
        variant="danger"
        isLoading={isActionLoading}
      />

      {/* Delete Single Repair Ticket Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!ticketToDelete}
        onClose={() => setTicketToDelete(null)}
        onConfirm={confirmDeleteSingleTicket}
        title={t('customers.deleteTicketConfirmTitle', 'Delete Repair Ticket')}
        message={
          <p style={{ margin: 0 }}>
            {t('customers.deleteTicketConfirmMsg', 'Are you sure you want to delete repair ticket #{{number}} ({{device}})?', {
              number: ticketToDelete?.ticketNumber,
              device: `${ticketToDelete?.deviceBrand} ${ticketToDelete?.deviceModel}`
            })}
          </p>
        }
        confirmLabel={t('customers.deleteTicketConfirmBtn', 'Delete Ticket')}
        variant="danger"
        isLoading={isActionLoading}
      />
    </>
  );
};
