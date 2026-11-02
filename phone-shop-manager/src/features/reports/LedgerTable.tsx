import React from 'react';
import { ShoppingBag, Wrench, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { formatCurrency } from '../../utils/formatCurrency';
import type { SaleTransaction, RepairTicket } from '../../types';
import type { ReportData } from '../../services/reportsService';
import type { LedgerTab } from './reportTypes';
import styles from './Reports.module.css';

interface LedgerTableProps {
  data: ReportData;
  filteredSalesLedger: SaleTransaction[];
  filteredRepairsLedger: RepairTicket[];
  ledgerTab: LedgerTab;
  setLedgerTab: (tab: LedgerTab) => void;
  ledgerSearch: string;
  setLedgerSearch: (value: string) => void;
  handleExportSalesCSV: () => void;
  handleExportRepairsCSV: () => void;
}

export const LedgerTable: React.FC<LedgerTableProps> = ({
  data,
  filteredSalesLedger,
  filteredRepairsLedger,
  ledgerTab,
  setLedgerTab,
  ledgerSearch,
  setLedgerSearch,
  handleExportSalesCSV,
  handleExportRepairsCSV,
}) => {
  const { t } = useTranslation();

  return (
    <Card padding="none" className={styles.spanFull}>
      <div className={styles.ledgerHeader}>
        <div className={styles.ledgerTabs}>
          <button
            className={[styles.ledgerTabBtn, ledgerTab === 'sales' && styles.ledgerTabActive].filter(Boolean).join(' ')}
            onClick={() => setLedgerTab('sales')}
          >
            <ShoppingBag size={15} /> {t('reports.salesLedger', 'Sales Ledger')} ({data.salesLedger.length})
          </button>
          <button
            className={[styles.ledgerTabBtn, ledgerTab === 'repairs' && styles.ledgerTabActive].filter(Boolean).join(' ')}
            onClick={() => setLedgerTab('repairs')}
          >
            <Wrench size={15} /> {t('reports.repairsLedger', 'Repairs Ledger')} ({data.repairsLedger.length})
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            placeholder={t('reports.searchPlaceholder', 'Search customer, item, cashier...')}
            value={ledgerSearch}
            onChange={e => setLedgerSearch(e.target.value)}
            className={[styles.dateInput, styles.ledgerSearch].join(' ')}
          />
          {ledgerTab === 'sales' ? (
            <Button size="sm" variant="secondary" leftIcon={<Download size={13} />} onClick={handleExportSalesCSV}>
              {t('reports.exportSalesCSV', 'Export Sales CSV')}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" leftIcon={<Download size={13} />} onClick={handleExportRepairsCSV}>
              {t('reports.exportRepairsCSV', 'Export Repairs CSV')}
            </Button>
          )}
        </div>
      </div>

      <div className={styles.tableWrapper}>
        {ledgerTab === 'sales' ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Date & Time</th>
                <th className={styles.th}>Receipt #</th>
                <th className={styles.th}>Customer</th>
                <th className={styles.th}>Items Purchased</th>
                <th className={styles.th}>Cashier</th>
                <th className={styles.th}>Payment</th>
                <th className={[styles.th, styles.textRight].join(' ')}>Total</th>
                <th className={styles.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredSalesLedger.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-on-surface-variant)' }}>
                    No sales transactions match your filter.
                  </td>
                </tr>
              ) : (
                filteredSalesLedger.map(tx => (
                  <tr key={tx.id} className={styles.tr}>
                    <td className={styles.td} style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
                      {new Date(tx.date).toLocaleDateString()} {new Date(tx.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className={[styles.td, styles.fontMono].join(' ')} style={{ fontSize: '11px' }}>
                      {tx.id.substring(0, 8)}...
                    </td>
                    <td className={styles.td}>
                      <strong>{tx.customerName || (tx.saleType === 'parts_b2b' ? 'Wholesale Client' : 'Walk-in Customer')}</strong>
                      {tx.saleType === 'parts_b2b' && (
                        <span style={{ marginLeft: '6px', fontSize: '10px', background: '#e0f2fe', color: '#0369a1', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
                          PARTS B2B
                        </span>
                      )}
                    </td>
                    <td className={styles.td}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '12px' }}>
                        {tx.items.map((i, idx) => (
                          <span key={idx}>
                            <strong>{i.quantity}x</strong> {i.product.name} {i.product.model}
                            <span style={{ color: 'var(--color-on-surface-variant)' }}> ({formatCurrency(i.product.price * i.quantity)})</span>
                          </span>
                        ))}
                        {tx.discount && (
                          <span style={{ color: 'var(--color-warning)', fontSize: '11px' }}>
                            Discount: -{tx.discount.value}{tx.discount.type === 'percent' ? '%' : ' DA'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={styles.td} style={{ fontSize: '12px' }}>
                      {tx.processedByName || 'Store Cashier'}
                    </td>
                    <td className={styles.td} style={{ fontSize: '12px', textTransform: 'capitalize' }}>
                      {tx.payments.map(p => p.method).join(' + ')}
                    </td>
                    <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                      <strong>{formatCurrency(tx.total)}</strong>
                    </td>
                    <td className={styles.td}>
                      <span className={[
                        styles.statusBadge,
                        tx.status === 'refunded' ? styles.statusRefunded : styles.statusCompleted
                      ].join(' ')}>
                        {tx.status || 'completed'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Date & Time</th>
                <th className={styles.th}>Ticket #</th>
                <th className={styles.th}>Customer</th>
                <th className={styles.th}>Device</th>
                <th className={styles.th}>Issue Description</th>
                <th className={styles.th}>Technician</th>
                <th className={[styles.th, styles.textRight].join(' ')}>Parts Cost</th>
                <th className={[styles.th, styles.textRight].join(' ')}>Repair Fee</th>
                <th className={styles.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredRepairsLedger.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-on-surface-variant)' }}>
                    No repair tickets match your filter.
                  </td>
                </tr>
              ) : (
                filteredRepairsLedger.map(r => {
                  const partsCost = (r.partsUsed || []).reduce((s, p) => s + (p.cost || 0) * (p.quantity || 1), 0);
                  const fee = r.actualCost || r.estimatedCost || 0;
                  return (
                    <tr key={r.id} className={styles.tr}>
                      <td className={styles.td} style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
                        {new Date(r.createdAt).toLocaleDateString()} {new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className={[styles.td, styles.fontMono].join(' ')}>
                        <strong>{r.ticketNumber}</strong>
                      </td>
                      <td className={styles.td}>
                        <strong>{r.customerName}</strong>
                        {r.customerPhone && <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>{r.customerPhone}</div>}
                      </td>
                      <td className={styles.td}>
                        {r.deviceBrand} {r.deviceModel}
                      </td>
                      <td className={styles.td} style={{ fontSize: '12px', maxWidth: 200 }}>
                        {r.issueDescription}
                      </td>
                      <td className={styles.td} style={{ fontSize: '12px' }}>
                        {r.assignedTechnician || r.createdByName || 'Tech'}
                      </td>
                      <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')} style={{ color: 'var(--color-error)' }}>
                        {partsCost > 0 ? `-${formatCurrency(partsCost)}` : '0 DA'}
                      </td>
                      <td className={[styles.td, styles.textRight, styles.fontMono].join(' ')}>
                        <strong>{formatCurrency(fee)}</strong>
                        {r.status === 'completed' && r.paymentStatus === 'partial' && (
                          <div style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600 }}>
                            Paid: {formatCurrency(r.paidAmount || 0)}
                          </div>
                        )}
                      </td>
                      <td className={styles.td}>
                        <span className={[
                          styles.statusBadge,
                          r.status === 'completed' ? styles.statusCompleted :
                          r.status === 'in_progress' ? styles.statusInProgress :
                          styles.statusPending
                        ].join(' ')}>
                          {r.status === 'completed' && r.paymentStatus === 'partial'
                            ? 'Claimed (Partly Paid)'
                            : r.status === 'completed' && r.paymentStatus === 'debt'
                            ? 'Claimed (Unpaid Debt)'
                            : r.status === 'completed'
                            ? 'Completed & Paid'
                            : r.status}
                        </span>
                        {r.status === 'completed' && (r.paymentStatus === 'partial' || r.paymentStatus === 'debt') && (
                          <div style={{ fontSize: '11px', color: '#dc2626', fontWeight: 700, marginTop: '2px' }}>
                            Debt: {formatCurrency(Math.max(0, fee - (r.paidAmount || 0)))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
};
