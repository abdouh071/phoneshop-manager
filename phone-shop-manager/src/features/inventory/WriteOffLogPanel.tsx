import React, { useEffect, useState, useMemo } from 'react';
import { X, AlertTriangle, Search } from 'lucide-react';
import { writeOffService } from '../../services/writeOffService';
import type { StockWriteOff } from '../../types';
import styles from './RestockHistory.module.css'; // reuse same styles
import { useInventoryStore } from '../../store/inventoryStore';
import { normalizeArabic } from '../../utils/normalizeText';

interface WriteOffLogPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

const REASON_LABELS: Record<StockWriteOff['reason'], string> = {
  damaged: '💥 Damaged',
  defective: '⚠️ Defective',
  lost: '🔍 Lost',
  stolen: '🚨 Stolen',
  expired: '⏰ Expired',
  other: '📝 Other',
};

const REASON_COLORS: Record<StockWriteOff['reason'], string> = {
  damaged: '#dc2626',
  defective: '#d97706',
  lost: '#7c3aed',
  stolen: '#1d4ed8',
  expired: '#64748b',
  other: '#374151',
};

export const WriteOffLogPanel: React.FC<WriteOffLogPanelProps> = ({ isOpen, onClose }) => {
  const { parts } = useInventoryStore();
  const [entries, setEntries] = useState<StockWriteOff[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    setLoadError(false);
    writeOffService.getAll()
      .then(allEntries => {
        const partIds = new Set(parts.map(p => p.id));
        const filteredEntries = allEntries.filter(e => {
          if (partIds.has(e.productId)) return false;
          if (e.productSku && e.productSku.toUpperCase().startsWith('PRT-')) return false;
          return true;
        });
        setEntries(filteredEntries);
      })
      .catch(() => {
        setEntries([]);
        setLoadError(true);
      })
      .finally(() => setIsLoading(false));
  }, [isOpen, parts]);

  const filtered = useMemo(() => {
    const q = normalizeArabic(search);
    if (!q) return entries;
    return entries.filter(e =>
      normalizeArabic(e.productName).includes(q) ||
      normalizeArabic(e.productSku).includes(q) ||
      normalizeArabic(e.reason).includes(q) ||
      normalizeArabic(e.performedByName).includes(q)
    );
  }, [entries, search]);

  const totalWrittenOff = entries.reduce((sum, e) => sum + e.quantityWrittenOff, 0);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <AlertTriangle size={20} style={{ color: '#dc2626' }} />
            <div>
              <h2 className={styles.title}>Write-Off Log</h2>
              <p className={styles.subtitle}>{entries.length} write-off events</p>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Stats */}
        <div className={styles.statsRow}>
          <div className={styles.statCard} style={{ color: '#dc2626' }}>
            <AlertTriangle size={16} />
            <div>
              <div className={styles.statValue}>{totalWrittenOff}</div>
              <div className={styles.statLabel}>Total Units Written Off</div>
            </div>
          </div>
          <div className={styles.statCard}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#dc2626' }}>🗂</span>
            <div>
              <div className={styles.statValue}>{entries.length}</div>
              <div className={styles.statLabel}>Write-Off Events</div>
            </div>
          </div>
          {/* Breakdown by reason */}
          {(['damaged', 'defective', 'lost', 'stolen'] as StockWriteOff['reason'][]).map(r => {
            const count = entries.filter(e => e.reason === r).reduce((s, e) => s + e.quantityWrittenOff, 0);
            if (count === 0) return null;
            return (
              <div key={r} className={styles.statCard} style={{ color: REASON_COLORS[r] }}>
                <div>
                  <div className={styles.statValue}>{count}</div>
                  <div className={styles.statLabel}>{REASON_LABELS[r].replace(/^\S+\s/, '')}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Search */}
        <div className={styles.searchWrap}>
          <Search size={15} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="Search by product, SKU, reason, or staff..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Table */}
        <div className={styles.tableWrap}>
          {isLoading ? (
            <div className={styles.empty}>Loading write-off history…</div>
          ) : loadError ? (
            <div className={styles.empty}>Failed to load write-off history. Please try again.</div>
          ) : filtered.length === 0 ? (
            <div className={styles.empty}>
              {entries.length === 0
                ? 'No write-offs recorded yet. Use the "Write Off" button on any product to mark damaged or lost units.'
                : 'No results match your search.'}
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Date</th>
                  <th className={styles.th}>Product</th>
                  <th className={styles.th}>SKU</th>
                  <th className={styles.th}>Qty</th>
                  <th className={styles.th}>Stock Before → After</th>
                  <th className={styles.th}>Reason</th>
                  <th className={styles.th}>Reported By</th>
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
                      <span style={{
                        background: 'rgba(220,38,38,0.1)',
                        color: '#dc2626',
                        fontWeight: 700,
                        fontSize: '12px',
                        padding: '2px 8px',
                        borderRadius: '12px',
                      }}>
                        -{entry.quantityWrittenOff}
                      </span>
                    </td>
                    <td className={styles.td} style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                      {entry.stockBefore} → <strong style={{ color: 'var(--color-on-surface)' }}>{entry.stockAfter}</strong>
                    </td>
                    <td className={styles.td}>
                      <span style={{
                        fontSize: '12px',
                        background: `${REASON_COLORS[entry.reason]}18`,
                        color: REASON_COLORS[entry.reason],
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontWeight: 600,
                      }}>
                        {REASON_LABELS[entry.reason]}
                      </span>
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
