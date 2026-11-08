import React, { useState, useEffect, useRef } from 'react';
import { Card, CardHeader } from '../../components/ui/Card';
import { TextArea } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Upload, Save, Trash2, Printer, RefreshCw } from 'lucide-react';
import styles from './Settings.module.css';
import { useToast } from '../../components/ui/Toast';
import { useSettingsStore } from '../../store/settingsStore';
import { formatCurrency } from '../../utils/formatCurrency';
import { printReceiptDirect } from '../../utils/printWindow';
import { errorMessage } from '../../utils/errorUtils';

export const ReceiptTab = () => {
  const { receiptHeader, receiptFooter, storeName, currency, logoUrl: savedLogoUrl, updateSettingsBulk } = useSettingsStore();
  const [headerText, setHeaderText] = useState(receiptHeader !== undefined ? receiptHeader : 'Thank you for shopping with us!');
  const [footerText, setFooterText] = useState(receiptFooter !== undefined ? receiptFooter : 'Returns accepted within 14 days with original receipt.');
  const [logoUrl, setLogoUrl] = useState(savedLogoUrl || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingPrint, setIsTestingPrint] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (receiptHeader !== undefined) setHeaderText(receiptHeader);
    if (receiptFooter !== undefined) setFooterText(receiptFooter);
    if (savedLogoUrl !== undefined) setLogoUrl(savedLogoUrl || '');
  }, [receiptHeader, receiptFooter, savedLogoUrl]);

  /**
   * Normalize and optimize image to ESC/POS friendly PNG format.
   * Forces width to multiple of 8 (max 320px) to prevent thermal raster corruption.
   */
  const processImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Invalid File', 'Please select a valid image file (PNG, JPG, or WebP).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('File Too Large', 'Please select an image smaller than 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUri = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        try {
          const MAX_WIDTH = 320;
          const MAX_HEIGHT = 160;
          let targetW = img.naturalWidth || img.width;
          let targetH = img.naturalHeight || img.height;

          if (targetW > MAX_WIDTH || targetH > MAX_HEIGHT) {
            const ratio = Math.min(MAX_WIDTH / targetW, MAX_HEIGHT / targetH);
            targetW = Math.round(targetW * ratio);
            targetH = Math.round(targetH * ratio);
          }

          // Force width to multiple of 8 (crucial for ESC/POS raster bit image alignment)
          targetW = Math.max(16, Math.round(targetW / 8) * 8);
          targetH = Math.max(1, targetH);

          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            toast.error('Processing Failed', 'Could not access image canvas.');
            return;
          }

          // Use high quality image smoothing
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, targetW, targetH);

          const optimizedPng = canvas.toDataURL('image/png');
          setLogoUrl(optimizedPng);
          toast.success('Logo Loaded', `Optimized to ${targetW}x${targetH}px thermal-ready PNG. Click Save to persist.`);
        } catch (procErr: unknown) {
          console.error('Error processing logo image:', procErr);
          toast.error('Optimization Failed', errorMessage(procErr) || 'Could not process image.');
        }
      };
      img.onerror = () => {
        toast.error('Invalid Image', 'Could not decode this image file.');
      };
      img.src = dataUri;
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImageFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processImageFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleRemoveLogo = () => {
    setLogoUrl('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    toast.info('Logo Cleared', 'Click "Save Receipt Settings" to save changes.');
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateSettingsBulk({
        receiptHeader: headerText,
        receiptFooter: footerText,
        logoUrl: logoUrl,
      });
      toast.success('Receipt Settings Saved', 'Receipt template and store logo saved successfully.');
    } catch (err: unknown) {
      toast.error('Save Failed', errorMessage(err) || 'Could not save receipt settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestPrint = async () => {
    setIsTestingPrint(true);
    try {
      const sampleTx = {
        id: `TEST-${Date.now().toString().slice(-4)}`,
        date: new Date().toISOString(),
        customerName: 'Test Customer',
        processedByName: 'Admin',
        items: [
          { product: { name: 'iPhone 15 Pro', model: '128GB Black Titanium', price: 999 }, quantity: 1 },
          { product: { name: 'Silicone Case', model: 'MagSafe Black', price: 49 }, quantity: 1 },
        ],
        subtotal: 1048,
        discount: { type: 'flat' as const, value: 48 },
        total: 1000,
        payments: [{ method: 'cash', amount: 1000 }],
      };

      const result = await printReceiptDirect(
        sampleTx,
        storeName,
        currency,
        {
          headerMessage: headerText,
          footerMessage: footerText,
          logoUrl: logoUrl || undefined,
        }
      );

      if (result.method === 'direct') {
        // A direct path carrying an error was refused by the server (for example,
        // the printer is offline). The test receipt never printed — say so.
        if (result.error) {
          toast.error('Print Error', result.error);
          return;
        }
        toast.success('Test Receipt Printed! 🖨️', 'Sent test receipt directly to thermal printer with logo.');
      } else {
        toast.info('Browser Print', 'Local print server offline — opened browser print fallback.');
      }
    } catch (err: unknown) {
      console.error('Test print failed:', err);
      toast.error('Print Error', errorMessage(err) || 'Could not print test receipt.');
    } finally {
      setIsTestingPrint(false);
    }
  };

  return (
    <div className={styles.receiptLayout}>
      <div className={styles.receiptForm}>
        <Card>
          <CardHeader title="Receipt Customization" subtitle="Configure the store logo, header message, and policy for customer receipts." />
          
          <div className={styles.formGroup}>
            {/* Hidden File Input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/png,image/jpeg,image/jpg,image/webp"
              style={{ display: 'none' }}
            />

            {/* Logo Upload Section */}
            <div className={styles.logoUploadSection}>
              <span className={styles.logoUploadLabel}>Store Logo for Thermal Receipts</span>
              
              {logoUrl ? (
                <div className={styles.logoActiveCard}>
                  <div className={styles.logoActiveLeft}>
                    <div className={styles.logoActiveThumbnailBox}>
                      <img src={logoUrl} alt="Store Logo" className={styles.logoActiveThumbnail} />
                    </div>
                    <div className={styles.logoActiveInfo}>
                      <span className={styles.logoActiveTitle}>Active Logo Attached</span>
                      <span className={styles.logoActiveSubtitle}>
                        Printed on receipts and drop-off tickets
                      </span>
                    </div>
                  </div>

                  <div className={styles.logoActiveActions}>
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<RefreshCw size={14} />}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Change
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      leftIcon={<Trash2 size={14} />}
                      onClick={handleRemoveLogo}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  className={`${styles.logoDropzone} ${isDragging ? styles.logoDropzoneActive : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  role="button"
                  tabIndex={0}
                >
                  <div className={styles.logoDropzoneIcon}>
                    <Upload size={22} />
                  </div>
                  <div className={styles.logoDropzoneTitle}>
                    Click to upload or drag and drop your store logo
                  </div>
                  <div className={styles.logoDropzoneSub}>
                    PNG, JPG, or WebP · Automatically scaled and centered for 80mm & 58mm thermal receipts
                  </div>
                </div>
              )}
            </div>

            <TextArea 
              label="Header Message"
              value={headerText}
              onChange={e => setHeaderText(e.target.value)}
              placeholder="e.g. Thank you for choosing us! Welcome to our store."
              rows={2}
            />

            <TextArea 
              label="Footer Message / Policy"
              value={footerText}
              onChange={e => setFooterText(e.target.value)}
              placeholder="e.g. Returns accepted within 14 days with original receipt. No cash refunds on opened electronics."
              rows={3}
            />

            <div className={styles.buttonRow}>
              <Button 
                leftIcon={<Save size={16} />} 
                onClick={handleSave} 
                isLoading={isSaving}
                className={styles.saveBtn}
              >
                Save Receipt Settings
              </Button>

              <Button
                variant="secondary"
                leftIcon={<Printer size={16} />}
                onClick={handleTestPrint}
                isLoading={isTestingPrint}
                className={styles.testPrintBtn}
              >
                Test Print Receipt
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Live Preview Panel */}
      <div className={styles.receiptPreviewPanel}>
        <Card>
          <CardHeader title="Live Thermal Preview" subtitle="Real-time look on standard 80mm roll" />
          <div className={styles.receiptPreview}>
            {logoUrl && (
              <div className={styles.previewLogoImgContainer}>
                <img src={logoUrl} alt="Store Logo" className={styles.previewLogoImg} />
              </div>
            )}
            <div className={styles.previewLogo}>{storeName || 'PhoneShop Pro'}</div>
            <div className={styles.previewHeader}>{headerText || 'Header text appears here'}</div>
            
            <div className={styles.previewDivider} />
            <div style={{ textAlign: 'center', fontSize: '11px', color: '#666', marginBottom: '4px' }}>
              <div>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
              <div>Order: #TEST-0042</div>
            </div>
            <div className={styles.previewDivider} />

            <div className={styles.previewItem}>
              <span>1x iPhone 15 Pro (128GB)</span>
              <span>{formatCurrency(999)}</span>
            </div>
            <div className={styles.previewItem}>
              <span>1x MagSafe Silicone Case</span>
              <span>{formatCurrency(49)}</span>
            </div>
            
            <div className={styles.previewDivider} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#666' }}>
              <span>Subtotal</span>
              <span>{formatCurrency(1048)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#047857', fontWeight: 600, margin: '2px 0' }}>
              <span>Discount</span>
              <span>−{formatCurrency(48)}</span>
            </div>
            <div className={styles.previewTotal}>
              <span>Total</span>
              <span>{formatCurrency(1000)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#555', marginTop: '2px' }}>
              <span>Payment: CASH</span>
              <span>{formatCurrency(1000)}</span>
            </div>
            <div className={styles.previewDivider} />
            
            <div className={styles.previewFooter}>{footerText || 'Footer text appears here'}</div>
          </div>
        </Card>
      </div>
    </div>
  );
};
