import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Printer,
  FileText,
  Smartphone,
  Tag,
  Plus,
  Trash2,
  Copy,
  RotateCcw,
  Search,
  Barcode,
  Sparkles,
  Eye,
  X,
  Keyboard,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Type,
  Target,
  Bookmark,
  Save,
  AlertTriangle,
} from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { useSettingsStore } from '../../store/settingsStore';
import { useInventoryStore } from '../../store/inventoryStore';
import { usePrinterStatus } from '../../hooks/usePrinterStatus';
import { useToast } from '../../components/ui/Toast';
import { getCurrencySymbol } from '../../utils/formatCurrency';
import { buildCustomTicketHTML } from './customTicketTemplate';
import { printCustomTicketDirect, calibrateLabelPrinter, openPrintWindow } from '../../utils/printWindow';
import type { CustomTicketData, TicketFormat, TicketPrintMode, TextFontSize } from './customTicketTypes';
import type { PhoneModel } from '../../types';
import styles from './CustomTicket.module.css';

export interface UserTemplate {
  id: string;
  name: string;
  data: CustomTicketData;
}

// Compute responsive font size for blank sticker centered text
const getComputedFontSize = (text: string, sizePref?: TextFontSize, isCompact: boolean = true) => {
  if (sizePref === 'normal') return isCompact ? '13px' : '15px';
  if (sizePref === 'large') return isCompact ? '17px' : '20px';
  if (sizePref === 'huge') return isCompact ? '22px' : '26px';
  if (sizePref === 'giant') return isCompact ? '28px' : '34px';

  const lines = (text || '').split('\n');
  const maxLineLen = lines.reduce((acc, l) => Math.max(acc, l.trim().length), 0);
  if (lines.length === 1 && maxLineLen <= 10) return isCompact ? '26px' : '32px';
  if (lines.length <= 2 && maxLineLen <= 16) return isCompact ? '20px' : '25px';
  if (lines.length <= 4 && maxLineLen <= 24) return isCompact ? '16px' : '20px';
  return isCompact ? '13px' : '15px';
};

// Barcode / QR Preview Renderer for Print Modal
const BarcodePreview: React.FC<{ value: string; isQr: boolean; isCompact?: boolean }> = ({ value, isQr, isCompact }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!isQr && svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, value, {
          format: 'CODE128',
          width: isCompact ? 1.1 : 1.35,
          height: isCompact ? 28 : 36,
          displayValue: true,
          fontSize: isCompact ? 9 : 10.5,
          font: 'monospace',
          margin: 0,
        });
      } catch (e) {
        console.warn('Barcode preview error:', e);
      }
    }
  }, [value, isQr, isCompact]);

  if (!value) return null;

  if (isQr) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '6px 0' }}>
        <QRCodeSVG value={value} size={isCompact ? 56 : 76} level="M" />
        <div style={{ fontSize: isCompact ? '9px' : '10px', fontFamily: 'monospace', color: '#444', marginTop: '3px' }}>
          {value}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0', overflow: 'hidden' }}>
      <svg ref={svgRef} style={{ maxWidth: '100%' }} />
    </div>
  );
};

const PRESET_TEMPLATES = [
  {
    id: 'phone_specs',
    name: '📱 Phone Specs',
    data: {
      title: 'PHONE SPECIFICATIONS',
      subtitle: 'Tested & Certified Device',
      deviceModel: 'Apple iPhone 14 Pro Max',
      condition: 'Grade A+ (Like New)',
      storage: '256GB',
      ram: '6GB',
      color: 'Deep Purple',
      batteryHealth: '94%',
      price: '8500',
      warranty: '3 Months Shop Warranty',
      imei: '359876123456789',
      specs: [
        { id: '1', label: 'Screen', value: 'Original Super Retina XDR' },
        { id: '2', label: 'Face ID', value: 'Working 100%' },
        { id: '3', label: 'True Tone', value: 'Active' },
        { id: '4', label: 'Network', value: 'Factory Unlocked (All SIMs)' },
      ],
      notes: 'Clean iCloud. Battery health 94%. Comes with original charging cable.',
      includeBarcode: true,
      barcodeValue: '359876123456789',
      barcodeType: 'barcode' as const,
      showStoreHeader: true,
      showStoreFooter: true,
      customFooter: 'Thank you for choosing PhoneShop Pro!',
      format: '80mm' as TicketFormat,
      copies: 1,
    },
  },
  {
    id: 'diagnostic',
    name: '🔧 Diagnostic Slip',
    data: {
      title: 'DEVICE DIAGNOSTIC REPORT',
      subtitle: 'Hardware & Functionality Checklist',
      deviceModel: 'Samsung Galaxy S23 Ultra',
      condition: 'Customer Pre-Check',
      storage: '512GB',
      ram: '12GB',
      color: 'Phantom Black',
      batteryHealth: 'Good',
      price: '',
      warranty: '',
      imei: '354890123894712',
      specs: [
        { id: '1', label: 'Display & Touch', value: 'Passed ✓' },
        { id: '2', label: 'Cameras (Front/Back)', value: 'Passed ✓' },
        { id: '3', label: 'Charging & Port', value: 'Fast Charge OK ✓' },
        { id: '4', label: 'Audio & Microphones', value: 'Passed ✓' },
        { id: '5', label: 'WiFi & Bluetooth', value: 'Connected ✓' },
      ],
      notes: 'No liquid contact found. Minor housing scratches on bottom edge.',
      includeBarcode: true,
      barcodeValue: '354890123894712',
      barcodeType: 'qr' as const,
      showStoreHeader: true,
      showStoreFooter: true,
      customFooter: 'Inspected by Lead Technician',
      format: '80mm' as TicketFormat,
      copies: 1,
    },
  },
  {
    id: 'price_tag',
    name: '🏷️ Price & Warranty Tag',
    data: {
      title: 'SPECIAL OFFER',
      subtitle: 'Verified Stock Ready to Go',
      deviceModel: 'Xiaomi Redmi Note 13 Pro',
      condition: 'Brand New / Sealed',
      storage: '256GB',
      ram: '8GB',
      color: 'Midnight Black',
      batteryHealth: '100% (New)',
      price: '3400',
      warranty: '1 Year Manufacturer Warranty',
      imei: 'XIA-RN13P-256',
      specs: [
        { id: '1', label: 'RAM', value: '8GB + 8GB Boost' },
        { id: '2', label: 'Camera', value: '200MP OIS Camera' },
        { id: '3', label: 'Charging', value: '67W Turbo Charge' },
      ],
      notes: 'Free protective cover and screen glass included.',
      includeBarcode: true,
      barcodeValue: 'XIA-RN13P-256',
      barcodeType: 'barcode' as const,
      showStoreHeader: true,
      showStoreFooter: true,
      customFooter: 'Best price guaranteed in town!',
      format: '80mm' as TicketFormat,
      copies: 1,
    },
  },
  {
    id: 'accessory',
    name: '⚡ Accessory Spec',
    data: {
      title: 'ACCESSORY SPEC SHEET',
      subtitle: 'Original Certified Accessory',
      deviceModel: 'Anker PowerPort III 20W Cube',
      condition: 'New in Box',
      storage: '',
      ram: '',
      color: 'White',
      batteryHealth: '',
      price: '180',
      warranty: '6 Months Replacement Warranty',
      imei: 'ANK-CHG-20W',
      specs: [
        { id: '1', label: 'Power Output', value: '20W Fast Charging' },
        { id: '2', label: 'Port Type', value: 'USB-C Power Delivery' },
        { id: '3', label: 'Compatibility', value: 'iPhone 12-16 & Android' },
      ],
      notes: 'Complies with CE safety regulations. Ultra-compact foldable plug.',
      includeBarcode: true,
      barcodeValue: 'ANK-CHG-20W',
      barcodeType: 'barcode' as const,
      showStoreHeader: true,
      showStoreFooter: true,
      customFooter: 'Always use certified fast chargers.',
      format: '58mm' as TicketFormat,
      copies: 1,
    },
  },
  {
    id: 'blank',
    name: '📝 Blank Custom Note',
    data: {
      title: 'CUSTOM RECEIPT & NOTE',
      subtitle: '',
      deviceModel: '',
      condition: '',
      storage: '',
      ram: '',
      color: '',
      batteryHealth: '',
      price: '',
      warranty: '',
      imei: '',
      specs: [{ id: '1', label: 'Item / Detail', value: 'Value' }],
      notes: 'Type any custom text, specifications, or customer instructions here.',
      includeBarcode: false,
      barcodeValue: '',
      barcodeType: 'barcode' as const,
      showStoreHeader: true,
      showStoreFooter: true,
      customFooter: 'Thank you for choosing PhoneShop Pro!',
      format: '80mm' as TicketFormat,
      copies: 1,
    },
  },
  {
    id: 'blank_sticker',
    name: '🏷️ Blank Centered Sticker',
    data: {
      title: '',
      subtitle: '',
      deviceModel: '',
      condition: '',
      storage: '',
      ram: '',
      color: '',
      batteryHealth: '',
      price: '',
      warranty: '',
      imei: '',
      specs: [],
      notes: '',
      includeBarcode: false,
      barcodeValue: '',
      barcodeType: 'barcode' as const,
      showStoreHeader: false,
      showStoreFooter: false,
      customFooter: '',
      format: 'sticker' as TicketFormat,
      copies: 1,
      mode: 'free_text' as const,
      freeText: 'RESERVED FOR AHMED\nIPHONE 15 PRO\nBATTERY 100%',
      fontSize: 'auto' as const,
      isBold: true,
      textAlign: 'center' as const,
      showStoreNameOnSticker: false,
      stickerSize: '50x20' as const,
    },
  },
];

