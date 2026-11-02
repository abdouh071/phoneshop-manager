import React from 'react';
import { ReceiptModal } from './ReceiptModal';
import { CashDrawerModal } from './CashDrawerModal';
import { VariantSelectModal } from './VariantSelectModal';
import { TouchQuantityModal } from './TouchQuantityModal';
import { MobileBarcodeScannerModal } from '../../components/pos/MobileBarcodeScannerModal';
import type { CartItem, PhoneModel, SaleTransaction } from '../../types';
import type { ProductGroup } from '../../utils/productGrouping';

interface PosOverlayModalsProps {
  completedTx: SaleTransaction | null;
  setCompletedTx: React.Dispatch<React.SetStateAction<SaleTransaction | null>>;
  isCashDrawerOpen: boolean;
  setIsCashDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedGroup: ProductGroup | null;
  setSelectedGroup: React.Dispatch<React.SetStateAction<ProductGroup | null>>;
  addToCart: (product: PhoneModel) => { success: boolean; reason?: 'out_of_stock' | 'max_reached'; availableStock?: number };
  touchQtyTarget: { item: CartItem; maxStock: number; isReturn: boolean } | null;
  setTouchQtyTarget: React.Dispatch<React.SetStateAction<{ item: CartItem; maxStock: number; isReturn: boolean } | null>>;
  updateQuantity: (productId: string, quantity: number, isReturn?: boolean) => { success: boolean; reason?: 'max_reached'; availableStock?: number };
  isCameraScannerOpen: boolean;
  setIsCameraScannerOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export const PosOverlayModals: React.FC<PosOverlayModalsProps> = ({
  completedTx,
  setCompletedTx,
  isCashDrawerOpen,
  setIsCashDrawerOpen,
  selectedGroup,
  setSelectedGroup,
  addToCart,
  touchQtyTarget,
  setTouchQtyTarget,
  updateQuantity,
  isCameraScannerOpen,
  setIsCameraScannerOpen,
}) => {
  return (
    <>
      <ReceiptModal
        transaction={completedTx}
        onClose={() => setCompletedTx(null)}
      />

      <CashDrawerModal
        isOpen={isCashDrawerOpen}
        onClose={() => setIsCashDrawerOpen(false)}
      />

      <VariantSelectModal
        group={selectedGroup}
        onClose={() => setSelectedGroup(null)}
        onSelect={(variant) => {
          addToCart(variant);
          setSelectedGroup(null);
        }}
      />

      <TouchQuantityModal
        isOpen={Boolean(touchQtyTarget)}
        item={touchQtyTarget?.item || null}
        maxStock={touchQtyTarget?.maxStock || 999}
        onClose={() => setTouchQtyTarget(null)}
        onApply={(newQty) => {
          if (touchQtyTarget) {
            updateQuantity(touchQtyTarget.item.product.id, newQty, touchQtyTarget.isReturn);
          }
        }}
      />

      <MobileBarcodeScannerModal
        isOpen={isCameraScannerOpen}
        onClose={() => setIsCameraScannerOpen(false)}
      />
    </>
  );
};
