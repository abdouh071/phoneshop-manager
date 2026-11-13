import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, Bell, ClipboardList, Package, Plus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { useToast } from '../../components/ui/Toast';
import { useInventoryStore } from '../../store/inventoryStore';
import { usePartsCartStore } from '../../store/partsCartStore';
import { useCustomerStore } from '../../store/customerStore';
import { useAuthStore } from '../../store/authStore';
import { usePermissions } from '../../hooks/usePermissions';
import { normalizeArabic } from '../../utils/normalizeText';
import type { ProductGroup } from '../../utils/productGrouping';
import type { Customer, PhoneModel } from '../../types';
import { VariantSelectModal } from '../pos/VariantSelectModal';
import { AddPartModal } from './AddPartModal';
import { EditPartPanel } from './EditPartPanel';
import { ProductDetailPanel } from '../inventory/ProductDetailPanel';
import { WriteOffModal } from '../inventory/WriteOffModal';
import { PrintPartsLabelsModal } from './PrintPartsLabelsModal';
import { RestockHistoryPanel } from '../inventory/RestockHistoryPanel';
import { WriteOffLogPanel } from '../inventory/WriteOffLogPanel';
import { RestockAssistantModal } from './RestockAssistantModal';
import { CustomerProfilePanel } from '../customers/CustomerProfilePanel';
import { PartsInventoryTab } from './PartsInventoryTab';
import { PartsPosTab } from './PartsPosTab';
import { PartsInvoicesTab } from './PartsInvoicesTab';
import { useBarcodeScanner } from './useBarcodeScanner';
import styles from './Parts.module.css';