export const CustomTicketPage: React.FC = () => {
  const { storeName, currency } = useSettingsStore();
  const currencySymbol = getCurrencySymbol(currency);
  const { products, fetchProducts } = useInventoryStore();
  const { isOnline, printer, labelPrinter } = usePrinterStatus();
  const toast = useToast();

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Mode: specs (detailed slip) vs free_text (blank centered sticker)
  const [activeMode, setActiveMode] = useState<TicketPrintMode>('specs');

  // Active ticket form state (restored from localStorage draft if available)
  const [ticket, setTicket] = useState<CustomTicketData>(() => {
    try {
      const savedDraft = localStorage.getItem('custom_ticket_draft');
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to parse saved ticket draft:', e);
    }
    return {
      ...PRESET_TEMPLATES[0].data,
      ram: '',
      mode: 'specs',
      freeText: '',
      fontSize: 'auto',
      isBold: true,
      textAlign: 'center',
      showStoreNameOnSticker: false,
      stickerSize: '50x20',
    };
  });

  // Auto-save active draft to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('custom_ticket_draft', JSON.stringify(ticket));
    } catch (e) {
      console.warn('Failed to auto-save ticket draft:', e);
    }
  }, [ticket]);

  // Load custom saved user templates from localStorage
  const [userTemplates, setUserTemplates] = useState<UserTemplate[]>(() => {
    try {
      const saved = localStorage.getItem('custom_ticket_user_templates');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn('Failed to load user templates:', e);
      return [];
    }
  });
  const [isSaveTemplateModalOpen, setIsSaveTemplateModalOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  const [selectedPresetId, setSelectedPresetId] = useState<string>('phone_specs');
  const [isPrinting, setIsPrinting] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [isInventoryModalOpen, setIsInventoryModalOpen] = useState(false);
  const [inventorySearch, setInventorySearch] = useState('');
  // Universal print preview modal state (for 80mm, 58mm, and sticker)
  const [showPrintPreview, setShowPrintPreview] = useState(false);

  // Recalibrate label gap sensor
  const handleCalibrateSensor = async () => {
    if (!isOnline) {
      toast.error('Print Server Offline', 'Cannot calibrate: Print server is not connected on port 3355.');
      return;
    }
    setIsCalibrating(true);
    try {
      const res = await calibrateLabelPrinter();
      if (res.success) {
        toast.success(
          'Sensor Calibrated! 🎯',
          res.message || 'Printer gap sensor synchronized! The sticker is now aligned with the label gap.'
        );
      } else {
        toast.error('Calibration Failed', res.error || 'Failed to calibrate printer sensor.');
      }
    } catch (err: any) {
      toast.error('Calibration Error', err?.message || 'Could not communicate with the print server.');
    } finally {
      setIsCalibrating(false);
    }
  };

  // Handle template switch (supports both built-in presets and user-saved templates)
  const handleSelectPreset = (presetId: string) => {
    const foundPreset = PRESET_TEMPLATES.find(p => p.id === presetId);
    const foundUser = userTemplates.find(p => p.id === presetId);
    const found = foundPreset || foundUser;
    if (found) {
      setSelectedPresetId(presetId);
      if (found.data.mode === 'free_text') {
        setActiveMode('free_text');
      } else {
        setActiveMode('specs');
      }
      setTicket({ ...found.data });
      toast.info('Template Loaded', `Applied "${found.name}" preset.`);
    }
  };

  // Save current ticket as custom template
  const handleSaveAsTemplate = () => {
    if (!newTemplateName.trim()) {
      toast.warning('Template Name Required', 'Please enter a name for your custom template.');
      return;
    }
    const newTpl: UserTemplate = {
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: `⭐ ${newTemplateName.trim()}`,
      data: { ...ticket },
    };
    const updated = [...userTemplates, newTpl];
    setUserTemplates(updated);
    try {
      localStorage.setItem('custom_ticket_user_templates', JSON.stringify(updated));
    } catch (e) {
      console.warn('Failed to save user templates to localStorage:', e);
    }
    setIsSaveTemplateModalOpen(false);
    setNewTemplateName('');
    toast.success('Template Saved', `"${newTpl.name}" is now available in your templates list.`);
  };

  // Delete a user-saved custom template
  const handleDeleteUserTemplate = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = userTemplates.filter(t => t.id !== id);
    setUserTemplates(updated);
    try {
      localStorage.setItem('custom_ticket_user_templates', JSON.stringify(updated));
    } catch (e) {
      console.warn('Failed to save user templates to localStorage:', e);
    }
    toast.info('Template Deleted', `Removed "${name}".`);
  };

  // Reset active working draft
  const handleResetDraft = () => {
    try {
      localStorage.removeItem('custom_ticket_draft');
    } catch (e) {}
    handleSelectPreset('blank');
    toast.info('Draft Cleared', 'Editor reset to blank note.');
  };

  // Blank sticker height overflow warning calculation (Problem 12)
  const blankStickerOverflowWarning = useMemo(() => {
    if (ticket.format !== 'sticker' || ticket.mode !== 'free_text') return null;
    const text = ticket.freeText || '';
    const lines = text.split('\n');
    const lineCount = lines.length;
    const size = ticket.stickerSize || '50x20';
    const totalDotsH = size === '50x30' ? 240 : size === '50x25' ? 200 : 160;

    const fontSize = ticket.fontSize || 'auto';
    let lineHeightDots = 18;
    if (fontSize === 'normal') lineHeightDots = 16;
    else if (fontSize === 'large') lineHeightDots = 22;
    else if (fontSize === 'huge') lineHeightDots = 28;
    else if (fontSize === 'giant') lineHeightDots = 38;
    else {
      lineHeightDots = lineCount <= 2 ? 30 : lineCount <= 4 ? 22 : 16;
    }

    const headerReserve = ticket.showStoreNameOnSticker ? 28 : 0;
    const barcodeReserve = (ticket.includeBarcode && ticket.barcodeValue.trim())
      ? (ticket.barcodeType === 'qr' ? 50 : 40)
      : 0;
    const availableHeightDots = totalDotsH - 12 - headerReserve - barcodeReserve;
    const requiredHeightDots = lineCount * lineHeightDots;

    if (requiredHeightDots > availableHeightDots) {
      const maxEstimatedLines = Math.max(1, Math.floor(availableHeightDots / lineHeightDots));
      return {
        isOverflow: true,
        lineCount,
        maxEstimatedLines,
        stickerSize: size,
      };
    }
    return null;
  }, [ticket.format, ticket.mode, ticket.freeText, ticket.stickerSize, ticket.fontSize, ticket.showStoreNameOnSticker, ticket.includeBarcode, ticket.barcodeValue, ticket.barcodeType]);

  // Spec item row helpers
  const handleAddSpec = () => {
    setTicket(prev => ({
      ...prev,
      specs: [...prev.specs, { id: `spec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, label: '', value: '' }],
    }));
  };

  const handleUpdateSpec = (id: string, field: 'label' | 'value', val: string) => {
    setTicket(prev => ({
      ...prev,
      specs: prev.specs.map(s => (s.id === id ? { ...s, [field]: val } : s)),
    }));
  };

  const handleRemoveSpec = (id: string) => {
    setTicket(prev => ({
      ...prev,
      specs: prev.specs.filter(s => s.id !== id),
    }));
  };

  // Load from Inventory Product
  // NOTE: supplier is intentionally excluded from customer-facing tickets (trade secret protection).
  // Device-specific fields are fully reset to the new product's values to prevent ghost specs.
  const handleSelectInventoryProduct = (prod: PhoneModel) => {
    setTicket(prev => ({
      ...prev,
      deviceModel: `${prod.name} ${prod.model}`.trim(),
      storage: prod.storage && prod.storage !== 'N/A' ? prod.storage : '',
      color: prod.color || '',
      ram: '',
      batteryHealth: '',
      imei: prod.sku || '',
      price: prod.price ? prod.price.toString() : prev.price,
      barcodeValue: prod.sku || prev.barcodeValue,
      includeBarcode: Boolean(prod.sku),
      specs: prev.specs.filter(s => s.id !== 'loc' && s.id !== 'sup'),
    }));
    setIsInventoryModalOpen(false);
    toast.success('Product Data Loaded', `Imported details for ${prod.name} ${prod.model}`);
  };

  // Filter inventory items for modal
  const filteredProducts = useMemo(() => {
    if (!inventorySearch.trim()) return products.slice(0, 25);
    const q = inventorySearch.toLowerCase().trim();
    return products.filter(
      p =>
        p.name.toLowerCase().includes(q) ||
        p.model.toLowerCase().includes(q) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.storage && p.storage.toLowerCase().includes(q)) ||
        (p.color && p.color.toLowerCase().includes(q))
    ).slice(0, 30);
  }, [products, inventorySearch]);

  // Live HTML preview
  const livePreviewHtml = useMemo(() => {
    return buildCustomTicketHTML(ticket, storeName, currencySymbol);
  }, [ticket, storeName, currencySymbol]);

  // Print Handler - Strictly via Local Print Server (Port 3355)
  const handleServerPrint = async () => {
    if (!isOnline) {
      toast.error(
        'Print Server Offline',
        'Cannot print: The local print server is not connected (http://localhost:3355). Please start it with "npm start" in the print-server folder.'
      );
      return;
    }

    setIsPrinting(true);
    try {
      const result = await printCustomTicketDirect(
        ticket,
        storeName,
        currencySymbol
      );

      if (result.success) {
        const destPrinter = ticket.format === 'sticker' ? (labelPrinter || 'Label Printer') : (printer || 'Thermal Printer');
        toast.success(
          'Printed Successfully! 🖨️',
          `Sent ${ticket.copies || 1} cop${(ticket.copies || 1) > 1 ? 'ies' : 'y'} directly to ${destPrinter} via Print Server.`
        );
      } else {
        toast.error('Print Server Error', result.error || 'Failed to print ticket via print server.');
      }
    } catch (err: any) {
      console.error('[Print Error]', err);
      toast.error('Print Server Error', err?.message || 'Could not communicate with the print server.');
    } finally {
      setIsPrinting(false);
    }
  };

  // Open Preview Modal before printing (for all formats: 80mm, 58mm, sticker)
  // NOTE: Preview is always available regardless of server status — allows browser print fallback.
  const handlePrintAction = () => {
    setShowPrintPreview(true);
  };

  // Browser Print Fallback: uses openPrintWindow with the live HTML preview
  const handleBrowserPrint = useCallback(() => {
    const label = ticket.mode === 'free_text' ? 'Blank Sticker' : 'Custom Ticket';
    openPrintWindow(livePreviewHtml, label);
    setShowPrintPreview(false);
    toast.success('Sent to Browser Print', 'Use your browser\'s print dialog to select a printer or save as PDF.');
  }, [livePreviewHtml, ticket.mode, toast]);

  // Confirm from preview modal → send to print server
  const handleConfirmPrint = async () => {
    setShowPrintPreview(false);
    await handleServerPrint();
  };

  return (
    <div className={styles.page}>
      {/* Header Bar */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.iconCircle}>
            <Printer size={22} />
          </div>
          <div>
            <h1 className={styles.title}>Custom Ticket & Spec Printer</h1>
            <p className={styles.subtitle}>
              Type specs, diagnostic test checklists, or phone tags and print them instantly on your thermal or label printer.
            </p>
          </div>
        </div>

        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            onClick={() => setIsInventoryModalOpen(true)}
            leftIcon={<Smartphone size={15} />}
          >
            Import from Inventory
          </Button>
          <Button
            variant="ghost"
            onClick={handleResetDraft}
            leftIcon={<RotateCcw size={14} />}
            title="Reset working draft to a blank note"
          >
            Clear / Blank
          </Button>
          <Button
            variant="secondary"
            onClick={() => setIsSaveTemplateModalOpen(true)}
            leftIcon={<Bookmark size={14} />}
            title="Save current ticket fields and settings as a reusable template"
          >
            Save as Template
          </Button>
        </div>
      </div>

      {/* Mode Switcher Bar */}
      <div className={styles.modeSwitcherBar}>
        <button
          type="button"
          className={[styles.modeTab, activeMode === 'specs' && styles.modeTabActive].filter(Boolean).join(' ')}
          onClick={() => {
            setActiveMode('specs');
            setTicket(prev => ({ ...prev, mode: 'specs' }));
          }}
        >
          <FileText size={16} />
          <span>📱 Phone Specs & Diagnostics</span>
        </button>

        <button
          type="button"
          className={[styles.modeTab, activeMode === 'free_text' && styles.modeTabActive].filter(Boolean).join(' ')}
          onClick={() => {
            setActiveMode('free_text');
            setTicket(prev => ({
              ...prev,
              mode: 'free_text',
              format: 'sticker',
              freeText: prev.freeText || 'RESERVED FOR AHMED\nIPHONE 15 PRO\nBATTERY 100%',
            }));
          }}
        >
          <Keyboard size={16} />
          <span>🏷️ Blank Sticker (Type & Center)</span>
          <span className={styles.centerBadge}>Exact Centered H & V</span>
        </button>
      </div>

      {/* Preset Quick Tabs */}
      <div className={styles.presetsBar}>
        <span className={styles.presetsLabel}>Templates:</span>
        {PRESET_TEMPLATES.map(p => (
          <button
            key={p.id}
            type="button"
            className={[
              styles.presetBtn,
              selectedPresetId === p.id && styles.presetBtnActive,
            ].filter(Boolean).join(' ')}
            onClick={() => handleSelectPreset(p.id)}
          >
            {p.name}
          </button>
        ))}

        {userTemplates.map(p => (
          <div
            key={p.id}
            style={{ display: 'inline-flex', alignItems: 'center', position: 'relative' }}
          >
            <button
              type="button"
              className={[
                styles.presetBtn,
                selectedPresetId === p.id && styles.presetBtnActive,
              ].filter(Boolean).join(' ')}
              style={{ paddingRight: '26px' }}
              onClick={() => handleSelectPreset(p.id)}
            >
              {p.name}
            </button>
            <button
              type="button"
              onClick={(e) => handleDeleteUserTemplate(p.id, p.name, e)}
              title="Delete custom template"
              style={{
                position: 'absolute',
                right: '6px',
                background: 'transparent',
                border: 'none',
                color: '#ef4444',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '2px',
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Main Two-Column Layout */}
      <div className={styles.layout}>
        {/* Left: Input Form Controls */}
        <div className={styles.formSection}>
          {activeMode === 'free_text' ? (
            <>
              {/* Card 1: Keyboard Typing Studio */}
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    <Keyboard size={16} />
                    <span>1. Type Sticker Text (Centered Horizontally & Vertically)</span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                    {(ticket.freeText || '').split('\n').filter(Boolean).length} lines · {(ticket.freeText || '').length} chars
                  </span>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label className={styles.label} style={{ marginBottom: '6px', display: 'block' }}>
                    Keyboard Input (Appears in center of sticker horizontally & vertically):
                  </label>
                  <textarea
                    rows={5}
                    className={styles.input}
                    style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, "Courier New", monospace',
                      fontSize: '14px',
                      lineHeight: '1.5',
                      padding: '12px 14px',
                      resize: 'vertical',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                    value={ticket.freeText || ''}
                    onChange={e => setTicket(prev => ({ ...prev, freeText: e.target.value }))}
                    placeholder="Type whatever you want to print on the blank sticker...&#10;&#10;e.g.&#10;RESERVED FOR SOUFIANE&#10;IPHONE 13 PRO MAX&#10;BATTERY 89% · 128GB"
                    autoFocus
                  />
                  {blankStickerOverflowWarning && (
                    <div style={{
                      marginTop: '8px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: 'rgba(245, 158, 11, 0.1)',
                      border: '1px solid rgba(245, 158, 11, 0.4)',
                      color: '#d97706',
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}>
                      <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                      <span>
                        <strong>Height Alert:</strong> Text has {blankStickerOverflowWarning.lineCount} lines, exceeding the safe height for a {blankStickerOverflowWarning.stickerSize}mm roll (~{blankStickerOverflowWarning.maxEstimatedLines} lines max at this font size). Switch font to "Normal" or use 50x25mm / 50x30mm to prevent text truncation on the physical printer.
                      </span>
                    </div>
                  )}
                </div>

                {/* Quick Snippets */}
                <div>
                  <label className={styles.label} style={{ fontSize: '11px', color: '#64748b' }}>
                    Quick Insert Chips (Click to insert):
                  </label>
                  <div className={styles.snippetRow}>
                    {[
                      '🏷️ RESERVED',
                      '🔧 FOR REPAIR',
                      '⚠️ DEFECTIVE / PARTS',
                      '✅ TESTED & PASSED',
                      '⭐ GRADE A+ LIKE NEW',
                      '🔋 BATTERY 100%',
                      '📦 SCREEN REPLACED',
                      '🚫 ICLOUD LOCKED',
                      '💰 SPECIAL OFFER',
                    ].map(snippet => (
                      <button
                        key={snippet}
                        type="button"
                        className={styles.snippetChip}
                        onClick={() => {
                          setTicket(prev => ({
                            ...prev,
                            freeText: prev.freeText ? `${prev.freeText}\n${snippet}` : snippet,
                          }));
                        }}
                      >
                        {snippet}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={styles.snippetChip}
                      style={{ color: '#ef4444', borderColor: '#fca5a5' }}
                      onClick={() => setTicket(prev => ({ ...prev, freeText: '' }))}
                    >
                      Clear Text
                    </button>
                  </div>
                </div>
              </div>

              {/* Card 2: Typography & Formatting */}
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    <Type size={16} />
                    <span>2. Sticker Format & Typography</span>
                  </div>
                </div>

                {/* Paper Format Selector */}
                <div style={{ marginBottom: '14px' }}>
                  <label className={styles.label} style={{ marginBottom: '6px', display: 'block' }}>
                    Paper Size:
                  </label>
                  <div className={styles.formatSelector}>
                    <div
                      className={[styles.formatCard, ticket.format === 'sticker' && styles.formatCardActive].filter(Boolean).join(' ')}
                      onClick={() => setTicket(prev => ({ ...prev, format: 'sticker' }))}
                    >
                      <span className={styles.formatTitle}>🏷️ Sticker Label</span>
                      <span className={styles.formatSub}>{(ticket.stickerSize || '50x20') === '50x30' ? '50 × 30 mm' : (ticket.stickerSize || '50x20') === '50x25' ? '50 × 25 mm' : '50 × 20 mm'}</span>
                    </div>
                    <div
                      className={[styles.formatCard, ticket.format === '80mm' && styles.formatCardActive].filter(Boolean).join(' ')}
                      onClick={() => setTicket(prev => ({ ...prev, format: '80mm' }))}
                    >
                      <span className={styles.formatTitle}>80mm Receipt</span>
                      <span className={styles.formatSub}>Standard Roll</span>
                    </div>
                    <div
                      className={[styles.formatCard, ticket.format === '58mm' && styles.formatCardActive].filter(Boolean).join(' ')}
                      onClick={() => setTicket(prev => ({ ...prev, format: '58mm' }))}
                    >
                      <span className={styles.formatTitle}>58mm Compact</span>
                      <span className={styles.formatSub}>Mini Roll</span>
                    </div>
                  </div>

                  {ticket.format === 'sticker' && (
                    <div style={{ marginTop: '10px', padding: '10px 12px', background: 'rgba(99, 102, 241, 0.08)', borderRadius: '8px', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>
                          🏷️ Sticker Roll Dimensions:
                        </label>
                        <span style={{ fontSize: '11px', color: '#6366f1', fontWeight: 600 }}>
                          {(ticket.stickerSize || '50x20') === '50x30' ? '50 × 30 mm' : (ticket.stickerSize || '50x20') === '50x25' ? '50 × 25 mm' : '50 × 20 mm (Standard Inventory Roll)'}
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                        <button
                          type="button"
                          style={{
                            padding: '6px 4px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                            border: (ticket.stickerSize || '50x20') === '50x20' ? '1.5px solid #6366f1' : '1px solid #cbd5e1',
                            background: (ticket.stickerSize || '50x20') === '50x20' ? '#6366f1' : '#ffffff',
                            color: (ticket.stickerSize || '50x20') === '50x20' ? '#ffffff' : '#334155',
                          }}
                          onClick={() => setTicket(prev => ({ ...prev, stickerSize: '50x20' }))}
                        >
                          50 × 20 mm (Std)
                        </button>
                        <button
                          type="button"
                          style={{
                            padding: '6px 4px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                            border: ticket.stickerSize === '50x25' ? '1.5px solid #6366f1' : '1px solid #cbd5e1',
                            background: ticket.stickerSize === '50x25' ? '#6366f1' : '#ffffff',
                            color: ticket.stickerSize === '50x25' ? '#ffffff' : '#334155',
                          }}
                          onClick={() => setTicket(prev => ({ ...prev, stickerSize: '50x25' }))}
                        >
                          50 × 25 mm
                        </button>
                        <button
                          type="button"
                          style={{
                            padding: '6px 4px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                            border: ticket.stickerSize === '50x30' ? '1.5px solid #6366f1' : '1px solid #cbd5e1',
                            background: ticket.stickerSize === '50x30' ? '#6366f1' : '#ffffff',
                            color: ticket.stickerSize === '50x30' ? '#ffffff' : '#334155',
                          }}
                          onClick={() => setTicket(prev => ({ ...prev, stickerSize: '50x30' }))}
                        >
                          50 × 30 mm
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Font Size Selector */}
                <div style={{ marginBottom: '14px' }}>
                  <label className={styles.label} style={{ marginBottom: '6px', display: 'block' }}>
                    Font Size on Sticker:
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
                    {(['auto', 'normal', 'large', 'huge', 'giant'] as TextFontSize[]).map(sz => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => setTicket(prev => ({ ...prev, fontSize: sz }))}
                        style={{
                          padding: '7px 4px',
                          borderRadius: '8px',
                          border: (ticket.fontSize || 'auto') === sz ? '2px solid #4f46e5' : '1px solid #cbd5e1',
                          background: (ticket.fontSize || 'auto') === sz ? '#eef2ff' : '#ffffff',
                          color: (ticket.fontSize || 'auto') === sz ? '#4f46e5' : '#334155',
                          fontWeight: 700,
                          fontSize: '11px',
                          textTransform: 'capitalize',
                          cursor: 'pointer',
                          textAlign: 'center',
                        }}
                      >
                        {sz === 'auto' ? '⚡ Auto Fit' : sz}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Alignment Selector & Bold Toggle */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                  <div>
                    <label className={styles.label} style={{ marginBottom: '6px', display: 'block' }}>
                      Text Alignment:
                    </label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => setTicket(prev => ({ ...prev, textAlign: 'center' }))}
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          borderRadius: '8px',
                          border: (ticket.textAlign || 'center') === 'center' ? '2px solid #4f46e5' : '1px solid #cbd5e1',
                          background: (ticket.textAlign || 'center') === 'center' ? '#eef2ff' : '#ffffff',
                          color: (ticket.textAlign || 'center') === 'center' ? '#4f46e5' : '#475569',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        <AlignCenter size={14} /> Center
                      </button>
                      <button
                        type="button"
                        onClick={() => setTicket(prev => ({ ...prev, textAlign: 'left' }))}
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          borderRadius: '8px',
                          border: ticket.textAlign === 'left' ? '2px solid #4f46e5' : '1px solid #cbd5e1',
                          background: ticket.textAlign === 'left' ? '#eef2ff' : '#ffffff',
                          color: ticket.textAlign === 'left' ? '#4f46e5' : '#475569',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        <AlignLeft size={14} /> Left
                      </button>
                      <button
                        type="button"
                        onClick={() => setTicket(prev => ({ ...prev, textAlign: 'right' }))}
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          borderRadius: '8px',
                          border: ticket.textAlign === 'right' ? '2px solid #4f46e5' : '1px solid #cbd5e1',
                          background: ticket.textAlign === 'right' ? '#eef2ff' : '#ffffff',
                          color: ticket.textAlign === 'right' ? '#4f46e5' : '#475569',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        <AlignRight size={14} /> Right
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className={styles.label} style={{ marginBottom: '6px', display: 'block' }}>
                      Typography Weight:
                    </label>
                    <label className={styles.toggleRow} style={{ marginTop: '6px' }}>
                      <input
                        type="checkbox"
                        className={styles.toggleCheckbox}
                        checked={ticket.isBold !== false}
                        onChange={e => setTicket(prev => ({ ...prev, isBold: e.target.checked }))}
                      />
                      <span style={{ fontSize: '12px', fontWeight: 600 }}>Bold Font (Darker Thermal Print)</span>
                    </label>
                  </div>
                </div>

                {/* Extra Options: Store Name Header & Barcode */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
                  <label className={styles.toggleRow}>
                    <input
                      type="checkbox"
                      className={styles.toggleCheckbox}
                      checked={Boolean(ticket.showStoreNameOnSticker)}
                      onChange={e => setTicket(prev => ({ ...prev, showStoreNameOnSticker: e.target.checked }))}
                    />
                    <span style={{ fontSize: '12.5px', fontWeight: 600 }}>
                      Include Store Header: &quot;{storeName || 'PhoneShop Pro'}&quot;
                    </span>
                  </label>

                  <label className={styles.toggleRow}>
                    <input
                      type="checkbox"
                      className={styles.toggleCheckbox}
                      checked={Boolean(ticket.includeBarcode)}
                      onChange={e => setTicket(prev => ({ ...prev, includeBarcode: e.target.checked }))}
                    />
                    <span style={{ fontSize: '12.5px', fontWeight: 600 }}>
                      Include Barcode / QR Code at bottom
                    </span>
                  </label>

                  {ticket.includeBarcode && (
                    <div style={{ paddingLeft: '24px' }}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          className={styles.input}
                          style={{ flex: 1, fontSize: '12px' }}
                          value={ticket.barcodeValue || ''}
                          onChange={e => setTicket(prev => ({ ...prev, barcodeValue: e.target.value }))}
                          placeholder="Barcode / IMEI / Number value"
                        />
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name="freeTextBarcodeType"
                              checked={ticket.barcodeType !== 'qr'}
                              onChange={() => setTicket(prev => ({ ...prev, barcodeType: 'barcode' }))}
                            />
                            1D Barcode
                          </label>
                          <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name="freeTextBarcodeType"
                              checked={ticket.barcodeType === 'qr'}
                              onChange={() => setTicket(prev => ({ ...prev, barcodeType: 'qr' }))}
                            />
                            QR Code
                          </label>
                        </div>
                      </div>
                      {ticket.barcodeType !== 'qr' && ticket.barcodeValue && /[^\x00-\x7F]/.test(ticket.barcodeValue) && (
                        <div style={{ marginTop: '6px', fontSize: '11px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                          <span>Code 128 barcode only supports ASCII alphanumeric characters.</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Card 1: Ticket Header & Formatting */}
              <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <FileText size={16} />
                <span>1. Slip Header & Paper Format</span>
              </div>
            </div>

            {/* Paper Format Selector */}
            <div style={{ marginBottom: '14px' }}>
              <label className={styles.label} style={{ marginBottom: '6px', display: 'block' }}>
                Print Format:
              </label>
              <div className={styles.formatSelector}>
                <div
                  className={[styles.formatCard, ticket.format === '80mm' && styles.formatCardActive].filter(Boolean).join(' ')}
                  onClick={() => setTicket(prev => ({ ...prev, format: '80mm' }))}
                >
                  <span className={styles.formatTitle}>80mm Receipt</span>
                  <span className={styles.formatSub}>Standard Roll (XP-T80Q)</span>
                </div>
                <div
                  className={[styles.formatCard, ticket.format === '58mm' && styles.formatCardActive].filter(Boolean).join(' ')}
                  onClick={() => setTicket(prev => ({ ...prev, format: '58mm' }))}
                >
                  <span className={styles.formatTitle}>58mm Compact</span>
                  <span className={styles.formatSub}>Mini Receipt Roll</span>
                </div>
                <div
                  className={[styles.formatCard, ticket.format === 'sticker' && styles.formatCardActive].filter(Boolean).join(' ')}
                  onClick={() => setTicket(prev => ({ ...prev, format: 'sticker' }))}
                >
                  <span className={styles.formatTitle}>🏷️ Sticker Label</span>
                  <span className={styles.formatSub}>{(ticket.stickerSize || '50x20') === '50x30' ? '50 × 30 mm' : (ticket.stickerSize || '50x20') === '50x25' ? '50 × 25 mm' : '50 × 20 mm'}</span>
                </div>
              </div>

              {ticket.format === 'sticker' && (
                <div style={{ marginTop: '10px', padding: '10px 12px', background: 'rgba(99, 102, 241, 0.08)', borderRadius: '8px', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>
                      🏷️ Sticker Roll Dimensions:
                    </label>
                    <span style={{ fontSize: '11px', color: '#6366f1', fontWeight: 600 }}>
                      {(ticket.stickerSize || '50x20') === '50x30' ? '50 × 30 mm' : (ticket.stickerSize || '50x20') === '50x25' ? '50 × 25 mm' : '50 × 20 mm (Standard Inventory Roll)'}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                    <button
                      type="button"
                      style={{
                        padding: '6px 4px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                        border: (ticket.stickerSize || '50x20') === '50x20' ? '1.5px solid #6366f1' : '1px solid #cbd5e1',
                        background: (ticket.stickerSize || '50x20') === '50x20' ? '#6366f1' : '#ffffff',
                        color: (ticket.stickerSize || '50x20') === '50x20' ? '#ffffff' : '#334155',
                      }}
                      onClick={() => setTicket(prev => ({ ...prev, stickerSize: '50x20' }))}
                    >
                      50 × 20 mm (Std)
                    </button>
                    <button
                      type="button"
                      style={{
                        padding: '6px 4px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                        border: ticket.stickerSize === '50x25' ? '1.5px solid #6366f1' : '1px solid #cbd5e1',
                        background: ticket.stickerSize === '50x25' ? '#6366f1' : '#ffffff',
                        color: ticket.stickerSize === '50x25' ? '#ffffff' : '#334155',
                      }}
                      onClick={() => setTicket(prev => ({ ...prev, stickerSize: '50x25' }))}
                    >
                      50 × 25 mm
                    </button>
                    <button
                      type="button"
                      style={{
                        padding: '6px 4px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                        border: ticket.stickerSize === '50x30' ? '1.5px solid #6366f1' : '1px solid #cbd5e1',
                        background: ticket.stickerSize === '50x30' ? '#6366f1' : '#ffffff',
                        color: ticket.stickerSize === '50x30' ? '#ffffff' : '#334155',
                      }}
                      onClick={() => setTicket(prev => ({ ...prev, stickerSize: '50x30' }))}
                    >
                      50 × 30 mm
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className={styles.grid2}>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Ticket Title</label>
                <input
                  type="text"
                  className={styles.input}
                  value={ticket.title}
                  onChange={e => setTicket(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g. PHONE SPECIFICATIONS"
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>Subtitle / Tagline</label>
                <input
                  type="text"
                  className={styles.input}
                  value={ticket.subtitle}
                  onChange={e => setTicket(prev => ({ ...prev, subtitle: e.target.value }))}
                  placeholder="e.g. Tested & Certified"
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '20px', marginTop: '12px' }}>
              <label className={styles.toggleRow}>
                <input
                  type="checkbox"
                  className={styles.toggleCheckbox}
                  checked={ticket.showStoreHeader}
                  onChange={e => setTicket(prev => ({ ...prev, showStoreHeader: e.target.checked }))}
                />
                <span>Include Store Name & Header</span>
              </label>

              <label className={styles.toggleRow}>
                <input
                  type="checkbox"
                  className={styles.toggleCheckbox}
                  checked={ticket.showStoreFooter}
                  onChange={e => setTicket(prev => ({ ...prev, showStoreFooter: e.target.checked }))}
                />
                <span>Include Store Footer & Verification</span>
              </label>
            </div>
          </div>

          {/* Card 2: Core Device Specifications */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <Smartphone size={16} />
                <span>2. Device & Hardware Details</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsInventoryModalOpen(true)}
                leftIcon={<Search size={13} />}
              >
                Auto-fill from Stock
              </Button>
            </div>

            <div className={styles.grid2} style={{ marginBottom: '14px' }}>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Device / Product Name</label>
                <input
                  type="text"
                  className={styles.input}
                  value={ticket.deviceModel}
                  onChange={e => setTicket(prev => ({ ...prev, deviceModel: e.target.value }))}
                  placeholder="e.g. Apple iPhone 15 Pro Max"
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>Condition / Grade</label>
                <input
                  type="text"
                  className={styles.input}
                  value={ticket.condition}
                  onChange={e => setTicket(prev => ({ ...prev, condition: e.target.value }))}
                  placeholder="e.g. Grade A+ (Like New)"
                />
              </div>
            </div>

            <div className={styles.grid3} style={{ marginBottom: '14px' }}>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Storage</label>
                <input
                  type="text"
                  className={styles.input}
                  value={ticket.storage}
                  onChange={e => setTicket(prev => ({ ...prev, storage: e.target.value }))}
                  placeholder="e.g. 256GB"
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>RAM</label>
                <input
                  type="text"
                  className={styles.input}
                  value={ticket.ram || ''}
                  onChange={e => setTicket(prev => ({ ...prev, ram: e.target.value }))}
                  placeholder="e.g. 8GB"
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>Color</label>
                <input
                  type="text"
                  className={styles.input}
                  value={ticket.color}
                  onChange={e => setTicket(prev => ({ ...prev, color: e.target.value }))}
                  placeholder="e.g. Natural Titanium"
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>Battery Health</label>
                <input
                  type="text"
                  className={styles.input}
                  value={ticket.batteryHealth}
                  onChange={e => setTicket(prev => ({ ...prev, batteryHealth: e.target.value }))}
                  placeholder="e.g. 94% or New"
                />
              </div>
            </div>

            <div className={styles.grid3} style={{ marginBottom: '14px' }}>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Price ({currencySymbol})</label>
                <input
                  type="text"
                  className={styles.input}
                  value={ticket.price}
                  onChange={e => setTicket(prev => ({ ...prev, price: e.target.value }))}
                  placeholder="e.g. 8500"
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>Shop Warranty</label>
                <input
                  type="text"
                  className={styles.input}
                  value={ticket.warranty}
                  onChange={e => setTicket(prev => ({ ...prev, warranty: e.target.value }))}
                  placeholder="e.g. 3 Months Shop"
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>IMEI / Serial Number</label>
                <input
                  type="text"
                  className={styles.input}
                  value={ticket.imei}
                  onChange={e => {
                    const v = e.target.value;
                    setTicket(prev => ({
                      ...prev,
                      imei: v,
                      barcodeValue: prev.includeBarcode && !prev.barcodeValue ? v : prev.barcodeValue,
                    }));
                  }}
                  placeholder="e.g. 359871..."
                />
              </div>
            </div>
          </div>

          {/* Card 3: Custom Key-Value Spec Lines */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <Tag size={16} />
                <span>3. Custom Technical Spec Lines</span>
              </div>
              <button
                type="button"
                className={styles.addSpecBtn}
                onClick={handleAddSpec}
              >
                <Plus size={14} /> Add Line
              </button>
            </div>

            {ticket.specs.length === 0 ? (
              <p style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic', margin: '6px 0' }}>
                No custom lines added. Click &quot;Add Line&quot; to specify Screen, RAM, Face ID, Network, or Box details.
              </p>
            ) : (
              <div className={styles.specsList}>
                {ticket.specs.map(item => (
                  <div key={item.id} className={styles.specRow}>
                    <input
                      type="text"
                      className={styles.input}
                      placeholder="Spec (e.g. Screen)"
                      value={item.label}
                      onChange={e => handleUpdateSpec(item.id, 'label', e.target.value)}
                    />
                    <input
                      type="text"
                      className={styles.input}
                      placeholder="Value (e.g. Original / True Tone OK)"
                      value={item.value}
                      onChange={e => handleUpdateSpec(item.id, 'value', e.target.value)}
                    />
                    <button
                      type="button"
                      className={styles.removeSpecBtn}
                      onClick={() => handleRemoveSpec(item.id)}
                      title="Remove line"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Card 4: Free-form Notes & Barcode */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <Barcode size={16} />
                <span>4. Notes, Barcode & Footer</span>
              </div>
            </div>

            <div className={styles.fieldGroup} style={{ marginBottom: '14px' }}>
              <label className={styles.label}>Notes & Observations (Optional)</label>
              <textarea
                className={styles.textarea}
                value={ticket.notes}
                onChange={e => setTicket(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="e.g. Never opened, comes with original charger and box, 100% clean iCloud..."
              />
            </div>

            <div className={styles.grid2} style={{ marginBottom: '14px' }}>
              <div className={styles.fieldGroup}>
                <label className={styles.toggleRow} style={{ marginBottom: '6px' }}>
                  <input
                    type="checkbox"
                    className={styles.toggleCheckbox}
                    checked={ticket.includeBarcode}
                    onChange={e => setTicket(prev => ({
                      ...prev,
                      includeBarcode: e.target.checked,
                      barcodeValue: e.target.checked && !prev.barcodeValue ? (prev.imei || '12345678') : prev.barcodeValue,
                    }))}
                  />
                  <span>Print Barcode or QR Code</span>
                </label>

                {ticket.includeBarcode && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <select
                        className={styles.select}
                        style={{ width: '110px' }}
                        value={ticket.barcodeType}
                        onChange={e => setTicket(prev => ({ ...prev, barcodeType: e.target.value as 'barcode' | 'qr' }))}
                      >
                        <option value="barcode">Barcode</option>
                        <option value="qr">QR Code</option>
                      </select>
                      <input
                        type="text"
                        className={styles.input}
                        placeholder="Code text / IMEI / URL"
                        value={ticket.barcodeValue}
                        onChange={e => setTicket(prev => ({ ...prev, barcodeValue: e.target.value }))}
                      />
                    </div>
                    {ticket.barcodeType !== 'qr' && ticket.barcodeValue && /[^\x00-\x7F]/.test(ticket.barcodeValue) && (
                      <div style={{ marginTop: '4px', fontSize: '11px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                        <span>Code 128 barcode only supports ASCII alphanumeric characters.</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>Custom Footer Note</label>
                <input
                  type="text"
                  className={styles.input}
                  value={ticket.customFooter}
                  onChange={e => setTicket(prev => ({ ...prev, customFooter: e.target.value }))}
                  placeholder="e.g. Thank you for visiting PhoneShop!"
                />
              </div>
            </div>
          </div>
            </>
          )}
        </div>

        {/* Right: Live Visual Slip Preview & Print Cockpit */}
        <div className={styles.previewSection}>
          <div className={styles.previewHeader}>
            <div className={styles.previewTitle}>
              <Sparkles size={16} style={{ color: 'var(--color-primary, #4f46e5)' }} />
              <span>
                {ticket.mode === 'free_text' ? 'Live Blank Sticker Preview' : 'Live Thermal Slip Preview'}
              </span>
            </div>
            <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
              {ticket.mode === 'free_text'
                ? `Centered (${(ticket.stickerSize || '50x20') === '50x30' ? '50x30mm' : (ticket.stickerSize || '50x20') === '50x25' ? '50x25mm' : '50x20mm'})`
                : ticket.format === 'sticker'
                ? ((ticket.stickerSize || '50x20') === '50x30' ? '50x30mm Sticker' : (ticket.stickerSize || '50x20') === '50x25' ? '50x25mm Sticker' : '50x20mm Sticker')
                : ticket.format === '58mm'
                ? '58mm Mini'
                : '80mm Roll'}
            </span>
          </div>

          {ticket.mode === 'free_text' ? (
            <div
              className={styles.blankStickerPreviewBox}
              style={{
                aspectRatio: (ticket.stickerSize || '50x20') === '50x30' ? '5 / 3' : (ticket.stickerSize || '50x20') === '50x25' ? '5 / 2.5' : '5 / 2',
                minHeight: (ticket.stickerSize || '50x20') === '50x30' ? '216px' : (ticket.stickerSize || '50x20') === '50x25' ? '180px' : '150px',
              }}
            >
              {ticket.showStoreNameOnSticker && (
                <div style={{
                  textAlign: 'center',
                  fontSize: '11px',
                  fontWeight: 900,
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase',
                  borderBottom: '1.5px solid #d4c84a',
                  paddingBottom: '3px',
                  marginBottom: '6px',
                  color: '#555',
                }}>
                  {(storeName || 'PhoneShop Pro').substring(0, 24)}
                </div>
              )}

              <div className={styles.blankStickerCenterStage}>
                <div
                  className={styles.blankStickerText}
                  style={{
                    fontSize: getComputedFontSize(ticket.freeText || '', ticket.fontSize, false),
                    fontWeight: ticket.isBold !== false ? 900 : 500,
                    textAlign: ticket.textAlign || 'center',
                    color: '#111827',
                    width: '100%',
                  }}
                >
                  {ticket.freeText ? (
                    ticket.freeText
                  ) : (
                    <span style={{ color: '#94a3b8', fontStyle: 'italic', fontWeight: 400, fontSize: '14px' }}>
                      (Sticker is blank. Type anything in the keyboard input on the left to see it centered here)
                    </span>
                  )}
                </div>
              </div>

              {ticket.includeBarcode && ticket.barcodeValue && (
                <div style={{ borderTop: '1px solid #d4c84a', paddingTop: '4px', marginTop: '6px' }}>
                  <BarcodePreview
                    value={ticket.barcodeValue}
                    isQr={ticket.barcodeType === 'qr'}
                    isCompact={true}
                  />
                </div>
              )}
            </div>
          ) : (
            /* Photorealistic Slip Preview Card */
            <div className={styles.thermalPaper}>
              <div dangerouslySetInnerHTML={{ __html: livePreviewHtml }} />
              <div className={styles.paperPerforated} />
            </div>
          )}

          {/* Print Controls Bar */}
          <div className={styles.printActionsBar}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>Copies:</span>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {[1, 2, 5, 10, 20].map(cnt => (
                  <button
                    key={cnt}
                    type="button"
                    style={{
                      padding: '3px 9px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      background: (ticket.copies || 1) === cnt ? '#4f46e5' : '#ffffff',
                      color: (ticket.copies || 1) === cnt ? '#ffffff' : '#334155',
                      fontWeight: 700,
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                    onClick={() => setTicket(prev => ({ ...prev, copies: cnt }))}
                  >
                    {cnt}
                  </button>
                ))}
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={ticket.copies || 1}
                  onChange={e => {
                    const v = Math.max(1, Math.min(50, parseInt(e.target.value) || 1));
                    setTicket(prev => ({ ...prev, copies: v }));
                  }}
                  style={{
                    width: '42px', padding: '3px 4px', borderRadius: '6px',
                    border: '1px solid #cbd5e1', textAlign: 'center',
                    fontWeight: 700, fontSize: '11px', color: '#334155',
                  }}
                  title="Custom copies count (1-50)"
                />
              </div>
            </div>

            <button
              type="button"
              className={styles.primaryPrintBtn}
              onClick={handlePrintAction}
              disabled={isPrinting}
              title={isOnline ? 'Preview slip and print via local print server' : 'Preview slip and print via browser (print server offline)'}
            >
              <Eye size={18} />
              <span>
                {isPrinting
                  ? 'Sending to Printer...'
                  : ticket.mode === 'free_text'
                  ? `Preview & Print Blank Sticker (${ticket.copies || 1} Cop${(ticket.copies || 1) > 1 ? 'ies' : 'y'})`
                  : ticket.format === 'sticker'
                  ? `Preview & Print Sticker (${ticket.copies || 1} Cop${(ticket.copies || 1) > 1 ? 'ies' : 'y'})`
                  : ticket.format === '58mm'
                  ? `Preview & Print 58mm (${ticket.copies || 1} Cop${(ticket.copies || 1) > 1 ? 'ies' : 'y'})`
                  : `Preview & Print 80mm (${ticket.copies || 1} Cop${(ticket.copies || 1) > 1 ? 'ies' : 'y'})`}
              </span>
            </button>

            <div className={styles.secondaryActionsRow}>
              {ticket.format === 'sticker' && (
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={handleCalibrateSensor}
                  disabled={isCalibrating || !isOnline}
                  style={{ color: '#4f46e5', borderColor: 'rgba(99,102,241,0.3)', fontWeight: 700 }}
                  title="Calibrate and synchronize the printer's optical gap sensor"
                >
                  <Target size={14} />
                  <span>{isCalibrating ? 'Calibrating...' : '🎯 Calibrate Sensor'}</span>
                </button>
              )}

              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => {
                  const textToCopy = ticket.mode === 'free_text'
                    ? (ticket.freeText || '')
                    : `${ticket.deviceModel}\nStorage: ${ticket.storage}\nColor: ${ticket.color}\nBattery: ${ticket.batteryHealth}\nPrice: ${ticket.price} ${currencySymbol}\n${ticket.notes}`;
                  navigator.clipboard.writeText(textToCopy);
                  toast.success('Copied to Clipboard', 'Text copied.');
                }}
                title="Copy text to clipboard"
              >
                <Copy size={14} />
                <span>{ticket.mode === 'free_text' ? 'Copy Text' : 'Copy Specs'}</span>
              </button>

              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => {
                  if (ticket.mode === 'free_text') {
                    setTicket(prev => ({ ...prev, freeText: '' }));
                    toast.info('Sticker Cleared', 'Text input cleared.');
                  } else {
                    handleSelectPreset('phone_specs');
                  }
                }}
                title={ticket.mode === 'free_text' ? 'Clear sticker text' : 'Reset slip to Phone Specs template'}
              >
                <RotateCcw size={14} />
                <span>{ticket.mode === 'free_text' ? 'Clear Text' : 'Reset Slip'}</span>
              </button>
            </div>

            <div style={{ textAlign: 'center', marginTop: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 500, color: isOnline ? '#059669' : '#f59e0b' }}>
                {isOnline
                  ? `🟢 Server Connected (Port 3355) · Target: ${ticket.format === 'sticker' ? labelPrinter || 'Label Printer' : printer || 'POS Thermal 80mm'}`
                  : '🟡 Print Server Offline · Browser Print Available'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Inventory Search & Auto-Fill Modal */}
      <Modal
        isOpen={isInventoryModalOpen}
        onClose={() => setIsInventoryModalOpen(false)}
        title="Load Product from Inventory"
        subtitle="Select any in-stock smartphone or accessory to auto-fill its specifications"
        size="md"
      >
        <SearchInput
          value={inventorySearch}
          onChange={setInventorySearch}
          placeholder="Search by name, model, storage, SKU..."
        />

        <div className={styles.inventorySearchModal}>
          {filteredProducts.length === 0 ? (
            <p style={{ textAlign: 'center', padding: '20px', color: '#64748b', fontSize: '13px' }}>
              No products found matching &quot;{inventorySearch}&quot;.
            </p>
          ) : (
            filteredProducts.map(p => (
              <div
                key={p.id}
                className={styles.inventoryItemCard}
                onClick={() => handleSelectInventoryProduct(p)}
              >
                <div>
                  <div className={styles.inventoryItemName}>
                    {p.name} {p.model}
                  </div>
                  <div className={styles.inventoryItemMeta}>
                    {[p.storage && p.storage !== 'N/A' ? p.storage : null, p.color, p.sku ? `SKU: ${p.sku}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <div className={styles.inventoryItemPrice}>
                  {p.price} {currencySymbol}
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>

      {/* ── Universal Print Preview Modal (80mm, 58mm, Sticker) ─────────────── */}
      {showPrintPreview && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(5px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '16px',
        }}>
          <div style={{
            background: '#1e293b', borderRadius: '20px', padding: '24px 28px',
            maxWidth: '480px', width: '100%', maxHeight: '92vh',
            boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
            border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: 38, height: 38, borderRadius: '10px',
                  background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Eye size={20} color="#fff" />
                </div>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#f1f5f9' }}>
                    {ticket.mode === 'free_text'
                      ? 'Blank Centered Sticker Preview'
                      : ticket.format === 'sticker'
                      ? 'Sticker Print Preview'
                      : ticket.format === '58mm'
                      ? '58mm Compact Receipt Preview'
                      : '80mm Thermal Receipt Preview'}
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#94a3b8' }}>
                    {ticket.format === 'sticker'
                      ? '50 × 30mm label · Centered H & V · Xprinter XP-420B (TSPL)'
                      : ticket.format === '58mm'
                      ? '58mm Mini Roll · ESC/POS 32 chars'
                      : 'Standard Roll (XP-T80Q) · ESC/POS 42 chars'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPrintPreview(false)}
                style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '8px', cursor: 'pointer', color: '#94a3b8', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* In-Modal Format Quick-Switcher Tabs */}
            <div style={{
              display: 'flex', gap: '6px', background: 'rgba(15,23,42,0.6)',
              padding: '4px', borderRadius: '10px', marginBottom: '16px',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              {(['80mm', '58mm', 'sticker'] as TicketFormat[]).map(fmt => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setTicket(prev => ({ ...prev, format: fmt }))}
                  style={{
                    flex: 1, padding: '6px 8px', borderRadius: '7px', border: 'none',
                    fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                    background: ticket.format === fmt ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'transparent',
                    color: ticket.format === fmt ? '#ffffff' : '#94a3b8',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {fmt === '80mm' ? '🧾 80mm Receipt' : fmt === '58mm' ? '🧾 58mm Compact' : `🏷️ Sticker (${ticket.stickerSize || '50x20'})`}
                </button>
              ))}
            </div>

            {/* Scrollable Preview Stage */}
            <div style={{
              overflowY: 'auto', maxHeight: '56vh', background: '#090d16',
              borderRadius: '12px', padding: '20px 14px', border: '1px solid rgba(255,255,255,0.05)',
              display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
              marginBottom: '16px',
            }}>
              {/* FORMAT 1: 50x20mm (standard), 50x25mm or 50x30mm STICKER */}
              {ticket.format === 'sticker' && (
                ticket.mode === 'free_text' ? (
                  <div style={{
                    width: '320px',
                    height: (ticket.stickerSize || '50x20') === '50x30' ? '192px' : (ticket.stickerSize || '50x20') === '50x25' ? '160px' : '135px',
                    background: '#fffef0',
                    borderRadius: '6px',
                    border: '1.5px dashed #c8b400',
                    padding: '8px 12px',
                    fontFamily: 'ui-monospace, SFMono-Regular, "Courier New", monospace',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    boxSizing: 'border-box',
                  }}>
                    {ticket.showStoreNameOnSticker && (
                      <div style={{ textAlign: 'center', fontWeight: 900, fontSize: '10px', letterSpacing: '0.5px', borderBottom: '1px solid #c8b400', paddingBottom: '2px', marginBottom: '3px', color: '#555', textTransform: 'uppercase' }}>
                        {(storeName || 'PhoneShop Pro').substring(0, 24)}
                      </div>
                    )}
                    <div style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      alignItems: 'center',
                      textAlign: ticket.textAlign || 'center',
                      width: '100%',
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        fontSize: getComputedFontSize(ticket.freeText || '', ticket.fontSize, true),
                        fontWeight: ticket.isBold !== false ? 900 : 500,
                        lineHeight: 1.25,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        color: '#111',
                        width: '100%',
                      }}>
                        {ticket.freeText || '(Empty Blank Sticker)'}
                      </div>
                    </div>
                    {ticket.includeBarcode && ticket.barcodeValue && (
                      <div style={{ borderTop: '1px solid #c8b400', marginTop: '2px', paddingTop: '2px' }}>
                        <BarcodePreview
                          value={ticket.barcodeValue}
                          isQr={ticket.barcodeType === 'qr'}
                          isCompact={true}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{
                    width: '320px',
                    minHeight: (ticket.stickerSize || '50x20') === '50x30' ? '192px' : (ticket.stickerSize || '50x20') === '50x25' ? '160px' : '135px',
                    maxHeight: (ticket.stickerSize || '50x20') === '50x30' ? '240px' : (ticket.stickerSize || '50x20') === '50x25' ? '200px' : '170px',
                    background: '#fffef0',
                    borderRadius: '6px',
                    border: '1.5px dashed #c8b400',
                    padding: '8px 12px',
                    fontFamily: 'ui-monospace, SFMono-Regular, "Courier New", monospace',
                    fontSize: '9.5px',
                    lineHeight: 1.25,
                    color: '#111',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                  }}>
                    {/* Shop name */}
                    <div style={{ textAlign: 'center', fontWeight: 900, fontSize: '11px', letterSpacing: '0.5px', borderBottom: '1.5px solid #333', paddingBottom: '3px', marginBottom: '3px' }}>
                      {(storeName || 'PhoneShop Pro').substring(0, 24)}
                    </div>
                    {/* Device name */}
                    {(ticket.deviceModel || ticket.title) && (
                      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: '10.5px', borderBottom: '1px solid #555', paddingBottom: '2px', marginBottom: '3px' }}>
                        {(ticket.deviceModel || ticket.title || '').substring(0, 24)}
                      </div>
                    )}
                    {/* Spec rows with 2-column paired layout WYSIWYG matching server.js */}
                    {(() => {
                      const mSpecs: { label: string; value: string }[] = [];
                      if (ticket.storage)       mSpecs.push({ label: 'Stockage', value: ticket.storage });
                      if (ticket.ram)           mSpecs.push({ label: 'RAM',      value: ticket.ram });
                      if (ticket.batteryHealth) mSpecs.push({ label: 'Batterie', value: ticket.batteryHealth });
                      if (ticket.condition)     mSpecs.push({ label: 'Etat',     value: ticket.condition });
                      if (ticket.warranty)      mSpecs.push({ label: 'Garantie', value: ticket.warranty });
                      if (ticket.color)         mSpecs.push({ label: 'Couleur',  value: ticket.color });
                      if (ticket.imei)          mSpecs.push({ label: 'IMEI',     value: ticket.imei });
                      ticket.specs.filter(s => s.label && s.value).forEach(s => {
                        mSpecs.push({ label: s.label.substring(0, 10), value: s.value.substring(0, 16) });
                      });

                      const is30mm = ticket.stickerSize === '50x30';
                      const is25mm = ticket.stickerSize === '50x25';
                      const maxSpecRows = is30mm ? 8 : is25mm ? 6 : (ticket.includeBarcode && ticket.barcodeValue ? 3 : 5);

                      if (mSpecs.length <= maxSpecRows) {
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                            {mSpecs.map((s, idx) => (
                              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8.5px' }}>
                                <span style={{ color: '#555' }}>{s.label} :</span>
                                <strong style={{ color: '#000' }}>{s.value}</strong>
                              </div>
                            ))}
                          </div>
                        );
                      }

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                          {Array.from({ length: Math.ceil(mSpecs.length / 2) }).map((_, idx) => {
                            const s1 = mSpecs[idx * 2];
                            const s2 = mSpecs[idx * 2 + 1];
                            return (
                              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '7.5px', lineHeight: 1.15 }}>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '48%' }}>
                                  <span style={{ color: '#555' }}>{s1.label}:</span> <strong>{s1.value}</strong>
                                </span>
                                {s2 && (
                                  <>
                                    <span style={{ color: '#bbb', margin: '0 2px' }}>|</span>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '48%' }}>
                                      <span style={{ color: '#555' }}>{s2.label}:</span> <strong>{s2.value}</strong>
                                    </span>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                    {/* Price */}
                    {ticket.price && (
                      <div style={{ textAlign: 'center', fontWeight: 900, fontSize: '11px', borderTop: '1.5px solid #333', marginTop: '4px', paddingTop: '3px', letterSpacing: '0.5px' }}>
                        PRICE : {(ticket.price || '').replace(/\s*(DA|DZD|USD|EUR|GBP|\$|€|£)\s*$/i, '').trim()} {currencySymbol}
                      </div>
                    )}
                    {/* Barcode / QR */}
                    {ticket.includeBarcode && ticket.barcodeValue && (
                      <div style={{ borderTop: '1px solid #aaa', marginTop: '6px', paddingTop: '4px' }}>
                        <BarcodePreview
                          value={ticket.barcodeValue}
                          isQr={ticket.barcodeType === 'qr'}
                          isCompact={true}
                        />
                      </div>
                    )}
                    {/* Notes */}
                    {ticket.notes && (
                      <div style={{ borderTop: '1px dashed #777', marginTop: '5px', paddingTop: '4px', fontSize: '9px', color: '#333', whiteSpace: 'pre-wrap' }}>
                        {ticket.notes}
                      </div>
                    )}
                  </div>
                )
              )}

              {/* FORMAT 2: 80mm RECEIPT (Standard Roll XP-T80Q) */}
              {ticket.format === '80mm' && (
                <div style={{
                  width: '360px',
                  background: '#ffffff',
                  borderRadius: '4px',
                  padding: '24px 22px 28px',
                  fontFamily: 'ui-monospace, SFMono-Regular, "Courier New", monospace',
                  fontSize: '11.5px',
                  lineHeight: 1.45,
                  color: '#111827',
                  boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
                  position: 'relative',
                }}>
                  {/* Store Header */}
                  {ticket.showStoreHeader && (
                    <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                      <div style={{ fontSize: '16px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {storeName || 'PhoneShop Pro'}
                      </div>
                      <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>
                        Specialized Phone Sales & Services
                      </div>
                      <div style={{ borderTop: '1px dashed #64748b', margin: '8px 0' }} />
                    </div>
                  )}

                  {/* Title & Date */}
                  <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      {ticket.title || '*** SPECIFICATION SLIP ***'}
                    </div>
                    {ticket.subtitle && (
                      <div style={{ fontSize: '11px', color: '#475569', marginTop: '1px' }}>
                        {ticket.subtitle}
                      </div>
                    )}
                    <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>
                      {new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                    </div>
                    <div style={{ borderTop: '1.5px solid #1e293b', margin: '8px 0' }} />
                  </div>

                  {/* Device Model Highlight or Centered Free Text */}
                  {ticket.mode === 'free_text' ? (
                    <div style={{
                      minHeight: '140px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      alignItems: 'center',
                      textAlign: ticket.textAlign || 'center',
                      padding: '24px 12px',
                      borderTop: '1.5px dashed #1e293b',
                      borderBottom: '1.5px dashed #1e293b',
                      margin: '14px 0',
                    }}>
                      <div style={{
                        fontSize: getComputedFontSize(ticket.freeText || '', ticket.fontSize, false),
                        fontWeight: ticket.isBold !== false ? 900 : 500,
                        lineHeight: 1.4,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        color: '#0f172a',
                        width: '100%',
                      }}>
                        {ticket.freeText || '(Empty Blank Slip)'}
                      </div>
                    </div>
                  ) : (
                    <>
                      {ticket.deviceModel && (
                        <div style={{
                          background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px',
                          padding: '8px 10px', textAlign: 'center', marginBottom: '10px',
                        }}>
                          <div style={{ fontSize: '9.5px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, letterSpacing: '0.5px' }}>
                            Device Model
                          </div>
                          <div style={{ fontSize: '14.5px', fontWeight: 900, color: '#0f172a', marginTop: '2px' }}>
                            {ticket.deviceModel}
                          </div>
                        </div>
                      )}

                      {/* Specs Two-Column Rows (42 cols ESC/POS style) */}
                      <div style={{ marginBottom: '10px' }}>
                        <div style={{ fontSize: '10.5px', fontWeight: 800, textTransform: 'uppercase', borderBottom: '1px solid #94a3b8', paddingBottom: '3px', marginBottom: '6px', color: '#334155' }}>
                          Technical Specifications
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          {ticket.condition     && <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '2px' }}><span style={{ color: '#64748b' }}>Condition:</span><span style={{ fontWeight: 700 }}>{ticket.condition}</span></div>}
                          {ticket.storage       && <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '2px' }}><span style={{ color: '#64748b' }}>Storage:</span><span style={{ fontWeight: 700 }}>{ticket.storage}</span></div>}
                          {ticket.ram           && <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '2px' }}><span style={{ color: '#64748b' }}>RAM:</span><span style={{ fontWeight: 700 }}>{ticket.ram}</span></div>}
                          {ticket.color         && <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '2px' }}><span style={{ color: '#64748b' }}>Color:</span><span style={{ fontWeight: 700 }}>{ticket.color}</span></div>}
                          {ticket.batteryHealth && <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '2px' }}><span style={{ color: '#64748b' }}>Battery:</span><span style={{ fontWeight: 700 }}>{ticket.batteryHealth}</span></div>}
                          {ticket.warranty      && <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '2px' }}><span style={{ color: '#64748b' }}>Warranty:</span><span style={{ fontWeight: 700 }}>{ticket.warranty}</span></div>}
                          {ticket.imei          && <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '2px' }}><span style={{ color: '#64748b' }}>IMEI/SN:</span><span style={{ fontWeight: 700 }}>{ticket.imei}</span></div>}
                          {ticket.specs.filter(s => s.label && s.value).map(s => (
                            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '2px' }}>
                              <span style={{ color: '#64748b' }}>{s.label.endsWith(':') ? s.label : `${s.label}:`}</span>
                              <span style={{ fontWeight: 700 }}>{s.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Price Banner */}
                      {ticket.price && (
                        <div style={{
                          border: '1.5px solid #0f172a', borderRadius: '6px',
                          padding: '8px 12px', margin: '10px 0',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          background: '#f8fafc',
                        }}>
                          <span style={{ fontSize: '12px', fontWeight: 800 }}>PRICE:</span>
                          <span style={{ fontSize: '16px', fontWeight: 900, color: '#0f172a' }}>
                            {ticket.price} {currencySymbol}
                          </span>
                        </div>
                      )}

                      {/* Notes */}
                      {ticket.notes && (
                        <div style={{ borderTop: '1px dashed #94a3b8', paddingTop: '6px', marginTop: '10px' }}>
                          <div style={{ fontSize: '9.5px', fontWeight: 800, textTransform: 'uppercase', color: '#475569', marginBottom: '2px' }}>
                            Notes & Observations:
                          </div>
                          <div style={{ fontSize: '10.5px', color: '#1e293b', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                            {ticket.notes}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Barcode / QR */}
                  {ticket.includeBarcode && ticket.barcodeValue && (
                    <div style={{ borderTop: '1px dashed #94a3b8', marginTop: '10px', paddingTop: '6px', textAlign: 'center' }}>
                      <BarcodePreview
                        value={ticket.barcodeValue}
                        isQr={ticket.barcodeType === 'qr'}
                        isCompact={false}
                      />
                    </div>
                  )}

                  {/* Footer */}
                  {ticket.showStoreFooter && (
                    <div style={{ borderTop: '1px dashed #94a3b8', marginTop: '10px', paddingTop: '6px', textAlign: 'center', fontSize: '10px', color: '#64748b' }}>
                      {ticket.customFooter || 'Thank you for choosing PhoneShop Pro!'}
                    </div>
                  )}

                  {/* Perforated cut line at bottom */}
                  <div style={{
                    marginTop: '16px', borderTop: '1px dashed #cbd5e1', paddingTop: '6px',
                    textAlign: 'center', fontSize: '9px', color: '#94a3b8', letterSpacing: '1px',
                  }}>
                    ✂ ---------------------------------------- ✂
                  </div>
                </div>
              )}

              {/* FORMAT 3: 58mm COMPACT (Mini Roll) */}
              {ticket.format === '58mm' && (
                <div style={{
                  width: '270px',
                  background: '#ffffff',
                  borderRadius: '4px',
                  padding: '18px 16px 22px',
                  fontFamily: 'ui-monospace, SFMono-Regular, "Courier New", monospace',
                  fontSize: '10.5px',
                  lineHeight: 1.4,
                  color: '#111827',
                  boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
                }}>
                  {/* Store Header */}
                  {ticket.showStoreHeader && (
                    <div style={{ textAlign: 'center', marginBottom: '6px' }}>
                      <div style={{ fontSize: '14px', fontWeight: 900, textTransform: 'uppercase' }}>
                        {storeName || 'PhoneShop Pro'}
                      </div>
                      <div style={{ borderTop: '1px dashed #64748b', margin: '6px 0' }} />
                    </div>
                  )}

                  {/* Title & Date */}
                  <div style={{ textAlign: 'center', marginBottom: '6px' }}>
                    <div style={{ fontSize: '11.5px', fontWeight: 800, textTransform: 'uppercase' }}>
                      {ticket.title || 'SPECIFICATION SLIP'}
                    </div>
                    {ticket.subtitle && (
                      <div style={{ fontSize: '9.5px', color: '#475569', marginTop: '1px' }}>
                        {ticket.subtitle}
                      </div>
                    )}
                    <div style={{ fontSize: '9px', color: '#64748b', marginTop: '1px' }}>
                      {new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </div>
                    <div style={{ borderTop: '1.5px solid #1e293b', margin: '6px 0' }} />
                  </div>

                  {/* Device Model Highlight or Centered Free Text */}
                  {ticket.mode === 'free_text' ? (
                    <div style={{
                      minHeight: '100px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      alignItems: 'center',
                      textAlign: ticket.textAlign || 'center',
                      padding: '16px 8px',
                      borderTop: '1.5px dashed #1e293b',
                      borderBottom: '1.5px dashed #1e293b',
                      margin: '10px 0',
                    }}>
                      <div style={{
                        fontSize: getComputedFontSize(ticket.freeText || '', ticket.fontSize, false),
                        fontWeight: ticket.isBold !== false ? 900 : 500,
                        lineHeight: 1.35,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        color: '#0f172a',
                        width: '100%',
                      }}>
                        {ticket.freeText || '(Empty Blank Slip)'}
                      </div>
                    </div>
                  ) : (
                    <>
                      {ticket.deviceModel && (
                        <div style={{
                          background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px',
                          padding: '6px 8px', textAlign: 'center', marginBottom: '8px',
                        }}>
                          <div style={{ fontSize: '12.5px', fontWeight: 900, color: '#0f172a' }}>
                            {ticket.deviceModel}
                          </div>
                        </div>
                      )}

                      {/* Specs Two-Column Rows (32 cols ESC/POS style) */}
                      <div style={{ marginBottom: '8px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5px', fontSize: '10px' }}>
                          {ticket.condition     && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Cond:</span><span style={{ fontWeight: 700 }}>{ticket.condition}</span></div>}
                          {ticket.storage       && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Storage:</span><span style={{ fontWeight: 700 }}>{ticket.storage}</span></div>}
                          {ticket.ram           && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>RAM:</span><span style={{ fontWeight: 700 }}>{ticket.ram}</span></div>}
                          {ticket.color         && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Color:</span><span style={{ fontWeight: 700 }}>{ticket.color}</span></div>}
                          {ticket.batteryHealth && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Battery:</span><span style={{ fontWeight: 700 }}>{ticket.batteryHealth}</span></div>}
                          {ticket.warranty      && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Warranty:</span><span style={{ fontWeight: 700 }}>{ticket.warranty}</span></div>}
                          {ticket.imei          && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>IMEI/SN:</span><span style={{ fontWeight: 700 }}>{ticket.imei}</span></div>}
                          {ticket.specs.filter(s => s.label && s.value).map(s => (
                            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: '#64748b' }}>{s.label.substring(0, 10)}:</span>
                              <span style={{ fontWeight: 700 }}>{s.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Price */}
                      {ticket.price && (
                        <div style={{
                          border: '1px solid #0f172a', borderRadius: '4px',
                          padding: '6px 8px', margin: '8px 0',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          background: '#f8fafc',
                        }}>
                          <span style={{ fontSize: '11px', fontWeight: 800 }}>PRICE:</span>
                          <span style={{ fontSize: '14px', fontWeight: 900, color: '#0f172a' }}>
                            {ticket.price} {currencySymbol}
                          </span>
                        </div>
                      )}

                      {/* Notes */}
                      {ticket.notes && (
                        <div style={{ borderTop: '1px dashed #94a3b8', paddingTop: '4px', marginTop: '6px', fontSize: '9.5px', color: '#1e293b', whiteSpace: 'pre-wrap' }}>
                          {ticket.notes}
                        </div>
                      )}
                    </>
                  )}

                  {/* Barcode / QR */}
                  {ticket.includeBarcode && ticket.barcodeValue && (
                    <div style={{ borderTop: '1px dashed #94a3b8', marginTop: '6px', paddingTop: '4px', textAlign: 'center' }}>
                      <BarcodePreview
                        value={ticket.barcodeValue}
                        isQr={ticket.barcodeType === 'qr'}
                        isCompact={true}
                      />
                    </div>
                  )}

                  {/* Footer */}
                  {ticket.showStoreFooter && (
                    <div style={{ borderTop: '1px dashed #94a3b8', marginTop: '8px', paddingTop: '4px', textAlign: 'center', fontSize: '9px', color: '#64748b' }}>
                      {ticket.customFooter || 'Thank you!'}
                    </div>
                  )}

                  {/* Perforated cut line at bottom */}
                  <div style={{
                    marginTop: '12px', borderTop: '1px dashed #cbd5e1', paddingTop: '4px',
                    textAlign: 'center', fontSize: '8.5px', color: '#94a3b8', letterSpacing: '1px',
                  }}>
                    ✂ --------------------------- ✂
                  </div>
                </div>
              )}
            </div>

            {/* Modal Actions Footer */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'center' }}>
                {isOnline
                  ? (ticket.format === 'sticker'
                    ? `🏷️ ${labelPrinter || 'Xprinter_XP_420B'} (TSPL)`
                    : `🖨️ ${printer || 'Printer_POS_80'} (ESC/POS)`)
                  : '🟡 Print server offline — Use "Print via Browser" below'}
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowPrintPreview(false)}
                  style={{
                    padding: '9px 16px', borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)',
                    color: '#94a3b8', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBrowserPrint}
                  style={{
                    padding: '9px 16px', borderRadius: '10px',
                    border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(255,255,255,0.06)',
                    color: '#a5b4fc', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  }}
                  title="Print using your browser's built-in print dialog (works without print server)"
                >
                  <FileText size={14} />
                  Browser / PDF
                </button>
                <button
                  type="button"
                  onClick={handleConfirmPrint}
                  disabled={isPrinting || !isOnline}
                  style={{
                    padding: '9px 20px', borderRadius: '10px',
                    border: 'none', background: isOnline ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : '#475569',
                    color: '#fff', fontWeight: 700, fontSize: '13px',
                    cursor: isOnline ? 'pointer' : 'not-allowed',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    opacity: isPrinting || !isOnline ? 0.6 : 1,
                    boxShadow: isOnline ? '0 4px 14px rgba(99,102,241,0.4)' : 'none',
                  }}
                  title={isOnline ? 'Print directly via thermal/label print server' : 'Print server must be running for direct printing'}
                >
                  <Printer size={16} />
                  {isPrinting ? 'Printing...' : !isOnline ? 'Server Offline' : `Direct Print ${ticket.copies || 1} Cop${(ticket.copies || 1) > 1 ? 'ies' : 'y'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save Template Modal (Problem 2) */}
      <Modal
        isOpen={isSaveTemplateModalOpen}
        onClose={() => setIsSaveTemplateModalOpen(false)}
        title="Save Current Ticket as Template"
        maxWidth="440px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
          <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
            Save your current specifications, notes, paper format, and layout settings to quickly re-use them for future devices or inventory slips.
          </p>
          <div>
            <label className={styles.label} style={{ marginBottom: '6px', display: 'block' }}>
              Template Name:
            </label>
            <input
              type="text"
              className={styles.input}
              placeholder="e.g. Screen Replacement 3-Mo Warranty"
              value={newTemplateName}
              onChange={e => setNewTemplateName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveAsTemplate();
              }}
              autoFocus
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
            <Button variant="ghost" onClick={() => setIsSaveTemplateModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveAsTemplate} leftIcon={<Save size={14} />}>
              Save Template
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
