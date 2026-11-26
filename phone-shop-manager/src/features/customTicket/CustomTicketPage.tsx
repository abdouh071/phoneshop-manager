import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Printer,
  FileText,
  Smartphone,
  Trash2,
  RotateCcw,
  Keyboard,
  Bookmark,
  Type,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useSettingsStore } from '../../store/settingsStore';
import { useInventoryStore } from '../../store/inventoryStore';
import { usePrinterStatus } from '../../hooks/usePrinterStatus';
import { useToast } from '../../components/ui/Toast';
import { getCurrencySymbol } from '../../utils/formatCurrency';
import { buildCustomTicketHTML } from './customTicketTemplate';
import { printCustomTicketDirect, calibrateLabelPrinter, openPrintWindow } from '../../utils/printWindow';
import { computeFreeTextStickerLayout } from '../../utils/customLabelWrap';
import type { CustomTicketData, TicketPrintMode } from './customTicketTypes';
import type { PhoneModel } from '../../types';
import styles from './CustomTicket.module.css';
import { errorMessage } from '../../utils/errorUtils';
import { searchAndRank } from '../../utils/searchUtils';
import { PRESET_TEMPLATES } from './presetTemplates';
import type { UserTemplate } from './ticketPrintTypes';
import { DeviceDetailsCard } from './DeviceDetailsCard';
import { InventoryPickerModal } from './InventoryPickerModal';
import { LivePreviewPanel } from './LivePreviewPanel';
import { NotesBarcodeCard } from './NotesBarcodeCard';
import { SaveTemplateModal } from './SaveTemplateModal';
import { SlipHeaderCard } from './SlipHeaderCard';
import { SpecLinesCard } from './SpecLinesCard';
import { StickerTextInputCard } from './StickerTextInputCard';
import { StickerTypographyCard } from './StickerTypographyCard';
import { UniversalPrintPreviewModal } from './UniversalPrintPreviewModal';
import { GiantTextTicketDesigner } from './GiantTextTicketDesigner';

