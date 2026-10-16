import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import { Upload, X, AlertCircle, FileText, CheckCircle2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useInventoryStore } from '../../store/inventoryStore';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency } from '../../utils/formatCurrency';
import { generateSKU, resolveUniqueSKU } from './AddProductModal';
import type { PhoneModel } from '../../types';
import styles from './BulkImportModal.module.css';

interface BulkImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TEMPLATE_HEADERS = [
  'name', 'model', 'category', 'color', 'storage', 'condition', 
  'sku', 'costPrice', 'price', 'stock', 'lowStockThreshold', 'location'
];

export const BulkImportModal: React.FC<BulkImportModalProps> = ({ isOpen, onClose }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const { addProductsBulk } = useInventoryStore();
  const toast = useToast();

  if (!isOpen) return null;

  const reset = () => {
    setParsedData([]);
    setErrors([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as any[];
        const parseErrors: string[] = [];
        
        // Basic validation
        if (rows.length === 0) {
          parseErrors.push('The CSV file is empty.');
        } else {
          const firstRow = rows[0];
          const missingHeaders = TEMPLATE_HEADERS.filter(h => !(h in firstRow));
          if (missingHeaders.length > 0) {
            parseErrors.push(`Missing required headers: ${missingHeaders.join(', ')}`);
          }
        }

        if (parseErrors.length > 0) {
          setErrors(parseErrors);
        } else {
          setErrors([]);
          setParsedData(rows);
        }
      },
      error: (error) => {
        setErrors([`Failed to parse CSV: ${error.message}`]);
      }
    });
  };

  const handleImport = async () => {
    if (parsedData.length === 0) return;
    setIsImporting(true);

    try {
      // Build a set of all existing SKUs from the store for collision resolution
      const { products: storeProducts } = useInventoryStore.getState();
      const systemSkus = new Set(storeProducts.map(p => (p.sku || '').toUpperCase().trim()));

      const products: Omit<PhoneModel, 'id'>[] = parsedData.map(row => {
        const name = row.name || 'Unknown';
        const model = row.model || '';
        const storage = row.storage || '';
        const color = row.color || '';

        // If CSV provides a SKU, deduplicate it; otherwise auto-generate one
        const rawSku = (row.sku || '').trim()
          ? (row.sku as string).trim()
          : generateSKU(name, model, storage, color);
        // resolveUniqueSKU mutates systemSkus, so each subsequent row sees prior rows' reserved SKUs
        const uniqueSku = resolveUniqueSKU(rawSku, systemSkus);

        return {
          name,
          model,
          category: (['smartphone', 'tablet', 'accessory', 'wearable'].includes(row.category) ? row.category : 'smartphone') as PhoneModel['category'],
          color,
          storage,
          condition: (row.condition || 'new') as PhoneModel['condition'],
          sku: uniqueSku,
          costPrice: parseFloat(row.costPrice) || 0,
          price: parseFloat(row.price) || 0,
          stock: parseInt(row.stock, 10) || 0,
          lowStockThreshold: parseInt(row.lowStockThreshold, 10) || 5,
          stockStatus: 'in_stock', // will be computed in service
          location: row.location || '',
          image: ''
        };
      });

      await addProductsBulk(products);
      toast.success('Import Successful', `Successfully imported ${products.length} products.`);
      handleClose();
    } catch (err) {
      toast.error('Import Failed', 'There was an error importing the products.');
    } finally {
      setIsImporting(false);
    }
  };

  const downloadTemplate = () => {
    const csv = Papa.unparse({
      fields: TEMPLATE_HEADERS,
      data: [{
        name: 'Apple iPhone 15',
        model: 'Pro',
        category: 'smartphone',
        color: 'Titanium',
        storage: '256GB',
        condition: 'new',
        sku: 'IP15P-256-TIT',
        costPrice: '900',
        price: '1199',
        stock: '10',
        lowStockThreshold: '1',
        location: 'A1-Front'
      }]
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'inventory_import_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Bulk Import Products</h2>
            <p className={styles.subtitle}>Upload a CSV file to add multiple products at once.</p>
          </div>
          <button className={styles.closeBtn} onClick={handleClose}><X size={20} /></button>
        </div>

        <div className={styles.body}>
          {parsedData.length === 0 ? (
            <div className={styles.uploadArea}>
              <Upload size={32} className={styles.uploadIcon} />
              <h3>Select a CSV file</h3>
              <p>Download our template to ensure your data is formatted correctly.</p>
              <div className={styles.uploadActions}>
                <Button variant="secondary" onClick={downloadTemplate} leftIcon={<FileText size={16} />}>
                  Download Template
                </Button>
                <input
                  type="file"
                  accept=".csv"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                />
                <Button onClick={() => fileInputRef.current?.click()}>
                  Browse Files
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.previewArea}>
              <div className={styles.successBanner}>
                <CheckCircle2 size={18} />
                <span>Ready to import <strong>{parsedData.length}</strong> products.</span>
                <Button variant="ghost" size="sm" onClick={reset}>Change File</Button>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>SKU</th>
                      <th>Stock</th>
                      <th>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        <td>{row.name} {row.model}</td>
                        <td><code>{row.sku}</code></td>
                        <td>{row.stock}</td>
                        <td>{formatCurrency(parseFloat(row.price || '0'))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsedData.length > 5 && (
                <p className={styles.previewMore}>...and {parsedData.length - 5} more</p>
              )}
            </div>
          )}

          {errors.length > 0 && (
            <div className={styles.errorArea}>
              <AlertCircle size={16} />
              <div>
                <strong>Issues found with your CSV:</strong>
                <ul>
                  {errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <Button variant="ghost" onClick={handleClose} disabled={isImporting}>Cancel</Button>
          <Button 
            onClick={handleImport} 
            disabled={parsedData.length === 0 || errors.length > 0}
            isLoading={isImporting}
          >
            Import {parsedData.length > 0 ? parsedData.length : ''} Products
          </Button>
        </div>
      </div>
    </div>
  );
};
