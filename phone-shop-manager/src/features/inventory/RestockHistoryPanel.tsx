import React, { useEffect, useState, useMemo } from 'react';
import { X, ClipboardList, TrendingUp, Package, Search, Banknote } from 'lucide-react';
import { restockService } from '../../services/restockService';
import type { RestockEntry } from '../../types';
import styles from './RestockHistory.module.css';
import { formatCurrency } from '../../utils/formatCurrency';

import { useInventoryStore } from '../../store/inventoryStore';

interface RestockHistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
}


const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

export const RestockHistoryPanel: React.FC<RestockHistoryPanelProps> = ({ isOpen, onClose }) => {
  const { parts } = useInventoryStore();
  const [entries, setEntries] = useState<RestockEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    restockService.getAll()
      .then(allEntries => {
        const partIds = new Set(parts.map(p => p.id));
        const filteredEntries = allEntries.filter(e => {
          if (partIds.has(e.productId)) return false;
          if (e.productSku && e.productSku.toUpperCase().startsWith('PRT-')) return false;
          return true;
        });
        setEntries(filteredEntries);
      })
      .finally(() => setIsLoading(false));
  }, [isOpen, parts]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return entries;
    return entries.filter(e =>
      e.productName.toLowerCase().includes(q) ||
      e.productSku.toLowerCase().includes(q) ||
      (e.supplier ?? '').toLowerCase().includes(q) ||
      (e.performedByName ?? '').toLowerCase().includes(q)
    );
  }, [entries, search]);

  const totalUnitsRestocked = entries.reduce((sum, e) => sum + e.quantityAdded, 0);
  const totalCost = entries.reduce((sum, e) => sum + (e.cost ?? 0) * e.quantityAdded, 0);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <ClipboardList size={20} />
            <div>
              <h2 className={styles.title}>Restock Log</h2>
              <p className={styles.subtitle}>{entries.length} entries total</p>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Summary Stats */}
        <div className={styles.statsRow}>
          <div className={styles.statCard}>
            <Package size={16} />
            <div>
              <div className={styles.statValue}>{totalUnitsRestocked.toLocaleString()}</div>
              <div className={styles.statLabel}>Total Units Received</div>
            </div>
          </div>
          <div className={styles.statCard}>
            <TrendingUp size={16} />
            <div>
              <div className={styles.statValue}>{entries.length}</div>
              <div className={styles.statLabel}>Restock Events</div>
            </div>
          </div>
          {totalCost > 0 && (
            <div className={styles.statCard}>
              <Banknote size={16} />
              <div>
                <div className={styles.statValue}>{formatCurrency(totalCost)}</div>
                <div className={styles.statLabel}>Total Stock Cost</div>
              </div>
            </div>
          )}
        </div>

        {/* Search */}
        <div className={styles.searchWrap}>
          <Search size={15} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="Search by product, SKU, supplier, or staff..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Table */}
        <div className={styles.tableWrap}>
          {isLoading ? (
            <div className={styles.empty}>Loading restock history…</div>
          ) : filtered.length === 0 ? (
            <div className={styles.empty}>
              {entries.length === 0
                ? 'No restock events recorded yet. Use the Restock button on any product to get started.'
                : 'No results match your search.'}
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Date</th>
                  <th className={styles.th}>Product</th>
                  <th className={styles.th}>SKU</th>
                  <th className={styles.th}>Qty Added</th>
                  <th className={styles.th}>Stock Before → After</th>
                  <th className={styles.th}>Unit Cost</th>
                  <th className={styles.th}>Supplier</th>
                  <th className={styles.th}>Received By</th>
                  <th className={styles.th}>Note</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(entry => (
                  <tr key={entry.id} className={styles.tr}>
                    <td className={styles.td} style={{ whiteSpace: 'nowrap', fontSize: '12px' }}>
                      {formatDate(entry.date)}
                    </td>
                    <td className={styles.td}>
                      <span className={styles.productName}>{entry.productName}</span>
                    </td>
                    <td className={styles.td}>
                      <code className={styles.sku}>{entry.productSku}</code>
                    </td>
                    <td className={styles.td}>
                      <span className={styles.qtyBadge}>+{entry.quantityAdded}</span>
                    </td>
                    <td className={styles.td} style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                      {entry.stockBefore} → <strong style={{ color: 'var(--color-on-surface)' }}>{entry.stockAfter}</strong>
                    </td>
                    <td className={styles.td}>
                      {entry.cost != null ? formatCurrency(entry.cost) : <span style={{ opacity: 0.4 }}>—</span>}
                    </td>
                    <td className={styles.td}>
                      {entry.supplier || <span style={{ opacity: 0.4 }}>—</span>}
                    </td>
                    <td className={styles.td}>
                      {entry.performedByName ? (
                        <span className={styles.staffBadge}>{entry.performedByName}</span>
                      ) : (
                        <span style={{ opacity: 0.4 }}>System</span>
                      )}
                    </td>
                    <td className={styles.td} style={{ fontSize: '12px', maxWidth: '160px' }}>
                      {entry.note || <span style={{ opacity: 0.4 }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
