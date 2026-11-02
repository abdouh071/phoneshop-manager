import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { useSettingsStore } from '../../store/settingsStore';
import {
  Download,
  FileSpreadsheet,
  FileJson,
  AlertCircle,
  Loader2,
  ShieldCheck,
  HardDrive,
  Users,
  Package,
  Wrench,
  Receipt,
  ClipboardList,
  CalendarCheck,
  UploadCloud,
  RotateCcw,
} from 'lucide-react';
import styles from './Settings.module.css';
import { errorMessage } from '../../utils/errorUtils';
import {
  APPEND_ONLY_COLLECTIONS,
  BACKUP_COLLECTIONS,
  RESTORE_OPT_IN_COLLECTIONS,
  backupFilename,
  exportStoreBackup,
  fetchCollectionDocuments,
  fileStamp,
  parseStoreBackup,
  restoreStoreBackup,
  valueToCsvCell,
  type BackupData,
  type RestoreCollectionReport,
  type RestoreMode,
  type StoreBackupArtifact,
} from '../../services/storeBackupService';

// ─── Helpers ─────────────────────────────────────────────────
function triggerDownload(content: string, filename: string, type: 'application/json' | 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface CsvField {
  key: string;
  label: string;
}

/** Rows come back from the backup service with Firestore values encoded for round-trip, so cells
 *  go through `valueToCsvCell` — a raw `String(obj)` used to land `[object Object]` in Excel. */
function jsonToCsv(rows: BackupData[], fields: CsvField[]): string {
  if (rows.length === 0) return '';
  const headerRow = fields.map(f => `"${f.label.replace(/"/g, '""')}"`).join(',');
  const body = rows.map(row =>
    fields
      .map(f => `"${valueToCsvCell(row[f.key] ?? null).replace(/"/g, '""')}"`)
      .join(',')
  );
  return [headerRow, ...body].join('\r\n');
}

const CUSTOMER_FIELDS: CsvField[] = [
  { key: 'name', label: 'Customer Name' },
  { key: 'phone', label: 'Phone Number' },
  { key: 'email', label: 'Email' },
  { key: 'accountType', label: 'Account Type' },
  { key: 'debt', label: 'Outstanding Debt' },
  { key: 'totalSpent', label: 'Total Spent' },
  { key: 'totalPurchases', label: 'Total Purchases' },
  { key: 'creditLimit', label: 'Credit Limit' },
  { key: 'address', label: 'Address' },
  { key: 'joinDate', label: 'Joined' },
  { key: 'notes', label: 'Notes' },
];

const INVENTORY_FIELDS: CsvField[] = [
  { key: 'name', label: 'Item Name' },
  { key: 'sku', label: 'SKU / Barcode' },
  { key: 'category', label: 'Category' },
  { key: 'brand', label: 'Brand' },
  { key: 'model', label: 'Model' },
  { key: 'condition', label: 'Condition' },
  { key: 'stock', label: 'In Stock' },
  { key: 'price', label: 'Selling Price' },
  { key: 'costPrice', label: 'Cost Price' },
  { key: 'lowStockThreshold', label: 'Low Stock Alert' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'location', label: 'Location' },
  { key: 'notes', label: 'Notes' },
];

const DEBT_FIELDS: CsvField[] = [
  { key: 'customerName', label: 'Customer' },
  { key: 'customerPhone', label: 'Phone' },
  { key: 'productOrService', label: 'Item / Service' },
  { key: 'date', label: 'Debt Date' },
  { key: 'totalAmount', label: 'Total' },
  { key: 'amountPaid', label: 'Paid' },
  { key: 'remainingBalance', label: 'Remaining' },
  { key: 'dueDate', label: 'Due Date' },
  { key: 'status', label: 'Status' },
  { key: 'linkedTicketNumber', label: 'Ticket #' },
  { key: 'createdAt', label: 'Created At' },
];

const REPAIR_FIELDS: CsvField[] = [
  { key: 'ticketNumber', label: 'Ticket #' },
  { key: 'customerName', label: 'Customer' },
  { key: 'customerPhone', label: 'Phone' },
  { key: 'deviceBrand', label: 'Brand' },
  { key: 'deviceModel', label: 'Device Model' },
  { key: 'imei', label: 'IMEI' },
  { key: 'issueDescription', label: 'Issue Description' },
  { key: 'status', label: 'Status' },
  { key: 'estimatedCost', label: 'Estimated Total' },
  { key: 'actualCost', label: 'Final Total' },
  { key: 'assignedTechnician', label: 'Technician' },
  { key: 'createdAt', label: 'Intake Date' },
];

const TRANSACTION_FIELDS: CsvField[] = [
  { key: 'invoiceNumber', label: 'Invoice #' },
  { key: 'date', label: 'Date Time' },
  { key: 'saleType', label: 'Sale Type' },
  { key: 'total', label: 'Total Amount' },
  { key: 'paymentStatus', label: 'Payment Status' },
  { key: 'status', label: 'Status' },
  { key: 'customerName', label: 'Customer' },
  { key: 'processedByName', label: 'Cashier' },
];

const PURCHASE_ORDER_FIELDS: CsvField[] = [
  { key: 'orderNumber', label: 'Order #' },
  { key: 'supplierName', label: 'Supplier' },
  { key: 'orderDate', label: 'Order Date' },
  { key: 'status', label: 'Status' },
  { key: 'totalCost', label: 'Total Cost' },
  { key: 'createdAt', label: 'Created At' },
];

const EOD_FIELDS: CsvField[] = [
  { key: 'date', label: 'Business Day' },
  { key: 'closedAt', label: 'Closed At' },
  { key: 'closedByName', label: 'Closed By' },
  { key: 'totalSales', label: 'Total Sales' },
  { key: 'cashSales', label: 'Cash Sales' },
  { key: 'netProfit', label: 'Net Profit' },
];

// ─── Component ───────────────────────────────────────────────
export const BackupTab: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const settings = useSettingsStore();

  const [isExportingAll, setIsExportingAll] = useState(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [exportingModule, setExportingModule] = useState<string | null>(null);
  const [lastBackupDate, setLastBackupDate] = useState<string | null>(() => {
    return localStorage.getItem('last_store_backup_date');
  });

  const [artifact, setArtifact] = useState<StoreBackupArtifact | null>(null);
  const [artifactName, setArtifactName] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<RestoreMode>('skip-existing');
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<string | null>(null);
  const [restoreReports, setRestoreReports] = useState<RestoreCollectionReport[] | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const moduleNames = artifact ? Object.keys(artifact.collections) : [];

  /** One-click Full Store Snapshot Export (JSON) */
  const handleExportFullBackup = async () => {
    setIsExportingAll(true);
    setExportProgress(null);
    try {
      const total = BACKUP_COLLECTIONS.length;
      const { artifact: result, json, failed } = await exportStoreBackup({
        storeName: settings.storeName || 'Phone Shop',
        currency: settings.currency || 'USD',
        onCollection: (name, index) =>
          setExportProgress(t('backup.reading', { name, index: index + 1, total })),
      });

      const records = Object.values(result.collections).reduce((sum, docs) => sum + docs.length, 0);
      const readable = result.reports.filter(r => r.status === 'ok').length;

      // Every collection failed: the file would be a valid-looking archive of nothing.
      if (readable === 0) {
        toast.error(
          t('backup.failedTitle'),
          t('backup.emptyRefused', { names: failed.map(f => f.name).slice(0, 3).join(', ') })
        );
        return;
      }

      const filename = backupFilename(settings.storeName || 'phone_shop', new Date());
      triggerDownload(json, filename, 'application/json');

      const nowFormatted = new Date().toLocaleString();
      setLastBackupDate(nowFormatted);
      localStorage.setItem('last_store_backup_date', nowFormatted);

      if (failed.length === 0) {
        toast.success(
          t('backup.createdTitle'),
          t('backup.createdDesc', { records, filename })
        );
      } else {
        toast.warning(
          t('backup.partialTitle'),
          t('backup.partialDesc', { names: failed.map(f => f.name).join(', ') })
        );
      }
    } catch (err: unknown) {
      toast.error(t('backup.failedTitle'), errorMessage(err) || t('backup.failedDesc'));
    } finally {
      setIsExportingAll(false);
      setExportProgress(null);
    }
  };

  /** Modular Export Handler (CSV or JSON) */
  const handleExportModule = async (collectionName: string, format: 'json' | 'csv', csvFields?: CsvField[]) => {
    const key = `${collectionName}_${format}`;
    setExportingModule(key);
    try {
      const documents = await fetchCollectionDocuments(collectionName);
      const rows = documents.map(d => ({ id: d.id, ...d.data }));
      const stamp = fileStamp(new Date());

      if (format === 'json') {
        const filename = `${collectionName}_export_${stamp}.json`;
        triggerDownload(JSON.stringify(documents, null, 2), filename, 'application/json');
      } else {
        const fields = csvFields || (rows[0] ? Object.keys(rows[0]).map(k => ({ key: k, label: k })) : []);
        const csv = jsonToCsv(rows, fields);
        const filename = `${collectionName}_export_${stamp}.csv`;
        triggerDownload(csv, filename, 'text/csv;charset=utf-8;');
      }

      toast.success(
        t('backup.exportComplete'),
        t('backup.exportedRecords', { count: documents.length, name: collectionName, format: format.toUpperCase() })
      );
    } catch (err: unknown) {
      toast.error(t('backup.exportFailed'), errorMessage(err) || t('backup.exportFailedDesc', { name: collectionName }));
    } finally {
      setExportingModule(null);
    }
  };

  const handlePickFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setArtifact(null);
    setRestoreReports(null);
    setParseError(null);
    setSelected([]);
    try {
      const parsed = parseStoreBackup(await file.text());
      setArtifact(parsed);
      setArtifactName(file.name);
      setSelected(
        Object.keys(parsed.collections).filter(
          name => (parsed.collections[name]?.length ?? 0) > 0 && !RESTORE_OPT_IN_COLLECTIONS.includes(name)
        )
      );
    } catch (err: unknown) {
      setParseError(errorMessage(err) || t('backup.invalidFileFallback'));
      setArtifactName(file.name);
    }
  };

  const toggleCollection = (name: string): void => {
    setSelected(prev => (prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]));
  };

  const runRestore = async (): Promise<void> => {
    if (!artifact || selected.length === 0) return;
    setIsRestoring(true);
    setRestoreProgress(null);
    try {
      const reports = await restoreStoreBackup({
        artifact,
        collections: selected,
        mode,
        onCollection: (name, index, total) =>
          setRestoreProgress(t('backup.restoreProgress', { name, index: index + 1, total })),
      });
      setRestoreReports(reports);
      setConfirmOpen(false);

      const written = reports.reduce((s, r) => s + r.written, 0);
      const skipped = reports.reduce((s, r) => s + r.skipped, 0);
      const failed = reports.reduce((s, r) => s + r.failed, 0);
      const message = t('backup.restoreDoneDesc', { written, skipped, failed });
      if (failed > 0) {
        toast.error(t('backup.restoreFailedTitle'), message);
      } else {
        toast.success(t('backup.restoreDone'), message);
      }
    } catch (err: unknown) {
      toast.error(t('backup.restoreFailedTitle'), errorMessage(err) || t('backup.restoreFailedDesc'));
    } finally {
      setIsRestoring(false);
      setRestoreProgress(null);
    }
  };

  const selectedDocuments = selected.reduce(
    (sum, name) => sum + (artifact?.collections[name]?.length ?? 0),
    0
  );
  const hasAppendOnlySelected = selected.some(name => APPEND_ONLY_COLLECTIONS.includes(name));

  return (
    <div className={styles.grid}>
      {/* ── Full Snapshot Card ── */}
      <Card padding="lg">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
            <div style={{
              width: '46px',
              height: '46px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              boxShadow: '0 4px 12px rgba(59, 130, 246, 0.25)',
            }}>
              <HardDrive size={24} />
            </div>
            <div>
              <h2 className={styles.sectionTitle} style={{ margin: 0, border: 'none', padding: 0 }}>
                {t('backup.fullTitle')}
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--color-on-surface-variant, #666)' }}>
                {t('backup.fullDesc')}
              </p>
            </div>
          </div>

          <Button
            variant="primary"
            onClick={handleExportFullBackup}
            disabled={isExportingAll}
            leftIcon={isExportingAll ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            style={{ minWidth: '180px' }}
          >
            {isExportingAll && exportProgress ? exportProgress : t('backup.exportFull')}
          </Button>
        </div>

        {/* Backup Status Strip */}
        <div style={{
          marginTop: '16px',
          padding: '12px 14px',
          borderRadius: '8px',
          background: 'var(--color-surface-container, #f3f4f6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          fontSize: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-on-surface)' }}>
            <ShieldCheck size={16} color="#10b981" />
            <span>
              <strong>{t('backup.securityNote')}</strong> {t('backup.securityDesc')}
            </span>
          </div>
          {lastBackupDate && (
            <div style={{ color: 'var(--color-on-surface-variant, #666)' }}>
              {t('backup.lastExported')} <strong>{lastBackupDate}</strong>
            </div>
          )}
        </div>
      </Card>

      {/* ── Restore Card ── */}
      <Card padding="lg">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
            <div style={{
              width: '46px',
              height: '46px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              boxShadow: '0 4px 12px rgba(245, 158, 11, 0.25)',
            }}>
              <UploadCloud size={24} />
            </div>
            <div>
              <h2 className={styles.sectionTitle} style={{ margin: 0, border: 'none', padding: 0 }}>
                {t('backup.restoreTitle')}
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--color-on-surface-variant, #666)' }}>
                {t('backup.restoreDesc')}
              </p>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            aria-label={t('backup.chooseFile')}
            style={{ display: 'none' }}
            onChange={e => void handlePickFile(e.target.files?.[0])}
          />
          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={isRestoring}
            leftIcon={<FileJson size={16} />}
            style={{ minWidth: '180px' }}
          >
            {t('backup.chooseFile')}
          </Button>
        </div>

        {parseError && (
          <div role="alert" style={{
            marginTop: '14px',
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            background: 'rgba(239, 68, 68, 0.08)',
            fontSize: '12px',
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-start',
          }}>
            <AlertCircle size={16} color="#ef4444" style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>
              <strong>{t('backup.invalidFile')}</strong> {artifactName}: {parseError}
            </span>
          </div>
        )}

        {artifact && (
          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant, #666)' }}>
              <strong>{artifactName}</strong>{' · '}
              {t('backup.fileLoaded', {
                when: new Date(artifact.metadata.exportedAt).toLocaleString(),
                store: artifact.metadata.storeName,
              })}
            </div>

            <div style={{
              border: '1px solid var(--color-outline-variant, #e5e7eb)',
              borderRadius: '8px',
              maxHeight: '260px',
              overflowY: 'auto',
            }}>
              {moduleNames.map(name => {
                const count = artifact.collections[name]?.length ?? 0;
                const checked = selected.includes(name);
                const optIn = RESTORE_OPT_IN_COLLECTIONS.includes(name);
                return (
                  <label key={name} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 12px',
                    fontSize: '13px',
                    borderBottom: '1px solid var(--color-outline-variant, #f0f0f0)',
                    cursor: count === 0 ? 'not-allowed' : 'pointer',
                    opacity: count === 0 ? 0.55 : 1,
                  }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={count === 0 || isRestoring}
                      onChange={() => toggleCollection(name)}
                    />
                    <span style={{ flex: 1 }}>{name}</span>
                    {optIn && <span style={{ fontSize: '11px', color: '#b45309' }}>{t('backup.optInWarningShort')}</span>}
                    <span style={{ color: 'var(--color-on-surface-variant, #666)' }}>
                      {t('backup.documentCount', { count })}
                    </span>
                  </label>
                );
              })}
            </div>

            <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <legend style={{ fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: 'var(--color-on-surface)' }}>
                {t('backup.restoreMode')}
              </legend>
              {(['skip-existing', 'overwrite'] as RestoreMode[]).map(value => (
                <label key={value} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="backup-restore-mode"
                    checked={mode === value}
                    disabled={isRestoring}
                    onChange={() => setMode(value)}
                  />
                  {t(value === 'skip-existing' ? 'backup.modeSkip' : 'backup.modeOverwrite')}
                </label>
              ))}
            </fieldset>

            {mode === 'overwrite' && hasAppendOnlySelected && (
              <div style={{ fontSize: '12px', color: '#b45309', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>{t('backup.appendOnlyWarning')}</span>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <Button
                variant="danger"
                onClick={() => setConfirmOpen(true)}
                disabled={isRestoring || selected.length === 0}
                leftIcon={isRestoring ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
              >
                {isRestoring && restoreProgress ? restoreProgress : t('backup.restoreButton', { selected: selected.length })}
              </Button>
              {selected.length === 0 && <span style={{ fontSize: '12px', color: '#b45309' }}>{t('backup.noCollectionsSelected')}</span>}
            </div>

            {restoreReports && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
                <strong>{t('backup.restoreReportTitle')}</strong>
                {restoreReports.map(r => (
                  <div key={r.name} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', color: 'var(--color-on-surface-variant, #666)' }}>
                    <span style={{ minWidth: '160px', color: 'var(--color-on-surface)' }}>{r.name}</span>
                    <span>{t('backup.written')}: {r.written}</span>
                    <span>{t('backup.skipped')}: {r.skipped}</span>
                    <span style={r.failed > 0 ? { color: '#ef4444' } : undefined}>{t('backup.failed')}: {r.failed}</span>
                    {r.error && <span style={{ color: '#ef4444' }}>{r.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── Modular Export Tables Card ── */}
      <Card padding="lg">
        <h2 className={styles.sectionTitle}>{t('backup.modulesTitle')}</h2>
        <p style={{ fontSize: '13px', color: 'var(--color-on-surface-variant, #666)', marginBottom: '16px' }}>
          {t('backup.modulesDesc')}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <ModuleExportRow
            icon={<Users size={18} color="#3b82f6" />}
            title={t('backup.moduleCustomers')}
            desc={t('backup.moduleCustomersDesc')}
            exportingModule={exportingModule}
            collection="customers"
            csvFields={CUSTOMER_FIELDS}
            onExport={handleExportModule}
          />

          <ModuleExportRow
            icon={<Package size={18} color="#10b981" />}
            title={t('backup.moduleInventory')}
            desc={t('backup.moduleInventoryDesc')}
            exportingModule={exportingModule}
            collection="inventory"
            csvFields={INVENTORY_FIELDS}
            onExport={handleExportModule}
          />

          <ModuleExportRow
            icon={<ClipboardList size={18} color="#f59e0b" />}
            title={t('backup.moduleDebts')}
            desc={t('backup.moduleDebtsDesc')}
            exportingModule={exportingModule}
            collection="customer_debts"
            csvFields={DEBT_FIELDS}
            onExport={handleExportModule}
          />

          <ModuleExportRow
            icon={<Wrench size={18} color="#8b5cf6" />}
            title={t('backup.moduleRepairs')}
            desc={t('backup.moduleRepairsDesc')}
            exportingModule={exportingModule}
            collection="repairs"
            csvFields={REPAIR_FIELDS}
            onExport={handleExportModule}
          />

          <ModuleExportRow
            icon={<Receipt size={18} color="#ec4899" />}
            title={t('backup.moduleTransactions')}
            desc={t('backup.moduleTransactionsDesc')}
            exportingModule={exportingModule}
            collection="transactions"
            csvFields={TRANSACTION_FIELDS}
            onExport={handleExportModule}
          />

          <ModuleExportRow
            icon={<FileSpreadsheet size={18} color="#0ea5e9" />}
            title={t('backup.modulePurchaseOrders')}
            desc={t('backup.modulePurchaseOrdersDesc')}
            exportingModule={exportingModule}
            collection="purchaseOrders"
            csvFields={PURCHASE_ORDER_FIELDS}
            onExport={handleExportModule}
          />

          <ModuleExportRow
            icon={<CalendarCheck size={18} color="#22c55e" />}
            title={t('backup.moduleEod')}
            desc={t('backup.moduleEodDesc')}
            exportingModule={exportingModule}
            collection="end_of_day"
            csvFields={EOD_FIELDS}
            onExport={handleExportModule}
          />
        </div>
      </Card>

      {/* ── Disaster Recovery Best Practices ── */}
      <Card padding="lg">
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <AlertCircle size={20} color="#f59e0b" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 600, color: 'var(--color-on-surface)' }}>
              {t('backup.guidelinesTitle')}
            </h3>
            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', lineHeight: 1.6, color: 'var(--color-on-surface-variant, #666)' }}>
              <li>{t('backup.guidelineFrequency')}</li>
              <li>{t('backup.guidelineStorage')}</li>
              <li>{t('backup.guidelinePrivacy')}</li>
              <li>{t('backup.guidelineRestore')}</li>
            </ul>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void runRestore()}
        isLoading={isRestoring}
        title={t('backup.confirmTitle')}
        confirmLabel={t('backup.confirmButton')}
        message={
          <span>
            {t('backup.confirmBody', { collections: selected.length, documents: selectedDocuments })}
            {mode === 'overwrite' && <><br /><strong>{t('backup.confirmOverwrite')}</strong></>}
          </span>
        }
      />
    </div>
  );
};

// ─── Modular Row Subcomponent ─────────────────────────────────
interface ModuleRowProps {
  icon: React.ReactNode;
  title: string;
  desc: string;
  collection: string;
  csvFields: CsvField[];
  exportingModule: string | null;
  onExport: (collection: string, format: 'json' | 'csv', fields?: CsvField[]) => void;
}

const ModuleExportRow: React.FC<ModuleRowProps> = ({
  icon,
  title,
  desc,
  collection,
  csvFields,
  exportingModule,
  onExport,
}) => {
  const { t } = useTranslation();
  const isExportingCsv = exportingModule === `${collection}_csv`;
  const isExportingJson = exportingModule === `${collection}_json`;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 14px',
      borderRadius: '8px',
      border: '1px solid var(--color-outline-variant, #e5e7eb)',
      background: 'var(--color-surface, #fff)',
      gap: '12px',
      flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', minWidth: '220px', flex: 1 }}>
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '8px',
          background: 'var(--color-surface-container, #f3f4f6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          {icon}
        </div>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-on-surface)' }}>{title}</div>
          <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant, #666)', marginTop: '2px' }}>{desc}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onExport(collection, 'csv', csvFields)}
          disabled={isExportingCsv || isExportingJson}
          leftIcon={isExportingCsv ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
        >
          {isExportingCsv ? t('backup.csvBusy') : t('backup.exportCsv')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onExport(collection, 'json')}
          disabled={isExportingCsv || isExportingJson}
          leftIcon={isExportingJson ? <Loader2 size={14} className="animate-spin" /> : <FileJson size={14} />}
        >
          {isExportingJson ? t('backup.jsonBusy') : t('backup.exportJson')}
        </Button>
      </div>
    </div>
  );
};
