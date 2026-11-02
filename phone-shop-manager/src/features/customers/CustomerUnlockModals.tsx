import React from 'react';
import type { Customer, CustomerDebtEntry, SaleTransaction } from '../../types';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { useCustomerStore } from '../../store/customerStore';
import { useToast } from '../../components/ui/Toast';
import { useTranslation } from 'react-i18next';

interface CustomerUnlockModalsProps {
  customer: Customer;
  txRequiringUnlock: { tx: SaleTransaction; purpose: 'edit' | 'refund' } | null;
  setTxRequiringUnlock: React.Dispatch<React.SetStateAction<{ tx: SaleTransaction; purpose: 'edit' | 'refund' } | null>>;
  handleUnlockSuccess: () => void;
  debtRequiringUnlock: CustomerDebtEntry | null;
  setDebtRequiringUnlock: React.Dispatch<React.SetStateAction<CustomerDebtEntry | null>>;
  debtAddRequiringUnlock: boolean;
  setDebtAddRequiringUnlock: React.Dispatch<React.SetStateAction<boolean>>;
  debtPaymentRequiringUnlock: CustomerDebtEntry | null;
  setDebtPaymentRequiringUnlock: React.Dispatch<React.SetStateAction<CustomerDebtEntry | null>>;
  debtEditRequiringUnlock: CustomerDebtEntry | null;
  setDebtEditRequiringUnlock: React.Dispatch<React.SetStateAction<CustomerDebtEntry | null>>;
  setIsAddDebtOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedDebtForPayment: React.Dispatch<React.SetStateAction<CustomerDebtEntry | null>>;
  setEditDebtName: React.Dispatch<React.SetStateAction<string>>;
  setEditDebtAmount: React.Dispatch<React.SetStateAction<string>>;
  setEditingDebtId: React.Dispatch<React.SetStateAction<string | null>>;
}

export const CustomerUnlockModals: React.FC<CustomerUnlockModalsProps> = ({
  customer,
  txRequiringUnlock,
  setTxRequiringUnlock,
  handleUnlockSuccess,
  debtRequiringUnlock,
  setDebtRequiringUnlock,
  debtAddRequiringUnlock,
  setDebtAddRequiringUnlock,
  debtPaymentRequiringUnlock,
  setDebtPaymentRequiringUnlock,
  debtEditRequiringUnlock,
  setDebtEditRequiringUnlock,
  setIsAddDebtOpen,
  setSelectedDebtForPayment,
  setEditDebtName,
  setEditDebtAmount,
  setEditingDebtId,
}) => {
  const { deleteDebt } = useCustomerStore();
  const toast = useToast();
  const { t } = useTranslation();

  return (
    <>
      {/* Admin Unlock Modal for Past Invoice */}
      <AdminUnlockModal
        isOpen={!!txRequiringUnlock}
        onClose={() => setTxRequiringUnlock(null)}
        onSuccess={handleUnlockSuccess}
        actionName={txRequiringUnlock?.purpose === 'edit'
          ? `Edit past receipt #${txRequiringUnlock.tx.invoiceNumber || txRequiringUnlock.tx.id.slice(0, 8)} for ${customer.name}`
          : `Refund past receipt #${txRequiringUnlock?.tx.invoiceNumber || txRequiringUnlock?.tx.id.slice(0, 8)} for ${customer.name}`}
        actionType={txRequiringUnlock?.purpose === 'edit' ? 'pos_edit_receipt' : 'pos_refund_transaction'}
        targetId={txRequiringUnlock?.tx.id}
        actionData={txRequiringUnlock ? {
          itemType: 'transaction',
          customerName: customer.name,
          invoiceNumber: txRequiringUnlock.tx.invoiceNumber || txRequiringUnlock.tx.id.slice(0, 8),
          total: txRequiringUnlock.tx.total,
          itemCount: txRequiringUnlock.tx.items?.length || 0,
        } : undefined}
      />

      {/* Admin Unlock Modal for Debt Deletion */}
      <AdminUnlockModal
        isOpen={!!debtRequiringUnlock}
        onClose={() => setDebtRequiringUnlock(null)}
        onSuccess={() => {
          if (debtRequiringUnlock) {
            deleteDebt(debtRequiringUnlock.id);
            toast.info(t('customers.debtDeletedTitle', 'Debt Deleted'), t('customers.debtDeletedDesc', 'Record removed.'));
            setDebtRequiringUnlock(null);
          }
        }}
        actionName={`Delete debt record for ${customer.name} ("${debtRequiringUnlock?.productOrService || 'Debt'}")`}
        actionType="customer_delete_debt"
        targetId={debtRequiringUnlock?.id}
        actionData={debtRequiringUnlock ? {
          customerName: customer.name,
          itemName: debtRequiringUnlock.productOrService,
          price: debtRequiringUnlock.remainingBalance,
          totalAmount: debtRequiringUnlock.totalAmount,
        } : undefined}
      />

      {/* Problem 2 fix: Admin Unlock Modal for Adding Debt */}
      <AdminUnlockModal
        isOpen={debtAddRequiringUnlock}
        onClose={() => setDebtAddRequiringUnlock(false)}
        onSuccess={() => {
          setDebtAddRequiringUnlock(false);
          setIsAddDebtOpen(true);
        }}
        actionName={`Add debt record to ${customer.name}'s account`}
        actionType="customer_add_debt"
        targetId={customer.id}
        actionData={{
          customerName: customer.name,
          currentDebt: customer.debt,
          creditLimit: customer.creditLimit,
        }}
      />

      {/* Problem 2 fix: Admin Unlock Modal for Recording Payment */}
      <AdminUnlockModal
        isOpen={!!debtPaymentRequiringUnlock}
        onClose={() => setDebtPaymentRequiringUnlock(null)}
        onSuccess={() => {
          if (debtPaymentRequiringUnlock) {
            setSelectedDebtForPayment(debtPaymentRequiringUnlock);
          }
          setDebtPaymentRequiringUnlock(null);
        }}
        actionName={`Record payment on ${customer.name}'s debt ("${debtPaymentRequiringUnlock?.productOrService || 'Debt'}")`}
        actionType="customer_record_payment"
        targetId={debtPaymentRequiringUnlock?.id}
        actionData={debtPaymentRequiringUnlock ? {
          customerName: customer.name,
          itemName: debtPaymentRequiringUnlock.productOrService,
          price: debtPaymentRequiringUnlock.remainingBalance,
          totalAmount: debtPaymentRequiringUnlock.totalAmount,
        } : undefined}
      />

      {/* Problem 2 fix: Admin Unlock Modal for Editing Debt */}
      <AdminUnlockModal
        isOpen={!!debtEditRequiringUnlock}
        onClose={() => setDebtEditRequiringUnlock(null)}
        onSuccess={() => {
          if (debtEditRequiringUnlock) {
            setEditDebtName(debtEditRequiringUnlock.productOrService);
            setEditDebtAmount(String(debtEditRequiringUnlock.totalAmount));
            setEditingDebtId(debtEditRequiringUnlock.id);
          }
          setDebtEditRequiringUnlock(null);
        }}
        actionName={`Edit debt record for ${customer.name} ("${debtEditRequiringUnlock?.productOrService || 'Debt'}")`}
        actionType="customer_edit_debt"
        targetId={debtEditRequiringUnlock?.id}
        actionData={debtEditRequiringUnlock ? {
          customerName: customer.name,
          itemName: debtEditRequiringUnlock.productOrService,
          price: debtEditRequiringUnlock.totalAmount,
          remainingBalance: debtEditRequiringUnlock.remainingBalance,
        } : undefined}
      />
    </>
  );
};
