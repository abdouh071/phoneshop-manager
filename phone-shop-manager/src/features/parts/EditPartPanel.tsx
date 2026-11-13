import React, { useState, useEffect } from 'react';
import { Save, Trash2, Printer } from 'lucide-react';
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
import { printBarcodeDirect, openPrintWindow, buildLabelsHTML } from '../../utils/printWindow';
import styles from './PartModal.module.css';

interface EditPartPanelProps {
  product: PhoneModel | null;
  isOpen?: boolean;
  onClose: () => void;
}

const COMMON_PART_NAMES = [
  'OLED Screen Assembly',
  'Incell Screen Assembly',
  'Original Battery (OEM)',
  'High Capacity Battery',
  'Charging Port Flex',
  'Rear Main Camera',
  'Front Selfie Camera',
  'Back Glass Panel',
  'Earpiece Speaker',
  'Loudspeaker Buzzer',
  'Power & Volume Flex',
];

const BRAND_CHIPS = [
  { name: 'Apple', icon: '🍏' },
  { name: 'Samsung', icon: '📱' },
  { name: 'Xiaomi', icon: '⚡' },
  { name: 'Huawei', icon: '🔴' },
  { name: 'Oppo', icon: '🟢' },
  { name: 'Realme', icon: '🟡' },
  { name: 'Google', icon: '🌐' },
];

