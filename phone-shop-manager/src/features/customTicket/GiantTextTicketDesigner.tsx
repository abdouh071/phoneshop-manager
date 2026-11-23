import React, { useState, useRef, useMemo, useCallback } from 'react';
import {
  Printer,
  Download,
  RotateCcw,
  Sparkles,
  Maximize2,
  Sliders,
  Type,
  Layout,
  Layers,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from 'lucide-react';
import { printBigBoxLabelDirect } from '../../utils/printWindow';
import { useToast } from '../../components/ui/Toast';
import styles from './GiantTextTicketDesigner.module.css';

export interface GiantTextTicketDesignerProps {
  storeName?: string;
  currencySymbol?: string;
  labelPrinter?: string | null;
}

export type LabelSizePreset =
  | '50x30'
  | '50x20'
  | '50x25'
  | '40x30'
  | '60x40'
  | '100x150'
  | 'custom';

export type TextWeight = 'normal' | 'bold' | '900';
export type TextAlign = 'left' | 'center' | 'right';
export type BorderStyle = 'none' | 'thin' | 'thick' | 'double' | 'dashed';
export type FontFamily = 'Impact' | 'Arial Black' | 'Bebas Neue, sans-serif' | 'system-ui, sans-serif' | 'Courier New, monospace';

interface PresetTemplate {
  id: string;
  label: string;
  headline: string;
  headlineSize: number;
  subtitle: string;
  subtitleSize: number;
  showSubtitle: boolean;
  extraText: string;
  extraSize: number;
  showExtra: boolean;
  isExtraBadge: boolean;
  fontFamily: FontFamily;
  weight: TextWeight;
  borderStyle: BorderStyle;
  align: TextAlign;
  sizePreset: LabelSizePreset;
}

const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    id: 'huge_word',
    label: '🔥 Huge Single Word',
    headline: 'PROMO',
    headlineSize: 64,
    subtitle: '',
    subtitleSize: 20,
    showSubtitle: false,
    extraText: '',
    extraSize: 18,
    showExtra: false,
    isExtraBadge: false,
    fontFamily: 'Impact',
    weight: '900',
    borderStyle: 'thick',
    align: 'center',
    sizePreset: '50x30',
  },
  {
    id: 'product_name',
    label: '📱 Product Name',
    headline: 'IPHONE 15 PRO',
    headlineSize: 34,
    subtitle: '128GB • 100% BATTERIE',
    subtitleSize: 16,
    showSubtitle: true,
    extraText: 'GARANTIE 3 MOIS',
    extraSize: 14,
    showExtra: true,
    isExtraBadge: false,
    fontFamily: 'Arial Black',
    weight: 'bold',
    borderStyle: 'thin',
    align: 'center',
    sizePreset: '50x30',
  },
  {
    id: 'promo_price',
    label: '💰 Promotional Price',
    headline: '1 500 DA',
    headlineSize: 52,
    subtitle: 'PRIX CHOC MAGASIN',
    subtitleSize: 14,
    showSubtitle: true,
    extraText: '',
    extraSize: 14,
    showExtra: false,
    isExtraBadge: false,
    fontFamily: 'Impact',
    weight: '900',
    borderStyle: 'double',
    align: 'center',
    sizePreset: '50x30',
  },
  {
    id: 'sale_discount',
    label: '🏷️ SALE / DISCOUNT',
    headline: 'SOLDES',
    headlineSize: 42,
    subtitle: 'SUR TOUS LES ACCESSOIRES',
    subtitleSize: 13,
    showSubtitle: true,
    extraText: '-50% REMISE',
    extraSize: 18,
    showExtra: true,
    isExtraBadge: true,
    fontFamily: 'Impact',
    weight: '900',
    borderStyle: 'thick',
    align: 'center',
    sizePreset: '50x30',
  },
  {
    id: 'two_line_headline',
    label: '⚡ Two-Line Headline',
    headline: 'FLASH SALE',
    headlineSize: 36,
    subtitle: 'AUJOURD\'HUI SEULEMENT',
    subtitleSize: 18,
    showSubtitle: true,
    extraText: '',
    extraSize: 14,
    showExtra: false,
    isExtraBadge: false,
    fontFamily: 'Bebas Neue, sans-serif',
    weight: '900',
    borderStyle: 'thin',
    align: 'center',
    sizePreset: '50x30',
  },
  {
    id: 'price_subtitle',
    label: '🛠️ Price with Subtitle',
    headline: '2 500 DA',
    headlineSize: 46,
    subtitle: 'Écran Original + Pose Offerte',
    subtitleSize: 14,
    showSubtitle: true,
    extraText: 'TEST TECHNIQUE INCLUS',
    extraSize: 12,
    showExtra: true,
    isExtraBadge: false,
    fontFamily: 'Arial Black',
    weight: 'bold',
    borderStyle: 'dashed',
    align: 'center',
    sizePreset: '50x30',
  },
];

