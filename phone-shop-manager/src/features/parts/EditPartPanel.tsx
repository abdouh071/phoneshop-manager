import React, { useState, useEffect } from 'react';
import { X, Save, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
import { computeStockStatus } from '../../utils/stockStatus';
import { findCodeCollisions } from '../../utils/productCode';
import { errorMessage } from '../../utils/errorUtils';
import type { PhoneModel } from '../../types';
import { ProfitMarginCalculator } from '../../components/ui/ProfitMarginCalculator';
import styles from '../inventory/ProductForm.module.css';

interface EditPartPanelProps {
  product: PhoneModel | null;
  onClose: () => void;
}

export const EditPartPanel: React.FC<EditPartPanelProps> = ({ product, onClose }) => {
  const { t } = useTranslation();
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

  const set = (key: keyof PhoneModel, value: unknown) => {
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
      stockStatus: computeStockStatus(stock, threshold),
    };

    // The "SKU / Barcode" field is editable here, and a code saved on two rows makes
    // every later scan answer to whichever came first — the wrong item sold in silence.
    const nextSku = (updates.sku || '').trim();
    if (nextSku && nextSku.toUpperCase() !== (product.sku || '').toUpperCase()) {
      const { products, parts } = useInventoryStore.getState();
      const collisions = findCodeCollisions([...products, ...parts], {
        id: product.id,
        sku: nextSku,
        barcode: updates.barcode,
      });
      if (collisions.length > 0) {
        toast.error(
          'Code Already on Another Product',
          `${collisions[0]}. Give this part its own code, or one scan will sell two different items.`
        );
        return;
      }
    }

    const outcome = await updateProduct(product.id, updates);
    if (outcome === 'committed') {
      toast.success('Part Updated', `${updates.name} has been updated.`);
    } else if (outcome === 'queued') {
      toast.info('Saved offline', `${updates.name} is kept on this device and syncs when you reconnect.`);
    } else {
      toast.warning('Not saved to the server', `${updates.name} is kept on this device and will retry syncing automatically.`);
    }
    onClose();
  };

  const handleDelete = async () => {
    const label = `${product.name} ${product.model}`.trim();
    try {
      const outcome = await deleteProduct(product.id);
      if (outcome === 'committed') {
        toast.success(t('inventory.deletedTitle'), t('inventory.deletedDesc', { name: label }));
      } else if (outcome === 'queued') {
        // The server document is still there; only this till stopped showing it.
        toast.info(t('inventory.deleteQueuedTitle'), t('inventory.deleteQueuedDesc', { name: label }));
      } else {
        toast.error(t('inventory.deleteFailedTitle'), t('inventory.deleteFailedDesc', { name: label }));
        setIsDeleting(false);
        return;
      }
      setIsDeleting(false);
      onClose();
    } catch (err) {
      toast.error(t('inventory.deleteFailedTitle'), errorMessage(err) || t('inventory.deleteFailedDesc', { name: label }));
      setIsDeleting(false);
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
        actionName={`Delete part: ${product.name}`}
        actionType="parts_delete"
        targetId={product.id}
        actionData={{
          itemType: 'part',
          partName: product.name,
          partNumber: product.partNumber,
          category: product.category,
          price: product.price,
          cost: product.cost,
          stock: product.stock,
        }}
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
              <Input className="privacy-cost-input" label={`Cost Price (${symbol}) *`} type="number" step="0.01" value={form.costPrice?.toString() || ''} onChange={e => set('costPrice', e.target.value)} />
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