export const EditPartPanel: React.FC<EditPartPanelProps> = ({ product, isOpen, onClose }) => {
  const { t } = useTranslation();
  const { updateProduct, deleteProduct } = useInventoryStore();
  const toast = useToast();
  const permissions = usePermissions();
  const { user } = useAuthStore();
  const canViewCosts = user?.role === 'admin' || (permissions.inventory_edit && permissions.reports);
  const { currency, storeName } = useSettingsStore();
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

  const handleAddBrandChip = (brandName: string) => {
    const list = [...compatibleModels];
    const last = list[list.length - 1] ?? '';
    if (!last.toLowerCase().includes(brandName.toLowerCase())) {
      if (last.trim()) {
        setCompatibleModels([...list, brandName]);
      } else {
        list[list.length - 1] = brandName;
        setCompatibleModels([...list]);
      }
    }
  };

  const handleSubmit = async (printBarcode = false) => {
    if (!form.name?.trim()) {
      toast.error(t('parts.editModal.missingFields'), t('parts.editModal.missingName'));
      return;
    }

    const normalizedModels = normalizeCompatibleModels(compatibleModels);
    if (normalizedModels.length === 0) {
      toast.error(t('parts.editModal.missingFields'), t('parts.editModal.missingModel'));
      return;
    }

    if (!form.price || Number(form.price) <= 0) {
      toast.error(t('parts.editModal.missingFields'), t('parts.editModal.missingSellPrice'));
      return;
    }

    if (canViewCosts && (!form.costPrice || Number(form.costPrice) < 0)) {
      toast.error(t('parts.editModal.missingFields'), t('parts.editModal.missingCostPrice'));
      return;
    }

    const stock = Number(form.stock) || 0;
    const threshold = Number(form.lowStockThreshold) || 1;

    const updates: Partial<PhoneModel> = {
      ...form,
      name: form.name.trim(),
      price: Number(form.price),
      costPrice: Number(form.costPrice) || 0,
      stock,
      lowStockThreshold: threshold,
      stockStatus: computeStockStatus(stock, threshold),
      compatibleModels: normalizedModels,
      model: joinModels(normalizedModels),
      partNumber: form.partNumber?.trim() || undefined,
      barcode: form.barcode?.trim() || undefined,
      color: form.color?.trim() || undefined,
      supplier: form.supplier?.trim() || undefined,
      location: form.location?.trim() || undefined,
      notes: form.notes?.trim() || undefined,
      imageUrl: form.imageUrl?.trim() || undefined,
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
          t('parts.editModal.codeConflict'),
          `${collisions[0]}. ${t('parts.editModal.codeConflictHint')}`
        );
        return;
      }
    }

    // Barcode collision check
    const nextBarcode = (updates.barcode || '').trim();
    if (nextBarcode && nextBarcode !== (product.barcode || '')) {
      const { products, parts } = useInventoryStore.getState();
      const collisions = findCodeCollisions([...products, ...parts], {
        id: product.id,
        sku: updates.sku,
        barcode: nextBarcode,
      });
      if (collisions.length > 0) {
        toast.error(
          t('parts.editModal.codeConflict'),
          `${collisions[0]}. ${t('parts.editModal.codeConflictHint')}`
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

      if (printBarcode) {
        const updatedItem = { ...product, ...updates } as PhoneModel;
        const result = await printBarcodeDirect([updatedItem], storeName, currency);
        if (result.method === 'direct' && result.error) {
          toast.error(t('parts.addPartModal.labelNotPrinted'), result.error);
        } else if (result.method === 'browser') {
          const html = buildLabelsHTML([updatedItem], storeName);
          openPrintWindow(html, 'Part Label');
        }
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
        title={t('parts.editModal.deleteTitle')}
        message={t('parts.editModal.deleteMessage', { name: product.name })}
        confirmLabel={t('parts.editModal.deleteConfirm')}
        isDanger
        onConfirm={handleDelete}
        onCancel={() => setIsDeleting(false)}
      />

      <Modal
        isOpen={modalOpen}
        onClose={onClose}
        title={t('parts.editModal.title')}
        subtitle={`${product.name} — ${product.model || product.sku}`}
        size="lg"
      >
        <div className={styles.formGrid}>

          {/* ── 1. Part Details ── */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('parts.editModal.sectionIdentity')}</h3>

            {/* Quick Preset Part Names */}
            <div>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-on-surface-variant)', display: 'block', marginBottom: '6px' }}>
                Quick Presets:
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                {COMMON_PART_NAMES.map(presetName => (
                  <button
                    key={presetName}
                    type="button"
                    onClick={() => setField('name', presetName)}
                    style={{
                      fontSize: '11px',
                      padding: '3px 8px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      background: form.name === presetName ? '#4f46e5' : 'var(--color-surface, #f8fafc)',
                      color: form.name === presetName ? '#ffffff' : 'var(--color-on-surface, #334155)',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    {presetName}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginTop: '8px' }}>
              <Input
                label={`${t('parts.editModal.labelName')} *`}
                value={form.name || ''}
                onChange={e => setField('name', e.target.value)}
                placeholder="e.g. OLED Screen Assembly"
              />
            </div>

            <div style={{ marginTop: '12px' }}>
              <CompatibleModelsInput
                models={compatibleModels}
                onChange={setCompatibleModels}
                label={`${t('parts.editModal.labelCompatible')} *`}
                placeholder="e.g. iPhone 14 Pro"
                addLabel={t('parts.editModal.addDevice')}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
                {BRAND_CHIPS.map(b => (
                  <button
                    key={b.name}
                    type="button"
                    onClick={() => handleAddBrandChip(b.name)}
                    style={{
                      fontSize: '10.5px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      border: '1px solid var(--color-border, #e2e8f0)',
                      background: 'var(--color-surface, #ffffff)',
                      color: 'var(--color-on-surface, #475569)',
                      cursor: 'pointer',
                    }}
                  >
                    {b.icon} {b.name}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.grid2} style={{ marginTop: '14px' }}>
              <Input
                label={t('parts.editModal.labelPartNumber')}
                value={form.partNumber || ''}
                onChange={e => setField('partNumber', e.target.value)}
                placeholder="e.g. 661-12345"
              />
              <Input
                label={t('parts.editModal.labelColor')}
                value={form.color || ''}
                onChange={e => setField('color', e.target.value)}
                placeholder="e.g. Black, Starlight"
              />
            </div>
          </div>

          {/* ── 2. Codes & Location ── */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('parts.editModal.sectionCodes')}</h3>
            <div className={styles.grid2}>
              <Input
                label={t('parts.editModal.labelSku')}
                value={form.sku || ''}
                onChange={e => setField('sku', e.target.value)}
                placeholder="PRT-XXXX-XXX"
              />
              <Input
                label={t('parts.editModal.labelBarcode')}
                value={form.barcode || ''}
                onChange={e => setField('barcode', e.target.value)}
                placeholder="Scan or enter barcode"
              />
            </div>
            <div className={styles.grid2} style={{ marginTop: '14px' }}>
              <Input
                label={t('parts.editModal.labelLocation')}
                value={form.location || ''}
                onChange={e => setField('location', e.target.value)}
                placeholder="e.g. Shelf A3, Bin 7"
              />
              <Input
                label={t('parts.editModal.labelSupplier')}
                value={form.supplier || ''}
                onChange={e => setField('supplier', e.target.value)}
                placeholder="Supplier name"
              />
            </div>
          </div>

          {/* ── 3. Pricing & Stock ── */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('parts.editModal.sectionPricing')}</h3>
            <div className={styles.grid3}>
              {canViewCosts && (
                <Input
                  className="privacy-cost-input"
                  label={`${t('parts.editModal.labelCost')} (${symbol}) *`}
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.costPrice?.toString() || ''}
                  onChange={e => setField('costPrice', e.target.value)}
                />
              )}
              <Input
                label={`${t('parts.editModal.labelSell')} (${symbol}) *`}
                type="number"
                step="0.01"
                min="0"
                value={form.price?.toString() || ''}
                onChange={e => setField('price', e.target.value)}
              />
              <Input
                label={t('parts.editModal.labelStock')}
                type="number"
                min="0"
                value={form.stock?.toString() || ''}
                onChange={e => setField('stock', e.target.value)}
              />
            </div>

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

            <div className={styles.grid2} style={{ marginTop: '14px' }}>
              <Input
                label={t('parts.editModal.labelThreshold')}
                type="number"
                min="0"
                value={form.lowStockThreshold?.toString() || ''}
                onChange={e => setField('lowStockThreshold', e.target.value)}
              />
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-on-surface)', display: 'block', marginBottom: '6px' }}>
                  {t('parts.editModal.labelCondition')}
                </label>
                <select
                  value={form.condition || ''}
                  onChange={e => setField('condition', e.target.value || undefined)}
                  style={{
                    width: '100%',
                    height: '42px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1.5px solid var(--color-border, #cbd5e1)',
                    background: 'var(--color-surface, #ffffff)',
                    color: 'var(--color-on-surface, #0f172a)',
                    fontSize: '14px',
                  }}
                >
                  <option value="">{t('parts.editModal.conditionAny')}</option>
                  <option value="new">{t('parts.editModal.conditionNew')}</option>
                  <option value="used">{t('parts.editModal.conditionUsed')}</option>
                  <option value="refurbished">{t('parts.editModal.conditionRefurbished')}</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── 4. Additional Info ── */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('parts.editModal.sectionAdditional')}</h3>
            <Input
              label={t('parts.editModal.labelImageUrl')}
              value={form.imageUrl || ''}
              onChange={e => setField('imageUrl', e.target.value)}
              placeholder="https://…"
              style={{ marginBottom: '14px' }}
            />
            <TextArea
              label={t('parts.editModal.labelNotes')}
              rows={3}
              value={form.notes || ''}
              onChange={e => setField('notes', e.target.value)}
              placeholder={t('parts.editModal.notesPlaceholder')}
            />
          </div>
        </div>

        {/* ── Modal Footer Actions ── */}
        <div className={styles.actions}>
          <Button
            variant="danger"
            size="sm"
            onClick={requestDelete}
            disabled={isSubmitting}
            leftIcon={<Trash2 size={16} />}
          >
            {t('parts.editModal.deleteBtn')}
          </Button>

          <div className={styles.actionRight}>
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={isSubmitting}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleSubmit(true)}
              disabled={isSubmitting}
              leftIcon={<Printer size={16} />}
            >
              {t('parts.saveAndPrint', 'Save & Print Label')}
            </Button>
            <Button
              onClick={() => handleSubmit(false)}
              disabled={isSubmitting}
              leftIcon={<Save size={16} />}
            >
              {isSubmitting ? t('common.saving', 'Saving...') : t('parts.editModal.saveBtn')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export const EditPartModal = EditPartPanel;
