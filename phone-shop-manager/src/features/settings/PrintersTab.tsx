import React, { useState } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Printer, Tag, CheckCircle2, AlertCircle, RefreshCw, Scissors, Sliders, HelpCircle } from 'lucide-react';
import styles from './Settings.module.css';
import { useToast } from '../../components/ui/Toast';
import { useSettingsStore } from '../../store/settingsStore';
import { usePrinterStatus } from '../../hooks/usePrinterStatus';
import { printReceiptDirect, printBarcodeDirect, calibrateLabelPrinter } from '../../utils/printWindow';
import { errorMessage } from '../../utils/errorUtils';

export const PrintersTab: React.FC = () => {
  const { isOnline, printer, labelPrinter, hasCutter, isChecking, refresh } = usePrinterStatus();
  const settings = useSettingsStore();
  const toast = useToast();

  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>(settings.receiptPaperWidth || '80mm');
  const [autoCut, setAutoCut] = useState<boolean>(settings.autoCutReceipt ?? true);
  const [isTestingReceipt, setIsTestingReceipt] = useState(false);
  const [isTestingLabel, setIsTestingLabel] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);

  const handleSavePrinterPrefs = async () => {
    try {
      await settings.updateSettingsBulk({
        receiptPaperWidth: paperWidth,
        autoCutReceipt: autoCut,
      });
      toast.success('Printer Preferences Saved', 'Hardware printer preferences updated successfully.');
    } catch (err: unknown) {
      toast.error('Failed to Save', errorMessage(err) || 'Could not save printer preferences.');
    }
  };

  const handleTestReceipt = async () => {
    setIsTestingReceipt(true);
    try {
      const demoTransaction = {
        id: `TEST-${Date.now().toString().slice(-4)}`,
        date: new Date().toISOString(),
        customerName: 'Test Customer (Hardware Check)',
        processedByName: 'Store Admin',
        items: [
          {
            product: {
              name: 'Hardware Test Line Item',
              model: 'ESC/POS 80mm',
              price: 1500,
            },
            quantity: 1,
          },
          {
            product: {
              name: 'Thermal Quality Check',
              model: 'Raster Graphic OK',
              price: 500,
            },
            quantity: 1,
          },
        ],
        subtotal: 2000,
        discount: { type: 'flat' as const, value: 0 },
        total: 2000,
        payments: [{ method: 'cash', amount: 2000 }],
        status: 'completed',
      };

      const result = await printReceiptDirect(
        demoTransaction,
        settings.storeName || 'Phone Shop Pro',
        settings.currency || 'DZD',
        {
          headerMessage: settings.receiptHeader || 'Hardware Self-Test OK',
          footerMessage: settings.receiptFooter || 'Thank you for testing your hardware printer!',
        }
      );

      if (result.method === 'direct') {
        toast.success('Receipt Printed', 'Test receipt sent directly to thermal printer.');
      } else {
        toast.info('Browser Print Opened', 'Direct print server offline; browser print dialog opened as fallback.');
      }
    } catch (err: unknown) {
      toast.error('Print Error', errorMessage(err) || 'Failed to print test receipt.');
    } finally {
      setIsTestingReceipt(false);
    }
  };

  const handleTestLabel = async () => {
    setIsTestingLabel(true);
    try {
      const demoProduct = {
        name: 'iPhone 13 Screen OLED',
        model: 'A2633 Original',
        sku: 'SCR-IP13-OLED',
        price: 14500,
        barcode: '613123456789',
        printCount: 1,
      };

      const result = await printBarcodeDirect(
        [demoProduct],
        settings.storeName || 'Phone Shop Pro',
        settings.currency || 'DZD'
      );

      if (result.method === 'direct') {
        toast.success('Label Printed', 'Test barcode label sent to TSPL label printer.');
      } else {
        toast.info('Browser Print Triggered', 'Print server not reachable for direct TSPL printing.');
      }
    } catch (err: unknown) {
      toast.error('Label Print Error', errorMessage(err) || 'Failed to print test label.');
    } finally {
      setIsTestingLabel(false);
    }
  };

  const handleCalibrate = async () => {
    const confirmed = window.confirm(
      'Label Sensor Calibration:\n\nThe printer will feed 2-3 blank labels to detect gap spacing and measure tag height. Ensure labels are loaded properly.\n\nProceed with calibration?'
    );
    if (!confirmed) return;

    setIsCalibrating(true);
    try {
      const res = await calibrateLabelPrinter();
      if (res.success) {
        toast.success('Calibration Completed', res.message || 'Label printer gap sensor calibrated successfully.');
      } else {
        toast.error('Calibration Failed', res.error || 'Could not calibrate label printer.');
      }
    } catch (err: unknown) {
      toast.error('Error', errorMessage(err) || 'Print server unreachable.');
    } finally {
      setIsCalibrating(false);
    }
  };

  return (
    <div className={styles.grid}>
      {/* 1. Server Health & Status */}
      <Card padding="lg">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h2 className={styles.sectionTitle} style={{ marginBottom: '4px' }}>Print Server Daemon</h2>
            <p style={{ fontSize: '13px', color: 'var(--color-on-surface-variant, #666)', margin: 0 }}>
              Local background service handling raw USB & Network printer communications on port 3355.
            </p>
          </div>
          <Button 
            variant="secondary" 
            size="sm" 
            onClick={refresh} 
            isLoading={isChecking}
            leftIcon={<RefreshCw size={14} />}
          >
            Refresh Status
          </Button>
        </div>

        <div style={{
          padding: '16px',
          borderRadius: '8px',
          backgroundColor: isOnline ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
          border: `1px solid ${isOnline ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}>
          {isOnline ? (
            <CheckCircle2 size={24} color="#16a34a" />
          ) : (
            <AlertCircle size={24} color="#dc2626" />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '14px', color: isOnline ? '#15803d' : '#b91c1c' }}>
              {isOnline ? 'Direct Print Server is Online & Ready' : 'Print Server is Offline / Unreachable'}
            </div>
            <div style={{ fontSize: '12px', color: isOnline ? '#166534' : '#991b1b', marginTop: '2px' }}>
              {isOnline 
                ? 'High-speed direct ESC/POS and TSPL label printing is fully operational.'
                : 'Direct printing is unavailable. Receipts will fall back to the standard browser print window.'}
            </div>
          </div>
          <span style={{
            fontSize: '11px',
            fontFamily: 'monospace',
            padding: '4px 8px',
            borderRadius: '4px',
            backgroundColor: isOnline ? '#dcfce7' : '#fee2e2',
            color: isOnline ? '#166534' : '#991b1b',
          }}>
            http://localhost:3355
          </span>
        </div>

        {!isOnline && (
          <div style={{ 
            marginTop: '12px', 
            padding: '12px', 
            backgroundColor: 'var(--color-surface-container, #f8fafc)', 
            borderRadius: '6px', 
            fontSize: '12px',
            lineHeight: 1.5,
            color: 'var(--color-on-surface-variant, #475569)' 
          }}>
            <strong>How to start the print server:</strong>
            <pre style={{ 
              backgroundColor: '#1e293b', 
              color: '#38bdf8', 
              padding: '8px 12px', 
              borderRadius: '4px', 
              fontSize: '11px',
              marginTop: '6px',
              overflowX: 'auto'
            }}>
              cd phone-shop-manager/print-server && node server.js
            </pre>
          </div>
        )}
      </Card>

      {/* 2. ESC/POS Thermal Receipt Printer */}
      <Card padding="lg">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <Printer size={20} color="var(--color-primary, #2563eb)" />
          <h2 className={styles.sectionTitle} style={{ margin: 0 }}>Thermal Receipt Printer (ESC/POS)</h2>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--color-on-surface-variant, #666)', marginBottom: '16px' }}>
          Configured for Point-of-Sale cash receipts, repair intake slips, and Z-reports.
        </p>

        <div className={styles.formGroup}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <div style={{ 
              padding: '12px', 
              backgroundColor: 'var(--color-surface-container, #f8fafc)', 
              borderRadius: '6px',
              border: '1px solid var(--color-outline-variant, #e2e8f0)'
            }}>
              <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant, #666)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Detected System Device
              </div>
              <div style={{ fontWeight: 600, fontSize: '14px', marginTop: '4px' }}>
                {printer || '80mm POS Thermal Printer'}
              </div>
            </div>

            <div style={{ 
              padding: '12px', 
              backgroundColor: 'var(--color-surface-container, #f8fafc)', 
              borderRadius: '6px',
              border: '1px solid var(--color-outline-variant, #e2e8f0)'
            }}>
              <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant, #666)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Hardware Auto-Cutter
              </div>
              <div style={{ fontWeight: 600, fontSize: '14px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Scissors size={14} color={hasCutter ? '#16a34a' : '#eab308'} />
                {hasCutter ? 'Supported & Enabled' : 'Manual Tear Bar'}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginTop: '8px' }}>
            <Select 
              label="Paper Roll Width"
              value={paperWidth}
              onChange={(val) => setPaperWidth(val as '80mm' | '58mm')}
              options={[
                { value: '80mm', label: '80mm (Standard POS, 48 chars)' },
                { value: '58mm', label: '58mm (Compact Mobile, 32 chars)' },
              ]}
            />

            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>Auto-cut After Print</div>
              <label className={styles.switch} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input 
                  type="checkbox" 
                  checked={autoCut}
                  onChange={(e) => setAutoCut(e.target.checked)}
                />
                <span className={styles.slider}></span>
                <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant, #666)' }}>
                  {autoCut ? 'Cut paper automatically' : 'Do not trigger auto-cutter'}
                </span>
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
            <Button 
              variant="secondary"
              onClick={handleTestReceipt}
              isLoading={isTestingReceipt}
              leftIcon={<Printer size={16} />}
            >
              Test Print Receipt
            </Button>
            <Button 
              variant="primary"
              onClick={handleSavePrinterPrefs}
            >
              Save Printer Preferences
            </Button>
          </div>
        </div>
      </Card>

      {/* 3. TSPL Barcode Label Printer */}
      <Card padding="lg">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <Tag size={20} color="var(--color-primary, #2563eb)" />
          <h2 className={styles.sectionTitle} style={{ margin: 0 }}>Barcode & Sticker Printer (TSPL)</h2>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--color-on-surface-variant, #666)', marginBottom: '16px' }}>
          Configured for printing product price tags, repair intake barcode stickers, and inventory parts labels.
        </p>

        <div className={styles.formGroup}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <div style={{ 
              padding: '12px', 
              backgroundColor: 'var(--color-surface-container, #f8fafc)', 
              borderRadius: '6px',
              border: '1px solid var(--color-outline-variant, #e2e8f0)'
            }}>
              <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant, #666)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Detected Label Device
              </div>
              <div style={{ fontWeight: 600, fontSize: '14px', marginTop: '4px' }}>
                {labelPrinter || 'Label Printer (TSPL)'}
              </div>
            </div>

            <div style={{ 
              padding: '12px', 
              backgroundColor: 'var(--color-surface-container, #f8fafc)', 
              borderRadius: '6px',
              border: '1px solid var(--color-outline-variant, #e2e8f0)'
            }}>
              <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant, #666)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Default Label Dimensions
              </div>
              <div style={{ fontWeight: 600, fontSize: '14px', marginTop: '4px' }}>
                50mm × 20mm (Standard Die-cut)
              </div>
            </div>
          </div>

          <div style={{ 
            marginTop: '12px', 
            padding: '10px 14px', 
            backgroundColor: 'rgba(59, 130, 246, 0.06)', 
            borderRadius: '6px', 
            fontSize: '12px', 
            color: '#1d4ed8',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <HelpCircle size={16} />
            <span>If labels are skipping or stopping between stickers, run gap sensor calibration to realign the roller.</span>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
            <Button 
              variant="secondary"
              onClick={handleTestLabel}
              isLoading={isTestingLabel}
              leftIcon={<Tag size={16} />}
            >
              Test Print 50x20mm Sticker
            </Button>
            <Button 
              variant="outline"
              onClick={handleCalibrate}
              isLoading={isCalibrating}
              leftIcon={<Sliders size={16} />}
            >
              Calibrate Label Gap Sensor
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};
