import React from 'react';
import { Modal } from '../../components/ui/Modal';
import { SearchInput } from '../../components/ui/Input';
import type { PhoneModel } from '../../types';
import styles from './CustomTicket.module.css';

interface InventoryPickerModalProps {
  isInventoryModalOpen: boolean;
  setIsInventoryModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  inventorySearch: string;
  setInventorySearch: React.Dispatch<React.SetStateAction<string>>;
  filteredProducts: PhoneModel[];
  handleSelectInventoryProduct: (prod: PhoneModel) => void;
  currencySymbol: string;
}

export const InventoryPickerModal: React.FC<InventoryPickerModalProps> = (props) => {
  const {
    isInventoryModalOpen,
    setIsInventoryModalOpen,
    inventorySearch,
    setInventorySearch,
    filteredProducts,
    handleSelectInventoryProduct,
    currencySymbol,
  } = props;

  return (
    <Modal
      isOpen={isInventoryModalOpen}
      onClose={() => setIsInventoryModalOpen(false)}
      title="Load Product from Inventory"
      subtitle="Select any in-stock smartphone or accessory to auto-fill its specifications"
      size="md"
    >
      <SearchInput
        value={inventorySearch}
        onChange={setInventorySearch}
        placeholder="Search by name, model, storage, SKU..."
      />

      <div className={styles.inventorySearchModal}>
        {filteredProducts.length === 0 ? (
          <p style={{ textAlign: 'center', padding: '20px', color: '#64748b', fontSize: '13px' }}>
            No products found matching &quot;{inventorySearch}&quot;.
          </p>
        ) : (
          filteredProducts.map(p => (
            <div
              key={p.id}
              className={styles.inventoryItemCard}
              onClick={() => handleSelectInventoryProduct(p)}
            >
              <div>
                <div className={styles.inventoryItemName}>
                  {p.name} {p.model}
                </div>
                <div className={styles.inventoryItemMeta}>
                  {[p.storage && p.storage !== 'N/A' ? p.storage : null, p.color, p.sku ? `SKU: ${p.sku}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <div className={styles.inventoryItemPrice}>
                {p.price} {currencySymbol}
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
};
