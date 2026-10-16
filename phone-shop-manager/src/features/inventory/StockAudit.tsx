import React, { useState, useRef, useEffect } from 'react';
import { ScanLine, CheckCircle2, AlertTriangle, XCircle, ArrowLeft, RotateCcw, FileText, Package } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import type { PhoneModel } from '../../types';
import styles from './StockAudit.module.css';
import { formatCurrency } from '../../utils/formatCurrency';

// ─── Types ──────────────────────────────────────────────────────────────────
interface ScannedEntry {
  sku: string;
  count: number;
  product: PhoneModel | null;
  timestamp: string;
}

interface AuditResult {
  product: PhoneModel;
  expected: number;
  counted: number;
  delta: number; // counted - expected
}

type AuditPhase = 'scanning' | 'report';


// ─── Component ───────────────────────────────────────────────────────────────
interface StockAuditProps {
  products: PhoneModel[];
  onClose: () => void;
}

export const StockAudit: React.FC<StockAuditProps> = ({ products, onClose }) => {
  const [phase, setPhase] = useState<AuditPhase>('scanning');
  const [skuInput, setSkuInput] = useState('');
  const [scanned, setScanned] = useState<Map<string, ScannedEntry>>(new Map());
  const [lastScan, setLastScan] = useState<{ sku: string; found: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the input on mount & after each scan
  useEffect(() => {
    inputRef.current?.focus();
  }, [phase, lastScan]);

  const productBySku = React.useMemo(() => {
    const map = new Map<string, PhoneModel>();
    products
      .filter(p => p.category !== 'repair_part' && !p.sku?.toUpperCase().startsWith('PRT-'))
      .forEach(p => map.set(p.sku.toUpperCase(), p));
    return map;
  }, [products]);

  const processScan = React.useCallback((rawSku: string) => {
    const sku = rawSku.trim().toUpperCase();
    if (!sku) return;

    const product = productBySku.get(sku) ?? null;
    const found = !!product;

    setScanned(prev => {
      const next = new Map(prev);
      const existing = next.get(sku);
      next.set(sku, {
        sku,
        count: (existing?.count ?? 0) + 1,
        product: existing?.product ?? product,
        timestamp: new Date().toLocaleTimeString(),
      });
      return next;
    });

    setLastScan({ sku, found });
  }, [productBySku]);

  const handleScan = (e: React.FormEvent) => {
    e.preventDefault();
    processScan(skuInput);
    setSkuInput('');
  };

  // Global barcode listener for when input is unfocused
  const barcodeBuffer = useRef('');
  const barcodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (phase !== 'scanning') return;
      // Ignore if user is typing in an input
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Enter') {
        if (barcodeBuffer.current.length > 3) {
          processScan(barcodeBuffer.current);
        }
        barcodeBuffer.current = '';
        if (barcodeTimer.current) clearTimeout(barcodeTimer.current);
        return;
      }

      if (e.key.length === 1) {
        barcodeBuffer.current += e.key;
        if (barcodeTimer.current) clearTimeout(barcodeTimer.current);
        barcodeTimer.current = setTimeout(() => {
          barcodeBuffer.current = '';
        }, 100);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [processScan, phase]);

  // ─── Build Report ────────────────────────────────────────────────────────
  const auditResults = React.useMemo((): AuditResult[] => {
    const results: AuditResult[] = [];

    // Products that have a discrepancy (scanned vs expected)
    products.forEach(p => {
      const entry = scanned.get(p.sku.toUpperCase());
      const counted = entry?.count ?? 0;
      const delta = counted - p.stock;
      results.push({ product: p, expected: p.stock, counted, delta });
    });

    // Unknown SKUs (scanned but not in system)
    scanned.forEach((entry, sku) => {
      if (!entry.product) {
        results.push({
          product: { id: 'unknown', name: 'Unknown', model: sku, sku, price: 0, costPrice: 0, stock: 0, stockStatus: 'out_of_stock', category: 'accessory', lowStockThreshold: 0 },
          expected: 0,
          counted: entry.count,
          delta: entry.count,
        });
      }
    });

    return results.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [products, scanned]);

  const missing = auditResults.filter(r => r.delta < 0);
  const extra = auditResults.filter(r => r.delta > 0);
  const matched = auditResults.filter(r => r.delta === 0 && r.counted > 0);
  const unscanned = auditResults.filter(r => r.delta === 0 && r.counted === 0);

  const shrinkageValue = missing.reduce((sum, r) => sum + Math.abs(r.delta) * r.product.costPrice, 0);

  const handleReset = () => {
    setScanned(new Map());
    setLastScan(null);
    setPhase('scanning');
  };

  const handlePrintReport = () => {
    window.print();
  };

  // ─── Render: Scanning Phase ───────────────────────────────────────────────
  if (phase === 'scanning') {
    const scannedList = Array.from(scanned.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return (
      <div className={styles.auditPage}>
        {/* Header */}
        <div className={styles.auditHeader}>
          <div className={styles.auditHeaderLeft}>
            <Button variant="ghost" leftIcon={<ArrowLeft size={16} />} onClick={onClose}>
              Exit Audit
            </Button>
            <div>
              <h1 className={styles.auditTitle}>
                <ScanLine size={22} /> Stock Audit Mode
              </h1>
              <p className={styles.auditSubtitle}>Scan each item's barcode to count physical stock on the shelf</p>
            </div>
          </div>
          <div className={styles.auditHeaderActions}>
            <Button variant="secondary" leftIcon={<RotateCcw size={16} />} onClick={handleReset}>
              Reset
            </Button>
            <Button leftIcon={<FileText size={16} />} onClick={() => setPhase('report')}>
              Generate Report ({scanned.size} SKUs)
            </Button>
          </div>
        </div>

        <div className={styles.auditBody}>
          {/* Scan Input Panel */}
          <div className={styles.scanPanel}>
            <Card className={styles.scanCard}>
              <div className={styles.scanIconWrapper}>
                <ScanLine size={48} className={styles.scanIcon} />
              </div>
              <h2 className={styles.scanPrompt}>Ready to Scan</h2>
              <p className={styles.scanHint}>Point barcode scanner at item, or type SKU manually</p>

              <form onSubmit={handleScan} className={styles.scanForm}>
                <input
                  ref={inputRef}
                  type="text"
                  value={skuInput}
                  onChange={e => setSkuInput(e.target.value)}
                  placeholder="Scan or type SKU..."
                  className={styles.scanInput}
                  autoComplete="off"
                  autoFocus
                />
                <Button type="submit" className={styles.scanBtn}>
                  Add Count
                </Button>
              </form>

              {/* Last scan feedback */}
              {lastScan && (
                <div className={[styles.feedback, lastScan.found ? styles.feedbackOk : styles.feedbackErr].join(' ')}>
                  {lastScan.found ? (
                    <><CheckCircle2 size={18} /> <strong>{lastScan.sku}</strong> — Found in system, count updated</>
                  ) : (
                    <><XCircle size={18} /> <strong>{lastScan.sku}</strong> — Not found in inventory</>
                  )}
                </div>
              )}

              {/* Stats */}
              <div className={styles.scanStats}>
                <div className={styles.statItem}>
                  <span className={styles.statValue}>{scanned.size}</span>
                  <span className={styles.statLabel}>Unique SKUs</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statValue}>
                    {Array.from(scanned.values()).reduce((s, e) => s + e.count, 0)}
                  </span>
                  <span className={styles.statLabel}>Total Items</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statValue}>{products.length}</span>
                  <span className={styles.statLabel}>Expected SKUs</span>
                </div>
              </div>
            </Card>
          </div>

          {/* Scan Log */}
          <div className={styles.scanLog}>
            <div className={styles.scanLogHeader}>
              <h3>Scan Log</h3>
              <span className={styles.scanLogCount}>{scannedList.length} entries</span>
            </div>
            <div className={styles.scanLogList}>
              {scannedList.length === 0 ? (
                <div className={styles.scanLogEmpty}>
                  <Package size={32} />
                  <p>No items scanned yet</p>
                </div>
              ) : (
                scannedList.map(entry => (
                  <div
                    key={entry.sku}
                    className={[styles.scanLogEntry, !entry.product && styles.scanLogEntryUnknown].filter(Boolean).join(' ')}
                  >
                    <div className={styles.scanLogEntryLeft}>
                      <code className={styles.scanLogSku}>{entry.sku}</code>
                      <span className={styles.scanLogName}>
                        {entry.product ? `${entry.product.name} ${entry.product.model}` : 'Unknown SKU'}
                      </span>
                    </div>
                    <div className={styles.scanLogEntryRight}>
                      <span className={styles.scanLogCount2}>×{entry.count}</span>
                      <span className={styles.scanLogTime}>{entry.timestamp}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: Report Phase ─────────────────────────────────────────────────
  return (
    <div className={`${styles.auditPage} ${styles.reportPage}`}>
      {/* Report Header */}
      <div className={styles.auditHeader}>
        <div className={styles.auditHeaderLeft}>
          <Button variant="ghost" leftIcon={<ArrowLeft size={16} />} onClick={() => setPhase('scanning')}>
            Back to Scanning
          </Button>
          <div>
            <h1 className={styles.auditTitle}><FileText size={22} /> Audit Report</h1>
            <p className={styles.auditSubtitle}>Generated {new Date().toLocaleString()}</p>
          </div>
        </div>
        <div className={styles.auditHeaderActions}>
          <Button variant="secondary" leftIcon={<RotateCcw size={16} />} onClick={handleReset}>
            Start New Audit
          </Button>
          <Button leftIcon={<FileText size={16} />} onClick={handlePrintReport}>
            Print Report
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className={styles.reportSummary}>
        <Card className={`${styles.summaryCard} ${styles.summaryDanger}`}>
          <XCircle size={20} />
          <div>
            <p className={styles.summaryNum}>{missing.length}</p>
            <p className={styles.summaryLabel}>Missing / Short</p>
          </div>
        </Card>
        <Card className={`${styles.summaryCard} ${styles.summaryWarning}`}>
          <AlertTriangle size={20} />
          <div>
            <p className={styles.summaryNum}>{extra.length}</p>
            <p className={styles.summaryLabel}>Extra / Surplus</p>
          </div>
        </Card>
        <Card className={`${styles.summaryCard} ${styles.summarySuccess}`}>
          <CheckCircle2 size={20} />
          <div>
            <p className={styles.summaryNum}>{matched.length}</p>
            <p className={styles.summaryLabel}>Matched</p>
          </div>
        </Card>
        <Card className={`${styles.summaryCard} ${styles.summaryNeutral}`}>
          <Package size={20} />
          <div>
            <p className={styles.summaryNum}>{unscanned.length}</p>
            <p className={styles.summaryLabel}>Not Scanned</p>
          </div>
        </Card>
        <Card className={`${styles.summaryCard} ${styles.summaryShrinkage}`}>
          <AlertTriangle size={20} />
          <div>
            <p className={styles.summaryNum}>{formatCurrency(shrinkageValue)}</p>
            <p className={styles.summaryLabel}>Shrinkage Value</p>
          </div>
        </Card>
      </div>

      {/* Results Table */}
      <Card padding="none">
        <div className={styles.reportTableHeader}>
          <h3>Discrepancy Details</h3>
          <p className={styles.reportTableSubtitle}>Only products with differences are highlighted</p>
        </div>
        <div className={styles.reportTableWrapper}>
          <table className={styles.reportTable}>
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Expected Stock</th>
                <th>Counted Stock</th>
                <th>Delta</th>
                <th>Status</th>
                <th>Shrinkage Value</th>
              </tr>
            </thead>
            <tbody>
              {/* Missing */}
              {missing.length > 0 && (
                <>
                  <tr className={styles.sectionRow}>
                    <td colSpan={7}><XCircle size={14} /> Missing / Short ({missing.length})</td>
                  </tr>
                  {missing.map(r => (
                    <tr key={r.product.sku} className={styles.rowMissing}>
                      <td>{r.product.name} {r.product.model}</td>
                      <td><code>{r.product.sku}</code></td>
                      <td>{r.expected}</td>
                      <td>{r.counted}</td>
                      <td className={styles.deltaMissing}>{r.delta}</td>
                      <td><span className={styles.badgeMissing}>Short</span></td>
                      <td className={styles.shrinkageVal}>{formatCurrency(Math.abs(r.delta) * r.product.costPrice)}</td>
                    </tr>
                  ))}
                </>
              )}

              {/* Extra */}
              {extra.length > 0 && (
                <>
                  <tr className={styles.sectionRow}>
                    <td colSpan={7}><AlertTriangle size={14} /> Extra / Surplus ({extra.length})</td>
                  </tr>
                  {extra.map(r => (
                    <tr key={r.product.sku} className={styles.rowExtra}>
                      <td>{r.product.name} {r.product.model}</td>
                      <td><code>{r.product.sku}</code></td>
                      <td>{r.expected}</td>
                      <td>{r.counted}</td>
                      <td className={styles.deltaExtra}>+{r.delta}</td>
                      <td><span className={styles.badgeExtra}>Surplus</span></td>
                      <td>—</td>
                    </tr>
                  ))}
                </>
              )}

              {/* Matched */}
              {matched.length > 0 && (
                <>
                  <tr className={styles.sectionRow}>
                    <td colSpan={7}><CheckCircle2 size={14} /> Matched ({matched.length})</td>
                  </tr>
                  {matched.map(r => (
                    <tr key={r.product.sku} className={styles.rowMatched}>
                      <td>{r.product.name} {r.product.model}</td>
                      <td><code>{r.product.sku}</code></td>
                      <td>{r.expected}</td>
                      <td>{r.counted}</td>
                      <td className={styles.deltaOk}>0</td>
                      <td><span className={styles.badgeOk}>Match</span></td>
                      <td>—</td>
                    </tr>
                  ))}
                </>
              )}

              {/* Not Scanned */}
              {unscanned.length > 0 && (
                <>
                  <tr className={styles.sectionRow}>
                    <td colSpan={7}><Package size={14} /> Not Scanned ({unscanned.length})</td>
                  </tr>
                  {unscanned.map(r => (
                    <tr key={r.product.sku} className={styles.rowUnscanned}>
                      <td>{r.product.name} {r.product.model}</td>
                      <td><code>{r.product.sku}</code></td>
                      <td>{r.expected}</td>
                      <td>—</td>
                      <td>—</td>
                      <td><span className={styles.badgeUnscanned}>Not Scanned</span></td>
                      <td>—</td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
