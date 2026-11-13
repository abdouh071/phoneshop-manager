import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/ui/Modal';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { Input, TextArea } from '../../components/ui/Input';
import { useInventoryStore } from '../../store/inventoryStore';
import { useAuthStore } from '../../store/authStore';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../components/ui/Toast';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import type { PhoneModel } from '../../types';
import styles from './PartModal.module.css';
import { useSettingsStore } from '../../store/settingsStore';
import { printBarcodeDirect, openPrintWindow, buildLabelsHTML } from '../../utils/printWindow';
import { getCurrencySymbol } from '../../utils/formatCurrency';
import { computeStockStatus } from '../../utils/stockStatus';
import { ProfitMarginCalculator } from '../../components/ui/ProfitMarginCalculator';
import { CompatibleModelsInput } from '../../components/inventory/CompatibleModelsInput';
import { normalizeCompatibleModels, joinModels } from '../../utils/compatibleModels';

interface AddPartModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const generateSKU = (name: string, model: string) => {
  const b = (name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3) || 'PRT').toUpperCase();
  const m = (model.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4) || 'GEN').toUpperCase();
  const rand = Math.floor(100 + Math.random() * 900);
  return `PRT-${b}${m}-${rand}`;
};

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

type FormData = {
  name: string; 
  models: string[]; 
  price: string; 
  costPrice: string; 
  stock: string; 
  sku: string;
  supplier: string; 
  location: string;
  lowStockThreshold: string; 
  notes: string;
};

const INITIAL: FormData = {
  name: '', models: [''], price: '', costPrice: '', stock: '', sku: '',
  supplier: '', location: '', lowStockThreshold: '1', notes: '',
};

type FormErrors = { [K in keyof FormData]?: string };

