import { Fragment, memo, useEffect, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, CornerDownRight, DollarSign, Package, TrendingUp, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { StockBadge } from '../../components/ui/Badge';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { useInventoryStore } from '../../store/inventoryStore';
import { usePrivacyStore } from '../../store/privacyStore';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { groupProductsByBaseModel } from '../../utils/productGrouping';
import type { ProductGroup } from '../../utils/productGrouping';
import { searchAndRank } from '../../utils/searchUtils';
import { useDebounce } from '../../hooks/useDebounce';
import { HighlightText } from '../../components/ui/HighlightText';import type { PhoneModel } from '../../types';
import { useRestockHandler } from '../inventory/useRestockHandler';
import { PartRowActions } from './PartRowActions';
import styles from './Parts.module.css';

type SortKey = 'name' | 'sku' | 'location' | 'costPrice' | 'price' | 'stock' | 'stockStatus';
type StockFilter = PhoneModel['stockStatus'] | 'all';
const stockOrder = { out_of_stock: 0, low_stock: 1, in_stock: 2 };
const margin = (p: PhoneModel) => p.price > 0 ? (p.price - p.costPrice) / p.price * 100 : 0;
const sortValue = (group: ProductGroup, key: SortKey): string | number => {
  switch (key) {
    case 'name': return `${group.name} ${group.model}`;
    case 'sku': return group.variants.map(p => p.sku || '').sort()[0];
    case 'location': return group.variants.map(p => p.location || '').sort()[0];
    case 'costPrice': return group.minCost;
    case 'price': return group.minPrice;
    case 'stock': return group.totalStock;
    case 'stockStatus': return stockOrder[group.stockStatus];
  }
};

interface PartsInventoryTabProps {
  initialLoading: boolean;
  canViewCosts: boolean;
  searchRequest: { query: string; key: string } | null;
  requirePermission: (name: string, callback: () => void) => void;
  onView: (product: PhoneModel) => void;
  onEdit: (product: PhoneModel) => void;
  onWriteOff: (product: PhoneModel) => void;
  onDelete: (product: PhoneModel) => void;
  onRestockAssistant: () => void;
}

export const PartsInventoryTab = memo(function PartsInventoryTab({
  initialLoading, canViewCosts, searchRequest, requirePermission, onView, onEdit, onWriteOff, onDelete, onRestockAssistant,
}: PartsInventoryTabProps) {
  const { t, i18n } = useTranslation();
  const { parts, isLoadingParts, error, fetchParts } = useInventoryStore(useShallow(s => ({
    parts: s.parts, isLoadingParts: s.isLoadingParts, error: s.error, fetchParts: s.fetchParts,
  })));
  const isLoading = initialLoading || isLoadingParts;
  const isPrivacyActive = usePrivacyStore(s => s.isPrivacyActive);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 150);
  const [statusFilter, setStatusFilter] = useState<StockFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [restockingId, setRestockingId] = useState<string | null>(null);
  const [restockAmt, setRestockAmt] = useState('');
  const [restockMeta, setRestockMeta] = useState({ supplier: '', cost: '', note: '' });
  const itemsPerPage = 10;

  useEffect(() => {
    if (searchRequest) { setSearchQuery(searchRequest.query); setCurrentPage(1); }
  }, [searchRequest]);

  const groups = useMemo(() => {
    // Apply ranked search with fuzzy tolerance, then filter by stock status
    const searchFiltered = debouncedSearch.trim()
      ? searchAndRank(parts, debouncedSearch, p =>
          [p.name, p.model, p.sku, p.location, p.supplier, p.notes].filter(Boolean) as string[]
        )
      : parts;
    return groupProductsByBaseModel(
      searchFiltered.filter(p => statusFilter === 'all' || p.stockStatus === statusFilter)
    );
  }, [parts, debouncedSearch, statusFilter]);
  const sortedGroups = useMemo(() => [...groups].sort((a, b) => {
    const valueA = sortValue(a, sortKey);
    const valueB = sortValue(b, sortKey);
    const order = typeof valueA === 'number' && typeof valueB === 'number'
      ? valueA - valueB : String(valueA).localeCompare(String(valueB), i18n.language, { numeric: true, sensitivity: 'base' });
    return (sortDir === 'asc' ? order : -order) || a.id.localeCompare(b.id);
  }), [groups, sortKey, sortDir, i18n.language]);
  const totalPages = Math.max(1, Math.ceil(sortedGroups.length / itemsPerPage));
  const page = Math.min(currentPage, totalPages);
  const paginatedGroups = sortedGroups.slice((page - 1) * itemsPerPage, page * itemsPerPage);
  useEffect(() => { setCurrentPage(p => Math.min(p, totalPages)); }, [totalPages]);

  const metrics = useMemo(() => parts.reduce((result, p) => {
    result[p.stockStatus]++;
    result.cost += (p.costPrice || 0) * (p.stock || 0);
    result.revenue += (p.price || 0) * (p.stock || 0);
    return result;
  }, { in_stock: 0, low_stock: 0, out_of_stock: 0, cost: 0, revenue: 0 }), [parts]);
  const lowStockCount = metrics.low_stock + metrics.out_of_stock;
  const filter = (status: StockFilter) => { setStatusFilter(status); setCurrentPage(1); };
  const sort = (key: SortKey) => {
    if (sortKey === key) setSortDir(dir => dir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setCurrentPage(1);
  };
  const toggleExpand = (id: string) => setExpandedGroups(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const closeRestock = () => {
    setRestockingId(null);
    setRestockAmt('');
    setRestockMeta({ supplier: '', cost: '', note: '' });
  };
  const handleRestock = useRestockHandler(() => restockAmt, restockMeta, closeRestock);
  const actions = (product: PhoneModel) => (
    <PartRowActions product={product} isRestocking={restockingId === product.id} restockAmt={restockAmt}
      restockCost={restockMeta.cost} canViewCosts={canViewCosts} onView={() => onView(product)} onEdit={() => onEdit(product)}
      onRestockOpen={() => requirePermission(t('parts.unlockRestock'), () => {
        setRestockingId(product.id); setRestockAmt(''); setRestockMeta({ supplier: '', cost: '', note: '' });
      })}
      onWriteOff={() => onWriteOff(product)} onDelete={() => onDelete(product)} onRestockAmtChange={setRestockAmt}
      onRestockCostChange={value => setRestockMeta(m => ({ ...m, cost: value }))}
      onSaveRestock={() => handleRestock(product)} onCancelRestock={closeRestock} />
  );
  const sortHeader = (key: SortKey, label: string) => (
    <th scope="col" className={styles.th} aria-sort={sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={styles.sortButton} onClick={() => sort(key)}>
        {label}
        <span aria-hidden="true" className={sortKey === key ? undefined : styles.sortNeutral}>
          {sortKey !== key ? <><ChevronUp size={12} /><ChevronDown size={12} /></> : sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
    </th>
  );
  const marginBadge = (min: number, max = min) => (
    <span data-privacy-cost className={[min >= 20 ? styles.marginGood : min >= 10 ? styles.marginOk : styles.marginBad, 'privacy-cost'].join(' ')}>
      {isPrivacyActive ? '••%' : min.toFixed(1) === max.toFixed(1) ? `${min.toFixed(1)}%` : `${min.toFixed(1)}% – ${max.toFixed(1)}%`}
    </span>
  );

  return (
    <div className={styles.inventoryTab}>
      {lowStockCount > 0 && (
        <div className={styles.warningBanner}>
          <div className={styles.warningLeft}><AlertTriangle size={18} /><span><strong>{t('parts.attentionNeeded')}</strong> {t('parts.lowStockWarning', { count: lowStockCount })}</span></div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.warningActionBtn} onClick={onRestockAssistant}>{t('parts.restockAssistantPo')}</button>
            <button type="button" className={styles.warningActionBtn} onClick={() => filter(statusFilter === 'low_stock' ? 'all' : 'low_stock')}>
              {t(statusFilter === 'low_stock' ? 'parts.showAllParts' : 'parts.filterLowStock')}
            </button>
          </div>
        </div>
      )}
      <div className={styles.summaryGrid}>
        {([
          { status: 'all', label: t('parts.totalParts'), value: parts.length, icon: Package, style: styles.iconTotal },
          { status: 'in_stock', label: t('inventory.inStock'), value: metrics.in_stock, icon: CheckCircle2, style: styles.iconInStock },
          { status: 'low_stock', label: t('inventory.lowStock'), value: metrics.low_stock, icon: AlertCircle, style: styles.iconLowStock },
          { status: 'out_of_stock', label: t('inventory.outOfStock'), value: metrics.out_of_stock, icon: XCircle, style: styles.iconOutStock },
        ] as const).map(card => (
          <button key={card.status} type="button" className={[styles.summaryCard, statusFilter === card.status && styles.summaryCardActive].filter(Boolean).join(' ')}
            aria-pressed={statusFilter === card.status} onClick={() => filter(statusFilter === card.status ? 'all' : card.status)}>
            <span className={styles.summaryCardTop}><span className={styles.summaryLabel}>{card.label}</span><span className={[styles.summaryIconWrap, card.style].join(' ')}><card.icon size={16} /></span></span>
            <span className={styles.summaryValue}>{(isLoading || error) && parts.length === 0 ? '—' : card.value}</span>
          </button>
        ))}
        {canViewCosts && <div className={styles.summaryCard}>
          <div className={styles.summaryCardTop}><span className={styles.summaryLabel}>{t('parts.costValuation')}</span><span className={[styles.summaryIconWrap, styles.iconValuation].join(' ')}><DollarSign size={16} /></span></div>
          <p className={styles.summaryValue}>{(isLoading || error) && parts.length === 0 ? '—' : formatPrivateCurrency(metrics.cost)}</p>
        </div>}
        <div className={styles.summaryCard}>
          <div className={styles.summaryCardTop}><span className={styles.summaryLabel}>{t('parts.potentialRevenue')}</span><span className={[styles.summaryIconWrap, styles.iconRevenue].join(' ')}><TrendingUp size={16} /></span></div>
          <p className={styles.summaryValue}>{(isLoading || error) && parts.length === 0 ? '—' : formatCurrency(metrics.revenue)}</p>
        </div>
      </div>
      <div className={styles.catalogCard} aria-busy={isLoading}>
        <div className={styles.tableHeader}>
          <div className={styles.headerLeft}><h2 className={styles.tableTitle}>{t('parts.catalogTitle')}</h2><span className={styles.itemCountBadge}>{t('parts.modelsCount', { count: sortedGroups.length })}</span></div>
          <div className={styles.headerActions}>
            <Select options={[
              { value: 'all', label: t('parts.allStatus') }, { value: 'in_stock', label: t('inventory.inStock') },
              { value: 'low_stock', label: t('inventory.lowStock') }, { value: 'out_of_stock', label: t('inventory.outOfStock') },
            ]} value={statusFilter} onChange={v => filter(v as StockFilter)} />
            <SearchInput value={searchQuery} onChange={v => { setSearchQuery(v); setCurrentPage(1); }}
              onClear={() => { setSearchQuery(''); setCurrentPage(1); }}
              aria-label={t('parts.searchPlaceholder')} placeholder={t('parts.searchPlaceholder')} className={styles.search} />
          </div>
        </div>
        {error && <div className={styles.loadError} role="alert"><AlertCircle size={16} /><span>{t('parts.loadFailed')}</span><Button size="sm" variant="secondary" disabled={isLoading} onClick={() => { void fetchParts(); }}>{t('common.refresh')}</Button></div>}
        {isLoading && <p className={styles.loadingMessage} role="status">{t('parts.loadingParts')}</p>}
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead><tr>
              <th scope="col" aria-label={t('parts.variants')} />
              {sortHeader('name', t('parts.partName'))}{sortHeader('sku', t('parts.sku'))}{sortHeader('location', t('parts.location'))}
              {canViewCosts && sortHeader('costPrice', t('parts.buyPriceCost'))}{sortHeader('price', t('parts.sellPrice'))}{sortHeader('stock', t('parts.stock'))}
              {canViewCosts && <th scope="col" className={styles.th}>{t('parts.margin')}</th>}
              {sortHeader('stockStatus', t('parts.statusCol'))}<th scope="col" className={styles.th}>{t('parts.actions')}</th>
            </tr></thead>
            <tbody>
              {isLoading && parts.length === 0 ? Array.from({ length: 5 }, (_, row) => (
                <tr key={row} aria-hidden="true">{Array.from({ length: canViewCosts ? 10 : 8 }, (_, col) => <td key={col} className={styles.td}><span className={styles.skeleton} /></td>)}</tr>
              )) : paginatedGroups.length === 0 ? (!isLoading && !error && <tr><td colSpan={canViewCosts ? 10 : 8} className={styles.emptyCell}><EmptyState title={t('parts.noParts')} description={t(searchQuery || statusFilter !== 'all' ? 'parts.noMatchingParts' : 'parts.noPartsDesc')} /></td></tr>) : paginatedGroups.map(group => {
                const isExpanded = expandedGroups.has(group.id);
                const isSingle = group.variants.length === 1;
                const single = group.variants[0];
                const margins = group.variants.map(margin);
                return <Fragment key={group.id}>
                  <tr className={[styles.tr, styles.trGroup].join(' ')}>
                    <td className={styles.td}>{!isSingle && <button type="button" className={styles.expandButton} aria-expanded={isExpanded} aria-label={t('parts.toggleVariants', { name: `${group.name} ${group.model}` })} onClick={() => toggleExpand(group.id)}>{isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>}</td>
                    <td className={styles.td}><div className={styles.productCell}>
                      <div className={styles.productAvatar}>{group.name[0]}</div><div>
                        <p className={styles.productName}><HighlightText text={`${group.name} ${group.model}`} query={debouncedSearch} /></p>
                        <div className={styles.productMeta}>{isSingle ? <span>{single.color || t('parts.standard')}</span> : <span className={styles.tagPill}>{t('parts.variantCount', { count: group.variants.length })}</span>}</div>
                      </div>
                    </div></td>
                    <td className={styles.td}>{isSingle ? <code className={styles.sku}>{single.sku}</code> : '—'}</td>
                    <td className={styles.td}>{isSingle ? single.location || '—' : '—'}</td>
                    {canViewCosts && <td className={styles.td} data-col="cost"><span data-privacy-cost className="privacy-cost">{group.minCost === group.maxCost ? formatPrivateCurrency(group.minCost) : isPrivacyActive ? '•••••' : `${formatCurrency(group.minCost)} – ${formatCurrency(group.maxCost)}`}</span></td>}
                    <td className={styles.td}>{group.minPrice === group.maxPrice ? formatCurrency(group.minPrice) : `${formatCurrency(group.minPrice)} – ${formatCurrency(group.maxPrice)}`}</td>
                    <td className={styles.td}>{t('parts.units', { count: group.totalStock })}</td>
                    {canViewCosts && <td className={styles.td} data-col="margin">{marginBadge(Math.min(...margins), Math.max(...margins))}</td>}
                    <td className={styles.td}><StockBadge status={group.stockStatus} /></td><td className={styles.td}>{isSingle && actions(single)}</td>
                  </tr>
                  {isExpanded && !isSingle && group.variants.map(product => <tr key={product.id} className={[styles.tr, styles.trVariant].join(' ')}>
                    <td className={styles.td}><CornerDownRight size={14} /></td>
                    <td className={styles.td}><p className={styles.productName}>{product.color || product.name}</p></td>
                    <td className={styles.td}><code className={styles.sku}>{product.sku}</code></td><td className={styles.td}>{product.location || '—'}</td>
                    {canViewCosts && <td className={styles.td} data-col="cost"><span data-privacy-cost className="privacy-cost">{formatPrivateCurrency(product.costPrice)}</span></td>}
                    <td className={styles.td}>{formatCurrency(product.price)}</td><td className={styles.td}>{t('parts.units', { count: product.stock })}</td>
                    {canViewCosts && <td className={styles.td} data-col="margin">{marginBadge(margin(product))}</td>}
                    <td className={styles.td}><StockBadge status={product.stockStatus} /></td><td className={styles.td}>{actions(product)}</td>
                  </tr>)}
                </Fragment>;
              })}
            </tbody>
          </table>
        </div>
        {sortedGroups.length > 0 && <div className={styles.pagination}><Pagination currentPage={page} totalPages={totalPages} onPageChange={setCurrentPage} itemsPerPage={itemsPerPage} totalItems={sortedGroups.length} /></div>}
      </div>
    </div>
  );
});
