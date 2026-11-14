import React, { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Printer, Tag, CheckCircle2, AlertCircle, RefreshCw, Scissors, Sliders, HelpCircle, Type, Check, Sparkles } from 'lucide-react';
import styles from './Settings.module.css';
import { useToast } from '../../components/ui/Toast';
import { useSettingsStore } from '../../store/settingsStore';
import { usePrinterStatus } from '../../hooks/usePrinterStatus';
import { printReceiptDirect, printBarcodeDirect, calibrateLabelPrinter } from '../../utils/printWindow';
import { AVAILABLE_LABEL_FONTS, type LabelFontKey, getLabelFontConfig } from '../../utils/labelFontConfig';
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

  // Label Font state
  const [selectedLabelFont, setSelectedLabelFont] = useState<LabelFontKey>(settings.labelFont || '2');
  const [sampleType, setSampleType] = useState<'part' | 'product'>('part');
  const [isSavingFont, setIsSavingFont] = useState(false);
  const [testingFontKey, setTestingFontKey] = useState<string | null>(null);

  useEffect(() => {
    if (settings.labelFont) {
      setSelectedLabelFont(settings.labelFont);
    }
  }, [settings.labelFont]);

  const handleSaveFont = async (fontToSave?: LabelFontKey) => {
    const font = fontToSave || selectedLabelFont;
    setIsSavingFont(true);
    try {
      await settings.updateSetting('labelFont', font);
      const cfg = getLabelFontConfig(font);
      toast.success('Label Font Saved', `Stickers will now print using ${cfg.label}.`);
    } catch (err: unknown) {
      toast.error('Failed to Save', errorMessage(err) || 'Could not save font preference.');
    } finally {
      setIsSavingFont(false);
    }
  };

  const handleTestFontPrint = async (fontKey: LabelFontKey) => {
    setTestingFontKey(fontKey);
    try {
      const demoItem = sampleType === 'part' ? {
        name: 'AFFICHEUR OLED IP 13 PRO',
        model: 'ORIGINAL CHINE',
        sku: 'PRT-SCR-IP13P',
        price: 8500,
        category: 'repair_part',
        hidePrice: true,
        compatibility: ['IPHONE 13 PRO (A2638)', 'IPHONE 13 (A2633)'],
        printCount: 1,
      } : {
        name: 'COQUE SILICONE MAGSAFE',
        model: 'IPHONE 14 PRO',
        sku: 'ACC-COQ-IP14P',
        price: 1500,
        barcode: '613123456789',
        printCount: 1,
      };

      const result = await printBarcodeDirect(
        [demoItem],
        settings.storeName || 'PhoneShop Pro',
        settings.currency || 'DZD',
        fontKey
      );

      if (result.method === 'direct') {
        if (result.error) {
          toast.error('Print Error', result.error);
          return;
        }
        const cfg = getLabelFontConfig(fontKey);
        toast.success('Test Label Printed', `Sent 50×20mm sticker to printer using ${cfg.label}.`);
      } else {
        toast.info('Direct Print Server Offline', 'Opening browser print window preview.');
      }
    } catch (err: unknown) {
      toast.error('Print Error', errorMessage(err) || 'Failed to print test label.');
    } finally {
      setTestingFontKey(null);
    }
  };

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
        // A direct path carrying an error was refused by the server (for example,
        // the printer is offline). The test receipt never printed — say so.
        if (result.error) {
          toast.error('Print Error', result.error);
          return;
        }
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
        // A direct path carrying an error was refused by the server (for example,
        // the printer is offline). The test label never printed — say so.
        if (result.error) {
          toast.error('Label Print Error', result.error);
          return;
        }
        toast.success('Label Printed', 'Test barcode label sent to TSPL label printer.');
      } else {
        // The barcode fallback opens no window, so nothing was "triggered" —
        // just say the direct path is unavailable.
        toast.info('Direct Print Unavailable', 'Print server not reachable for direct TSPL printing.');
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

          {/* ──────────────────────────────────────────────────────────
              LABEL TYPOGRAPHY & FONT SWITCHER (ALL AVAILABLE FONTS)
          ────────────────────────────────────────────────────────── */}
          <div style={{
            marginTop: '24px',
            paddingTop: '20px',
            borderTop: '1px solid var(--color-outline-variant, #e2e8f0)',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              marginBottom: '16px',
            }}>
              <div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '15px',
                  fontWeight: 600,
                  color: 'var(--color-on-surface, #0f172a)',
                }}>
                  <Type size={18} color="var(--color-primary, #2563eb)" />
                  <span>Label Typography & Font (Available TSPL Fonts)</span>
                </div>
                <div style={{
                  fontSize: '12px',
                  color: 'var(--color-on-surface-variant, #64748b)',
                  marginTop: '2px',
                }}>
                  Select your preferred thermal label font, preview it in real time, and send immediate test stickers to your printer.
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleSaveFont()}
                  isLoading={isSavingFont}
                  leftIcon={<Check size={14} />}
                >
                  Save Font Preference
                </Button>
              </div>
            </div>

            {/* Font Cards Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '12px',
              marginBottom: '20px',
            }}>
              {AVAILABLE_LABEL_FONTS.map((font) => {
                const isSelected = selectedLabelFont === font.key;
                const isPrintingThis = testingFontKey === font.key;

                return (
                  <div
                    key={font.key}
                    onClick={() => setSelectedLabelFont(font.key)}
                    style={{
                      padding: '14px',
                      borderRadius: '8px',
                      border: `2px solid ${isSelected ? 'var(--color-primary, #2563eb)' : 'var(--color-outline-variant, #e2e8f0)'}`,
                      backgroundColor: isSelected ? 'rgba(37, 99, 235, 0.04)' : 'var(--color-surface, #fff)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease-in-out',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      boxShadow: isSelected ? '0 0 0 1px var(--color-primary, #2563eb)' : 'none',
                    }}
                  >
                    <div>
                      {/* Top Row: Title + Badge */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px', marginBottom: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{
                            width: '16px',
                            height: '16px',
                            borderRadius: '50%',
                            border: `2px solid ${isSelected ? 'var(--color-primary, #2563eb)' : '#cbd5e1'}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: isSelected ? 'var(--color-primary, #2563eb)' : '#fff',
                            flexShrink: 0,
                          }}>
                            {isSelected && <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#fff' }} />}
                          </div>
                          <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-on-surface, #0f172a)' }}>
                            {font.label}
                          </div>
                        </div>
                        <span style={{
                          fontSize: '10px',
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: '12px',
                          backgroundColor: `${font.badgeColor}15`,
                          color: font.badgeColor,
                          whiteSpace: 'nowrap',
                        }}>
                          {font.badge}
                        </span>
                      </div>

                      {/* Specs */}
                      <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant, #64748b)', marginBottom: '6px', fontFamily: 'monospace' }}>
                        {font.specs}
                      </div>

                      {/* Description */}
                      <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant, #475569)', lineHeight: 1.4, marginBottom: '10px' }}>
                        {font.description}
                      </div>

                      {/* Inline Typography Preview */}
                      <div style={{
                        padding: '8px 10px',
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '4px',
                        marginBottom: '10px',
                        textAlign: 'center',
                        fontFamily: font.cssStyle.fontFamily,
                        fontSize: font.cssStyle.fontSize,
                        fontWeight: font.cssStyle.fontWeight,
                        letterSpacing: font.cssStyle.letterSpacing || 'normal',
                        lineHeight: 1.2,
                        color: '#0f172a',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                      }}>
                        AFFICHEUR OLED IP 13 PRO
                      </div>
                    </div>

                    {/* Bottom Action: Test Print Button for this specific font */}
                    <div style={{ marginTop: '4px', display: 'flex', justifyContent: 'flex-end' }}>
                      <Button
                        variant={isSelected ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedLabelFont(font.key);
                          handleTestFontPrint(font.key);
                        }}
                        isLoading={isPrintingThis}
                        leftIcon={<Tag size={12} />}
                      >
                        {isPrintingThis ? 'Printing...' : 'Test Print'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Interactive Live 50mm × 20mm Sticker Preview */}
            {(() => {
              const activeFont = getLabelFontConfig(selectedLabelFont);
              return (
                <div style={{
                  padding: '16px',
                  backgroundColor: 'var(--color-surface-container, #f8fafc)',
                  borderRadius: '8px',
                  border: '1px solid var(--color-outline-variant, #e2e8f0)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                      <Sparkles size={15} color="var(--color-primary, #2563eb)" />
                      <span>Live 50mm × 20mm Sticker Preview (Active: {activeFont.label})</span>
                    </div>

                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => setSampleType('part')}
                        style={{
                          fontSize: '11px',
                          fontWeight: 500,
                          padding: '3px 8px',
                          borderRadius: '4px',
                          border: '1px solid #cbd5e1',
                          backgroundColor: sampleType === 'part' ? '#2563eb' : '#fff',
                          color: sampleType === 'part' ? '#fff' : '#334155',
                          cursor: 'pointer',
                        }}
                      >
                        Repair Part
                      </button>
                      <button
                        type="button"
                        onClick={() => setSampleType('product')}
                        style={{
                          fontSize: '11px',
                          fontWeight: 500,
                          padding: '3px 8px',
                          borderRadius: '4px',
                          border: '1px solid #cbd5e1',
                          backgroundColor: sampleType === 'product' ? '#2563eb' : '#fff',
                          color: sampleType === 'product' ? '#fff' : '#334155',
                          cursor: 'pointer',
                        }}
                      >
                        Retail Product
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
                    {/* Realistic 50mm × 20mm Die-Cut Label Container */}
                    <div style={{
                      width: '320px',
                      height: '128px',
                      backgroundColor: '#fff',
                      border: '1px solid #94a3b8',
                      borderRadius: '3px',
                      padding: '4px 8px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
                      position: 'relative',
                      overflow: 'hidden',
                      boxSizing: 'border-box',
                      fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                    }}>
                      {/* Store Title (shifted left 2mm) */}
                      <div style={{
                        fontWeight: 700,
                        fontSize: '11px',
                        letterSpacing: '0.3px',
                        textTransform: 'uppercase',
                        color: '#000',
                        transform: 'translateX(-8px)',
                        marginTop: '2px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '100%',
                      }}>
                        {settings.storeName || 'PHONESHOP PRO'}
                      </div>

                      {/* Black Separator Bar */}
                      <div style={{ width: '100%', height: '1.5px', backgroundColor: '#000', margin: '3px 0 3px 0' }} />

                      {/* Dynamic Text in Selected Font (Shifted right by 3mm, down 1.5mm) */}
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        width: '100%',
                        fontFamily: activeFont.cssStyle.fontFamily,
                        fontSize: activeFont.cssStyle.fontSize,
                        fontWeight: activeFont.cssStyle.fontWeight,
                        letterSpacing: activeFont.cssStyle.letterSpacing || 'normal',
                        color: '#111',
                        lineHeight: 1.15,
                        transform: 'translateX(12px)',
                        marginTop: '4px',
                      }}>
                        {sampleType === 'part' ? (
                          <>
                            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                              AFFICHEUR OLED IP 13 PRO
                            </div>
                            {activeFont.maxLines >= 2 && (
                              <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', marginTop: '2px' }}>
                                ORIGINAL CHINE
                              </div>
                            )}
                            {activeFont.maxLines >= 3 && (
                              <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', marginTop: '2px', opacity: 0.85, fontSize: '90%' }}>
                                COMPATIBLE: A2638
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                              COQUE SILICONE MAGSAFE
                            </div>
                            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', marginTop: '2px' }}>
                              IPHONE 14 PRO - NOIR
                            </div>
                          </>
                        )}
                      </div>

                      {/* Fixed Barcode at bottom (Shifted right by 3mm -> 0px / centered) */}
                      <div style={{
                        position: 'absolute',
                        bottom: '4px',
                        left: 0,
                        right: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transform: 'translateX(4px)',
                      }}>
                        <svg width="112" height="22" viewBox="0 0 112 22">
                          <rect x="0" y="0" width="2" height="22" fill="#000" />
                          <rect x="3" y="0" width="1" height="22" fill="#000" />
                          <rect x="6" y="0" width="3" height="22" fill="#000" />
                          <rect x="11" y="0" width="1" height="22" fill="#000" />
                          <rect x="14" y="0" width="2" height="22" fill="#000" />
                          <rect x="18" y="0" width="3" height="22" fill="#000" />
                          <rect x="23" y="0" width="1" height="22" fill="#000" />
                          <rect x="26" y="0" width="2" height="22" fill="#000" />
                          <rect x="30" y="0" width="1" height="22" fill="#000" />
                          <rect x="33" y="0" width="3" height="22" fill="#000" />
                          <rect x="38" y="0" width="2" height="22" fill="#000" />
                          <rect x="42" y="0" width="1" height="22" fill="#000" />
                          <rect x="45" y="0" width="3" height="22" fill="#000" />
                          <rect x="50" y="0" width="1" height="22" fill="#000" />
                          <rect x="53" y="0" width="2" height="22" fill="#000" />
                          <rect x="57" y="0" width="3" height="22" fill="#000" />
                          <rect x="62" y="0" width="1" height="22" fill="#000" />
                          <rect x="65" y="0" width="2" height="22" fill="#000" />
                          <rect x="69" y="0" width="1" height="22" fill="#000" />
                          <rect x="72" y="0" width="3" height="22" fill="#000" />
                          <rect x="77" y="0" width="2" height="22" fill="#000" />
                          <rect x="81" y="0" width="1" height="22" fill="#000" />
                          <rect x="84" y="0" width="3" height="22" fill="#000" />
                          <rect x="89" y="0" width="1" height="22" fill="#000" />
                          <rect x="92" y="0" width="2" height="22" fill="#000" />
                          <rect x="96" y="0" width="3" height="22" fill="#000" />
                          <rect x="101" y="0" width="1" height="22" fill="#000" />
                          <rect x="104" y="0" width="2" height="22" fill="#000" />
                          <rect x="108" y="0" width="3" height="22" fill="#000" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleTestFontPrint(selectedLabelFont)}
                      isLoading={testingFontKey === selectedLabelFont}
                      leftIcon={<Printer size={14} />}
                    >
                      Print Sample with {activeFont.label}
                    </Button>
                  </div>
                </div>
              );
            })()}
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
            <Button 
              variant="secondary"
              onClick={handleTestLabel}
              isLoading={isTestingLabel}
              leftIcon={<Tag size={16} />}
            >
              Test Print Standard Label
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
