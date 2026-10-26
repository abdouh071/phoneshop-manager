import React, { useState, useRef } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input, TextArea } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { useInventoryStore } from '../../store/inventoryStore';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../components/ui/Toast';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import type { PhoneModel, AccessorySubCategory } from '../../types';
import { ACCESSORY_SUB_CATEGORY_OPTIONS } from '../../utils/accessorySubCategories';
import styles from './ProductForm.module.css';
import { useSettingsStore } from '../../store/settingsStore';
import { printBarcodeDirect, openPrintWindow, buildLabelsHTML } from '../../utils/printWindow';
import { formatCurrency, getCurrencySymbol } from '../../utils/formatCurrency';
import { ProfitMarginCalculator } from '../../components/ui/ProfitMarginCalculator';
import { Plus, X, Package, Layers, Link, Copy, Barcode, RefreshCw } from 'lucide-react';

interface AddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STORAGE_OPTIONS = ['N/A', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB'].map(v => ({ value: v, label: v }));

const ALL_CATEGORY_OPTIONS = [
  { value: 'smartphone', label: '📱 Smartphone' },
  { value: 'tablet', label: '💻 Tablet' },
  { value: 'accessory', label: '🎧 Accessory' },
  { value: 'wearable', label: '⌚ Wearable' },
];

const COLOR_CODES: Record<string, string> = {
  black: 'BLK',
  noir: 'BLK',
  blue: 'BLU',
  bleu: 'BLU',
  white: 'WHT',
  blanc: 'WHT',
  silver: 'SLV',
  argent: 'SLV',
  gold: 'GLD',
  or: 'GLD',
  gray: 'GRY',
  grey: 'GRY',
  gris: 'GRY',
  green: 'GRN',
  vert: 'GRN',
  purple: 'PRP',
  violet: 'PRP',
  pink: 'PNK',
  rose: 'PNK',
  red: 'RED',
  rouge: 'RED',
  yellow: 'YLW',
  jaune: 'YLW',
  orange: 'ORG',
  midnight: 'MID',
  starlight: 'STA',
  natural: 'NAT',
  titanium: 'TIT',
  graphite: 'GRP',
  space: 'SPC',
  sierra: 'SRA',
  alpine: 'ALP',
};

export const getColorCode = (color: string): string => {
  const clean = (color || '').trim().toLowerCase();
  if (!clean) return '';
  if (COLOR_CODES[clean]) return COLOR_CODES[clean];
  for (const [key, code] of Object.entries(COLOR_CODES)) {
    if (clean.includes(key)) return code;
  }
  const alpha = clean.replace(/[^a-z0-9]/g, '');
  return (alpha.slice(0, 3) || '').toUpperCase();
};

export const generateSKU = (name: string, model: string, storage: string, color: string) => {
  const b = (name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3) || 'GEN').toUpperCase();
  const m = (model.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4) || 'MOD').toUpperCase();
  const s = storage && storage !== 'N/A' ? storage.replace('GB', '').replace('TB', 'T').replace(/[^a-zA-Z0-9]/g, '') : '';
  const c = getColorCode(color);
  
  const tokens = [b, m];
  if (s) tokens.push(s);
  if (c) tokens.push(c);
  return tokens.join('-');
};

/**
 * System-Wide Collision Prevention:
 * Ensures guaranteed uniqueness for any barcode / SKU across the entire store database.
 * If baseSku already exists in the system or current batch, automatically appends -2, -3, etc.
 * Prevents any chance of two different added items sharing the same barcode.
 */
export const resolveUniqueSKU = (
  baseSku: string,
  existingSkus: Set<string>
): string => {
  const upper = (baseSku || 'GEN-MOD').toUpperCase().trim();
  if (!existingSkus.has(upper)) {
    existingSkus.add(upper);
    return upper;
  }
  let suffix = 2;
  while (existingSkus.has(`${upper}-${suffix}`)) {
    suffix++;
  }
  const unique = `${upper}-${suffix}`;
  existingSkus.add(unique);
  return unique;
};

// --- Single-mode form type (unchanged from before) ---
type FormData = {
  name: string; model: string; storage: string; color: string;
  price: string; costPrice: string; stock: string; sku: string;
  category: string; accessorySubCategory?: AccessorySubCategory; supplier: string; location: string;
  lowStockThreshold: string; notes: string;
};

// --- Multi-mode variant type ---
type VariantFormData = {
  id: string; // local unique key for React
  model: string;
  storage: string;
  color: string;
  price: string;
  costPrice: string;
  stock: string;
  lowStockThreshold: string;
};

type VariantErrors = Partial<Record<keyof VariantFormData, string>>;

type AddMode = 'single' | 'multi';

let variantIdCounter = 0;
const createEmptyVariant = (category: string = 'smartphone', prevVariant?: VariantFormData): VariantFormData => ({
  id: `v-${++variantIdCounter}-${Date.now()}`,
  model: '',
  storage: category === 'accessory' ? 'N/A' : (prevVariant?.storage || '128GB'),
  color: '',
  price: '',
  costPrice: '',
  stock: '',
  lowStockThreshold: prevVariant?.lowStockThreshold || '1',
});

// ─── VariantCard sub-component ───────────────────────────────────────────────
interface VariantCardProps {
  index: number;
  variant: VariantFormData;
  errors: VariantErrors;
  productName: string;
  category: string;
  symbol: string;
  canRemove: boolean;
  syncCost: boolean;
  syncPrice: boolean;
  syncStock: boolean;
  firstVariant?: VariantFormData;
  existingSkuSet: Set<string>;
  allVariants: VariantFormData[];
  onUpdate: (id: string, key: keyof VariantFormData, value: string) => void;
  onRemove: (id: string) => void;
  onClone: (id: string) => void;
}