export const GiantTextTicketDesigner: React.FC<GiantTextTicketDesignerProps> = ({
  storeName,
  currencySymbol = 'DA',
  labelPrinter,
}) => {
  const toast = useToast();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Dimension & Orientation State
  const [sizePreset, setSizePreset] = useState<LabelSizePreset>('50x30');
  const [customWidthMm, setCustomWidthMm] = useState<number>(50);
  const [customHeightMm, setCustomHeightMm] = useState<number>(30);
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');

  // Text Lines State
  const [headline, setHeadline] = useState<string>('PROMO');
  const [headlineSize, setHeadlineSize] = useState<number>(56);
  const [headlineWeight, setHeadlineWeight] = useState<TextWeight>('900');

  const [showSubtitle, setShowSubtitle] = useState<boolean>(true);
  const [subtitle, setSubtitle] = useState<string>('PRIX EXCEPTIONNEL');
  const [subtitleSize, setSubtitleSize] = useState<number>(18);
  const [subtitleWeight, setSubtitleWeight] = useState<TextWeight>('bold');

  const [showExtra, setShowExtra] = useState<boolean>(false);
  const [extraText, setExtraText] = useState<string>('-50%');
  const [extraSize, setExtraSize] = useState<number>(20);
  const [isExtraBadge, setIsExtraBadge] = useState<boolean>(false);

  // Typography & Styling State
  const [fontFamily, setFontFamily] = useState<FontFamily>('Impact');
  const [textAlign, setTextAlign] = useState<TextAlign>('center');
  const [letterSpacing, setLetterSpacing] = useState<number>(1);
  const [lineSpacing, setLineSpacing] = useState<number>(6);
  const [borderStyle, setBorderStyle] = useState<BorderStyle>('thick');
  const [paddingMm, setPaddingMm] = useState<number>(2);

  // Execution State
  const [copies, setCopies] = useState<number>(1);
  const [isPrinting, setIsPrinting] = useState<boolean>(false);
  const [zoomLevel, setZoomLevel] = useState<number>(1); // 1 = 100%, 1.25, 1.5, etc.
  const [activePresetId, setActivePresetId] = useState<string>('huge_word');

  // Compute physical dimensions in mm based on size preset and orientation
  const { widthMm, heightMm } = useMemo(() => {
    let w = 50;
    let h = 30;

    switch (sizePreset) {
      case '50x30': w = 50; h = 30; break;
      case '50x20': w = 50; h = 20; break;
      case '50x25': w = 50; h = 25; break;
      case '40x30': w = 40; h = 30; break;
      case '60x40': w = 60; h = 40; break;
      case '100x150': w = 100; h = 150; break;
      case 'custom':
        w = Math.max(10, Math.min(150, customWidthMm || 50));
        h = Math.max(10, Math.min(200, customHeightMm || 30));
        break;
      default: w = 50; h = 30;
    }

    if (orientation === 'portrait') {
      return { widthMm: Math.min(w, h), heightMm: Math.max(w, h) };
    }
    return { widthMm: Math.max(w, h), heightMm: Math.min(w, h) };
  }, [sizePreset, customWidthMm, customHeightMm, orientation]);

  // Dots calculation at 203 DPI (8 dots per mm)
  const dotsW = Math.round(widthMm * 8);
  const dotsH = Math.round(heightMm * 8);

  // Auto-fit headline text into printable area
  const handleAutoFit = useCallback(() => {
    if (!headline.trim()) return;
    const padDots = Math.round(paddingMm * 8);
    const availW = dotsW - padDots * 2 - (borderStyle !== 'none' ? 16 : 0);
    const availH = dotsH - padDots * 2 - (borderStyle !== 'none' ? 16 : 0);

    // Rough character width heuristic: Impact/Arial Black glyph is ~0.65 of font size
    const charCount = Math.max(1, headline.length);
    let targetSize = Math.floor(availW / (charCount * 0.65));

    // Factor in presence of subtitle / extra text
    let heightShare = availH * 0.85;
    if (showSubtitle && subtitle.trim()) heightShare *= 0.6;
    if (showExtra && extraText.trim()) heightShare *= 0.7;

    targetSize = Math.min(targetSize, Math.floor(heightShare));
    targetSize = Math.max(18, Math.min(130, targetSize));

    setHeadlineSize(targetSize);
    toast.success('Auto-Fitted', `Headline scaled to ${targetSize}pt to fill label.`);
  }, [headline, paddingMm, dotsW, dotsH, borderStyle, showSubtitle, subtitle, showExtra, extraText, toast]);

  // Apply a preset
  const handleApplyPreset = (preset: PresetTemplate) => {
    setActivePresetId(preset.id);
    setHeadline(preset.headline);
    setHeadlineSize(preset.headlineSize);
    setHeadlineWeight(preset.weight);
    setSubtitle(preset.subtitle);
    setSubtitleSize(preset.subtitleSize);
    setShowSubtitle(preset.showSubtitle);
    setExtraText(preset.extraText);
    setExtraSize(preset.extraSize);
    setShowExtra(preset.showExtra);
    setIsExtraBadge(preset.isExtraBadge);
    setFontFamily(preset.fontFamily);
    setBorderStyle(preset.borderStyle);
    setTextAlign(preset.align);
    setSizePreset(preset.sizePreset);
    toast.info('Template Applied', `Loaded "${preset.label}"`);
  };

  // Reset to clean blank
  const handleReset = () => {
    setHeadline('');
    setSubtitle('');
    setShowSubtitle(false);
    setExtraText('');
    setShowExtra(false);
    setHeadlineSize(48);
    setBorderStyle('none');
    toast.info('Reset', 'Ticket cleared to blank.');
  };

  // Build TSPL command stream for direct hardware printing on XP-420B
  const generateTSPL = (): string => {
    let tspl = '';
    tspl += `SIZE ${widthMm} mm, ${heightMm} mm\r\n`;
    tspl += 'GAP 2 mm, 0 mm\r\n';
    tspl += 'REFERENCE 0,0\r\n';
    tspl += `DIRECTION ${orientation === 'portrait' ? '0' : '1'}\r\n`;
    tspl += 'CLS\r\n';

    // Border commands
    if (borderStyle === 'thin') {
      tspl += `BOX 4,4,${dotsW - 4},${dotsH - 4},2\r\n`;
    } else if (borderStyle === 'thick') {
      tspl += `BOX 6,6,${dotsW - 6},${dotsH - 6},5\r\n`;
    } else if (borderStyle === 'double') {
      tspl += `BOX 4,4,${dotsW - 4},${dotsH - 4},2\r\n`;
      tspl += `BOX 10,10,${dotsW - 10},${dotsH - 10},2\r\n`;
    } else if (borderStyle === 'dashed') {
      tspl += `BOX 4,4,${dotsW - 4},${dotsH - 4},2\r\n`;
    }

    const padDots = Math.round(paddingMm * 8);

    // Collect active lines
    interface RenderLine {
      text: string;
      size: number;
      weight: TextWeight;
      isBadge: boolean;
    }
    const linesToPrint: RenderLine[] = [];
    if (headline.trim()) {
      linesToPrint.push({ text: headline.trim(), size: headlineSize, weight: headlineWeight, isBadge: false });
    }
    if (showSubtitle && subtitle.trim()) {
      linesToPrint.push({ text: subtitle.trim(), size: subtitleSize, weight: subtitleWeight, isBadge: false });
    }
    if (showExtra && extraText.trim()) {
      linesToPrint.push({ text: extraText.trim(), size: extraSize, weight: 'bold', isBadge: isExtraBadge });
    }

    // Map font sizes to TSPL native fonts and multipliers
    // TSPL fonts: "1" (8x12), "2" (12x20 / 16x20), "3" (16x24), "4" (24x32), "5" (32x48)
    const lineMetrics = linesToPrint.map(line => {
      let font = '2';
      let mul = 1;

      if (line.size >= 52) {
        font = '5';
        mul = Math.min(4, Math.floor(line.size / 24));
      } else if (line.size >= 36) {
        font = '4';
        mul = Math.min(3, Math.floor(line.size / 20));
      } else if (line.size >= 24) {
        font = '3';
        mul = Math.min(2, Math.floor(line.size / 16));
      } else if (line.size >= 16) {
        font = '2';
        mul = 1;
      } else {
        font = '1';
        mul = 1;
      }

      const baseH = font === '5' ? 48 : font === '4' ? 32 : font === '3' ? 24 : font === '2' ? 20 : 12;
      const baseW = font === '5' ? 32 : font === '4' ? 24 : font === '3' ? 16 : font === '2' ? 16 : 10;
      const height = baseH * mul;
      const width = line.text.length * baseW * mul;

      return { line, font, mul, height, width, baseW, baseH };
    });

    const totalLinesHeight = lineMetrics.reduce((sum, m) => sum + m.height + lineSpacing, 0) - lineSpacing;
    let currentY = Math.max(padDots, Math.floor((dotsH - totalLinesHeight) / 2));

    for (const m of lineMetrics) {
      let x = padDots + 6;
      if (textAlign === 'right') {
        x = Math.max(padDots + 6, dotsW - m.width - padDots - 6);
      } else if (textAlign === 'center') {
        x = Math.max(padDots + 6, Math.floor((dotsW - m.width) / 2));
      }

      // Safe clean text
      const clean = m.line.text.replace(/["\\]/g, '').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '');

      // Optional inverted badge
      if (m.line.isBadge) {
        const badgeW = m.width + 16;
        const badgeH = m.height + 8;
        const bX = Math.max(0, x - 8);
        const bY = Math.max(0, currentY - 4);
        tspl += `BAR ${bX},${bY},${badgeW},${badgeH}\r\n`;
        tspl += `REVERSE ${bX},${bY},${badgeW},${badgeH}\r\n`;
      }

      tspl += `TEXT ${x},${currentY},"${m.font}",0,${m.mul},${m.mul},"${clean}"\r\n`;
      currentY += m.height + lineSpacing;
    }

    tspl += `PRINT ${copies},1\r\n`;
    tspl += 'CLS\r\n';

    return tspl;
  };

  // Handle direct hardware print via print server
  const handleDirectPrint = async () => {
    if (!headline.trim() && !subtitle.trim() && !extraText.trim()) {
      toast.warning('Empty Label', 'Type some text before printing.');
      return;
    }

    setIsPrinting(true);
    try {
      const tsplStream = generateTSPL();
      const payload = {
        tspl: tsplStream,
        copies,
        widthMm,
        heightMm,
        orientation,
        borderStyle,
        paddingMm,
        textAlign,
        text: headline, // fallback
      };

      const result = await printBigBoxLabelDirect(payload);
      if (result.method === 'direct') {
        toast.success(
          'Label Printed!',
          `Sent ${copies} copy(s) to ${labelPrinter || 'Xprinter XP-420B'}.`
        );
      } else if (result.error) {
        toast.error('Print Error', result.error);
      }
    } catch (err: unknown) {
      console.error('[GiantTextDesigner Print Error]', err);
      const msg = err instanceof Error ? err.message : 'Print server communication failed.';
      toast.error('Print Server Error', msg);
    } finally {
      setIsPrinting(false);
    }
  };

  // Export as high-resolution 203 DPI PNG
  const handleExportPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas dimensions to physical 203 DPI dots
    canvas.width = dotsW;
    canvas.height = dotsH;

    // 1. Pure white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dotsW, dotsH);

    // 2. Border
    ctx.strokeStyle = '#000000';
    if (borderStyle === 'thin') {
      ctx.lineWidth = 2;
      ctx.strokeRect(4, 4, dotsW - 8, dotsH - 8);
    } else if (borderStyle === 'thick') {
      ctx.lineWidth = 6;
      ctx.strokeRect(6, 6, dotsW - 12, dotsH - 12);
    } else if (borderStyle === 'double') {
      ctx.lineWidth = 2;
      ctx.strokeRect(4, 4, dotsW - 8, dotsH - 8);
      ctx.strokeRect(10, 10, dotsW - 20, dotsH - 20);
    } else if (borderStyle === 'dashed') {
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(4, 4, dotsW - 8, dotsH - 8);
      ctx.setLineDash([]);
    }

    // 3. Render lines
    ctx.fillStyle = '#000000';
    ctx.textAlign = textAlign;
    ctx.textBaseline = 'middle';

    const activeLines: { text: string; size: number; weight: string; isBadge: boolean }[] = [];
    if (headline.trim()) activeLines.push({ text: headline.trim(), size: headlineSize, weight: headlineWeight, isBadge: false });
    if (showSubtitle && subtitle.trim()) activeLines.push({ text: subtitle.trim(), size: subtitleSize, weight: subtitleWeight, isBadge: false });
    if (showExtra && extraText.trim()) activeLines.push({ text: extraText.trim(), size: extraSize, weight: 'bold', isBadge: isExtraBadge });

    const totalHeight = activeLines.reduce((sum, l) => sum + l.size + lineSpacing, 0) - lineSpacing;
    let curY = (dotsH - totalHeight) / 2;

    const targetX =
      textAlign === 'left'
        ? Math.round(paddingMm * 8) + 12
        : textAlign === 'right'
        ? dotsW - Math.round(paddingMm * 8) - 12
        : dotsW / 2;

    for (const line of activeLines) {
      ctx.font = `${line.weight === '900' ? '900' : line.weight === 'bold' ? 'bold' : 'normal'} ${line.size}px ${fontFamily}`;
      const yPos = curY + line.size / 2;

      if (line.isBadge) {
        const textMetrics = ctx.measureText(line.text);
        const badgeW = textMetrics.width + 16;
        const badgeH = line.size + 8;
        const bX = textAlign === 'center' ? targetX - badgeW / 2 : textAlign === 'right' ? targetX - badgeW : targetX;
        ctx.fillStyle = '#000000';
        ctx.fillRect(bX, yPos - badgeH / 2, badgeW, badgeH);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(line.text, targetX, yPos);
        ctx.fillStyle = '#000000';
      } else {
        ctx.fillText(line.text, targetX, yPos);
      }

      curY += line.size + lineSpacing;
    }

    // Trigger download
    const link = document.createElement('a');
    link.download = `ticket-thermal-${widthMm}x${heightMm}mm.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast.success('PNG Exported', `Saved 203 DPI label (${dotsW}x${dotsH} px)`);
  };

  return (
    <div className={styles.designerWrap}>
      {/* ── Ready-Made Presets Bar ── */}
      <div className={styles.presetsBar}>
        <span className={styles.presetsLabel}>
          <Sparkles size={15} color="#4f46e5" />
          Preset Templates:
        </span>
        {PRESET_TEMPLATES.map(p => (
          <button
            key={p.id}
            type="button"
            className={[styles.presetBtn, activePresetId === p.id && styles.presetBtnActive].filter(Boolean).join(' ')}
            onClick={() => handleApplyPreset(p)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ── Main Two-Column Layout ── */}
      <div className={styles.designerLayout}>
        {/* ── Left Column: Editing Controls ── */}
        <div className={styles.controlsCol}>
          {/* Card 1: Dimensions & Layout */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <Layout size={16} />
                <span>Ticket Dimensions &amp; Orientation</span>
              </div>
              <span className={styles.rowLabelValue}>
                {widthMm} × {heightMm} mm ({dotsW}×{dotsH} px @ 203 DPI)
              </span>
            </div>

            <div className={styles.formRow}>
              <label className={styles.rowLabel}>Label Size Preset</label>
              <select
                className={styles.select}
                value={sizePreset}
                onChange={e => setSizePreset(e.target.value as LabelSizePreset)}
              >
                <option value="50x30">50 × 30 mm (Standard Shelf / Price Sticker)</option>
                <option value="50x20">50 × 20 mm (Compact Barcode / Price Tag)</option>
                <option value="50x25">50 × 25 mm (Square Tag)</option>
                <option value="40x30">40 × 30 mm (Jewelry &amp; Parts)</option>
                <option value="60x40">60 × 40 mm (Large Bin / Box Label)</option>
                <option value="100x150">100 × 150 mm (4×6 Large Carton Sign)</option>
                <option value="custom">Custom Size (mm)...</option>
              </select>
            </div>

            {sizePreset === 'custom' && (
              <div className={`${styles.formRow} ${styles.grid2}`}>
                <div>
                  <label className={styles.rowLabel}>Width (mm)</label>
                  <input
                    type="number"
                    min={10}
                    max={150}
                    className={styles.input}
                    value={customWidthMm}
                    onChange={e => setCustomWidthMm(Number(e.target.value) || 50)}
                  />
                </div>
                <div>
                  <label className={styles.rowLabel}>Height (mm)</label>
                  <input
                    type="number"
                    min={10}
                    max={200}
                    className={styles.input}
                    value={customHeightMm}
                    onChange={e => setCustomHeightMm(Number(e.target.value) || 30)}
                  />
                </div>
              </div>
            )}

            <div className={`${styles.formRow} ${styles.grid2}`}>
              <div>
                <label className={styles.rowLabel}>Orientation</label>
                <div className={styles.toggleGroup}>
                  <button
                    type="button"
                    className={[styles.toggleBtn, orientation === 'landscape' && styles.toggleBtnActive].filter(Boolean).join(' ')}
                    onClick={() => setOrientation('landscape')}
                  >
                    Landscape ↔
                  </button>
                  <button
                    type="button"
                    className={[styles.toggleBtn, orientation === 'portrait' && styles.toggleBtnActive].filter(Boolean).join(' ')}
                    onClick={() => setOrientation('portrait')}
                  >
                    Portrait ↕
                  </button>
                </div>
              </div>

              <div>
                <label className={styles.rowLabel}>Text Alignment</label>
                <div className={styles.toggleGroup}>
                  <button
                    type="button"
                    className={[styles.toggleBtn, textAlign === 'left' && styles.toggleBtnActive].filter(Boolean).join(' ')}
                    onClick={() => setTextAlign('left')}
                    title="Align Left"
                  >
                    <AlignLeft size={14} />
                  </button>
                  <button
                    type="button"
                    className={[styles.toggleBtn, textAlign === 'center' && styles.toggleBtnActive].filter(Boolean).join(' ')}
                    onClick={() => setTextAlign('center')}
                    title="Align Center"
                  >
                    <AlignCenter size={14} />
                  </button>
                  <button
                    type="button"
                    className={[styles.toggleBtn, textAlign === 'right' && styles.toggleBtnActive].filter(Boolean).join(' ')}
                    onClick={() => setTextAlign('right')}
                    title="Align Right"
                  >
                    <AlignRight size={14} />
                  </button>
                </div>
              </div>
            </div>

            <div className={`${styles.formRow} ${styles.grid2}`}>
              <div>
                <label className={styles.rowLabel}>Border Style</label>
                <select
                  className={styles.select}
                  value={borderStyle}
                  onChange={e => setBorderStyle(e.target.value as BorderStyle)}
                >
                  <option value="none">No Border</option>
                  <option value="thin">Thin Border (1px)</option>
                  <option value="thick">Thick Bold Border (3px)</option>
                  <option value="double">Double Line Border</option>
                  <option value="dashed">Dashed Border</option>
                </select>
              </div>

              <div>
                <label className={styles.rowLabel}>
                  <span>Padding</span>
                  <span className={styles.rowLabelValue}>{paddingMm} mm</span>
                </label>
                <div className={styles.sliderRow}>
                  <input
                    type="range"
                    min={0}
                    max={8}
                    step={1}
                    className={styles.rangeInput}
                    value={paddingMm}
                    onChange={e => setPaddingMm(Number(e.target.value))}
                  />
                  <input
                    type="number"
                    min={0}
                    max={8}
                    className={styles.numInput}
                    value={paddingMm}
                    onChange={e => setPaddingMm(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Headline Text (Giant) */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <Type size={16} />
                <span>Line 1: Main Headline (Giant Text)</span>
              </div>
              <button
                type="button"
                className={styles.autoFitBtn}
                onClick={handleAutoFit}
                title="Automatically calculate maximum font size to fill the label"
              >
                <Maximize2 size={12} />
                Auto-Fit
              </button>
            </div>

            <div className={styles.formRow}>
              <textarea
                rows={2}
                className={styles.textarea}
                value={headline}
                onChange={e => setHeadline(e.target.value)}
                placeholder="e.g. PROMO, SOLDES, 1 500 DA, IPHONE 15..."
              />
            </div>

            <div className={`${styles.formRow} ${styles.grid2}`}>
              <div>
                <label className={styles.rowLabel}>
                  <span>Headline Font Size</span>
                  <span className={styles.rowLabelValue}>{headlineSize} px</span>
                </label>
                <div className={styles.sliderRow}>
                  <input
                    type="range"
                    min={18}
                    max={120}
                    step={2}
                    className={styles.rangeInput}
                    value={headlineSize}
                    onChange={e => setHeadlineSize(Number(e.target.value))}
                  />
                  <input
                    type="number"
                    min={18}
                    max={120}
                    className={styles.numInput}
                    value={headlineSize}
                    onChange={e => setHeadlineSize(Number(e.target.value))}
                  />
                </div>
              </div>

              <div>
                <label className={styles.rowLabel}>Weight</label>
                <div className={styles.toggleGroup}>
                  <button
                    type="button"
                    className={[styles.toggleBtn, headlineWeight === 'normal' && styles.toggleBtnActive].filter(Boolean).join(' ')}
                    onClick={() => setHeadlineWeight('normal')}
                  >
                    Regular
                  </button>
                  <button
                    type="button"
                    className={[styles.toggleBtn, headlineWeight === 'bold' && styles.toggleBtnActive].filter(Boolean).join(' ')}
                    onClick={() => setHeadlineWeight('bold')}
                  >
                    Bold
                  </button>
                  <button
                    type="button"
                    className={[styles.toggleBtn, headlineWeight === '900' && styles.toggleBtnActive].filter(Boolean).join(' ')}
                    onClick={() => setHeadlineWeight('900')}
                  >
                    Black
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Subtitle & Tag Lines */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <Layers size={16} />
                <span>Lines 2 &amp; 3: Subtitle &amp; Price Tag (Optional)</span>
              </div>
            </div>

            {/* Line 2: Subtitle */}
            <div className={styles.formRow}>
              <div className={styles.inlineHeader}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={showSubtitle}
                    onChange={e => setShowSubtitle(e.target.checked)}
                  />
                  <span>Include Subtitle (Line 2)</span>
                </label>
                {showSubtitle && <span className={styles.rowLabelValue}>{subtitleSize} px</span>}
              </div>
              {showSubtitle && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <input
                    type="text"
                    className={styles.input}
                    value={subtitle}
                    onChange={e => setSubtitle(e.target.value)}
                    placeholder={`e.g. 128GB • 100% BATTERIE or 2 500 ${currencySymbol}`}
                  />
                  <div className={`${styles.formRow} ${styles.grid2}`} style={{ marginBottom: 0 }}>
                    <div className={styles.sliderRow}>
                      <input
                        type="range"
                        min={10}
                        max={48}
                        step={1}
                        className={styles.rangeInput}
                        value={subtitleSize}
                        onChange={e => setSubtitleSize(Number(e.target.value))}
                      />
                      <input
                        type="number"
                        min={10}
                        max={48}
                        className={styles.numInput}
                        value={subtitleSize}
                        onChange={e => setSubtitleSize(Number(e.target.value))}
                      />
                    </div>
                    <div className={styles.toggleGroup}>
                      <button
                        type="button"
                        className={[styles.toggleBtn, subtitleWeight === 'normal' && styles.toggleBtnActive].filter(Boolean).join(' ')}
                        onClick={() => setSubtitleWeight('normal')}
                      >
                        Regular
                      </button>
                      <button
                        type="button"
                        className={[styles.toggleBtn, subtitleWeight === 'bold' && styles.toggleBtnActive].filter(Boolean).join(' ')}
                        onClick={() => setSubtitleWeight('bold')}
                      >
                        Bold
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Line 3: Extra Tag / Badge */}
            <div className={styles.formRow} style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
              <div className={styles.inlineHeader}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={showExtra}
                    onChange={e => setShowExtra(e.target.checked)}
                  />
                  <span>Include Tag / Badge (Line 3)</span>
                </label>
                {showExtra && (
                  <label className={styles.checkboxLabel} style={{ fontSize: '11px', color: '#4f46e5' }}>
                    <input
                      type="checkbox"
                      checked={isExtraBadge}
                      onChange={e => setIsExtraBadge(e.target.checked)}
                    />
                    <span>Inverted Badge (White on Black)</span>
                  </label>
                )}
              </div>
              {showExtra && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <input
                    type="text"
                    className={styles.input}
                    value={extraText}
                    onChange={e => setExtraText(e.target.value)}
                    placeholder="e.g. -50% REMISE or GARANTIE 3 MOIS"
                  />
                  <div className={styles.sliderRow}>
                    <input
                      type="range"
                      min={10}
                      max={48}
                      step={1}
                      className={styles.rangeInput}
                      value={extraSize}
                      onChange={e => setExtraSize(Number(e.target.value))}
                    />
                    <input
                      type="number"
                      min={10}
                      max={48}
                      className={styles.numInput}
                      value={extraSize}
                      onChange={e => setExtraSize(Number(e.target.value))}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Card 4: Typography & Spacing Fine-Tuning */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <Sliders size={16} />
                <span>Typography &amp; Spacing</span>
              </div>
            </div>

            <div className={`${styles.formRow} ${styles.grid2}`}>
              <div>
                <label className={styles.rowLabel}>Font Family</label>
                <select
                  className={styles.select}
                  value={fontFamily}
                  onChange={e => setFontFamily(e.target.value as FontFamily)}
                >
                  <option value="Impact">Impact (Heavy &amp; Punchy)</option>
                  <option value="Arial Black">Arial Black (Ultra Bold Clean)</option>
                  <option value="Bebas Neue, sans-serif">Bebas Neue (Tall Condensed)</option>
                  <option value="system-ui, sans-serif">System Sans (Modern)</option>
                  <option value="Courier New, monospace">Courier (Monospace)</option>
                </select>
              </div>

              <div>
                <label className={styles.rowLabel}>
                  <span>Letter Spacing</span>
                  <span className={styles.rowLabelValue}>{letterSpacing} px</span>
                </label>
                <div className={styles.sliderRow}>
                  <input
                    type="range"
                    min={-2}
                    max={10}
                    step={1}
                    className={styles.rangeInput}
                    value={letterSpacing}
                    onChange={e => setLetterSpacing(Number(e.target.value))}
                  />
                  <input
                    type="number"
                    min={-2}
                    max={10}
                    className={styles.numInput}
                    value={letterSpacing}
                    onChange={e => setLetterSpacing(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>

            <div className={styles.formRow}>
              <label className={styles.rowLabel}>
                <span>Line Spacing / Gap</span>
                <span className={styles.rowLabelValue}>{lineSpacing} px</span>
              </label>
              <div className={styles.sliderRow}>
                <input
                  type="range"
                  min={0}
                  max={24}
                  step={1}
                  className={styles.rangeInput}
                  value={lineSpacing}
                  onChange={e => setLineSpacing(Number(e.target.value))}
                />
                <input
                  type="number"
                  min={0}
                  max={24}
                  className={styles.numInput}
                  value={lineSpacing}
                  onChange={e => setLineSpacing(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Right Column: Live Thermal Ticket Preview ── */}
        <div className={styles.previewCol}>
          <div className={styles.previewCard}>
            <div className={styles.previewTopBar}>
              <div className={styles.previewMeta}>
                <span>Xprinter XP-420B {storeName ? `• ${storeName}` : ''}</span>
                <span className={styles.badgeDpi}>203 DPI</span>
                <span>• {widthMm} × {heightMm} mm</span>
              </div>

              <div className={styles.zoomControls}>
                <button
                  type="button"
                  className={styles.zoomBtn}
                  onClick={() => setZoomLevel(1)}
                  title="100% Scale"
                >
                  100%
                </button>
                <button
                  type="button"
                  className={styles.zoomBtn}
                  onClick={() => setZoomLevel(1.25)}
                  title="125% Scale"
                >
                  125%
                </button>
                <button
                  type="button"
                  className={styles.zoomBtn}
                  onClick={() => setZoomLevel(1.5)}
                  title="150% Scale"
                >
                  150%
                </button>
              </div>
            </div>

            {/* Stage containing the live ticket preview */}
            <div className={styles.ticketStage}>
              <div
                className={[
                  styles.thermalLabel,
                  borderStyle === 'thin' && styles.borderThin,
                  borderStyle === 'thick' && styles.borderThick,
                  borderStyle === 'double' && styles.borderDouble,
                  borderStyle === 'dashed' && styles.borderDashed,
                ].filter(Boolean).join(' ')}
                style={{
                  width: `${dotsW * zoomLevel * 0.9}px`,
                  height: `${dotsH * zoomLevel * 0.9}px`,
                  padding: `${paddingMm * 8 * zoomLevel * 0.9}px`,
                  textAlign,
                  fontFamily,
                  letterSpacing: `${letterSpacing}px`,
                  gap: `${lineSpacing}px`,
                }}
              >
                {/* Line 1: Headline */}
                {headline.trim() && (
                  <div
                    className={styles.lineItem}
                    style={{
                      fontSize: `${headlineSize * zoomLevel * 0.9}px`,
                      fontWeight: headlineWeight === '900' ? 900 : headlineWeight === 'bold' ? 700 : 400,
                      lineHeight: 1.05,
                    }}
                  >
                    {headline}
                  </div>
                )}

                {/* Line 2: Subtitle */}
                {showSubtitle && subtitle.trim() && (
                  <div
                    className={styles.lineItem}
                    style={{
                      fontSize: `${subtitleSize * zoomLevel * 0.9}px`,
                      fontWeight: subtitleWeight === 'bold' ? 700 : 400,
                      lineHeight: 1.15,
                    }}
                  >
                    {subtitle}
                  </div>
                )}

                {/* Line 3: Extra Tag / Badge */}
                {showExtra && extraText.trim() && (
                  <div className={styles.lineItem}>
                    <span
                      className={isExtraBadge ? styles.badgeWrap : undefined}
                      style={{
                        fontSize: `${extraSize * zoomLevel * 0.9}px`,
                        fontWeight: 800,
                        lineHeight: 1.1,
                      }}
                    >
                      {extraText}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action Bar (Print & Export) */}
          <div className={styles.actionCard}>
            <div className={styles.printRow}>
              {/* Copies counter */}
              <div className={styles.copiesWrap} title="Number of copies to print">
                <button
                  type="button"
                  className={styles.copiesBtn}
                  onClick={() => setCopies(prev => Math.max(1, prev - 1))}
                  disabled={copies <= 1}
                >
                  -
                </button>
                <span className={styles.copiesVal}>{copies}</span>
                <button
                  type="button"
                  className={styles.copiesBtn}
                  onClick={() => setCopies(prev => Math.min(50, prev + 1))}
                >
                  +
                </button>
              </div>

              {/* Direct Hardware Print Button */}
              <button
                type="button"
                className={styles.printBtn}
                onClick={handleDirectPrint}
                disabled={isPrinting || (!headline.trim() && !subtitle.trim())}
              >
                <Printer size={18} />
                <span>{isPrinting ? 'Printing...' : 'Print Ticket to XP-420B'}</span>
              </button>

              {/* Separate PNG Export Button */}
              <button
                type="button"
                className={styles.exportBtn}
                onClick={handleExportPng}
                title="Download 203 DPI PNG image"
              >
                <Download size={16} />
                <span>Export PNG</span>
              </button>

              {/* Reset Draft Button */}
              <button
                type="button"
                className={styles.exportBtn}
                onClick={handleReset}
                title="Reset to blank"
              >
                <RotateCcw size={15} />
              </button>
            </div>

            <div className={styles.noticeBar}>
              <span>⚡ Direct silent hardware printing (Port 3355) — Zero browser print popups</span>
              <span>{headline.length + (showSubtitle ? subtitle.length : 0) + (showExtra ? extraText.length : 0)} total chars</span>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden off-screen canvas for high-resolution PNG export */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
};
