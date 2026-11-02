import React, { useEffect, useState, useMemo } from 'react';
import { X, Plus, Trash2, Save, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Input, SearchInput } from '../../components/ui/Input';
import { usePurchasingStore } from '../../store/purchasingStore';
import { useInventoryStore } from '../../store/inventoryStore';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency } from '../../utils/formatCurrency';
import { extractSuppliersFromInventory } from '../../utils/supplierUtils';
import type { PurchaseOrder, POItem, PhoneModel } from '../../types';
import styles from './POBuilderModal.module.css';

interface POBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  poId: string | null;
}

export const POBuilderModal: React.FC<POBuilderModalProps> = ({ isOpen, onClose, poId }) => {
  const { t } = useTranslation();
  const { suppliers, purchaseOrders, addPO, updatePO, addSupplier } = usePurchasingStore();
  const { products, parts, fetchAll } = useInventoryStore();
  const toast = useToast();

  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [expectedDelivery, setExpectedDelivery] = useState('');
  const [items, setItems] = useState<POItem[]>([]);
  const [search, setSearch] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch full inventory (products & repair parts) to ensure all product suppliers are available
  useEffect(() => {
    if (isOpen) {
      fetchAll();
    }
  }, [isOpen, fetchAll]);

  // Merge registered suppliers with suppliers previously added to products or parts
  const allSuppliers = useMemo(() => {
    return extractSuppliersFromInventory(suppliers, products, parts, purchaseOrders);
  }, [suppliers, products, parts, purchaseOrders]);

  const supplierOptions = useMemo(() => {
    const registeredCount = allSuppliers.filter(s => s.source === 'registered').length;
    const catalogCount = allSuppliers.filter(s => s.source === 'product_catalog').length;

    return [
      { value: '', label: 'Select a supplier...' },
      ...allSuppliers.map(s => {
        const isFromCatalog = s.source === 'product_catalog';
        const groupLabel = isFromCatalog ? '📦 Suppliers from Added Products' : '🏢 Registered Suppliers';
        return {
          value: s.id,
          label: isFromCatalog ? `${s.name} (from product catalog)` : s.name,
          group: registeredCount > 0 && catalogCount > 0 ? groupLabel : (isFromCatalog ? '📦 Suppliers from Added Products' : undefined),
        };
      })
    ];
  }, [allSuppliers]);

  useEffect(() => {
    if (isOpen && poId) {
      const po = purchaseOrders.find(p => p.id === poId);
      if (po) {
        // Match existing supplier by ID or case-insensitive name
        const match = allSuppliers.find(
          s => s.id === po.supplierId || s.name.toLowerCase() === po.supplierName?.toLowerCase()
        );
        setSupplierId(match ? match.id : po.supplierId);
        setNotes(po.notes || '');
        setExpectedDelivery(po.expectedDelivery ? po.expectedDelivery.split('T')[0] : '');
        setItems(po.items);
      }
    } else if (isOpen && !poId) {
      setSupplierId('');
      setNotes('');
      setExpectedDelivery('');
      setItems([]);
      setSearch('');
    }
  }, [isOpen, poId, purchaseOrders, allSuppliers]);

  if (!isOpen) return null;

  const handleAddItem = (p: PhoneModel) => {
    if (items.some(i => i.productId === p.id)) {
      toast.error('Already added', 'This item is already in the PO.');
      return;
    }
    const displayName = [p.name, p.model, p.color, p.storage].filter(Boolean).join(' ');
    setItems([...items, {
      productId: p.id,
      productName: displayName,
      productSku: p.sku || 'N/A',
      requestedQty: 1,
      receivedQty: 0,
      unitCost: p.costPrice || 0
    }]);
    setSearch('');
  };

  const updateItem = (index: number, updates: Partial<POItem>) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], ...updates };
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const totalAmount = items.reduce((sum, item) => sum + (item.requestedQty * item.unitCost), 0);

  const handleSave = async (status: PurchaseOrder['status']) => {
    if (!supplierId) {
      toast.error('Missing Supplier', 'Please select a supplier.');
      return;
    }
    if (items.length === 0) {
      toast.error('Empty PO', 'Please add at least one item to the PO.');
      return;
    }

    const supplier = allSuppliers.find(s => s.id === supplierId);
    if (!supplier) {
      toast.error('Supplier Not Found', 'Could not resolve the selected supplier.');
      return;
    }

    setIsSubmitting(true);
    try {
      let finalSupplierId = supplier.id;

      // If supplier was picked from product catalog and isn't yet an official registered supplier,
      // register it in Firestore suppliers collection so it has a permanent profile and ID.
      if (supplier.source === 'product_catalog' || supplier.id.startsWith('inv_sup_')) {
        try {
          const registered = await addSupplier({
            name: supplier.name,
            notes: `Auto-registered from inventory product catalog when creating PO.`,
          });
          if (registered?.id) {
            finalSupplierId = registered.id;
          }
        } catch (e) {
          console.warn('Could not auto-register supplier to suppliers collection, continuing with synthesized ID:', e);
        }
      }

      const payload = {
        supplierId: finalSupplierId,
        supplierName: supplier.name,
        status,
        orderDate: new Date().toISOString(),
        expectedDelivery: expectedDelivery ? new Date(expectedDelivery).toISOString() : undefined,
        items,
        totalAmount,
        notes: notes || undefined,
      };

      if (poId) {
        await updatePO(poId, payload);
        toast.success('PO Updated', `Purchase order updated as ${status}.`);
      } else {
        await addPO(payload);
        toast.success('PO Created', `Purchase order saved as ${status}.`);
      }
      onClose();
    } catch (err) {
      toast.error('Error', 'Failed to save purchase order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const allInventory = [...products, ...parts];
  const searchResults = search.trim() === '' ? [] : allInventory.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    (p.sku && p.sku.toLowerCase().includes(search.toLowerCase())) ||
    (p.model && p.model.toLowerCase().includes(search.toLowerCase()))
  ).slice(0, 8);

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div>
            <h2>{poId ? 'Edit Purchase Order' : 'New Purchase Order'}</h2>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label={t('common.close')}><X size={20} /></button>
        </div>

        <div className={styles.body}>
          {/* Top Info */}
          <div className={styles.infoGrid}>
            <Select
              label="Supplier *"
              value={supplierId}
              onChange={setSupplierId}
              options={supplierOptions}
            />
            <Input
              label="Expected Delivery (Optional)"
              type="date"
              value={expectedDelivery}
              onChange={e => setExpectedDelivery(e.target.value)}
            />
          </div>

          {/* Product Search */}
          <div className={styles.searchSection}>
            <label className={styles.label}>Add Items</label>
            <div className={styles.searchBox}>
              <SearchInput
                placeholder="Search inventory to add items..."
                value={search}
                onChange={setSearch}
              />
              {searchResults.length > 0 && (
                <div className={styles.searchResults}>
                  {searchResults.map(p => (
                    <div key={p.id} className={styles.searchResultItem} onClick={() => handleAddItem(p)}>
                      <div>
                        <strong>{p.name} {p.model}</strong> ({p.color})
                        <code className={styles.searchSku}>{p.sku}</code>
                      </div>
                      <Plus size={16} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Items Table */}
          <div className={styles.itemsTable}>
            <div className={styles.tableHeader}>
              <div style={{ flex: 2 }}>Product</div>
              <div style={{ width: 100 }}>Unit Cost</div>
              <div style={{ width: 80 }}>Qty</div>
              <div style={{ width: 100 }}>Total</div>
              <div style={{ width: 40 }}></div>
            </div>
            {items.length === 0 ? (
              <div className={styles.emptyItems}>No items added yet.</div>
            ) : (
              <div className={styles.tableBody}>
                {items.map((item, index) => (
                  <div key={item.productId} className={styles.tableRow}>
                    <div style={{ flex: 2, display: 'flex', flexDirection: 'column' }}>
                      <span className={styles.itemName}>{item.productName}</span>
                      <code className={styles.itemSku}>{item.productSku}</code>
                    </div>
                    <div style={{ width: 100 }}>
                      <input 
                        type="number" 
                        min="0" 
                        step="0.01" 
                        className={styles.numberInput}
                        value={item.unitCost}
                        onChange={e => updateItem(index, { unitCost: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                    <div style={{ width: 80 }}>
                      <input 
                        type="number" 
                        min="1" 
                        className={styles.numberInput}
                        value={item.requestedQty}
                        onChange={e => updateItem(index, { requestedQty: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                    <div style={{ width: 100, fontWeight: 600, paddingTop: 8 }}>
                      {formatCurrency(item.requestedQty * item.unitCost)}
                    </div>
                    <div style={{ width: 40, paddingTop: 4 }}>
                      <button className={styles.deleteBtn} onClick={() => removeItem(index)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className={styles.tableFooter}>
              <span>Total Amount:</span>
              <span className={styles.totalAmount}>{formatCurrency(totalAmount)}</span>
            </div>
          </div>

          <Input
            label="Notes"
            placeholder="Additional instructions for supplier..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        <div className={styles.footer}>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button 
              variant="secondary" 
              leftIcon={<Save size={16} />} 
              onClick={() => handleSave('draft')}
              isLoading={isSubmitting}
            >
              Save as Draft
            </Button>
            <Button 
              leftIcon={<Send size={16} />} 
              onClick={() => handleSave('sent')}
              isLoading={isSubmitting}
            >
              Mark as Sent
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