const VariantCard: React.FC<VariantCardProps> = ({
  index, variant, errors, productName, category, symbol, canRemove,
  syncCost, syncPrice, syncStock, firstVariant, existingSkuSet, allVariants,
  onUpdate, onRemove, onClone,
}) => {
  const isFirst = index === 0;
  const hideStorageColor = category === 'accessory';

  // Effective values fallback if variant value hasn't been set yet
  const effectiveCost = variant.costPrice || (!isFirst && syncCost && firstVariant ? firstVariant.costPrice : '');
  const effectivePrice = variant.price || (!isFirst && syncPrice && firstVariant ? firstVariant.price : '');
  const effectiveStock = variant.stock || (!isFirst && syncStock && firstVariant ? firstVariant.stock : '');
  const effectiveThreshold = variant.lowStockThreshold || (!isFirst && syncStock && firstVariant ? firstVariant.lowStockThreshold : '5');
  const effectiveStorage = hideStorageColor ? 'N/A' : variant.storage;
  const effectiveColor = hideStorageColor ? '' : variant.color;

  // Build a temporary set with existing DB SKUs + all prior variants' SKUs for live preview dedup
  const liveSku = (() => {
    if (!variant.model.trim()) return '';
    const rawSku = generateSKU(productName || 'PRD', variant.model, effectiveStorage, effectiveColor);
    // Collect SKUs from prior variants in the batch (all variants before this one)
    const tempSet = new Set(existingSkuSet);
    for (const v of allVariants) {
      if (v.id === variant.id) break; // only include variants BEFORE this one
      const vStorage = category === 'accessory' ? 'N/A' : v.storage;
      const vColor = category === 'accessory' ? '' : v.color;
      if (v.model.trim()) {
        const vSku = generateSKU(productName || 'PRD', v.model, vStorage, vColor);
        resolveUniqueSKU(vSku, tempSet); // reserves this SKU in tempSet
      }
    }
    return resolveUniqueSKU(rawSku, tempSet);
  })();

  // Match flags: indicates if the current variant's value matches Model 1
  const isCostSynced = !isFirst && syncCost && !!firstVariant?.costPrice && variant.costPrice === firstVariant.costPrice;
  const isPriceSynced = !isFirst && syncPrice && !!firstVariant?.price && variant.price === firstVariant.price;
  const isStockSynced = !isFirst && syncStock && !!firstVariant?.stock && variant.stock === firstVariant.stock;
  const isThresholdSynced = !isFirst && syncStock && !!firstVariant?.lowStockThreshold && variant.lowStockThreshold === firstVariant.lowStockThreshold;

  return (
    <div className={styles.variantCard}>
      <div className={styles.variantCardHeader}>
        <div className={styles.variantLabelGroup}>
          <span className={styles.variantLabel}>
            <span className={styles.variantNumber}>{index + 1}</span>
            Model {index + 1}
            {isFirst && (syncCost || syncPrice || syncStock) && (
              <span className={styles.primaryBadge}>Master (Source)</span>
            )}
          </span>
          {liveSku && (
            <span className={styles.cardSkuBadge} title="Live distinct barcode generated for this model">
              <Barcode size={13} /> {liveSku}
            </span>
          )}
        </div>

        <div className={styles.variantCardActions}>
          <button
            className={styles.variantCloneBtn}
            onClick={() => onClone(variant.id)}
            title="Clone this model (duplicate specs to a new model)"
            type="button"
          >
            <Copy size={13} />
            <span>Clone</span>
          </button>
          <button
            className={styles.variantRemoveBtn}
            onClick={() => onRemove(variant.id)}
            disabled={!canRemove}
            title={canRemove ? 'Remove this model' : 'At least one model is required'}
            type="button"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Model name */}
      <Input
        label="Model Name *"
        placeholder="e.g. 25W USB-C Fast Charger"
        value={variant.model}
        onChange={e => onUpdate(variant.id, 'model', e.target.value)}
        error={errors.model}
      />

      {/* Storage + Color (hidden for accessories) */}
      {!hideStorageColor && (
        <div className={styles.row}>
          <Select label="Storage" options={STORAGE_OPTIONS} value={variant.storage}
            onChange={v => onUpdate(variant.id, 'storage', v)} />
          <Input label="Color *" placeholder="e.g. Midnight Black" value={variant.color}
            onChange={e => onUpdate(variant.id, 'color', e.target.value)} error={errors.color} />
        </div>
      )}

      {/* Pricing */}
      <div className={styles.row}>
        <Input
          className="privacy-cost-input"
          label={
            isCostSynced ? (
              <>Cost ({symbol}) * <span className={styles.syncedBadge} title="Matches Model 1 (editable)">Same as Model 1</span></>
            ) : (
              `Cost (${symbol}) *`
            )
          }
          type="number"
          placeholder="0.00"
          value={variant.costPrice}
          onChange={e => onUpdate(variant.id, 'costPrice', e.target.value)}
          error={errors.costPrice}
        />
        <Input
          label={
            isPriceSynced ? (
              <>Sell Price ({symbol}) * <span className={styles.syncedBadge} title="Matches Model 1 (editable)">Same as Model 1</span></>
            ) : (
              `Sell Price (${symbol}) *`
            )
          }
          type="number"
          placeholder="0.00"
          value={variant.price}
          onChange={e => onUpdate(variant.id, 'price', e.target.value)}
          error={errors.price}
        />
      </div>

      {/* Margin calculator */}
      <div style={{ marginTop: '-4px' }}>
        <ProfitMarginCalculator
          costPrice={effectiveCost}
          sellPrice={effectivePrice}
          stock={effectiveStock}
          onApplySellPrice={(suggested) => onUpdate(variant.id, 'price', suggested.toString())}
        />
      </div>

      {/* Stock */}
      <div className={styles.row}>
        <Input
          label={
            isStockSynced ? (
              <>Stock * <span className={styles.syncedBadge} title="Matches Model 1 (editable)">Same as Model 1</span></>
            ) : (
              'Stock *'
            )
          }
          type="number"
          placeholder="0"
          value={variant.stock}
          onChange={e => onUpdate(variant.id, 'stock', e.target.value)}
          error={errors.stock}
        />
        <Input
          label={
            isThresholdSynced ? (
              <>Low Stock Threshold <span className={styles.syncedBadge} title="Matches Model 1 (editable)">Same as Model 1</span></>
            ) : (
              'Low Stock Threshold'
            )
          }
          type="number"
          placeholder="1"
          value={variant.lowStockThreshold}
          onChange={e => onUpdate(variant.id, 'lowStockThreshold', e.target.value)}
        />
      </div>
    </div>
  );
};

