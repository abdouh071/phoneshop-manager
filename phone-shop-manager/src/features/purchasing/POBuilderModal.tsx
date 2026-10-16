import React, { useEffect, useState } from 'react';
import { X, Search, Plus, Trash2, Save, Send } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Input, SearchInput } from '../../components/ui/Input';
import { usePurchasingStore } from '../../store/purchasingStore';
import { useInventoryStore } from '../../store/inventoryStore';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency } from '../../utils/formatCurrency';
import type { PurchaseOrder, POItem, PhoneModel } from '../../types';
import styles from './POBuilderModal.module.css';

interface POBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  poId: string | null;
}

export const POBuilderModal: React.FC<POBuilderModalProps> = ({ isOpen, onClose, poId }) => {
  const { suppliers, purchaseOrders, addPO, updatePO } = usePurchasingStore();
  const { products, fetchProducts } = useInventoryStore();
  const toast = useToast();

  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [expectedDelivery, setExpectedDelivery] = useState('');
  const [items, setItems] = useState<POItem[]>([]);
  const [search, setSearch] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (products.length === 0) fetchProducts();
    }
  }, [isOpen, products.length, fetchProducts]);

  useEffect(() => {
    if (isOpen && poId) {
      const po = purchaseOrders.find(p => p.id === poId);
      if (po) {
        setSupplierId(po.supplierId);
        setNotes(po.notes || '');
        setExpectedDelivery(po.expectedDelivery ? po.expectedDelivery.split('T')[0] : '');
        setItems(po.items);
      }
    } else {
      setSupplierId('');
      setNotes('');
      setExpectedDelivery('');
      setItems([]);
      setSearch('');
    }
  }, [isOpen, poId, purchaseOrders]);

  if (!isOpen) return null;

  const handleAddItem = (p: PhoneModel) => {
    if (items.some(i => i.productId === p.id)) {
      toast.error('Already added', 'This product is already in the PO.');
      return;
    }
    setItems([...items, {
      productId: p.id,
      productName: `${p.name} ${p.model} ${p.color} ${p.storage}`,
      productSku: p.sku,
      requestedQty: 1,
      receivedQty: 0,
      unitCost: p.costPrice
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

    const supplier = suppliers.find(s => s.id === supplierId);
    if (!supplier) return;

    setIsSubmitting(true);
    try {
      const payload = {
        supplierId,
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

  const searchResults = search.trim() === '' ? [] : products.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.sku.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 5);

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div>
            <h2>{poId ? 'Edit Purchase Order' : 'New Purchase Order'}</h2>
          </div>
          <button className={styles.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>

        <div className={styles.body}>
          {/* Top Info */}
          <div className={styles.infoGrid}>
            <Select
              label="Supplier *"
              value={supplierId}
              onChange={setSupplierId}
              options={[{ value: '', label: 'Select a supplier...' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]}
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
