import React, { useState, useEffect } from 'react';
import { X, Save, ShieldAlert, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input, TextArea } from '../../components/ui/Input';
import { useInventoryStore } from '../../store/inventoryStore';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../components/ui/Toast';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { usePermissions } from '../../hooks/usePermissions';
import { useSettingsStore } from '../../store/settingsStore';
import { getCurrencySymbol } from '../../utils/formatCurrency';
import type { PhoneModel } from '../../types';
import { ProfitMarginCalculator } from '../../components/ui/ProfitMarginCalculator';
import styles from '../inventory/ProductForm.module.css';

interface EditPartPanelProps {
  product: PhoneModel | null;
  onClose: () => void;
}

export const EditPartPanel: React.FC<EditPartPanelProps> = ({ product, onClose }) => {
  const { updateProduct, deleteProduct } = useInventoryStore();
  const toast = useToast();
  const permissions = usePermissions();
  const { user } = useAuthStore();
  const canViewCosts = user?.role === 'admin' || (permissions.inventory_edit && permissions.reports);
  const { currency } = useSettingsStore();
  const symbol = getCurrencySymbol(currency);

  const [form, setForm] = useState<Partial<PhoneModel>>({});
  const [isDeleting, setIsDeleting] = useState(false);
  const [showAdminUnlock, setShowAdminUnlock] = useState(false);

  useEffect(() => {
    if (product) {
      setForm(product);
    }
  }, [product]);

  if (!product) return null;

  const set = (key: keyof PhoneModel, value: any) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!form.name?.trim() || !form.model?.trim() || !form.price || !form.costPrice) {
      toast.error('Missing Required Fields');
      return;
    }

    const stock = Number(form.stock);
    const threshold = Number(form.lowStockThreshold) || 1;

    const updates: Partial<PhoneModel> = {
      ...form,
      price: Number(form.price),
      costPrice: Number(form.costPrice),
      stock,
      lowStockThreshold: threshold,
      stockStatus: stock === 0 ? 'out_of_stock' : stock <= threshold ? 'low_stock' : 'in_stock',
    };

    try {
      await updateProduct(product.id, updates);
      toast.success('Part Updated', `${updates.name} has been updated.`);
      onClose();
    } catch (err) {
      toast.error('Failed to update part');
    }
  };

  const handleDelete = async () => {
    try {
      await deleteProduct(product.id);
      toast.success('Part Deleted');
      setIsDeleting(false);
      onClose();
    } catch (err) {
      toast.error('Failed to delete part');
    }
  };

  const requestDelete = () => {
    if (permissions.inventory_delete) {
      setIsDeleting(true);
    } else {
      setShowAdminUnlock(true);
    }
  };

  return (
    <div className={styles.slidePanel}>
      <AdminUnlockModal
        isOpen={showAdminUnlock}
        onClose={() => setShowAdminUnlock(false)}
        onSuccess={() => { setShowAdminUnlock(false); setIsDeleting(true); }}
        actionName="delete this part"
      />

      <ConfirmDialog
        isOpen={isDeleting}
        title="Delete Part?"
        message={`Are you sure you want to delete ${product.name}? This action cannot be undone.`}
        confirmLabel="Delete"
        isDanger
        onConfirm={handleDelete}
        onCancel={() => setIsDeleting(false)}
      />

      <div className={styles.slidePanelHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Button variant="ghost" size="sm" onClick={onClose}><X size={20} /></Button>
          <h2 className={styles.sectionTitle} style={{ margin: 0 }}>Edit Part</h2>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button variant="danger" size="sm" leftIcon={<Trash2 size={16} />} onClick={requestDelete}>Delete</Button>
          <Button size="sm" leftIcon={<Save size={16} />} onClick={handleSubmit}>Save Changes</Button>
        </div>
      </div>

      <div className={styles.slidePanelBody}>
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Part Details</h3>
          <div className={styles.grid2}>
            <Input label="Part Name *" value={form.name || ''} onChange={e => set('name', e.target.value)} />
            <Input label="Compatible Model(s) *" value={form.model || ''} onChange={e => set('model', e.target.value)} />
          </div>
          <div className={styles.grid2} style={{ marginTop: '16px' }}>
            <Input label="SKU / Barcode" value={form.sku || ''} onChange={e => set('sku', e.target.value)} />
            <Input label="Bin / Location" value={form.location || ''} onChange={e => set('location', e.target.value)} />
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Pricing & Stock</h3>
          <div className={styles.grid3}>
            {canViewCosts && (
              <Input label={`Cost Price (${symbol}) *`} type="number" step="0.01" value={form.costPrice?.toString() || ''} onChange={e => set('costPrice', e.target.value)} />
            )}
            <Input label={`Sell Price (${symbol}) *`} type="number" step="0.01" value={form.price?.toString() || ''} onChange={e => set('price', e.target.value)} />
            <Input label="Current Stock *" type="number" value={form.stock?.toString() || ''} onChange={e => set('stock', e.target.value)} />
          </div>

          {/* Live Profit & Margin Breakdown — only for authorized staff */}
          {canViewCosts && (
            <div style={{ marginTop: '12px' }}>
              <ProfitMarginCalculator
                costPrice={form.costPrice || 0}
                sellPrice={form.price || 0}
                stock={form.stock || 0}
                onApplySellPrice={(suggested) => set('price', suggested)}
              />
            </div>
          )}

          <div className={styles.grid2} style={{ marginTop: '16px' }}>
            <Input label="Low Stock Alert Threshold" type="number" value={form.lowStockThreshold?.toString() || ''} onChange={e => set('lowStockThreshold', e.target.value)} />
            <Input label="Supplier" value={form.supplier || ''} onChange={e => set('supplier', e.target.value)} />
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Additional Info</h3>
          <TextArea label="Notes" rows={4} value={form.notes || ''} onChange={e => set('notes', e.target.value)} />
        </div>
      </div>
    </div>
  );
};