export const CustomTicketPage: React.FC = () => {
  const { storeName, currency } = useSettingsStore();
  const currencySymbol = getCurrencySymbol(currency);
  const { products, fetchProducts } = useInventoryStore();
  const { isOnline, printer, labelPrinter } = usePrinterStatus();
  const toast = useToast();

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Mode: specs (detailed slip) vs free_text (blank centered sticker) vs quick_big (write & print box label)
  const [activeMode, setActiveMode] = useState<TicketPrintMode | 'quick_big'>('specs');

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
    } catch (err: unknown) {
      toast.error('Calibration Error', errorMessage(err) || 'Could not communicate with the print server.');
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

  // Blank sticker height overflow warning calculation aligned with printer wrap & TSPL metrics
  const blankStickerOverflowWarning = useMemo(() => {
    if (ticket.format !== 'sticker' || ticket.mode !== 'free_text') return null;
    const layout = computeFreeTextStickerLayout(ticket, storeName);
    if (!layout.isOverflow) return null;
    const nonEmptyCount = layout.wrappedLines.filter(l => l.length > 0).length;
    return {
      isOverflow: true,
      lineCount: Math.max(nonEmptyCount, layout.wrappedLines.length),
      clippedLines: layout.clippedLines,
      maxEstimatedLines: layout.maxLines,
      stickerSize: layout.stickerSize,
    };
  }, [
    ticket.format,
    ticket.mode,
    ticket.freeText,
    ticket.stickerSize,
    ticket.fontSize,
    ticket.showStoreNameOnSticker,
    ticket.includeBarcode,
    ticket.barcodeValue,
    ticket.barcodeType,
    storeName,
  ]);

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
    return searchAndRank(
      products, inventorySearch, p =>
        [p.name, p.model, p.sku, p.storage, p.color].filter(Boolean) as string[]
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
        if (result.warning) {
          toast.warning('Printed, with text cut off', result.warning);
        } else {
          toast.success(
            'Printed Successfully! 🖨️',
            `Sent ${ticket.copies || 1} cop${(ticket.copies || 1) > 1 ? 'ies' : 'y'} directly to ${destPrinter} via Print Server.`
          );
        }
      } else {
        toast.error('Print Server Error', result.error || 'Failed to print ticket via print server.');
      }
    } catch (err: unknown) {
      console.error('[Print Error]', err);
      toast.error('Print Server Error', errorMessage(err) || 'Could not communicate with the print server.');
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

        <button
          type="button"
          className={[styles.modeTab, activeMode === 'quick_big' && styles.modeTabActive].filter(Boolean).join(' ')}
          onClick={() => setActiveMode('quick_big')}
        >
          <Type size={16} />
          <span>Big Box Label (Write & Print)</span>
          <span className={styles.centerBadge}>Giant Text</span>
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
        {activeMode === 'quick_big' ? (
          <GiantTextTicketDesigner
            storeName={storeName}
            currencySymbol={currencySymbol}
            labelPrinter={labelPrinter}
          />
        ) : (
          <>
            {/* Left: Input Form Controls */}
            <div className={styles.formSection}>
              {activeMode === 'free_text' ? (
                <>
                  {/* Card 1: Keyboard Typing Studio */}
                  <StickerTextInputCard
                    ticket={ticket}
                    setTicket={setTicket}
                    blankStickerOverflowWarning={blankStickerOverflowWarning}
                  />

                  {/* Card 2: Typography & Formatting */}
                  <StickerTypographyCard
                    ticket={ticket}
                    setTicket={setTicket}
                    storeName={storeName}
                  />
                </>
              ) : (
                <>
                  {/* Card 1: Ticket Header & Formatting */}
                  <SlipHeaderCard
                    ticket={ticket}
                    setTicket={setTicket}
                  />

                  {/* Card 2: Core Device Specifications */}
                  <DeviceDetailsCard
                    ticket={ticket}
                    setTicket={setTicket}
                    currencySymbol={currencySymbol}
                    setIsInventoryModalOpen={setIsInventoryModalOpen}
                  />

                  {/* Card 3: Custom Key-Value Spec Lines */}
                  <SpecLinesCard
                    ticket={ticket}
                    handleAddSpec={handleAddSpec}
                    handleUpdateSpec={handleUpdateSpec}
                    handleRemoveSpec={handleRemoveSpec}
                  />

                  {/* Card 4: Free-form Notes & Barcode */}
                  <NotesBarcodeCard
                    ticket={ticket}
                    setTicket={setTicket}
                  />
                </>
              )}
            </div>

            {/* Right: Live Visual Slip Preview & Print Cockpit */}
            <LivePreviewPanel
              ticket={ticket}
              setTicket={setTicket}
              storeName={storeName}
              currencySymbol={currencySymbol}
              livePreviewHtml={livePreviewHtml}
              isOnline={isOnline}
              printer={printer}
              labelPrinter={labelPrinter}
              isPrinting={isPrinting}
              isCalibrating={isCalibrating}
              handleCalibrateSensor={handleCalibrateSensor}
              handlePrintAction={handlePrintAction}
              handleSelectPreset={handleSelectPreset}
              toast={toast}
            />
          </>
        )}
      </div>

      {/* Inventory Search & Auto-Fill Modal */}
      <InventoryPickerModal
        isInventoryModalOpen={isInventoryModalOpen}
        setIsInventoryModalOpen={setIsInventoryModalOpen}
        inventorySearch={inventorySearch}
        setInventorySearch={setInventorySearch}
        filteredProducts={filteredProducts}
        handleSelectInventoryProduct={handleSelectInventoryProduct}
        currencySymbol={currencySymbol}
      />

      {/* ── Universal Print Preview Modal (80mm, 58mm, Sticker) ─────────────── */}
      {showPrintPreview && (
        <UniversalPrintPreviewModal
          ticket={ticket}
          setTicket={setTicket}
          storeName={storeName}
          currencySymbol={currencySymbol}
          isOnline={isOnline}
          printer={printer}
          labelPrinter={labelPrinter}
          isPrinting={isPrinting}
          blankStickerOverflowWarning={blankStickerOverflowWarning}
          setShowPrintPreview={setShowPrintPreview}
          handleBrowserPrint={handleBrowserPrint}
          handleConfirmPrint={handleConfirmPrint}
        />
      )}

      {/* Save Template Modal (Problem 2) */}
      <SaveTemplateModal
        isSaveTemplateModalOpen={isSaveTemplateModalOpen}
        setIsSaveTemplateModalOpen={setIsSaveTemplateModalOpen}
        newTemplateName={newTemplateName}
        setNewTemplateName={setNewTemplateName}
        handleSaveAsTemplate={handleSaveAsTemplate}
      />
    </div>
  );
};