export const AddPartModal: React.FC<AddPartModalProps> = ({ isOpen, onClose }) => {
  const { storeName, currency } = useSettingsStore();
  const { user } = useAuthStore();
  const permissions = usePermissions();
  const canViewCosts = user?.role === 'admin' || (permissions.inventory_edit && permissions.reports);
  const symbol = getCurrencySymbol(currency);
  const { addProduct, parts } = useInventoryStore();
  const { t } = useTranslation();
  const toast = useToast();

  const [form, setForm] = useState<FormData>(() => INITIAL);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<{product: PhoneModel, printBarcode?: boolean} | null>(null);

  useEffect(() => {
    if (isOpen) {
      setForm(INITIAL);
      setErrors({});
      setDuplicateWarning(null);
    }
  }, [isOpen]);

  const set = (key: keyof FormData, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(e => ({ ...e, [key]: undefined }));
  };

  const setModels = (models: string[]) => {
    setForm(prev => ({ ...prev, models }));
    setErrors(e => ({ ...e, models: undefined }));
  };

  const joinedModels = () => form.models.map(m => m.trim()).filter(Boolean).join(' ');

  const generateNewSKU = () => {
    set('sku', generateSKU(form.name || 'PRT', joinedModels() || 'GEN'));
  };

  const validate = (): boolean => {
    const errs: FormErrors = {};
    if (!form.name.trim()) errs.name = 'Required';
    if (!joinedModels()) errs.models = 'Required';
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) <= 0) errs.price = 'Enter a valid price';
    if (!form.costPrice || isNaN(Number(form.costPrice)) || Number(form.costPrice) <= 0) errs.costPrice = 'Enter a valid cost';
    if (!form.stock || isNaN(Number(form.stock)) || Number(form.stock) < 0) errs.stock = 'Enter a valid quantity';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (force: boolean = false, printBarcode: boolean = false) => {
    if (!validate()) return;

    const models = normalizeCompatibleModels(form.models);
    const model = joinModels(models);

    if (!force) {
      // Server already isolated parts — no need for category filter
      const duplicate = parts.find(p =>
        (p.name ?? '').toLowerCase().trim() === form.name.toLowerCase().trim() &&
        (p.model ?? '').toLowerCase().trim() === model.toLowerCase().trim()
      );
      if (duplicate) {
        setDuplicateWarning({ product: duplicate, printBarcode });
        return;
      }
    }

    setIsSubmitting(true);
    const stock = Number(form.stock);
    const threshold = Number(form.lowStockThreshold) || 1;
    
    // Auto generate SKU if empty
    const finalSku = form.sku.trim() || generateSKU(form.name, model);

    const product: Omit<PhoneModel, 'id'> = {
      name: form.name.trim(), 
      model, 
      compatibleModels: models, 
      storage: 'N/A', // Parts don't have storage
      color: '',      // Parts usually don't have color, or it's in the name
      price: Number(form.price),
      costPrice: Number(form.costPrice), 
      stock,
      stockStatus: computeStockStatus(stock, threshold),
      sku: finalSku,
      category: 'repair_part',
      supplier: form.supplier.trim() || undefined,
      location: form.location.trim() || undefined,
      lowStockThreshold: threshold,
      notes: form.notes.trim() || undefined,
    };
    
    try {
      await addProduct(product);
      toast.success(t('parts.addPartModal.partAdded'), t('parts.addPartModal.partAddedDesc', { name: product.name }));
      
      if (printBarcode) {
        const tempProduct = { ...product, id: 'temp-' + Date.now(), hidePrice: true };
        const result = await printBarcodeDirect([tempProduct as PhoneModel], storeName, currency);
        if (result.method === 'direct' && result.error) {
          // The part is saved; only the label is missing. Say so instead of
          // letting a part reach the shelf with no barcode on it.
          toast.error(t('parts.addPartModal.labelNotPrinted'), result.error);
        } else if (result.method === 'browser') {
          const html = buildLabelsHTML([tempProduct], storeName);
          openPrintWindow(html, 'Part Label');
        }
      }
      onClose();
    } catch (err) {
      toast.error(t('parts.addPartModal.failedToAdd'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Repair Part" size="lg">
      <div className={styles.formGrid}>
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Part Details</h3>
          
          {/* Quick Preset Part Names */}
          <div style={{ marginBottom: '12px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-on-surface-variant)', display: 'block', marginBottom: '6px' }}>
              Quick Presets:
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
              {COMMON_PART_NAMES.map(presetName => (
                <button
                  key={presetName}
                  type="button"
                  onClick={() => set('name', presetName)}
                  style={{
                    fontSize: '11px',
                    padding: '3px 8px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    background: form.name === presetName ? '#4f46e5' : '#f8fafc',
                    color: form.name === presetName ? '#ffffff' : '#334155',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  {presetName}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.grid2}>
            <Input label="Part Name *" placeholder="e.g. OLED Screen Assembly" value={form.name} onChange={e => set('name', e.target.value)} error={errors.name} />
            <div>
              <CompatibleModelsInput
                models={form.models}
                onChange={setModels}
                error={errors.models}
                label="Compatible Device(s) *"
                placeholder="e.g. iPhone 13 Pro"
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
                {BRAND_CHIPS.map(b => (
                  <button
                    key={b.name}
                    type="button"
                    onClick={() => {
                      if (!joinedModels().toLowerCase().includes(b.name.toLowerCase())) {
                        const last = form.models[form.models.length - 1] ?? '';
                        setModels(last.trim()
                          ? [...form.models.slice(0, -1), `${last} ${b.name}`]
                          : [...form.models.slice(0, -1), b.name]);
                      }
                    }}
                    style={{
                      fontSize: '10.5px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      border: '1px solid #e2e8f0',
                      background: '#ffffff',
                      color: '#475569',
                      cursor: 'pointer',
                    }}
                  >
                    {b.icon} {b.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className={styles.grid2} style={{ marginTop: '16px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <Input label="SKU / Barcode" placeholder="Leave blank to auto-generate" value={form.sku} onChange={e => set('sku', e.target.value)} />
              </div>
              <Button variant="secondary" onClick={generateNewSKU} style={{ padding: '0 12px', height: '42px' }}>Auto</Button>
            </div>
            <Input label="Bin / Location" placeholder="e.g. Shelf B4" value={form.location} onChange={e => set('location', e.target.value)} />
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Pricing & Stock</h3>
          <div className={styles.grid3}>
            {canViewCosts && (
              <Input className="privacy-cost-input" label={`Cost Price (${symbol}) *`} type="number" step="0.01" value={form.costPrice} onChange={e => set('costPrice', e.target.value)} error={errors.costPrice} />
            )}
            <Input label={`Sell Price (${symbol}) *`} type="number" step="0.01" value={form.price} onChange={e => set('price', e.target.value)} error={errors.price} />
            <Input label="Initial Stock *" type="number" value={form.stock} onChange={e => set('stock', e.target.value)} error={errors.stock} />
          </div>

          {/* Live Profit & Margin Calculator — only for authorized staff */}
          {canViewCosts && (
            <div style={{ marginTop: '12px' }}>
              <ProfitMarginCalculator
                costPrice={form.costPrice}
                sellPrice={form.price}
                stock={form.stock}
                onApplySellPrice={(suggested) => set('price', suggested.toString())}
              />
            </div>
          )}

          <div className={styles.grid2} style={{ marginTop: '16px' }}>
            <Input label="Low Stock Alert Threshold" type="number" value={form.lowStockThreshold} onChange={e => set('lowStockThreshold', e.target.value)} />
            <Input label="Supplier" placeholder="e.g. iFixit" value={form.supplier} onChange={e => set('supplier', e.target.value)} />
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Additional Info</h3>
          <TextArea label="Notes" rows={3} placeholder="Internal notes about this part..." value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>
      </div>

      <div className={styles.actions}>
        <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Button variant="secondary" onClick={() => handleSubmit(false, true)} disabled={isSubmitting}>
            Save & Print Label
          </Button>
          <Button onClick={() => handleSubmit(false, false)} disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Add Part'}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!duplicateWarning}
        title="Possible Duplicate Part"
        message={`A part named "${duplicateWarning?.product.name} ${duplicateWarning?.product.model}" already exists. Are you sure you want to add another one?`}
        confirmLabel="Add Anyway"
        onConfirm={() => {
          const print = duplicateWarning?.printBarcode || false;
          setDuplicateWarning(null);
          handleSubmit(true, print);
        }}
        onCancel={() => setDuplicateWarning(null)}
      />
    </Modal>
  );
};
