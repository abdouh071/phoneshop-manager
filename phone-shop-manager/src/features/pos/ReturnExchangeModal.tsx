import React, { useState, useMemo } from 'react';
import { Search, RefreshCw, AlertCircle, CheckCircle, Package, ArrowDownLeft } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useInventoryStore } from '../../store/inventoryStore';
import { useCartStore } from '../../store/cartStore';
import { useAuthStore } from '../../store/authStore';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import type { PhoneModel } from '../../types';
import { formatCurrency } from '../../utils/formatCurrency';
import styles from './ReturnExchangeModal.module.css';

interface ReturnExchangeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const RETURN_REASONS = [
  'Customer Exchange (Changement de modèle)',
  'Wrong Model / Incompatible (Erreur de modèle)',
  'Customer Changed Mind (Changement d\'avis)',
  'Defective / Faulty (Défectueux / Panne)',
  'Warranty Return (Retour sous garantie)',
  'Other Reason (Autre raison)',
];

export const ReturnExchangeModal: React.FC<ReturnExchangeModalProps> = ({ isOpen, onClose }) => {
  const { products } = useInventoryStore();
  const { addReturnItem, customerName, transactions } = useCartStore();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<PhoneModel | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [customPrice, setCustomPrice] = useState<number | null>(null);
  const [reason, setReason] = useState<string>(RETURN_REASONS[0]);
  const [restock, setRestock] = useState<boolean>(true);
  const [showAdminUnlock, setShowAdminUnlock] = useState<boolean>(false);

  // Past purchases by attached customer (if any)
  const customerPastPurchasedProducts = useMemo(() => {
    if (!customerName || !customerName.trim()) return [];
    const qName = customerName.toLowerCase().trim();
    const custTxs = transactions.filter(t => t.customerName && t.customerName.toLowerCase().trim() === qName);
    const seen = new Set<string>();
    const list: PhoneModel[] = [];

    custTxs.forEach(t => {
      t.items.forEach(item => {
        if (!item.isReturn && item.product.category !== 'repair_part' && !seen.has(item.product.id)) {
          seen.add(item.product.id);
          list.push(item.product);
        }
      });
    });

    return list.slice(0, 6);
  }, [customerName, transactions]);

  // Filter products by search query
  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) {
      return customerPastPurchasedProducts.length > 0
        ? customerPastPurchasedProducts
        : products.slice(0, 10);
    }
    const q = searchQuery.toLowerCase().trim();
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.model.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q)
    ).slice(0, 15);
  }, [searchQuery, products, customerPastPurchasedProducts]);

  const handleSelectProduct = (product: PhoneModel) => {
    setSelectedProduct(product);
    setCustomPrice(product.price);
    setQuantity(1);
  };

  const executeConfirmReturn = () => {
    if (!selectedProduct) return;
    const finalPrice = customPrice !== null ? customPrice : selectedProduct.price;

    addReturnItem(selectedProduct, {
      quantity: Math.max(1, quantity),
      returnReason: reason,
      restock,
      customReturnPrice: finalPrice,
    });

    // Reset and close
    setSelectedProduct(null);
    setSearchQuery('');
    setCustomPrice(null);
    setQuantity(1);
    onClose();
  };

  const handleConfirmReturn = () => {
    if (!selectedProduct) return;
    const finalPrice = customPrice !== null ? customPrice : selectedProduct.price;

    // Problem 10 fix: If return credit exceeds catalog price, require admin authorization
    if (finalPrice > selectedProduct.price && !isAdmin) {
      setShowAdminUnlock(true);
      return;
    }

    executeConfirmReturn();
  };

  const currentUnitReturnPrice = selectedProduct
    ? (customPrice !== null ? customPrice : selectedProduct.price)
    : 0;
  const totalReturnCredit = currentUnitReturnPrice * quantity;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="🔄 Return or Exchange Item"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirmReturn}
            disabled={!selectedProduct}
            leftIcon={<ArrowDownLeft size={16} />}
            style={{ background: '#b45309', borderColor: '#b45309', color: '#ffffff' }}
          >
            Add Return to Cart (-{formatCurrency(totalReturnCredit)})
          </Button>
        </>
      }
    >
      <div className={styles.modalContent}>
        {/* Search Bar */}
        <div className={styles.searchWrap}>
          <Search size={16} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search returned item by name, model, or barcode/SKU..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className={styles.searchInput}
            autoFocus
          />
        </div>

        {/* Product Selection List */}
        <div>
          <div className={styles.sectionTitle}>
            {customerPastPurchasedProducts.length > 0 && !searchQuery.trim()
              ? `Recent Purchases by ${customerName}`
              : 'Select Product Being Returned'}
          </div>
          <div className={styles.resultsList}>
            {filteredProducts.length === 0 ? (
              <div className={styles.emptyState}>No products found matching &quot;{searchQuery}&quot;</div>
            ) : (
              filteredProducts.map(product => {
                const isSelected = selectedProduct?.id === product.id;
                return (
                  <button
                    key={product.id}
                    type="button"
                    className={[styles.resultItem, isSelected && styles.resultItemSelected].filter(Boolean).join(' ')}
                    onClick={() => handleSelectProduct(product)}
                  >
                    <div className={styles.itemMain}>
                      <span className={styles.itemName}>{product.name} {product.model}</span>
                      <span className={styles.itemSub}>
                        SKU: {product.sku} • Stock: {product.stock}
                      </span>
                    </div>
                    <span className={styles.itemPrice}>{formatCurrency(product.price)}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Selected Product Form */}
        {selectedProduct && (
          <div className={styles.selectedCard}>
            <div className={styles.selectedHeader}>
              <span className={styles.selectedTitle}>
                📦 {selectedProduct.name} {selectedProduct.model}
              </span>
              <span style={{ fontSize: '12px', color: '#78350f', fontWeight: 600 }}>
                Catalog Price: {formatCurrency(selectedProduct.price)}
              </span>
            </div>

            <div className={styles.formGrid}>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Quantity Returned:</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={quantity}
                  onChange={e => setQuantity(Math.max(1, Number(e.target.value)))}
                  className={styles.fieldInput}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Return Price per Unit (DA):</label>
                <input
                  type="number"
                  min={0}
                  value={customPrice !== null ? customPrice : selectedProduct.price}
                  onChange={e => setCustomPrice(Math.max(0, Number(e.target.value)))}
                  className={styles.fieldInput}
                />
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>Reason for Return / Exchange:</label>
              <select
                value={reason}
                onChange={e => setReason(e.target.value)}
                className={styles.selectInput}
              >
                {RETURN_REASONS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={restock}
                onChange={e => setRestock(e.target.checked)}
                className={styles.checkbox}
              />
              <span>Return item to inventory (+{quantity} to active sellable stock)</span>
            </label>

            {customPrice !== null && customPrice > selectedProduct.price && (
              <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', color: '#92400e', marginTop: '8px' }}>
                ⚠️ <strong>High Return Price Warning:</strong> The return unit price ({formatCurrency(customPrice)}) exceeds the catalog price ({formatCurrency(selectedProduct.price)}).
                {!isAdmin && ' Admin authorization will be required to proceed.'}
              </div>
            )}

            <div className={styles.creditSummaryBanner}>
              <span>Total Return Credit Applied:</span>
              <span>-{formatCurrency(totalReturnCredit)}</span>
            </div>
          </div>
        )}
      </div>

      <AdminUnlockModal
        isOpen={showAdminUnlock}
        onClose={() => setShowAdminUnlock(false)}
        onSuccess={() => {
          setShowAdminUnlock(false);
          executeConfirmReturn();
        }}
        actionName={`Authorize high return credit for ${selectedProduct?.name || 'item'}`}
        actionType="pos_high_return_credit"
        actionData={selectedProduct ? {
          itemType: 'return_exchange',
          productName: selectedProduct.name,
          sku: selectedProduct.sku,
          catalogPrice: selectedProduct.price,
          customReturnPrice: customPrice ?? selectedProduct.price,
          totalReturnCredit,
          quantity,
          returnReason: reason || undefined,
        } : undefined}
      />
    </Modal>
  );
};
