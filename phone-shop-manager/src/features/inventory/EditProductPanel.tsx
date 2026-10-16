import React, { useState, useEffect } from 'react';
import { SlidePanel } from '../../components/ui/SlidePanel';
import { Button } from '../../components/ui/Button';
import { Input, TextArea } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useInventoryStore } from '../../store/inventoryStore';
import { useToast } from '../../components/ui/Toast';
import { useSettingsStore } from '../../store/settingsStore';
import { formatCurrency, getCurrencySymbol } from '../../utils/formatCurrency';
import { ProfitMarginCalculator } from '../../components/ui/ProfitMarginCalculator';
import type { PhoneModel } from '../../types';
import styles from './ProductForm.module.css';

interface EditProductPanelProps {
  product: PhoneModel | null;
  onClose: () => void;
}

const CATEGORY_OPTIONS = [
  { value: 'smartphone', label: 'Smartphone' },
  { value: 'tablet', label: 'Tablet' },
  { value: 'accessory', label: 'Accessory' },
  { value: 'wearable', label: 'Wearable' },
];

export const EditProductPanel: React.FC<EditProductPanelProps> = ({ product, onClose }) => {
  const { currency } = useSettingsStore();
  const symbol = getCurrencySymbol(currency);
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [price, setPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [stock, setStock] = useState('');
  const [category, setCategory] = useState<PhoneModel['category']>('smartphone');

  const [supplier, setSupplier] = useState('');
  const [location, setLocation] = useState('');

  const [lowStockThreshold, setLowStockThreshold] = useState('5');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  const { updateProduct, deleteProduct } = useInventoryStore();
  const toast = useToast();

  useEffect(() => {
    if (product) {
      setName(product.name || '');
      setModel(product.model || '');
      setPrice(product.price.toString());
      setCostPrice(product.costPrice.toString());
      setStock(product.stock.toString());
      setCategory(product.category);

      setSupplier(product.supplier ?? '');
      setLocation(product.location ?? '');

      setLowStockThreshold((product.lowStockThreshold ?? 1).toString());
      setNotes(product.notes ?? '');
    }
  }, [product]);

  if (!product) return null;

  const handleSave = async () => {
    const trimmedName = name.trim();
    const trimmedModel = model.trim();

    if (!trimmedName) {
      toast.error('Invalid Name', 'Product name cannot be empty.');
      return;
    }
    if (!trimmedModel) {
      toast.error('Invalid Model', 'Product model cannot be empty.');
      return;
    }

    const priceNum = Number(price);
    const costNum = Number(costPrice);
    const stockNum = Number(stock);
    const threshold = Number(lowStockThreshold) || 5;

    if (!price || isNaN(priceNum) || priceNum <= 0) {
      toast.error('Invalid Price', 'Sell price must be a positive number.');
      return;
    }
    if (!costPrice || isNaN(costNum) || costNum <= 0) {
      toast.error('Invalid Cost', 'Buy/Cost price must be a positive number.');
      return;
    }
    if (stock === '' || isNaN(stockNum) || stockNum < 0) {
      toast.error('Invalid Stock', 'Stock quantity must be 0 or more.');
      return;
    }

    setIsSubmitting(true);
    // Note: SKU is strictly excluded from updates so it is NEVER changed or regenerated when name is edited
    await updateProduct(product.id, {
      name: trimmedName,
      model: trimmedModel,
      price: priceNum,
      costPrice: costNum,
      stock: stockNum,
      category,
      supplier: supplier.trim() || undefined,
      location: location.trim() || undefined,
      lowStockThreshold: threshold,
      notes: notes.trim() || undefined,
    });
    toast.success('Product updated', `${trimmedName} ${trimmedModel} saved successfully.`);
    setIsSubmitting(false);
    onClose();
  };

  const handleDelete = async () => {
    setIsSubmitting(true);
    await deleteProduct(product.id);
    toast.success('Product deleted', `${product.name} ${product.model} has been removed.`);
    setIsSubmitting(false);
    setShowConfirmDelete(false);
    onClose();
  };

  const sellPrice = Number(price);
  const costNum = Number(costPrice);
  const margin = sellPrice > 0 ? (((sellPrice - costNum) / sellPrice) * 100).toFixed(1) : '0';
  const profit = (sellPrice - costNum).toFixed(2);

  return (
    <>
      <SlidePanel
        isOpen={!!product}
        onClose={onClose}
        title="Edit Product"
        subtitle={`${name || product.name} ${model || product.model}${product.category !== 'accessory' && product.storage && product.storage.trim().toUpperCase() !== 'N/A' && product.storage.trim().toLowerCase() !== 'none' ? ` · ${product.storage}` : ''}`}
        width="md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
            <Button onClick={handleSave} isLoading={isSubmitting}>Save Changes</Button>
          </>
        }
      >
        <div className={styles.form}>

          <p className={styles.sectionLabel}>Product Information</p>
          <div className={styles.row}>
            <Input
              label="Product Name *"
              placeholder="e.g. Apple, Samsung, Anker"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <Input
              label="Model *"
              placeholder="e.g. iPhone 15 Pro, Charger 20W"
              value={model}
              onChange={e => setModel(e.target.value)}
            />
          </div>

          <div className={styles.row}>
            <Select
              label="Category"
              options={CATEGORY_OPTIONS}
              value={category}
              onChange={v => setCategory(v as PhoneModel['category'])}
            />
            <div className={styles.skuInput}>
              <Input
                label="SKU / Barcode (Permanent)"
                value={product.sku || 'N/A'}
                disabled
                title="SKU barcode is permanent and cannot be changed"
              />
            </div>
          </div>

          <p className={styles.sectionLabel}>Pricing</p>
          <div className={styles.row}>
            <Input label={`Buy Price / Cost (${symbol})`} type="number" value={costPrice}
              onChange={e => setCostPrice(e.target.value)} />
            <Input label={`Sell Price (${symbol})`} type="number" value={price}
              onChange={e => setPrice(e.target.value)} />
          </div>

          <div style={{ marginTop: '4px' }}>
            <ProfitMarginCalculator
              costPrice={costPrice}
              sellPrice={price}
              stock={stock}
              onApplySellPrice={(suggested) => setPrice(suggested.toString())}
            />
          </div>

          <p className={styles.sectionLabel}>Stock</p>
          <div className={styles.row}>
            <Input label="Current Stock" type="number" value={stock}
              onChange={e => setStock(e.target.value)} />
            <Input label="Low Stock Threshold" type="number" value={lowStockThreshold}
              onChange={e => setLowStockThreshold(e.target.value)} />
          </div>

          <p className={styles.sectionLabel}>Supplier & Tracking</p>
          <Input label="Supplier" placeholder="e.g. Tech Distro Ltd" value={supplier}
            onChange={e => setSupplier(e.target.value)} />
          <Input label="Storage Location" placeholder="e.g. Shelf A3" value={location}
            onChange={e => setLocation(e.target.value)} />

          <TextArea label="Internal Notes" placeholder="Optional staff notes..." value={notes}
            onChange={e => setNotes(e.target.value)} rows={2} />

          <div className={styles.dangerZone}>
            <p className={styles.dangerTitle}>Danger Zone</p>
            <p className={styles.dangerDesc}>Once you delete a product, there is no going back. Please be certain.</p>
            <Button variant="danger" onClick={() => setShowConfirmDelete(true)} className={styles.deleteBtn}>
              Delete Product
            </Button>
          </div>
        </div>
      </SlidePanel>

      <ConfirmDialog
        isOpen={showConfirmDelete}
        onClose={() => setShowConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete Product"
        message={`Are you sure you want to delete ${product.name} ${product.model}? This action cannot be undone.`}
        confirmLabel="Delete"
        isLoading={isSubmitting}
      />
    </>
  );
};
