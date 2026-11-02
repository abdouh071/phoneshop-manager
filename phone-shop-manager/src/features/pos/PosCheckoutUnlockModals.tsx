import React from 'react';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { useToast } from '../../components/ui/Toast';
import type { CartItem, Customer } from '../../types';
import { formatCurrency } from '../../utils/formatCurrency';

interface PosCheckoutUnlockModalsProps {
  showCreditLimitUnlock: boolean;
  setShowCreditLimitUnlock: React.Dispatch<React.SetStateAction<boolean>>;
  setCreditLimitOverrideApproved: React.Dispatch<React.SetStateAction<boolean>>;
  showDiscountUnlock: boolean;
  setShowDiscountUnlock: React.Dispatch<React.SetStateAction<boolean>>;
  pendingDiscountValue: number | null;
  setPendingDiscountValue: React.Dispatch<React.SetStateAction<number | null>>;
  setDiscount: (discount: { type: 'percent' | 'flat'; value: number } | null) => void;
  matchedCustomer: Customer | null;
  customerName: string;
  total: number;
  items: CartItem[];
}

export const PosCheckoutUnlockModals: React.FC<PosCheckoutUnlockModalsProps> = ({
  showCreditLimitUnlock,
  setShowCreditLimitUnlock,
  setCreditLimitOverrideApproved,
  showDiscountUnlock,
  setShowDiscountUnlock,
  pendingDiscountValue,
  setPendingDiscountValue,
  setDiscount,
  matchedCustomer,
  customerName,
  total,
  items,
}) => {
  const toast = useToast();

  return (
    <>
      {/* Admin Unlock Modal for Credit Limit Breach (Problem 2) */}
      <AdminUnlockModal
        isOpen={showCreditLimitUnlock}
        onClose={() => setShowCreditLimitUnlock(false)}
        onSuccess={() => {
          setShowCreditLimitUnlock(false);
          setCreditLimitOverrideApproved(true);
          toast.success('Credit Limit Overridden', 'Admin authorization verified.');
        }}
        actionName={`Override credit limit for ${matchedCustomer?.name || customerName || 'customer'}`}
        actionType="pos_credit_limit_override"
        actionData={{
          itemType: 'pos_credit',
          customerName: matchedCustomer?.name || customerName || 'Customer',
          creditLimit: matchedCustomer?.creditLimit || 0,
          currentDebt: matchedCustomer?.debt || 0,
          cartTotal: total,
          itemCount: items.length,
        }}
      />

      {/* Admin Unlock Modal for Large Manual Discount (Problem 5) */}
      <AdminUnlockModal
        isOpen={showDiscountUnlock}
        onClose={() => {
          setShowDiscountUnlock(false);
          setPendingDiscountValue(null);
        }}
        onSuccess={() => {
          setShowDiscountUnlock(false);
          if (pendingDiscountValue !== null) {
            setDiscount({ type: 'flat', value: pendingDiscountValue });
            setPendingDiscountValue(null);
            toast.success('Discount Authorized', 'Admin authorization verified.');
          }
        }}
        actionName={`Authorize discount of ${pendingDiscountValue ? formatCurrency(pendingDiscountValue) : ''}`}
        actionType="pos_discount_override"
        actionData={{
          itemType: 'pos_discount',
          discountAmount: pendingDiscountValue || 0,
          cartTotal: total,
          customerName: matchedCustomer?.name || customerName || 'Walk-in Customer',
          itemCount: items.length,
        }}
      />
    </>
  );
};