// ─── Main Modal ──────────────────────────────────────────────────────────────
export const AddProductModal: React.FC<AddProductModalProps> = ({ isOpen, onClose }) => {
  const { user } = useAuthStore();
  const { storeName, currency } = useSettingsStore();
  const symbol = getCurrencySymbol(currency);
  const { addProduct, addProductsBulk, products } = useInventoryStore();
  const toast = useToast();
  const CATEGORY_OPTIONS = ALL_CATEGORY_OPTIONS;
  const defaultCategory = 'smartphone';

  const INITIAL: FormData = {
    name: '', model: '', storage: '128GB', color: '',
    price: '', costPrice: '', stock: '', sku: '',
    category: defaultCategory, accessorySubCategory: 'other', supplier: '', location: '',
    lowStockThreshold: '1', notes: '',
  };

  // ── State ──
  const [mode, setMode] = useState<AddMode>('single');
  const [form, setForm] = useState<FormData>(() => INITIAL);
  const [errors, setErrors] = useState<Partial<FormData>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittingAction, setSubmittingAction] = useState<'submit' | 'print' | 'add_new' | null>(null);
  const [hasPreservedDefaults, setHasPreservedDefaults] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<{
    product: PhoneModel;
    printBarcode?: boolean;
    createAnother?: boolean;
  } | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Multi-mode variant state
  const [variants, setVariants] = useState<VariantFormData[]>(() => [createEmptyVariant(defaultCategory)]);
  const [variantErrors, setVariantErrors] = useState<Record<string, VariantErrors>>({});

  // ── Sync Checkpoints State ──
  const [syncCost, setSyncCost] = useState(false);
  const [syncPrice, setSyncPrice] = useState(false);
  const [syncStock, setSyncStock] = useState(false);

  // ── Shared field setter ──
  // Build the existing-SKU set once from the current store for live preview dedup
  const existingSkuSet = React.useMemo(
    () => new Set(products.map(p => (p.sku || '').toUpperCase().trim())),
    [products]
  );

  const set = (key: keyof FormData, value: string) => {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      if (key === 'category' && value === 'accessory') {
        next.storage = 'N/A';
        next.color = '';
        if (!next.accessorySubCategory) next.accessorySubCategory = 'other';
      }
      if (['name', 'model', 'storage', 'color'].includes(key)) {
        const rawSku = generateSKU(next.name, next.model, next.storage, next.color);
        // Resolve against existing DB SKUs so the preview shows -2, -3, etc. when needed
        const tempSet = new Set(existingSkuSet);
        next.sku = resolveUniqueSKU(rawSku, tempSet);
      }
      return next;
    });
    setErrors(e => ({ ...e, [key]: undefined }));
  };

  // ── Variant field setter ──
  const updateVariant = (id: string, key: keyof VariantFormData, value: string) => {
    setVariants(prev => {
      const isFirst = prev.length > 0 && prev[0].id === id;
      const prevMasterVal = isFirst ? prev[0][key] : '';
      return prev.map(v => {
        if (v.id === id) {
          return { ...v, [key]: value };
        }
        // When editing Master model (Model 1), update linked fields on other models that match or are empty
        if (isFirst) {
          if (key === 'costPrice' && syncCost) {
            if (!v.costPrice || v.costPrice === prevMasterVal) return { ...v, costPrice: value };
          }
          if (key === 'price' && syncPrice) {
            if (!v.price || v.price === prevMasterVal) return { ...v, price: value };
          }
          if (key === 'stock' && syncStock) {
            if (!v.stock || v.stock === prevMasterVal) return { ...v, stock: value };
          }
          if (key === 'lowStockThreshold' && syncStock) {
            if (!v.lowStockThreshold || v.lowStockThreshold === prevMasterVal) return { ...v, lowStockThreshold: value };
          }
        }
        return v;
      });
    });

    setVariantErrors(prev => {
      const updated = { ...prev };
      if (updated[id]) {
        updated[id] = { ...updated[id], [key]: undefined };
      }
      // If updating master model, clear corresponding errors on synced variants
      const isFirst = variants.length > 0 && variants[0].id === id;
      if (isFirst) {
        variants.slice(1).forEach(v => {
          if (updated[v.id]) {
            if (key === 'costPrice' && syncCost) updated[v.id] = { ...updated[v.id], costPrice: undefined };
            if (key === 'price' && syncPrice) updated[v.id] = { ...updated[v.id], price: undefined };
            if (key === 'stock' && syncStock) updated[v.id] = { ...updated[v.id], stock: undefined };
          }
        });
      }
      return updated;
    });
  };

  // ── Sync Checkpoint Handlers ──
  const handleToggleSyncCost = (enabled: boolean) => {
    setSyncCost(enabled);
    if (enabled && variants.length > 1) {
      const masterCost = variants[0].costPrice;
      setVariants(prev => prev.map((v, i) => i > 0 ? { ...v, costPrice: masterCost } : v));
      setVariantErrors(prev => {
        const next = { ...prev };
        variants.slice(1).forEach(v => {
          if (next[v.id]) next[v.id] = { ...next[v.id], costPrice: undefined };
        });
        return next;
      });
    }
  };

  const handleToggleSyncPrice = (enabled: boolean) => {
    setSyncPrice(enabled);
    if (enabled && variants.length > 1) {
      const masterPrice = variants[0].price;
      setVariants(prev => prev.map((v, i) => i > 0 ? { ...v, price: masterPrice } : v));
      setVariantErrors(prev => {
        const next = { ...prev };
        variants.slice(1).forEach(v => {
          if (next[v.id]) next[v.id] = { ...next[v.id], price: undefined };
        });
        return next;
      });
    }
  };

  const handleToggleSyncStock = (enabled: boolean) => {
    setSyncStock(enabled);
    if (enabled && variants.length > 1) {
      const masterStock = variants[0].stock;
      const masterThreshold = variants[0].lowStockThreshold;
      setVariants(prev => prev.map((v, i) => i > 0 ? { ...v, stock: masterStock, lowStockThreshold: masterThreshold } : v));
      setVariantErrors(prev => {
        const next = { ...prev };
        variants.slice(1).forEach(v => {
          if (next[v.id]) next[v.id] = { ...next[v.id], stock: undefined, lowStockThreshold: undefined };
        });
        return next;
      });
    }
  };

  const addVariant = () => {
    const first = variants[0];
    const last = variants[variants.length - 1];
    setVariants(prev => [
      ...prev,
      {
        id: `v-${++variantIdCounter}-${Date.now()}`,
        model: '',
        storage: form.category === 'accessory' ? 'N/A' : (last?.storage || '128GB'),
        color: '',
        price: syncPrice && first ? first.price : '',
        costPrice: syncCost && first ? first.costPrice : '',
        stock: syncStock && first ? first.stock : '',
        lowStockThreshold: syncStock && first ? first.lowStockThreshold : (last?.lowStockThreshold || '1'),
      }
    ]);
  };

  const cloneVariant = (id: string) => {
    const targetIdx = variants.findIndex(v => v.id === id);
    if (targetIdx === -1) return;
    const source = variants[targetIdx];
    const first = variants[0];

    const cloned: VariantFormData = {
      id: `v-${++variantIdCounter}-${Date.now()}`,
      model: source.model,
      storage: source.storage,
      color: source.color,
      price: syncPrice && first ? first.price : source.price,
      costPrice: syncCost && first ? first.costPrice : source.costPrice,
      stock: syncStock && first ? first.stock : source.stock,
      lowStockThreshold: syncStock && first ? first.lowStockThreshold : source.lowStockThreshold,
    };

    setVariants(prev => [
      ...prev.slice(0, targetIdx + 1),
      cloned,
      ...prev.slice(targetIdx + 1),
    ]);

    toast.info('Model cloned!', `Cloned "${source.model || `Model ${targetIdx + 1}`}". Tweak color or storage as needed.`);
  };

  const removeVariant = (id: string) => {
    setVariants(prev => prev.filter(v => v.id !== id));
    setVariantErrors(prev => {
      const updated = { ...prev };
      delete updated[id];
      return updated;
    });
  };

  // ── Validation ──
  const validateSingleMode = (): boolean => {
    const errs: Partial<FormData> = {};
    const isNoStorage = form.category === 'accessory';
    if (!form.name.trim()) errs.name = 'Required';
    if (!form.model.trim()) errs.model = 'Required';
    if (!isNoStorage && !form.color.trim()) errs.color = 'Required';
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) <= 0) errs.price = 'Enter a valid price';
    if (!form.costPrice || isNaN(Number(form.costPrice)) || Number(form.costPrice) <= 0) errs.costPrice = 'Enter a valid cost';
    if (!form.stock || isNaN(Number(form.stock)) || Number(form.stock) < 0) errs.stock = 'Enter a valid quantity';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const validateMultiMode = (): boolean => {
    // Validate shared fields
    const sharedErrs: Partial<FormData> = {};
    if (!form.name.trim()) sharedErrs.name = 'Product name is required';
    setErrors(sharedErrs);

    // Validate each variant
    const vErrors: Record<string, VariantErrors> = {};
    let hasErrors = Object.keys(sharedErrs).length > 0;
    const isNoStorage = form.category === 'accessory';
    const seenVariants = new Set<string>();

    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const errs: VariantErrors = {};
      const effectiveCost = v.costPrice || (syncCost && i > 0 ? variants[0].costPrice : '');
      const effectivePrice = v.price || (syncPrice && i > 0 ? variants[0].price : '');
      const effectiveStock = v.stock || (syncStock && i > 0 ? variants[0].stock : '');

      if (!v.model.trim()) {
        errs.model = 'Model name is required';
      } else {
        const key = `${v.model.trim().toLowerCase()}|${isNoStorage ? 'N/A' : v.storage}|${isNoStorage ? '' : v.color.trim().toLowerCase()}`;
        if (seenVariants.has(key)) {
          errs.model = 'Duplicate model in list';
        } else {
          seenVariants.add(key);
        }
      }
      if (!isNoStorage && !v.color.trim()) errs.color = 'Color is required';
      if (!effectiveCost || isNaN(Number(effectiveCost)) || Number(effectiveCost) <= 0) {
        errs.costPrice = 'Enter valid cost';
      }
      if (!effectivePrice || isNaN(Number(effectivePrice)) || Number(effectivePrice) <= 0) {
        errs.price = 'Enter valid price';
      }
      if (!effectiveStock || isNaN(Number(effectiveStock)) || Number(effectiveStock) < 0) {
        errs.stock = 'Enter valid quantity';
      }
      if (Object.keys(errs).length > 0) {
        vErrors[v.id] = errs;
        hasErrors = true;
      }
    }
    setVariantErrors(vErrors);
    return !hasErrors;
  };

  // ── Submit ──
  const handleSubmit = async (force: boolean = false, printBarcode: boolean = false, createAnother: boolean = false) => {
    if (mode === 'single') {
      await handleSingleSubmit(force, printBarcode, createAnother);
    } else {
      await handleMultiSubmit(force, printBarcode, createAnother);
    }
  };

  // Single mode submit
  const handleSingleSubmit = async (force: boolean, printBarcode: boolean, createAnother: boolean) => {
    if (!validateSingleMode()) return;

    const isNoStorage = form.category === 'accessory';
    const storage = isNoStorage ? 'N/A' : form.storage;
    const color = isNoStorage ? '' : form.color.trim();

    if (!force) {
      const duplicate = products.find(p => 
        p.name.toLowerCase().trim() === form.name.toLowerCase().trim() &&
        p.model.toLowerCase().trim() === form.model.toLowerCase().trim() &&
        (isNoStorage || p.storage === storage) &&
        (isNoStorage || (p.color || '').toLowerCase().trim() === color.toLowerCase().trim())
      );
      if (duplicate) {
        setDuplicateWarning({ product: duplicate, printBarcode, createAnother });
        return;
      }
    }

    setIsSubmitting(true);
    setSubmittingAction(createAnother ? 'add_new' : printBarcode ? 'print' : 'submit');

    try {
      const stock = Number(form.stock);
      const threshold = Number(form.lowStockThreshold) || 5;

      // Guaranteed collision-free barcode across entire store database
      const systemSkus = new Set(products.map(p => (p.sku || '').toUpperCase()));
      const rawSku = form.sku.trim() || generateSKU(form.name, form.model, storage, color);
      const guaranteedUniqueSku = resolveUniqueSKU(rawSku, systemSkus);

      const product: Omit<PhoneModel, 'id'> = {
        name: form.name.trim(),
        model: form.model.trim(),
        storage,
        color,
        price: Number(form.price),
        costPrice: Number(form.costPrice),
        stock,
        stockStatus: stock === 0 ? 'out_of_stock' : stock <= threshold ? 'low_stock' : 'in_stock',
        sku: guaranteedUniqueSku,
        category: form.category as PhoneModel['category'],
        accessorySubCategory: form.category === 'accessory' ? ((form.accessorySubCategory as AccessorySubCategory) || 'other') : undefined,
        supplier: form.supplier.trim() || undefined,
        location: form.location.trim() || undefined,
        lowStockThreshold: threshold,
        notes: form.notes.trim() || undefined,
      };
      
      // Add product to database
      await addProduct(product);
      
      // Print barcode if requested
      if (printBarcode) {
        const printProduct = { ...product, id: 'temp' } as PhoneModel;
        const result = await printBarcodeDirect([printProduct], storeName, currency);
        
        if (result.method === 'browser') {
          const html = buildLabelsHTML([printProduct], storeName);
          openPrintWindow(html, 'Product Label');
        }
      }

      if (createAnother) {
        toast.success('Product saved!', `${form.name} ${form.model} added. Ready for next item with preserved defaults.`);
        resetForNewProduct();
      } else {
        toast.success('Product added!', `${form.name} ${form.model} added to inventory.`);
        resetAndClose();
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to add product', 'An unexpected error occurred.');
      setIsSubmitting(false);
      setSubmittingAction(null);
    }
  };

  // Multi mode submit — batch-creates all variants
  const handleMultiSubmit = async (force: boolean, printBarcode: boolean, createAnother: boolean) => {
    if (!validateMultiMode()) return;

    const isNoStorage = form.category === 'accessory';

    // Check for duplicates per variant against existing database (unless forced)
    if (!force) {
      for (const v of variants) {
        const storage = isNoStorage ? 'N/A' : v.storage;
        const color = isNoStorage ? '' : v.color.trim();
        const duplicate = products.find(p =>
          p.name.toLowerCase().trim() === form.name.toLowerCase().trim() &&
          p.model.toLowerCase().trim() === v.model.toLowerCase().trim() &&
          (isNoStorage || p.storage === storage) &&
          (isNoStorage || (p.color || '').toLowerCase().trim() === color.toLowerCase().trim())
        );
        if (duplicate) {
          setDuplicateWarning({ product: duplicate, printBarcode, createAnother });
          return;
        }
      }
    }

    setIsSubmitting(true);
    setSubmittingAction(createAnother ? 'add_new' : printBarcode ? 'print' : 'submit');

    try {
      // Track all existing system barcodes to guarantee 100% collision-free barcodes across database and batch
      const systemSkus = new Set(products.map(p => (p.sku || '').toUpperCase()));

      // Build product array from shared fields + variants (applying master model sync where active)
      const productsToAdd: Omit<PhoneModel, 'id'>[] = variants.map((v, idx) => {
        const effectiveCost = v.costPrice || (syncCost && idx > 0 ? variants[0].costPrice : '');
        const effectivePrice = v.price || (syncPrice && idx > 0 ? variants[0].price : '');
        const effectiveStock = v.stock || (syncStock && idx > 0 ? variants[0].stock : '');
        const effectiveThreshold = v.lowStockThreshold || (syncStock && idx > 0 ? variants[0].lowStockThreshold : '5');

        const stock = Number(effectiveStock);
        const threshold = Number(effectiveThreshold) || 5;
        const storage = isNoStorage ? 'N/A' : v.storage;
        const color = isNoStorage ? '' : v.color.trim();
        const rawSku = generateSKU(form.name, v.model, storage, color);
        const guaranteedUniqueSku = resolveUniqueSKU(rawSku, systemSkus);

        return {
          name: form.name.trim(),
          model: v.model.trim(),
          storage,
          color,
          price: Number(effectivePrice),
          costPrice: Number(effectiveCost),
          stock,
          stockStatus: stock === 0 ? 'out_of_stock' : stock <= threshold ? 'low_stock' : 'in_stock',
          sku: guaranteedUniqueSku,
          category: form.category as PhoneModel['category'],
          accessorySubCategory: form.category === 'accessory' ? ((form.accessorySubCategory as AccessorySubCategory) || 'other') : undefined,
          supplier: form.supplier.trim() || undefined,
          location: form.location.trim() || undefined,
          lowStockThreshold: threshold,
          notes: form.notes.trim() || undefined,
        };
      });

      await addProductsBulk(productsToAdd);

      // Print barcodes if requested
      if (printBarcode) {
        const printProducts = productsToAdd.map((p, i) => ({ ...p, id: `temp-${i}` } as PhoneModel));
        const result = await printBarcodeDirect(printProducts, storeName, currency);

        if (result.method === 'browser') {
          const html = buildLabelsHTML(printProducts, storeName);
          openPrintWindow(html, 'Product Labels');
        }
      }

      const totalStock = variants.reduce((sum, v, idx) => {
        const s = v.stock || (syncStock && idx > 0 ? variants[0].stock : '');
        return sum + (Number(s) || 0);
      }, 0);

      if (createAnother) {
        toast.success(
          `${variants.length} models added!`,
          `${form.name} (${totalStock} units) saved. Ready for next product with preserved defaults.`
        );
        resetForNewProduct();
      } else {
        toast.success(
          `${variants.length} models added!`,
          `${form.name} — ${variants.length} models, ${totalStock} total units added to inventory.`
        );
        resetAndClose();
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to add products', 'An unexpected error occurred.');
      setIsSubmitting(false);
      setSubmittingAction(null);
    }
  };

  const resetForNewProduct = () => {
    const preservedCategory = form.category;
    const preservedSubCategory = form.accessorySubCategory;
    const preservedSupplier = form.supplier;
    const preservedLocation = form.location;

    setForm({
      ...INITIAL,
      category: preservedCategory,
      accessorySubCategory: preservedSubCategory,
      supplier: preservedSupplier,
      location: preservedLocation,
      storage: preservedCategory === 'accessory' ? 'N/A' : '128GB',
    });
    setErrors({});
    setVariants([createEmptyVariant(preservedCategory)]);
    setVariantErrors({});
    setSyncCost(false);
    setSyncPrice(false);
    setSyncStock(false);
    setIsSubmitting(false);
    setSubmittingAction(null);
    setDuplicateWarning(null);
    setHasPreservedDefaults(true);

    // Auto-focus the Product Name field for fluid back-to-back typing
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 60);
  };

  const resetAndClose = () => {
    setForm({ ...INITIAL, category: defaultCategory });
    setErrors({});
    setVariants([createEmptyVariant(defaultCategory)]);
    setVariantErrors({});
    setSyncCost(false);
    setSyncPrice(false);
    setSyncStock(false);
    setIsSubmitting(false);
    setSubmittingAction(null);
    setDuplicateWarning(null);
    setHasPreservedDefaults(false);
    setMode('single');
    onClose();
  };

  const handleClose = () => { resetAndClose(); };

  // ── Mode switch handler ──
  const switchMode = (newMode: AddMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    setVariantErrors({});
    setSyncCost(false);
    setSyncPrice(false);
    setSyncStock(false);
    if (newMode === 'multi') {
      // Move current single-mode model/pricing into first variant if any data exists
      if (form.model.trim() || form.price || form.costPrice || form.stock) {
        setVariants([{
          id: `v-${++variantIdCounter}-${Date.now()}`,
          model: form.model,
          storage: form.category === 'accessory' ? 'N/A' : (form.storage || '128GB'),
          color: form.color,
          price: form.price,
          costPrice: form.costPrice,
          stock: form.stock,
          lowStockThreshold: form.lowStockThreshold || '1',
        }]);
      } else {
        setVariants([createEmptyVariant(form.category)]);
      }
    } else {
      // Moving back to single: put first variant's data back into the form
      if (variants.length > 0) {
        const first = variants[0];
        setForm(prev => {
          const rawSku = generateSKU(prev.name, first.model, first.storage, first.color);
          const tempSet = new Set(existingSkuSet);
          return {
            ...prev,
            model: first.model,
            storage: first.storage,
            color: first.color,
            price: first.price,
            costPrice: first.costPrice,
            stock: first.stock,
            lowStockThreshold: first.lowStockThreshold,
            sku: resolveUniqueSKU(rawSku, tempSet),
          };
        });
      }
    }
  };

  // ── Multi-mode summary ──
  const totalVariants = variants.length;
  const totalStock = variants.reduce((sum, v, idx) => {
    const s = v.stock || (syncStock && idx > 0 ? variants[0].stock : '');
    return sum + (Number(s) || 0);
  }, 0);

  // ── Footer button labels ──
  const submitLabel = mode === 'multi' ? `Add All ${totalVariants} Models` : 'Add Product';
  const printLabel = mode === 'multi' ? 'Save & Print All Barcodes' : 'Save & Print Barcode';

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        closeOnOverlayClick={false}
        closeOnEscape={false}
        title="Add New Product"
        subtitle={mode === 'multi' ? `Adding ${totalVariants} model${totalVariants !== 1 ? 's' : ''} for "${form.name || '...'}"` : 'Fill in the product details below'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>Cancel</Button>
            <Button variant="secondary" onClick={() => handleSubmit(false, true, false)} isLoading={submittingAction === 'print'} disabled={isSubmitting}>{printLabel}</Button>
            <Button
              variant="secondary"
              className={styles.addNewBtn}
              onClick={() => handleSubmit(false, false, true)}
              isLoading={submittingAction === 'add_new'}
              disabled={isSubmitting}
              leftIcon={<RefreshCw size={14} />}
              title="Save this product and immediately open a fresh form preserving Supplier, Category, and Location"
            >
              Add & New
            </Button>
            <Button onClick={() => handleSubmit(false, false, false)} isLoading={submittingAction === 'submit'} disabled={isSubmitting}>{submitLabel}</Button>
          </>
        }
      >
        <div className={styles.form}>
          {/* Preserved Defaults Banner (shown during "Add & New" back-to-back entries) */}
          {hasPreservedDefaults && (
            <div className={styles.preservedBanner}>
              <div className={styles.preservedInfo}>
                <RefreshCw size={13} className={styles.preservedIcon} />
                <span>Preserving for rapid entry:</span>
                <span className={styles.preservedTag}>
                  Category: <strong>{CATEGORY_OPTIONS.find(c => c.value === form.category)?.label || form.category}</strong>
                </span>
                {form.supplier && (
                  <span className={styles.preservedTag}>
                    Supplier: <strong>{form.supplier}</strong>
                  </span>
                )}
                {form.location && (
                  <span className={styles.preservedTag}>
                    Location: <strong>{form.location}</strong>
                  </span>
                )}
              </div>
              <button
                type="button"
                className={styles.clearPreservedBtn}
                onClick={() => {
                  setForm(prev => ({
                    ...prev,
                    supplier: '',
                    location: '',
                    category: defaultCategory,
                  }));
                  setHasPreservedDefaults(false);
                }}
              >
                Reset Defaults
              </button>
            </div>
          )}

          {/* ── Mode Toggle ── */}
          <div className={styles.modeToggle}>
            <button
              type="button"
              className={`${styles.modeOption} ${mode === 'single' ? styles.modeOptionActive : ''}`}
              onClick={() => switchMode('single')}
            >
              <Package size={14} /> Single Model
            </button>
            <button
              type="button"
              className={`${styles.modeOption} ${mode === 'multi' ? styles.modeOptionActive : ''}`}
              onClick={() => switchMode('multi')}
            >
              <Layers size={14} /> Multiple Models
            </button>
          </div>

          {/* ══════════════ SINGLE MODE ══════════════ */}
          {mode === 'single' && (
            <>
              {/* Basic Info */}
              <p className={styles.sectionLabel}>Basic Information</p>
              <div className={styles.row}>
                <Input ref={nameInputRef} label="Name *" placeholder="e.g. Apple, Samsung, Charger" value={form.name}
                  onChange={e => set('name', e.target.value)} error={errors.name} />
                <Input label="Model *" placeholder="e.g. iPhone 15 Pro" value={form.model}
                  onChange={e => set('model', e.target.value)} error={errors.model} />
              </div>
              <div className={styles.row}>
                <Select label="Category" options={CATEGORY_OPTIONS} value={form.category}
                  onChange={v => set('category', v)} />
                {form.category === 'accessory' ? (
                  <Select label="Accessory Type *" options={ACCESSORY_SUB_CATEGORY_OPTIONS} value={form.accessorySubCategory || 'other'}
                    onChange={v => set('accessorySubCategory', v)} />
                ) : (
                  <Input label="Storage Location" placeholder="e.g. Shelf A3" value={form.location}
                    onChange={e => set('location', e.target.value)} />
                )}
              </div>
              {form.category === 'accessory' && (
                <div className={styles.row}>
                  <Input label="Storage Location" placeholder="e.g. Shelf A3" value={form.location}
                    onChange={e => set('location', e.target.value)} />
                </div>
              )}

              {/* Storage and color — hidden for accessories */}
              {form.category !== 'accessory' && (
                <div className={styles.row}>
                  <Select label="Storage" options={STORAGE_OPTIONS} value={form.storage}
                    onChange={v => set('storage', v)} />
                  <Input label="Color *" placeholder="e.g. Midnight Black" value={form.color}
                    onChange={e => set('color', e.target.value)} error={errors.color} />
                </div>
              )}

              {/* Pricing */}
              <p className={styles.sectionLabel}>Pricing</p>
              <div className={styles.row}>
                <Input className="privacy-cost-input" label={`Buy Price / Cost (${symbol}) *`} type="number" placeholder="0.00" value={form.costPrice}
                  onChange={e => set('costPrice', e.target.value)} error={errors.costPrice} />
                <Input label={`Sell Price (${symbol}) *`} type="number" placeholder="0.00" value={form.price}
                  onChange={e => set('price', e.target.value)} error={errors.price} />
              </div>
              <div style={{ marginTop: '4px' }}>
                <ProfitMarginCalculator
                  costPrice={form.costPrice}
                  sellPrice={form.price}
                  stock={form.stock}
                  onApplySellPrice={(suggested) => set('price', suggested.toString())}
                />
              </div>

              {/* Stock */}
              <p className={styles.sectionLabel}>Stock</p>
              <div className={styles.row}>
                <Input label="Initial Stock *" type="number" placeholder="0" value={form.stock}
                  onChange={e => set('stock', e.target.value)} error={errors.stock} />
                <Input label="Low Stock Alert Threshold" type="number" placeholder="1" value={form.lowStockThreshold}
                  onChange={e => set('lowStockThreshold', e.target.value)} />
              </div>

              {/* Supplier & Tracking */}
              <p className={styles.sectionLabel}>Supplier & Tracking</p>
              <div className={styles.row}>
                <Input label="Supplier / Vendor" placeholder="e.g. Apple Authorized" value={form.supplier}
                  onChange={e => set('supplier', e.target.value)} />
              </div>
              <Input label="SKU (auto-generated)" value={form.sku} readOnly
                className={styles.skuInput} onChange={() => {}} />

              {/* Notes */}
              <TextArea label="Internal Notes" placeholder="Optional staff notes about this product..." value={form.notes}
                onChange={e => set('notes', e.target.value)} rows={2} />
            </>
          )}

          {/* ══════════════ MULTI MODE ══════════════ */}
          {mode === 'multi' && (
            <>
              {/* Shared Product Info */}
              <p className={styles.sectionLabel}>Shared Product Information</p>
              <div className={styles.row}>
                <Input ref={nameInputRef} label="Product Name *" placeholder="e.g. Charger, Screen Protector, Samsung Case" value={form.name}
                  onChange={e => set('name', e.target.value)} error={errors.name} />
                <Select label="Category" options={CATEGORY_OPTIONS} value={form.category}
                  onChange={v => set('category', v)} />
              </div>
              {form.category === 'accessory' && (
                <div className={styles.row}>
                  <Select label="Accessory Type *" options={ACCESSORY_SUB_CATEGORY_OPTIONS} value={form.accessorySubCategory || 'other'}
                    onChange={v => set('accessorySubCategory', v)} />
                </div>
              )}
              <div className={styles.row}>
                <Input label="Storage Location" placeholder="e.g. Shelf A3" value={form.location}
                  onChange={e => set('location', e.target.value)} />
                <Input label="Supplier / Vendor" placeholder="e.g. Samsung Authorized" value={form.supplier}
                  onChange={e => set('supplier', e.target.value)} />
              </div>
              <TextArea label="Internal Notes (shared)" placeholder="Optional notes shared across all models..." value={form.notes}
                onChange={e => set('notes', e.target.value)} rows={2} />

              {/* Models / Variants */}
              <p className={styles.sectionLabel}>Models / Variants</p>

              {/* Quick Sync Checkpoints */}
              <div className={styles.syncBar}>
                <div className={styles.syncBarHeader}>
                  <Link size={15} className={styles.syncBarIcon} />
                  <span className={styles.syncBarTitle}>Quick Sync with Model 1:</span>
                  <span className={styles.syncBarDesc}>(Subsequent models are prefilled from Model 1 but remain editable)</span>
                </div>
                <div className={styles.syncOptions}>
                  <label className={`${styles.syncCheckboxLabel} ${syncCost ? styles.syncCheckboxLabelActive : ''}`}>
                    <input
                      type="checkbox"
                      checked={syncCost}
                      onChange={e => handleToggleSyncCost(e.target.checked)}
                      className={styles.syncCheckboxInput}
                    />
                    <span className={styles.syncCheckboxText}>Same Cost</span>
                  </label>

                  <label className={`${styles.syncCheckboxLabel} ${syncPrice ? styles.syncCheckboxLabelActive : ''}`}>
                    <input
                      type="checkbox"
                      checked={syncPrice}
                      onChange={e => handleToggleSyncPrice(e.target.checked)}
                      className={styles.syncCheckboxInput}
                    />
                    <span className={styles.syncCheckboxText}>Same Price</span>
                  </label>

                  <label className={`${styles.syncCheckboxLabel} ${syncStock ? styles.syncCheckboxLabelActive : ''}`}>
                    <input
                      type="checkbox"
                      checked={syncStock}
                      onChange={e => handleToggleSyncStock(e.target.checked)}
                      className={styles.syncCheckboxInput}
                    />
                    <span className={styles.syncCheckboxText}>Same Stock & Low Stock Threshold</span>
                  </label>
                </div>
              </div>

              <div className={styles.variantsContainer}>
                {variants.map((variant, idx) => (
                  <VariantCard
                    key={variant.id}
                    index={idx}
                    variant={variant}
                    errors={variantErrors[variant.id] || {}}
                    productName={form.name}
                    category={form.category}
                    symbol={symbol}
                    canRemove={variants.length > 1}
                    syncCost={syncCost}
                    syncPrice={syncPrice}
                    syncStock={syncStock}
                    firstVariant={variants[0]}
                    existingSkuSet={existingSkuSet}
                    allVariants={variants}
                    onUpdate={updateVariant}
                    onRemove={removeVariant}
                    onClone={cloneVariant}
                  />
                ))}

                {/* Add Another Model button */}
                <button type="button" className={styles.addVariantBtn} onClick={addVariant}>
                  <Plus size={16} /> Add Another Model
                </button>
              </div>

              {/* Summary Bar */}
              {totalVariants > 0 && (
                <div className={styles.summaryBar}>
                  <span className={styles.summaryItem}>
                    <Layers size={14} />
                    <span className={styles.summaryValue}>{totalVariants}</span> model{totalVariants !== 1 ? 's' : ''}
                  </span>
                  <span className={styles.summaryItem}>
                    <Package size={14} />
                    <span className={styles.summaryValue}>{totalStock}</span> total units
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!duplicateWarning}
        title="Possible Duplicate Detected"
        message={`This looks like a duplicate of an existing product (${duplicateWarning?.product.sku}). Are you sure you want to add it as a new product instead of updating the existing stock?`}
        confirmLabel="Yes, Add Anyway"
        cancelLabel="Cancel"
        onConfirm={() => {
          const print = duplicateWarning?.printBarcode || false;
          const createAnother = duplicateWarning?.createAnother || false;
          setDuplicateWarning(null);
          handleSubmit(true, print, createAnother);
        }}
        onCancel={() => setDuplicateWarning(null)}
        isDestructive={false}
      />
    </>
  );
};
