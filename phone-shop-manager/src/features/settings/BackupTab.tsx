import React, { useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
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
  Layers,
} from 'lucide-react';
import styles from './Settings.module.css';

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

function formatDateForFile(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}_${hh}${min}`;
}

/** Converts a flat or semi-flat array of objects into a properly escaped CSV string */
function jsonToCsv(data: Record<string, any>[], fields: { key: string; label: string }[]): string {
  if (!data || data.length === 0) return '';
  const headerRow = fields.map(f => `"${f.label.replace(/"/g, '""')}"`).join(',');
  const rows = data.map(row => {
    return fields.map(f => {
      let val = row[f.key];
      if (val === undefined || val === null) {
        val = '';
      } else if (typeof val === 'object') {
        if (val.toDate && typeof val.toDate === 'function') {
          val = val.toDate().toISOString();
        } else {
          val = JSON.stringify(val);
        }
      } else {
        val = String(val);
      }
      return `"${val.replace(/"/g, '""')}"`;
    }).join(',');
  });
  return [headerRow, ...rows].join('\r\n');
}

// ─── Component ───────────────────────────────────────────────
export const BackupTab: React.FC = () => {
  const toast = useToast();
  const settings = useSettingsStore();

  const [isExportingAll, setIsExportingAll] = useState(false);
  const [exportingModule, setExportingModule] = useState<string | null>(null);
  const [lastBackupDate, setLastBackupDate] = useState<string | null>(() => {
    return localStorage.getItem('last_store_backup_date');
  });

  /** Safely fetch all documents from a Firestore collection */
  const fetchCollectionDocs = async (collectionName: string): Promise<Record<string, any>[]> => {
    const snap = await getDocs(collection(db, collectionName));
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  };

  /** One-click Full Store Snapshot Export (JSON) */
  const handleExportFullBackup = async () => {
    setIsExportingAll(true);
    try {
      const [customers, products, parts, repairs, transactions, settingsDoc] = await Promise.all([
        fetchCollectionDocs('customers').catch(() => []),
        fetchCollectionDocs('products').catch(() => []),
        fetchCollectionDocs('parts').catch(() => []),
        fetchCollectionDocs('repairs').catch(() => []),
        fetchCollectionDocs('transactions').catch(() => []),
        fetchCollectionDocs('settings').catch(() => []),
      ]);

      const backupData = {
        metadata: {
          app: 'Phone Shop Manager Pro',
          exportTimestamp: new Date().toISOString(),
          storeName: settings.storeName || 'Phone Shop',
          currency: settings.currency || 'USD',
          version: '2.0.0',
        },
        counts: {
          customers: customers.length,
          products: products.length,
          parts: parts.length,
          repairs: repairs.length,
          transactions: transactions.length,
        },
        collections: {
          customers,
          products,
          parts,
          repairs,
          transactions,
          settings: settingsDoc,
        },
      };

      const dateStr = formatDateForFile();
      const sanitizedStore = (settings.storeName || 'phone_shop')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_');
      const filename = `${sanitizedStore}_full_backup_${dateStr}.json`;

      triggerDownload(JSON.stringify(backupData, null, 2), filename, 'application/json');

      const nowFormatted = new Date().toLocaleString();
      setLastBackupDate(nowFormatted);
      localStorage.setItem('last_store_backup_date', nowFormatted);

      toast.success(
        'Store Backup Created',
        `Exported ${customers.length + products.length + parts.length + repairs.length + transactions.length} total records to ${filename}`
      );
    } catch (err: any) {
      toast.error('Backup Failed', err?.message || 'Could not fetch database records.');
    } finally {
      setIsExportingAll(false);
    }
  };

  /** Modular Export Handler (CSV or JSON) */
  const handleExportModule = async (
    collectionName: string,
    format: 'json' | 'csv',
    csvFields?: { key: string; label: string }[]
  ) => {
    const key = `${collectionName}_${format}`;
    setExportingModule(key);
    try {
      const data = await fetchCollectionDocs(collectionName);
      const dateStr = formatDateForFile();

      if (format === 'json') {
        const filename = `${collectionName}_export_${dateStr}.json`;
        triggerDownload(JSON.stringify(data, null, 2), filename, 'application/json');
      } else {
        const fields = csvFields || (data[0] ? Object.keys(data[0]).map(k => ({ key: k, label: k })) : []);
        const csv = jsonToCsv(data, fields);
        const filename = `${collectionName}_export_${dateStr}.csv`;
        triggerDownload(csv, filename, 'text/csv;charset=utf-8;');
      }

      toast.success(
        'Export Complete',
        `Exported ${data.length} ${collectionName} records as ${format.toUpperCase()}`
      );
    } catch (err: any) {
      toast.error('Export Failed', err?.message || `Failed to export ${collectionName}`);
    } finally {
      setExportingModule(null);
    }
  };

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
                Full System Disaster Backup
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--color-on-surface-variant, #666)' }}>
                Download a complete, offline JSON snapshot of all store collections (Customers, Inventory, Parts, Repairs, Transactions & Settings).
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
            {isExportingAll ? 'Extracting Data…' : 'Export Full Backup'}
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
              <strong>Backup Security:</strong> Snapshot is generated client-side from your authenticated session. No external third-party servers are contacted.
            </span>
          </div>
          {lastBackupDate && (
            <div style={{ color: 'var(--color-on-surface-variant, #666)' }}>
              Last exported: <strong>{lastBackupDate}</strong>
            </div>
          )}
        </div>
      </Card>

      {/* ── Modular Export Tables Card ── */}
      <Card padding="lg">
        <h2 className={styles.sectionTitle}>Modular Collection Exports</h2>
        <p style={{ fontSize: '13px', color: 'var(--color-on-surface-variant, #666)', marginBottom: '16px' }}>
          Export individual store datasets formatted for Excel/Spreadsheets (CSV) or external developer tools (JSON).
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Customers */}
          <ModuleExportRow
            icon={<Users size={18} color="#3b82f6" />}
            title="Customers & Debts"
            desc="Client profiles, phone numbers, addresses, account debt balances, and loyalty history."
            isExportingJson={exportingModule === 'customers_json'}
            isExportingCsv={exportingModule === 'customers_csv'}
            onExportJson={() => handleExportModule('customers', 'json')}
            onExportCsv={() => handleExportModule('customers', 'csv', [
              { key: 'name', label: 'Customer Name' },
              { key: 'phone', label: 'Phone Number' },
              { key: 'email', label: 'Email' },
              { key: 'debt', label: 'Outstanding Debt' },
              { key: 'totalSpent', label: 'Total Spent' },
              { key: 'notes', label: 'Notes' },
              { key: 'createdAt', label: 'Created At' },
            ])}
          />

          {/* Products / Inventory */}
          <ModuleExportRow
            icon={<Package size={18} color="#10b981" />}
            title="Inventory & Accessories"
            desc="Phones, accessories, stock quantities, buy cost, sell price, barcode/SKUs, and supplier info."
            isExportingJson={exportingModule === 'products_json'}
            isExportingCsv={exportingModule === 'products_csv'}
            onExportJson={() => handleExportModule('products', 'json')}
            onExportCsv={() => handleExportModule('products', 'csv', [
              { key: 'name', label: 'Product Name' },
              { key: 'sku', label: 'SKU / Barcode' },
              { key: 'category', label: 'Category' },
              { key: 'stockQuantity', label: 'In Stock' },
              { key: 'costPrice', label: 'Cost Price' },
              { key: 'sellingPrice', label: 'Selling Price' },
              { key: 'minStockThreshold', label: 'Min Alert' },
            ])}
          />

          {/* Repair Parts */}
          <ModuleExportRow
            icon={<Layers size={18} color="#f59e0b" />}
            title="Spare Parts & Stock"
            desc="Screen assemblies, batteries, charging ports, cost, sell price, and low stock levels."
            isExportingJson={exportingModule === 'parts_json'}
            isExportingCsv={exportingModule === 'parts_csv'}
            onExportJson={() => handleExportModule('parts', 'json')}
            onExportCsv={() => handleExportModule('parts', 'csv', [
              { key: 'name', label: 'Part Name' },
              { key: 'compatibility', label: 'Device Compatibility' },
              { key: 'category', label: 'Category' },
              { key: 'quantity', label: 'Quantity' },
              { key: 'costPrice', label: 'Cost' },
              { key: 'sellPrice', label: 'Sell Price' },
              { key: 'lowStockThreshold', label: 'Low Stock Threshold' },
            ])}
          />

          {/* Repairs */}
          <ModuleExportRow
            icon={<Wrench size={18} color="#8b5cf6" />}
            title="Repair Tickets"
            desc="Tickets, device models, fault diagnostics, repair status, assigned technician, parts used, and labor."
            isExportingJson={exportingModule === 'repairs_json'}
            isExportingCsv={exportingModule === 'repairs_csv'}
            onExportJson={() => handleExportModule('repairs', 'json')}
            onExportCsv={() => handleExportModule('repairs', 'csv', [
              { key: 'ticketNumber', label: 'Ticket #' },
              { key: 'customerName', label: 'Customer' },
              { key: 'customerPhone', label: 'Phone' },
              { key: 'deviceModel', label: 'Device Model' },
              { key: 'issue', label: 'Issue Description' },
              { key: 'status', label: 'Status' },
              { key: 'estimatedCost', label: 'Estimated Total' },
              { key: 'assignedTechnicianName', label: 'Technician' },
              { key: 'createdAt', label: 'Intake Date' },
            ])}
          />

          {/* Transactions */}
          <ModuleExportRow
            icon={<Receipt size={18} color="#ec4899" />}
            title="Financial Transactions & POS Sales"
            desc="Complete register sales, invoice IDs, payment methods (Cash/Card/Debt), discounts, and cashier IDs."
            isExportingJson={exportingModule === 'transactions_json'}
            isExportingCsv={exportingModule === 'transactions_csv'}
            onExportJson={() => handleExportModule('transactions', 'json')}
            onExportCsv={() => handleExportModule('transactions', 'csv', [
              { key: 'id', label: 'Transaction ID' },
              { key: 'type', label: 'Transaction Type' },
              { key: 'total', label: 'Total Amount' },
              { key: 'paymentMethod', label: 'Payment Method' },
              { key: 'customerName', label: 'Customer' },
              { key: 'cashierName', label: 'Cashier' },
              { key: 'createdAt', label: 'Date Time' },
            ])}
          />
        </div>
      </Card>

      {/* ── Disaster Recovery Best Practices ── */}
      <Card padding="lg">
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <AlertCircle size={20} color="#f59e0b" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 600, color: 'var(--color-on-surface)' }}>
              Disaster Recovery Guidelines for Store Owners
            </h3>
            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', lineHeight: 1.6, color: 'var(--color-on-surface-variant, #666)' }}>
              <li>
                <strong>Frequency:</strong> Perform a <em>Full System Disaster Backup</em> at the end of every week or before performing major inventory reconciliations.
              </li>
              <li>
                <strong>Storage:</strong> Save downloaded JSON files to an external USB drive or encrypted cloud folder (Google Drive, OneDrive) separate from this workstation.
              </li>
              <li>
                <strong>Privacy:</strong> Exported backups contain customer phone numbers and financial balances. Never share backup files with unauthorized personnel.
              </li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
};

// ─── Modular Row Subcomponent ─────────────────────────────────
interface ModuleRowProps {
  icon: React.ReactNode;
  title: string;
  desc: string;
  isExportingJson: boolean;
  isExportingCsv: boolean;
  onExportJson: () => void;
  onExportCsv: () => void;
}

const ModuleExportRow: React.FC<ModuleRowProps> = ({
  icon,
  title,
  desc,
  isExportingJson,
  isExportingCsv,
  onExportJson,
  onExportCsv,
}) => {
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
          onClick={onExportCsv}
          disabled={isExportingCsv || isExportingJson}
          leftIcon={isExportingCsv ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
        >
          {isExportingCsv ? 'CSV…' : 'Export CSV'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onExportJson}
          disabled={isExportingCsv || isExportingJson}
          leftIcon={isExportingJson ? <Loader2 size={14} className="animate-spin" /> : <FileJson size={14} />}
        >
          {isExportingJson ? 'JSON…' : 'Export JSON'}
        </Button>
      </div>
    </div>
  );
};