export const PartsPage = () => {
  const { t } = useTranslation();
  const { parts, fetchParts, isLoadingParts, error: partsError } = useInventoryStore(useShallow(s => ({
    parts: s.parts, fetchParts: s.fetchParts, isLoadingParts: s.isLoadingParts, error: s.error,
  })));
  const addToCart = usePartsCartStore(s => s.addToCart);
  const fetchCarts = usePartsCartStore(s => s.fetchCarts);
  const itemCount = usePartsCartStore(s => s.items.reduce((sum, item) => sum + item.quantity, 0));
  const { customers, fetchCustomers } = useCustomerStore(useShallow(s => ({
    customers: s.customers, fetchCustomers: s.fetchCustomers,
  })));
  const user = useAuthStore(s => s.user);
  const permissions = usePermissions();
  const canEdit = user?.role === 'admin' || permissions.inventory_edit;
  const canViewCosts = user?.role === 'admin' || (permissions.inventory_edit && permissions.reports);
  const toast = useToast();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<'inventory' | 'pos' | 'invoices'>('inventory');
  const [inventorySearch, setInventorySearch] = useState<{ query: string; key: string } | null>(null);
  const [customerRequest, setCustomerRequest] = useState<{ customer: Customer; key: string } | null>(null);
  const handledCustomerLink = useRef('');
  const handledProductLink = useRef('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  const [isRestockAssistantOpen, setIsRestockAssistantOpen] = useState(false);
  const [isRestockLogOpen, setIsRestockLogOpen] = useState(false);
  const [isWriteOffLogOpen, setIsWriteOffLogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<PhoneModel | null>(null);
  const [detailProduct, setDetailProduct] = useState<PhoneModel | null>(null);
  const [writeOffProduct, setWriteOffProduct] = useState<PhoneModel | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<ProductGroup | null>(null);
  const [profilePanelCustomer, setProfilePanelCustomer] = useState<Customer | null>(null);
  const [actionRequiringUnlock, setActionRequiringUnlock] = useState<{ name: string; callback: () => void } | null>(null);
  const lowStockCount = parts.filter(p => p.stockStatus === 'low_stock' || p.stockStatus === 'out_of_stock').length;

  const [initialLoading, setInitialLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    void fetchParts().finally(() => { if (mounted) setInitialLoading(false); });
    return () => { mounted = false; };
  }, [fetchParts]);
  // Lazy-load carts & customers only when the POS tab is first opened (#4 audit fix).
  // Saves 2 Firestore full-collection reads on the common inventory-only flow.
  const posTabActivated = useRef(false);
  useEffect(() => {
    if (activeTab === 'pos' && !posTabActivated.current) {
      posTabActivated.current = true;
      fetchCarts();
      fetchCustomers();
    }
  }, [activeTab, fetchCarts, fetchCustomers]);

  useEffect(() => {
    const key = `${location.key}:${location.search}`;
    const id = new URLSearchParams(location.search).get('b2bCustomer');
    if (!id) { handledCustomerLink.current = ''; return; }
    if (handledCustomerLink.current === key) return;
    const customer = customers.find(c => c.id === id);
    if (customer) {
      handledCustomerLink.current = key;
      setCustomerRequest({ customer, key });
      setActiveTab('pos');
    }
  }, [location.key, location.search, customers]);

  useEffect(() => {
    const key = `${location.key}:${location.search}`;
    const params = new URLSearchParams(location.search);
    const search = params.get('search');
    const focusId = params.get('focusId');
    const target = focusId || search;
    if (!target) { handledProductLink.current = ''; return; }
    if (handledProductLink.current === key) return;
    if (search && !focusId) setInventorySearch({ query: search, key });
    const q = normalizeArabic(target);
    const match = parts.find(p => {
      const full = normalizeArabic([p.name, p.model].filter(Boolean).join(' '));
      const name = normalizeArabic(p.name);
      const sku = normalizeArabic(p.sku);
      return p.id === target || (sku !== '' && sku === q) ||
        (full !== '' && (full.includes(q) || q.includes(full))) ||
        (name !== '' && (name.includes(q) || q.includes(name)));
    });
    if (match) {
      handledProductLink.current = key;
      setActiveTab('inventory');
      setDetailProduct(match);
    }
  }, [location.key, location.search, parts]);

  const requirePermission = useCallback((name: string, callback: () => void) => {
    if (canEdit) callback();
    else setActionRequiringUnlock({ name, callback });
  }, [canEdit]);
  const openRestockAssistant = useCallback(() => {
    requirePermission(t('parts.unlockRestockAssistant'), () => setIsRestockAssistantOpen(true));
  }, [requirePermission, t]);
  const editProduct = useCallback((product: PhoneModel) => {
    requirePermission(t('parts.unlockEdit'), () => setEditingProduct(product));
  }, [requirePermission, t]);
  const writeOff = useCallback((product: PhoneModel) => {
    requirePermission(t('parts.unlockWriteOff'), () => setWriteOffProduct(product));
  }, [requirePermission, t]);

  useBarcodeScanner({ onScan: sku => {
    const part = parts.find(p => p.sku && p.sku.toLowerCase() === sku.toLowerCase());
    if (!part) {
      toast.error(t('parts.partNotFound'), t('parts.barcodeNotFound', { sku }));
      return;
    }
    const result = addToCart(part);
    if (result.success) {
      setActiveTab('pos');
      toast.success(t('parts.addedToCart'), `${part.name} ${part.model} ${t('parts.addedViaBarcode')}`);
    } else if (result.reason === 'out_of_stock') {
      toast.error(t('parts.outOfStockToast'), `${part.name} ${part.model} ${t('parts.hasNoUnits')}`);
    } else {
      toast.warning(t('parts.stockLimitReached'), t('parts.availableUnits', { count: result.availableStock }));
    }
  } });

  return (
    <div className={styles.page}>
      <AddPartModal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} />
      <EditPartPanel product={editingProduct} onClose={() => setEditingProduct(null)} />
      <ProductDetailPanel product={detailProduct} onClose={() => setDetailProduct(null)} onEdit={p => { setDetailProduct(null); editProduct(p); }} />
      <WriteOffModal product={writeOffProduct} onClose={() => setWriteOffProduct(null)} />
      <PrintPartsLabelsModal isOpen={isPrintOpen} onClose={() => setIsPrintOpen(false)} />
      <RestockHistoryPanel isOpen={isRestockLogOpen} onClose={() => setIsRestockLogOpen(false)} />
      <WriteOffLogPanel isOpen={isWriteOffLogOpen} onClose={() => setIsWriteOffLogOpen(false)} />
      <RestockAssistantModal isOpen={isRestockAssistantOpen} onClose={() => setIsRestockAssistantOpen(false)} />
      <AdminUnlockModal
        isOpen={actionRequiringUnlock !== null}
        onClose={() => setActionRequiringUnlock(null)}
        onSuccess={() => { actionRequiringUnlock?.callback(); setActionRequiringUnlock(null); }}
        actionName={actionRequiringUnlock?.name}
      />
      <CustomerProfilePanel customer={profilePanelCustomer} isOpen={!!profilePanelCustomer} onClose={() => setProfilePanelCustomer(null)} />
      <VariantSelectModal group={selectedGroup} onClose={() => setSelectedGroup(null)} onSelect={variant => { addToCart(variant); setSelectedGroup(null); }} />

      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('parts.title')}</h1>
          <p className={styles.subtitle}>
            {initialLoading || isLoadingParts ? t('common.loading') : partsError && parts.length === 0 ? t('parts.loadFailed') :
              `${t('parts.partsAvailable', { count: parts.length })} · ${t('parts.unitsInStock', { count: parts.reduce((s, p) => s + p.stock, 0) })}`}
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button variant={lowStockCount > 0 ? 'primary' : 'secondary'} leftIcon={<Bell size={16} />} onClick={openRestockAssistant}
            style={lowStockCount > 0 ? { background: '#d97706', borderColor: '#b45309' } : undefined} title={t('parts.restockAssistantHelp')}>
            {t('parts.restockAssistant')} {lowStockCount > 0 && `(${lowStockCount})`}
          </Button>
          <Button variant="secondary" leftIcon={<ClipboardList size={16} />} onClick={() => requirePermission(t('parts.unlockRestockLog'), () => setIsRestockLogOpen(true))}>
            {t('inventory.restockHistory')}
          </Button>
          <Button variant="secondary" leftIcon={<AlertTriangle size={16} />} onClick={() => requirePermission(t('parts.unlockWriteOffLog'), () => setIsWriteOffLogOpen(true))}>
            {t('inventory.writeOffLog')}
          </Button>
          <Button variant="secondary" leftIcon={<Package size={16} />} onClick={() => setIsPrintOpen(true)}>{t('parts.printLabels')}</Button>
          <Button leftIcon={<Plus size={16} />} onClick={() => requirePermission(t('parts.unlockAdd'), () => setIsAddOpen(true))}>{t('parts.addPart')}</Button>
        </div>
      </div>

      <div className={styles.categoryTabs}>
        <button type="button" className={[styles.categoryTab, activeTab === 'inventory' && styles.categoryTabActive].filter(Boolean).join(' ')}
          aria-pressed={activeTab === 'inventory'} onClick={() => setActiveTab('inventory')}>
          <span>{t('parts.inventoryTab')}</span><span className={styles.tabCount}>{parts.length}</span>
        </button>
        {permissions.parts_sell && (
          <button type="button" className={[styles.categoryTab, activeTab === 'pos' && styles.categoryTabActive].filter(Boolean).join(' ')}
            aria-pressed={activeTab === 'pos'} onClick={() => setActiveTab('pos')}>
            <span>{t('parts.posTab')}</span><span className={styles.tabCount}>{itemCount > 0 ? t('parts.inCart', { count: itemCount }) : t('parts.posTab')}</span>
          </button>
        )}
        <button type="button" className={[styles.categoryTab, activeTab === 'invoices' && styles.categoryTabActive].filter(Boolean).join(' ')}
          aria-pressed={activeTab === 'invoices'} onClick={() => setActiveTab('invoices')}>{t('parts.invoicesTab')}</button>
      </div>

      <div hidden={activeTab !== 'inventory'}>
        <PartsInventoryTab initialLoading={initialLoading} canViewCosts={canViewCosts} searchRequest={inventorySearch} requirePermission={requirePermission}
          onView={setDetailProduct} onEdit={editProduct} onWriteOff={writeOff} onRestockAssistant={openRestockAssistant} />
      </div>
      <div hidden={activeTab !== 'pos'}>
        <PartsPosTab initialLoading={initialLoading} customerRequest={customerRequest} onSelectGroup={setSelectedGroup} onOpenCustomerProfile={setProfilePanelCustomer} />
      </div>
      {activeTab === 'invoices' && <PartsInvoicesTab customers={customers} onOpenCustomerProfile={setProfilePanelCustomer} />}
    </div>
  );
};
