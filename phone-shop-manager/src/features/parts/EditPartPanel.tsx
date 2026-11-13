import React, { useState, useEffect } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../components/ui/Modal';
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
import { CompatibleModelsInput } from '../../components/inventory/CompatibleModelsInput';
import { normalizeCompatibleModels, joinModels, modelsFromProduct } from '../../utils/compatibleModels';
import styles from './PartModal.module.css';

interface EditPartPanelProps {
  product: PhoneModel | null;
  isOpen?: boolean;
  onClose: () => void;
}

export const EditPartPanel: React.FC<EditPartPanelProps> = ({ product, isOpen, onClose }) => {
  const { t } = useTranslation();
  const { updateProduct, deleteProduct } = useInventoryStore();
  const toast = useToast();
  const permissions = usePermissions();
  const { user } = useAuthStore();
  const canViewCosts = user?.role === 'admin' || (permissions.inventory_edit && permissions.reports);
  const { currency } = useSettingsStore();
  const symbol = getCurrencySymbol(currency);

  const [form, setForm] = useState<Partial<PhoneModel>>({});
  const [compatibleModels, setCompatibleModels] = useState<string[]>(['']);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showAdminUnlock, setShowAdminUnlock] = useState(false);

  useEffect(() => {
    if (product) {
      setForm(product);
      setCompatibleModels(modelsFromProduct(product));
    }
  }, [product]);

  const modalOpen = isOpen !== undefined ? isOpen : !!product;
  if (!product) return null;

  const setField = (key: keyof PhoneModel, value: unknown) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    const normalizedModels = normalizeCompatibleModels(compatibleModels);
    if (!form.name?.trim() || normalizedModels.length === 0 || !form.price || !form.costPrice) {
      toast.error(t('parts.editModal.missingFields'));
      return;
    }

    const stock = Number(form.stock) || 0;
    const threshold = Number(form.lowStockThreshold) || 1;

    const updates: Partial<PhoneModel> = {
      ...form,
      name: form.name.trim(),
      model: joinModels(normalizedModels),
      compatibleModels: normalizedModels,
      price: Number(form.price),
      costPrice: Number(form.costPrice) || 0,
      stock,
      lowStockThreshold: threshold,
      stockStatus: computeStockStatus(stock, threshold),
      sku: form.sku?.trim() || undefined,
      location: form.location?.trim() || undefined,
      supplier: form.supplier?.trim() || undefined,
      notes: form.notes?.trim() || undefined,
    };

    // SKU collision check
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
          t('parts.editModal.codeConflict', 'Code Already on Another Product'),
          `${collisions[0]}. ${t('parts.editModal.codeConflictHint', 'Give this part its own code, or one scan will sell two different items.')}`
        );
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const outcome = await updateProduct(product.id, updates);
      if (outcome === 'committed') {
        toast.success(t('parts.editModal.partUpdated'), t('parts.editModal.partUpdatedDesc', { name: updates.name }));
      } else if (outcome === 'queued') {
        toast.info(t('parts.editModal.savedOffline'), t('parts.editModal.savedOfflineDesc', { name: updates.name }));
      } else {
        toast.warning(t('parts.editModal.savedRetrying'), t('parts.editModal.savedRetryingDesc', { name: updates.name }));
      }
      onClose();
    } catch (err) {
      toast.error(t('parts.editModal.savedRetrying'), errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    const label = `${product.name} ${product.model}`.trim();
    try {
      const outcome = await deleteProduct(product.id);
      if (outcome === 'committed') {
        toast.success(t('inventory.deletedTitle'), t('inventory.deletedDesc', { name: label }));
      } else if (outcome === 'queued') {
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
    <>
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
        title={t('parts.editModal.deleteTitle', 'Delete Part?')}
        message={t('parts.editModal.deleteMessage', { name: product.name, defaultValue: `Are you sure you want to delete ${product.name}? This action cannot be undone.` })}
        confirmLabel={t('parts.editModal.deleteConfirm', 'Delete')}
        isDanger
        onConfirm={handleDelete}
        onCancel={() => setIsDeleting(false)}
      />

      <Modal
        isOpen={modalOpen}
        onClose={onClose}
        title={t('parts.editModal.title', 'Edit Part')}
        size="lg"
      >
        <div className={styles.formGrid}>
          {/* ── 1. Part Details ── */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('parts.editModal.sectionIdentity', 'Part Details')}</h3>
            <div>
              <Input
                label={`${t('parts.editModal.labelName', 'Part Name')} *`}
                value={form.name || ''}
                onChange={e => setField('name', e.target.value)}
              />
            </div>
            <div style={{ marginTop: '12px' }}>
              <CompatibleModelsInput
                models={compatibleModels}
                onChange={setCompatibleModels}
                label={`${t('parts.editModal.labelCompatible', 'Compatible Device(s)')} *`}
                placeholder="e.g. iPhone 14 Pro"
                addLabel={t('parts.editModal.addDevice', 'Add another device')}
              />
            </div>
            <div className={styles.grid2} style={{ marginTop: '12px' }}>
              <Input
                label={t('parts.editModal.labelSku', 'SKU / Barcode')}
                value={form.sku || ''}
                onChange={e => setField('sku', e.target.value)}
              />
              <Input
                label={t('parts.editModal.labelLocation', 'Bin / Location')}
                value={form.location || ''}
                onChange={e => setField('location', e.target.value)}
              />
            </div>
          </div>

          {/* ── 2. Pricing & Stock ── */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('parts.editModal.sectionPricing', 'Pricing & Stock')}</h3>
            <div className={styles.grid3}>
              {canViewCosts && (
                <Input
                  className="privacy-cost-input"
                  label={`${t('parts.editModal.labelCost', 'Cost Price')} (${symbol}) *`}
                  type="number"
                  step="0.01"
                  value={form.costPrice?.toString() || ''}
                  onChange={e => setField('costPrice', e.target.value)}
                />
              )}
              <Input
                label={`${t('parts.editModal.labelSell', 'Sell Price')} (${symbol}) *`}
                type="number"
                step="0.01"
                value={form.price?.toString() || ''}
                onChange={e => setField('price', e.target.value)}
              />
              <Input
                label={`${t('parts.editModal.labelStock', 'Current Stock')} *`}
                type="number"
                value={form.stock?.toString() || ''}
                onChange={e => setField('stock', e.target.value)}
              />
            </div>

            {/* Live Profit & Margin Breakdown — only for authorized staff */}
            {canViewCosts && (
              <div style={{ marginTop: '12px' }}>
                <ProfitMarginCalculator
                  costPrice={Number(form.costPrice) || 0}
                  sellPrice={Number(form.price) || 0}
                  stock={Number(form.stock) || 0}
                  onApplySellPrice={(suggested) => setField('price', suggested)}
                />
              </div>
            )}

            <div className={styles.grid2}>
              <Input
                label={t('parts.editModal.labelThreshold', 'Low Stock Alert Threshold')}
                type="number"
                value={form.lowStockThreshold?.toString() || ''}
                onChange={e => setField('lowStockThreshold', e.target.value)}
              />
              <Input
                label={t('parts.editModal.labelSupplier', 'Supplier')}
                value={form.supplier || ''}
                onChange={e => setField('supplier', e.target.value)}
              />
            </div>
          </div>

          {/* ── 3. Additional Info ── */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('parts.editModal.sectionAdditional', 'Additional Info')}</h3>
            <TextArea
              label={t('parts.editModal.labelNotes', 'Notes')}
              rows={4}
              value={form.notes || ''}
              onChange={e => setField('notes', e.target.value)}
            />
          </div>
        </div>

        {/* ── Actions Footer ── */}
        <div className={styles.actions}>
          <Button
            variant="danger"
            size="sm"
            leftIcon={<Trash2 size={16} />}
            onClick={requestDelete}
            disabled={isSubmitting}
          >
            {t('parts.editModal.deleteBtn', 'Delete')}
          </Button>

          <div className={styles.actionRight}>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={isSubmitting}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              size="sm"
              leftIcon={<Save size={16} />}
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? t('common.saving', 'Saving...') : t('parts.editModal.saveBtn', 'Save Changes')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export const EditPartModal = EditPartPanel;
