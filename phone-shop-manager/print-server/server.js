/**
 * Phone Shop Print Server
 * 
 * Local Express server that receives receipt data from the web app
 * and sends ESC/POS commands directly to the XP-T80Q thermal printer
 * via the macOS CUPS print queue.
 * 
 * Usage:
 *   1. Copy .env.example to .env and set your PRINTER_NAME
 *   2. npm install
 *   3. npm start
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const { ThermalPrinter, PrinterTypes, CharacterSet } = require('node-thermal-printer');
const { PNG } = require('pngjs');

function removeAccents(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[\u2713\u2714\u2611]/g, '[OK]')
    .replace(/[\u2717\u2718\u2612]/g, '[FAIL]')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const app = express();
const PORT = process.env.PORT || 3355;
const PRINTER_NAME = process.env.PRINTER_NAME || 'XP_T80Q';
const LABEL_PRINTER_NAME = process.env.LABEL_PRINTER_NAME || PRINTER_NAME;
const HAS_CUTTER = process.env.HAS_CUTTER !== 'false'; // default true
const LABEL_OFFSET_X = parseInt(process.env.LABEL_OFFSET_X || '12', 10); // dots to shift left to compensate for printer's built-in left margin

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// --- Printer Instance ---
function createPrinter() {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    // No interface provided; we will just get the buffer and use lpr directly
    characterSet: CharacterSet.PC437_USA,
    removeSpecialCharacters: false,
    lineCharacter: '-',
    width: 42, // 80mm paper ≈ 42 chars with standard font
  });

  // Cancel Chinese/Kanji character mode (FS .) — POS-80 clones default to
  // GBK/GB2312 and interpret high bytes (0x80–0xFF) as Chinese characters.
  // Also explicitly select code page 0 (PC437) with ESC t 0.
  printer.append(Buffer.from([0x1C, 0x2E, 0x1B, 0x74, 0x00]));

  return printer;
}

/**
 * Print a base64-encoded PNG logo centered on the receipt printer.
 * Strips the data URI prefix if present, decodes to buffer, and uses
 * node-thermal-printer's printImageBuffer (ESC/POS GS v 0 raster).
 *
 * @param {ThermalPrinter} printer — already-created printer instance
 * @param {string} base64DataUri — e.g. 'data:image/png;base64,iVBOR...'
 */
/**
 * Convert a PNG image buffer into ESC/POS ESC * 33 (24-dot double density)
 * bit-image commands.
 *
 * Why ESC * instead of GS v 0?
 * POS-80 thermal printers reject GS v 0 raster commands over USB and dump
 * the binary bytes as ASCII text (Ç, ?), feeding meters of blank paper.
 * ESC * 33 is the universal 24-dot bit-image command supported by ALL
 * ESC/POS printers. Each 24-dot slice feeds seamlessly with ESC 3 0 line spacing.
 *
 * @param {Buffer} pngBuffer — PNG image buffer
 * @param {object} [options]
 * @param {number} [options.maxWidth=180] — Max width in dots
 * @param {number} [options.maxHeight=90] — Max height in dots
 * @param {boolean} [options.invert] — Force invert
 * @returns {Buffer|null}
 */
function buildEscStarBitImage(pngBuffer, options = {}) {
  try {
    const png = PNG.sync.read(pngBuffer);
    const { width, height, data } = png;
    if (!width || !height || !data || data.length === 0) return null;

    // 1. Dark pixel ratio detection (for dark-background / inverted badges)
    let darkPixelCount = 0;
    const totalPixels = width * height;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) << 2;
        const a = data[idx + 3];
        if (a > 126) {
          const gray = 0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2];
          if (gray < 128) darkPixelCount++;
        }
      }
    }
    const shouldInvert = options.invert !== undefined 
      ? options.invert 
      : (darkPixelCount / totalPixels > 0.65);

    // 2. Vertical content bounding box to trim excessive margins
    let top = 0;
    let bottom = height - 1;
    for (let y = 0; y < height; y++) {
      let has = false;
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) << 2;
        if (data[idx + 3] > 126) {
          const gray = 0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2];
          let isBlack = gray < 128;
          if (shouldInvert) isBlack = !isBlack;
          if (isBlack) { has = true; break; }
        }
      }
      if (has) { top = y; break; }
    }
    for (let y = height - 1; y >= top; y--) {
      let has = false;
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) << 2;
        if (data[idx + 3] > 126) {
          const gray = 0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2];
          let isBlack = gray < 128;
          if (shouldInvert) isBlack = !isBlack;
          if (isBlack) { has = true; break; }
        }
      }
      if (has) { bottom = y; break; }
    }

    top = Math.max(0, top - 2);
    bottom = Math.min(height - 1, bottom + 2);
    const contentHeight = Math.max(1, bottom - top + 1);

    // Scale to compact dimensions for receipt header (max 180px wide, max 90px high)
    const MAX_W = options.maxWidth || 180;
    const MAX_H = options.maxHeight || 90;
    let targetW = width;
    let targetH = contentHeight;

    const scale = Math.min(MAX_W / targetW, MAX_H / targetH, 1.0);
    targetW = Math.max(16, Math.round(targetW * scale));
    targetH = Math.max(8, Math.round(targetH * scale));

    const mode = 33; // 24-dot double density
    const chunks = [];

    const nL = targetW % 256;
    const nH = Math.floor(targetW / 256);

    // Set 0-dot line spacing ONCE before the slice loop so 24-dot slices
    // connect seamlessly. Placing this inside the loop after image data
    // causes the printer to misinterpret ESC bytes as printable text.
    chunks.push(Buffer.from([0x1B, 0x33, 0x00]));

    for (let sliceY = 0; sliceY < targetH; sliceY += 24) {
      const sliceBuf = [];
      // ESC * m nL nH
      sliceBuf.push(0x1B, 0x2A, mode, nL, nH);

      for (let x = 0; x < targetW; x++) {
        const srcX = Math.floor((x / targetW) * width);
        for (let k = 0; k < 3; k++) {
          let byteVal = 0;
          for (let b = 0; b < 8; b++) {
            const dy = sliceY + k * 8 + b;
            if (dy < targetH) {
              const srcY = top + Math.floor((dy / targetH) * contentHeight);
              if (srcY < height) {
                const idx = (srcY * width + srcX) << 2;
                const a = data[idx + 3];
                let isBlack = false;
                if (a > 126) {
                  const gray = 0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2];
                  isBlack = gray < 128;
                  if (shouldInvert) isBlack = !isBlack;
                }
                if (isBlack) {
                  byteVal |= (1 << (7 - b));
                }
              }
            }
          }
          sliceBuf.push(byteVal);
        }
      }

      // LF to advance to next 24-dot slice (no ESC 3 here — already set above)
      sliceBuf.push(0x0A);
      chunks.push(Buffer.from(sliceBuf));
    }

    // Reset line spacing to default (ESC 2)
    chunks.push(Buffer.from([0x1B, 0x32]));

    return Buffer.concat(chunks);
  } catch (err) {
    console.warn('[buildEscStarBitImage] Error:', err.message);
    return null;
  }
}

/**
 * Print a base64-encoded PNG logo centered on the receipt printer using ESC * 33.
 *
 * @param {ThermalPrinter} printer — already-created printer instance
 * @param {string} base64DataUri — e.g. 'data:image/png;base64,iVBOR...'
 * @param {object} [options]
 */
function printLogoFromBase64(printer, base64DataUri, options = {}) {
  if (!base64DataUri || typeof base64DataUri !== 'string') return;

  try {
    const raw = base64DataUri.replace(/^data:image\/[a-z+]+;base64,/i, '');
    const imgBuffer = Buffer.from(raw, 'base64');

    const bitImage = buildEscStarBitImage(imgBuffer, options);
    if (!bitImage) return;

    // Center alignment for logo
    printer.alignCenter();
    printer.append(bitImage);
    // Small newline after logo before store name
    printer.append(Buffer.from([0x0A]));
  } catch (logoErr) {
    console.warn('[Logo Print] Failed to print logo image:', logoErr.message);
  }
}

// --- Execute Print via LPR (macOS/Linux) using execFile (No shell injection risk) ---
function executePrint(printer, targetPrinter = PRINTER_NAME) {
  return new Promise((resolve, reject) => {
    try {
      const buffer = printer.getBuffer();
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const tmpFilePath = path.join(os.tmpdir(), `receipt_${Date.now()}_${randomSuffix}.bin`);
      fs.writeFileSync(tmpFilePath, buffer);
      
      execFile('lpr', ['-P', targetPrinter, '-o', 'raw', tmpFilePath], (error, stdout, stderr) => {
        // Clean up temp file
        try { fs.unlinkSync(tmpFilePath); } catch (e) {}
        
        if (error) {
          reject(new Error(`lpr error: ${error.message}`));
          return;
        }
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}

// --- Execute TSPL Print (for Xprinter XP-420B / TSC label printers) ---
function executeTSPLPrint(tsplCommands, targetPrinter = LABEL_PRINTER_NAME) {
  return new Promise((resolve, reject) => {
    try {
      // Ensure the TSPL stream starts with a buffer reset and ends with a clean CLS
      const cleanCommands = `\r\nCLS\r\n${tsplCommands.trim()}\r\nCLS\r\n`;
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const tmpFilePath = path.join(os.tmpdir(), `label_${Date.now()}_${randomSuffix}.bin`);
      fs.writeFileSync(tmpFilePath, Buffer.from(cleanCommands, 'utf-8'));
      
      execFile('lpr', ['-P', targetPrinter, '-o', 'raw', tmpFilePath], (error, stdout, stderr) => {
        try { fs.unlinkSync(tmpFilePath); } catch (e) {}
        if (error) {
          reject(new Error(`lpr error: ${error.message}`));
          return;
        }
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}

// Global Process Crash Guards
process.on('uncaughtException', (err) => {
  console.error('[PrintServer Crash Guard] Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[PrintServer Crash Guard] Unhandled Rejection:', reason);
});

function isLabelPrinter(printerName) {
  const name = (printerName || '').toLowerCase();
  return name.includes('420') || name.includes('label') || name.includes('tsc') || name.includes('xp_4') || name.includes('xp-4') || name.includes('365') || name.includes('235');
}

// --- Currency Formatting ---
function formatCurrency(amount, currency = 'USD') {
  let formatted = '';
  const curr = (currency || 'USD').toUpperCase();
  switch (curr) {
    case 'DZD':
      formatted = `${new Intl.NumberFormat('fr-DZ').format(amount)} DA`;
      break;
    case 'EUR':
      formatted = `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(amount)} €`;
      break;
    case 'GBP':
      formatted = `£${new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2 }).format(amount)}`;
      break;
    case 'CAD':
      formatted = `CA$ ${new Intl.NumberFormat('en-CA', { minimumFractionDigits: 2 }).format(amount)}`;
      break;
    case 'AUD':
      formatted = `AU$ ${new Intl.NumberFormat('en-AU', { minimumFractionDigits: 2 }).format(amount)}`;
      break;
    case 'TRY':
      formatted = `${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2 }).format(amount)} ₺`;
      break;
    case 'SAR':
      formatted = `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(amount)} SAR`;
      break;
    case 'AED':
      formatted = `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(amount)} AED`;
      break;
    case 'MAD':
      formatted = `${new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(amount)} DH`;
      break;
    case 'TND':
      formatted = `${new Intl.NumberFormat('fr-TN', { minimumFractionDigits: 2 }).format(amount)} DT`;
      break;
    case 'USD':
    default:
      formatted = `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(amount)}`;
      break;
  }
  // Replace non-breaking spaces (U+00A0, U+202F, etc.) with regular spaces
  // Thermal printers often print these as '?' in standard code pages.
  return formatted.replace(/[\u00A0\u202F\s]/g, ' ');
}

// --- Date Formatting ---
function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// --- Right-pad / left-pad helpers for column alignment ---
function padRight(text, width) {
  if (text.length >= width) return text.substring(0, width);
  return text + ' '.repeat(width - text.length);
}

function padLeft(text, width) {
  if (text.length >= width) return text.substring(0, width);
  return ' '.repeat(width - text.length) + text;
}

// Calculate centered X position on 400-dot-wide label (50mm)
// Subtracts LABEL_OFFSET_X to compensate for the printer's physical left margin
function getCenteredX(text, font = '2', totalWidth = 400) {
  const charWidth = font === '5' ? 32 : font === '4' ? 24 : font === '3' ? 16 : font === '2' ? 12 : font === '0' ? 10 : font === '1' ? 8 : 12;
  const textWidth = (text || '').length * charWidth;
  return Math.max(0, Math.floor((totalWidth - textWidth) / 2) - LABEL_OFFSET_X);
}

/**
 * Calculates dynamic centering and narrow/wide parameters for Code 128 barcode
 * to ensure the barcode is perfectly centered and never overflows the 400-dot label width.
 */
function getBarcodeParams(sku, totalWidth = 400) {
  const clean = (sku || '').trim();
  const isNumeric = /^\d+$/.test(clean);
  const effectiveLen = isNumeric ? Math.ceil(clean.length / 2) + 1 : clean.length;
  // Code 128: start (11) + data (len*11) + checksum (11) + stop (13) + quiet zones (~20)
  const modules = (effectiveLen + 3) * 11 + 2;

  // Enforce standard safe width: max 260 dots (~32.5mm) on 400-dot (50mm) label
  // This guarantees at least 70 dots (~9mm) margin on both left and right edges!
  const MAX_SAFE_WIDTH = 260;

  let narrow = 2;
  let width = modules * narrow;

  // If 2-dot narrow exceeds 260 dots (e.g. longer SKU), scale to 1-dot narrow
  if (width > MAX_SAFE_WIDTH) {
    narrow = 1;
    width = modules * narrow;
  }

  // 1:1 standard width ratio for 100% accurate, certified Code 128 scanner recognition
  const wide = narrow;
  // Center precisely with printer physical margin offset
  const x = Math.max(20, Math.floor((totalWidth - width) / 2) - LABEL_OFFSET_X);
  return { x, narrow, wide, width };
}

/**
 * Format a two-column row: left-aligned name, right-aligned price
 * Total width = 42 chars for 80mm paper
 */
function twoColumnRow(left, right, totalWidth = 42) {
  const gap = 2;
  const rightLen = right.length;
  const maxLeft = totalWidth - rightLen - gap;
  const truncatedLeft = left.length > maxLeft ? left.substring(0, maxLeft) : left;
  const padding = totalWidth - truncatedLeft.length - rightLen;
  return truncatedLeft + ' '.repeat(Math.max(padding, 1)) + right;
}

// ============================================================
// Routes
// ============================================================

/**
 * GET /status — Health check
 */
app.get('/status', async (_req, res) => {
  try {
    res.json({
      ok: true,
      printer: PRINTER_NAME,
      labelPrinter: LABEL_PRINTER_NAME,
      connected: true,
      hasCutter: HAS_CUTTER,
    });
  } catch (err) {
    res.json({
      ok: true,
      printer: PRINTER_NAME,
      labelPrinter: LABEL_PRINTER_NAME,
      connected: false,
      hasCutter: HAS_CUTTER,
      error: err.message,
    });
  }
});

/**
 * POST /print-receipt — Print a sale receipt
 * 
 * Body:
 * {
 *   storeName: string,
 *   currency: string,         // 'USD' | 'EUR' | 'DZD'
 *   transaction: {
 *     id: string,
 *     date: string,           // ISO string
 *     customerName?: string,
 *     processedByName?: string,
 *     items: [{ product: { name, model, price }, quantity }],
 *     subtotal: number,
 *     discount?: { type: 'percent' | 'flat', value: number },
 *     total: number,
 *     payments: [{ method: string, amount: number }],
 *     status?: string,
 *   },
 *   headerMessage?: string,
 *   footerMessage?: string,
 * }
 */
app.post('/print-receipt', async (req, res) => {
  try {
    const { storeName, currency, transaction, headerMessage, footerMessage, logo, translations = {} } = req.body;
    const t = (key, defaultText) => translations[key] || defaultText;

    if (!transaction || !transaction.items) {
      return res.status(400).json({ ok: false, error: 'Missing transaction data' });
    }

    const printer = createPrinter();
    const fmt = (v) => formatCurrency(v, currency);

    // ---- Logo (if provided) ----
    if (logo) {
      await printLogoFromBase64(printer, logo);
    }

    // ---- Store Header ----
    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println(storeName || 'PhoneShop Pro');
    printer.bold(false);
    printer.setTextNormal();

    if (headerMessage) {
      printer.println(headerMessage);
    }

    printer.drawLine();

    // ---- Date & Order ID ----
    printer.alignCenter();
    printer.println(formatDate(transaction.date));
    printer.println(`Order: ${transaction.id}`);

    // ---- Customer & Cashier ----
    if (transaction.customerName || transaction.processedByName) {
      printer.drawLine();
      printer.alignLeft();
      if (transaction.customerName) {
        printer.println(twoColumnRow(t('customer', 'Customer:'), transaction.customerName));
      }
      if (transaction.processedByName) {
        printer.println(twoColumnRow(t('cashier', 'Cashier:'), transaction.processedByName));
      }
    }

    printer.drawLine();

    // ---- Items Header ----
    printer.bold(true);
    printer.alignLeft();
    printer.println(twoColumnRow(t('item', 'Item'), t('price', 'Price')));
    printer.bold(false);

    // ---- Items ----
    for (const item of transaction.items) {
      const name = `${item.quantity}x ${item.product.name} ${item.product.model}`;
      const price = fmt(item.product.price * item.quantity);
      printer.println(twoColumnRow(name, price));
    }

    printer.drawLine();

    // ---- Subtotal ----
    printer.alignLeft();
    printer.println(twoColumnRow(t('subtotal', 'Subtotal'), fmt(transaction.subtotal)));

    // ---- Discount ----
    if (transaction.discount && transaction.discount.value > 0) {
      const discountLabel = transaction.discount.type === 'percent'
        ? `${t('discount', 'Discount')} (${transaction.discount.value}%)`
        : t('discount', 'Discount');
      const discountAmount = transaction.discount.type === 'percent'
        ? transaction.subtotal * (transaction.discount.value / 100)
        : transaction.discount.value;
      printer.println(twoColumnRow(discountLabel, `-${fmt(discountAmount)}`));
    }

    // ---- Refund Status ----
    if (transaction.status === 'refunded') {
      printer.bold(true);
      printer.println(t('fullyRefunded', '*** FULLY REFUNDED ***'));
      printer.bold(false);
    } else if (transaction.status === 'partially_refunded') {
      printer.bold(true);
      printer.println(t('partiallyRefunded', '*** PARTIALLY REFUNDED ***'));
      printer.bold(false);
    }

    // ---- Total ----
    printer.drawLine();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println(twoColumnRow(t('total', 'TOTAL'), fmt(transaction.total)));
    printer.setTextNormal();
    printer.bold(false);

    printer.drawLine();

    // ---- Payment Method ----
    printer.alignCenter();
    const paymentsText = transaction.payments
      .map((p) => `${p.method.toUpperCase()} ${fmt(p.amount)}`)
      .join(' + ');
    printer.println(`${t('payment', 'Payment:')} ${paymentsText}`);

    // ---- Footer ----
    printer.newLine();
    printer.bold(true);
    printer.println(t('thanks', 'Thank you for your purchase!'));
    printer.bold(false);

    if (footerMessage) {
      printer.println(footerMessage);
    }

    // ---- Feed & Cut ----
    printer.newLine();
    printer.newLine();
    printer.newLine();

    if (HAS_CUTTER) {
      printer.cut();
    } else {
      // Extra feed for manual tear
      printer.newLine();
      printer.newLine();
    }

    // ---- Execute Print ----
    await executePrint(printer);
    console.log(`[✓] Receipt printed — Order ${transaction.id}`);

    res.json({ ok: true, message: 'Receipt printed successfully' });
  } catch (err) {
    console.error('[✗] Print failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /print-repair-label — Print a repair ticket label
 * 
 * Body:
 * {
 *   storeName: string,
 *   ticket: {
 *     ticketNumber: string,
 *     deviceBrand: string,
 *     deviceModel: string,
 *     customerName: string,
 *     createdAt: string,
 *   }
 * }
 */
app.post('/print-repair-label', async (req, res) => {
  try {
    const { storeName, currency = 'DZD', ticket, copies = 1, translations = {} } = req.body;
    const t = (key, defaultText) => removeAccents(translations[key] || defaultText);
    const copiesCount = Math.max(1, parseInt(copies || 1, 10));

    if (!ticket || !ticket.ticketNumber) {
      return res.status(400).json({ ok: false, error: 'Missing ticket data' });
    }

    const fmt = (v) => formatCurrency(v, currency);
    const ticketNum = (ticket.ticketNumber || '').replace(/"/g, '').trim();
    const phoneName = removeAccents(`${ticket.deviceBrand || ''} ${ticket.deviceModel || ''}`.replace(/"/g, '').trim());
    const custName = removeAccents((ticket.customerName || '').replace(/"/g, '').trim().substring(0, 24));
    const custPhone = (ticket.customerPhone || '').replace(/"/g, '').trim().substring(0, 16);
    const phoneHeader = `${phoneName}${custPhone ? ` ${custPhone}` : ''}`.substring(0, 28);
    const issueDesc = removeAccents((ticket.issueDescription || '').replace(/"/g, '').trim().substring(0, 34));
    const costVal = ticket.actualCost ?? ticket.estimatedCost ?? 0;
    const depositVal = ticket.depositAmount || 0;
    const isPaid = depositVal > 0 && depositVal >= costVal;
    let priceText = `${t('price', 'Price')} : ${fmt(costVal)}`;
    if (isPaid) {
      priceText = `${fmt(costVal)} (${t('paid', 'Payé')})`;
    } else if (depositVal > 0) {
      priceText = `${t('total', 'Total')} : ${fmt(costVal)} (${t('dep', 'Dep')} : ${fmt(depositVal)})`;
    } else {
      priceText = `${t('price', 'Price')} : ${fmt(costVal)}`;
    }

    if (isLabelPrinter(LABEL_PRINTER_NAME)) {
      let tspl = '';
      tspl += 'SIZE 50 mm, 25 mm\r\n';
      tspl += 'GAP 2 mm, 0 mm\r\n';
      tspl += 'REFERENCE 32,40\r\n';
      tspl += 'DIRECTION 1\r\n';
      tspl += 'CLS\r\n';
      
      const { x: barcodeX, narrow, wide } = getBarcodeParams(ticketNum);

      // Line 1: Phone Name & Phone Number
      tspl += `TEXT 12,6,"2",0,1,1,"${phoneHeader}"\r\n`;
      // Divider
      tspl += 'BAR 0,28,400,1\r\n';
      // Line 2: Customer Name (up 1mm)
      tspl += `TEXT 12,34,"2",0,1,1,"${t('client', 'Client')} : ${custName}"\r\n`;
      // Line 3: Problem Description (down 1mm)
      tspl += `TEXT 12,60,"2",0,1,1,"${t('issue', 'Issue')} : ${issueDesc || t('diagnostic', 'Diagnostic')}"\r\n`;
      // Line 4: Price & Deposit (down 2mm)
      tspl += `TEXT 12,86,"2",0,1,1,"${priceText}"\r\n`;
      // Line 5: Barcode (down 1mm)
      tspl += `BARCODE ${barcodeX},110,"128",38,0,0,${narrow},${wide},"${ticketNum}"\r\n`;
      // Line 6: Ticket reference text (down 1mm)
      const ticketRefX = Math.max(0, getCenteredX(ticketNum, '1') - 48);
      tspl += `TEXT ${ticketRefX},154,"1",0,1,1,"${ticketNum}"\r\n`;
      tspl += `PRINT ${copiesCount},1\r\n`;
      tspl += 'CLS\r\n';

      await executeTSPLPrint(tspl, LABEL_PRINTER_NAME);
      console.log(`[✓] Repair back label printed via TSPL (${copiesCount} copies) — ${ticket.ticketNumber} on ${LABEL_PRINTER_NAME}`);
      return res.json({ ok: true, message: 'Repair label printed successfully' });
    }

    const printer = createPrinter();

    // ---- ESC/POS Fallback Label ----
    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println(ticket.ticketNumber);
    printer.bold(false);
    printer.setTextNormal();
    printer.println(phoneName);
    printer.drawLine();

    printer.alignLeft();
    printer.println(`${t('client', 'Client')} : ${custName} (${custPhone || t('noPhone', 'No tel')})`);
    printer.println(`${t('issue', 'Issue')} : ${issueDesc || t('diagnostic', 'Diagnostic')}`);
    printer.bold(true);
    printer.println(priceText);
    printer.bold(false);
    printer.drawLine();

    printer.alignCenter();
    try {
      printer.printQR(ticket.ticketNumber, { cellSize: 3, correction: 'M', model: 2 });
    } catch (_qrErr) {
      printer.println(`[${ticket.ticketNumber}]`);
    }

    printer.newLine();
    if (HAS_CUTTER) {
      printer.cut();
    } else {
      printer.newLine();
      printer.newLine();
    }

    for (let c = 0; c < copiesCount; c++) {
      await executePrint(printer, LABEL_PRINTER_NAME);
    }
    console.log(`[✓] Repair back label printed (${copiesCount} copies) — ${ticket.ticketNumber} on ${LABEL_PRINTER_NAME}`);

    res.json({ ok: true, message: 'Repair label printed successfully' });
  } catch (err) {
    console.error('[✗] Label print failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /print-repair-ticket — Print standard 80mm customer drop-off ticket on receipt printer
 */
app.post('/print-repair-ticket', async (req, res) => {
  try {
    const { storeName, currency = 'DZD', ticket, headerMessage, footerMessage, logo, translations = {} } = req.body;
    const t = (key, defaultText) => removeAccents(translations[key] || defaultText);

    if (!ticket || !ticket.ticketNumber) {
      return res.status(400).json({ ok: false, error: 'Missing ticket data' });
    }

    const printer = createPrinter();
    const fmt = (v) => formatCurrency(v, currency);

    // ---- Logo (if provided) ----
    if (logo) {
      await printLogoFromBase64(printer, logo);
    }

    // ---- Store Header ----
    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println(storeName || 'PhoneShop Pro');
    printer.bold(false);
    printer.setTextNormal();

    if (headerMessage) {
      printer.println(headerMessage);
    }

    printer.drawLine();
    printer.bold(true);
    printer.println(t('repairIntake', '*** REPAIR INTAKE TICKET ***'));
    printer.println(ticket.ticketNumber);
    printer.bold(false);
    const trackingPin = ticket.trackingPin || (ticket.customerPhone ? ticket.customerPhone.slice(-4) : '');
    if (trackingPin) {
      printer.bold(true);
      printer.println(`${t('pin', 'PIN:')} ${trackingPin}`);
      printer.bold(false);
    }
    printer.println(formatDate(ticket.createdAt));
    printer.drawLine();

    // ---- Customer & Device Info ----
    printer.alignLeft();
    printer.println(twoColumnRow(t('customer', 'Customer:'), removeAccents(ticket.customerName)));
    if (ticket.customerPhone) {
      printer.println(twoColumnRow(t('phone', 'Phone:'), ticket.customerPhone));
    }
    printer.println(twoColumnRow(t('device', 'Device:'), removeAccents(`${ticket.deviceBrand} ${ticket.deviceModel}`)));
    if (ticket.lockValue) {
      const lockLabel = ticket.lockType === 'pattern' ? t('pattern', 'Pattern:') : t('pinLabel', 'PIN:');
      printer.println(twoColumnRow(t('security', 'Security:'), `${lockLabel} ${ticket.lockValue}`));
    }
    if (ticket.assignedTechnician) {
      printer.println(twoColumnRow(t('technician', 'Technician:'), removeAccents(ticket.assignedTechnician)));
    }
    if (ticket.createdByName) {
      printer.println(twoColumnRow(t('intakeBy', 'Intake By:'), removeAccents(ticket.createdByName)));
    }

    printer.drawLine();

    // ---- Issue Description ----
    printer.println(t('reportedProblem', 'Reported Problem :'));
    printer.println(removeAccents(ticket.issueDescription || t('diagnosticRequired', 'Diagnostic required')));

    printer.drawLine();

    // ---- Financials ----
    const total = ticket.actualCost ?? ticket.estimatedCost ?? 0;
    const deposit = ticket.depositAmount || 0;
    const balance = Math.max(0, total - deposit);

    printer.println(twoColumnRow(t('estimatedCost', 'Estimated Cost:'), fmt(total)));
    printer.println(twoColumnRow(t('depositPaid', 'Deposit Paid:'), fmt(deposit)));
    printer.bold(true);
    printer.println(twoColumnRow(t('balanceDue', 'BALANCE DUE:'), balance <= 0 ? t('paidInFull', 'PAID IN FULL') : fmt(balance)));
    printer.bold(false);

    printer.drawLine();

    // ---- QR Code & Footer ----
    printer.alignCenter();
    try {
      const trackingUrl = ticket.trackingUrl || ticket.ticketNumber;
      printer.printQR(trackingUrl, {
        cellSize: 4,
        correction: 'M',
        model: 2,
      });
      printer.newLine();
      printer.setTextSize(1, 1);
      printer.println(t('scanTrack', 'Scan to track repair online'));
      printer.setTextNormal();
    } catch (_qrErr) {
      printer.println(`[${ticket.ticketNumber}]`);
    }

    printer.newLine();
    printer.println(footerMessage || t('presentTicket', 'Please present this ticket when picking up your device.'));
    printer.println(t('thanksRepair', 'Thank you for trusting us with your repair!'));

    printer.newLine();
    printer.newLine();

    if (HAS_CUTTER) {
      printer.cut();
    } else {
      printer.newLine();
      printer.newLine();
    }

    await executePrint(printer, PRINTER_NAME);
    console.log(`[✓] Repair intake ticket printed on 80mm — ${ticket.ticketNumber} on ${PRINTER_NAME}`);

    res.json({ ok: true, message: 'Repair intake ticket printed successfully' });
  } catch (err) {
    console.error('[✗] Repair ticket print failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /print-z-report — Print End-of-Day Shift Z-Report on receipt printer
 * 
 * Body:
 * {
 *   storeName: string,
 *   currency: string,
 *   date: string,
 *   generatedBy: string,
 *   summary: {
 *     grossSales: number,
 *     salesCount: number,
 *     refundsAmount: number,
 *     refundsCount: number,
 *     netCash: number,
 *     unitsSold: number,
 *     discountsTotal: number,
 *     avgTicket: number,
 *     staffBreakdown: [{ name: string, count: number, total: number }]
 *   }
 * }
 */
app.post('/print-z-report', async (req, res) => {
  try {
    const { storeName, currency, date, generatedBy, summary, translations = {} } = req.body;
    const t = (key, defaultText) => translations[key] || defaultText;

    if (!summary) {
      return res.status(400).json({ ok: false, error: 'Missing summary data' });
    }

    const printer = createPrinter();
    const fmt = (v) => formatCurrency(v, currency);

    // ---- Store Header ----
    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println(storeName || 'PhoneShop Pro');
    printer.bold(false);
    printer.setTextNormal();

    printer.drawLine();
    printer.bold(true);
    printer.println(t('zReport', '*** END-OF-DAY Z-REPORT ***'));
    printer.bold(false);
    printer.println(`${t('shiftDate', 'Shift Date:')} ${date || formatDate(new Date().toISOString())}`);
    if (generatedBy) printer.println(`${t('cashier', 'Cashier:')} ${generatedBy}`);
    printer.println(`${t('printed', 'Printed:')} ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`);
    printer.drawLine();

    // ---- Sales Summary ----
    printer.alignLeft();
    printer.bold(true);
    printer.println(t('salesSummary', 'SALES SUMMARY'));
    printer.bold(false);
    printer.println(twoColumnRow(`${t('grossSales', 'Gross Sales')} (${summary.salesCount} ${t('txs', 'txs')}):`, fmt(summary.grossSales)));
    if (summary.discountsTotal > 0) {
      printer.println(twoColumnRow(t('discountsGiven', 'Discounts Given:'), `-${fmt(summary.discountsTotal)}`));
    }
    printer.println(twoColumnRow(t('unitsSold', 'Units / Items Sold:'), `${summary.unitsSold} ${t('pcs', 'pcs')}`));
    printer.println(twoColumnRow(t('averageTicket', 'Average Ticket:'), fmt(summary.avgTicket)));

    printer.drawLine();

    // ---- Returns & Refunds ----
    printer.bold(true);
    printer.println(t('returnsRefunds', 'RETURNS & REFUNDS'));
    printer.bold(false);
    printer.println(twoColumnRow(`${t('refundsGiven', 'Refunds Given')} (${summary.refundsCount} ${t('txs', 'txs')}):`, `-${fmt(summary.refundsAmount)}`));

    printer.drawLine();

    // ---- Cash Drawer Reconciliation ----
    printer.bold(true);
    printer.println(t('cashDrawerRec', 'CASH DRAWER RECONCILIATION'));
    printer.bold(false);
    printer.println(twoColumnRow(t('cashCollected', 'Cash Collected:'), fmt(summary.grossSales)));
    printer.println(twoColumnRow(t('cashPaidOut', 'Cash Paid Out (Refunds):'), `-${fmt(summary.refundsAmount)}`));
    printer.drawLine();

    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.alignCenter();
    printer.println(t('netCashDrawer', 'NET CASH IN DRAWER:'));
    printer.println(fmt(summary.netCash));
    printer.setTextNormal();
    printer.bold(false);
    printer.drawLine();

    // ---- Staff Breakdown ----
    if (summary.staffBreakdown && summary.staffBreakdown.length > 0) {
      printer.alignLeft();
      printer.bold(true);
      printer.println(t('staffBreakdown', 'STAFF BREAKDOWN'));
      printer.bold(false);
      for (const s of summary.staffBreakdown) {
        printer.println(twoColumnRow(`${s.name} (${s.count} ${t('txs', 'txs')}):`, fmt(s.total)));
      }
      printer.drawLine();
    }

    printer.alignCenter();
    printer.println(t('endOfReport', '*** END OF REPORT ***'));
    printer.newLine();
    printer.newLine();
    printer.newLine();

    if (HAS_CUTTER) {
      printer.cut();
    } else {
      printer.newLine();
      printer.newLine();
    }

    await executePrint(printer, PRINTER_NAME);
    console.log(`[✓] Z-Report printed on ${PRINTER_NAME}`);

    res.json({ ok: true, message: 'Z-Report printed successfully' });
  } catch (err) {
    console.error('[✗] Z-Report print failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /print-barcode — Print product barcode labels
 * 
 * Body:
 * {
 *   storeName: string,
 *   currency: string,
 *   products: [{
 *     name: string,
 *     model: string,
 *     sku: string,
 *     price: number,
 *     category: string,
 *     storage?: string,
 *     color?: string
 *   }]
 * }
 */
app.post('/print-barcode', async (req, res) => {
  try {
    const { storeName, currency, products } = req.body;

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ ok: false, error: 'Missing products data' });
    }

    const fmt = (v) => formatCurrency(v, currency);

    if (isLabelPrinter(LABEL_PRINTER_NAME)) {
      let fullTspl = '';

      for (const product of products) {
        fullTspl += 'SIZE 50 mm, 20 mm\r\n';
        fullTspl += 'GAP 2 mm, 0 mm\r\n';
        fullTspl += 'REFERENCE 0,0\r\n';
        fullTspl += 'DIRECTION 1\r\n';
        fullTspl += 'CLS\r\n';

        const sku = (product.sku || '').replace(/"/g, '').trim();
        const shopTitle = (storeName || 'PhoneShop Pro').replace(/"/g, '').trim().substring(0, 24);
        
        // Product Name: only product name + model (clean, bold, same size as store name)
        let fullText = `${product.name || ''}${product.model ? ` ${product.model}` : ''}`.trim().replace(/"/g, '');

        const fontType = '2';
        const fontArgs = `"2",0,1,1`;
        const maxChars = 24;
        const shiftDots = 16; // 2mm margin alignment with store title

        // Split into up to 2 lines if long text exceeds line width
        let textLines = [];
        if (fullText.length > maxChars) {
          const words = fullText.split(' ');
          let line1 = '';
          let line2 = '';
          for (const w of words) {
            const test = line1 ? `${line1} ${w}` : w;
            if (test.length <= maxChars) {
              line1 = test;
            } else {
              line2 = line2 ? `${line2} ${w}` : w;
            }
          }
          textLines = line2 ? [line1, line2.substring(0, maxChars + 2)] : [fullText.substring(0, maxChars + 2)];
        } else {
          textLines = [fullText.substring(0, maxChars + 2)];
        }

        // Shift shop name 2mm (16 dots at 203 DPI) to the left
        const shopX = Math.max(0, getCenteredX(shopTitle, '2') - 16);
        const skuX = Math.max(0, getCenteredX(sku, '1'));
        const { x: barcodeX, narrow, wide } = getBarcodeParams(sku);

        if (product.hidePrice) {
          // Line 1: Shop Name (bold, shifted 2mm left)
          fullTspl += `TEXT ${shopX},6,"2",0,1,1,"${shopTitle}"\r\n`;
          // Line 2: Solid continuous line (1mm below shop name)
          fullTspl += 'BAR 0,30,400,2\r\n';

          if (textLines.length > 1) {
            const line1X = Math.max(0, getCenteredX(textLines[0], fontType) - shiftDots);
            const line2X = Math.max(0, getCenteredX(textLines[1], fontType) - shiftDots);
            fullTspl += `TEXT ${line1X},34,${fontArgs},"${textLines[0]}"\r\n`;
            fullTspl += `TEXT ${line2X},54,${fontArgs},"${textLines[1]}"\r\n`;
            fullTspl += `BARCODE ${barcodeX},82,"128",42,0,0,${narrow},${wide},"${sku}"\r\n`;
          } else {
            const nameSpecsX = Math.max(0, getCenteredX(textLines[0], fontType) - shiftDots);
            fullTspl += `TEXT ${nameSpecsX},40,${fontArgs},"${textLines[0]}"\r\n`;
            fullTspl += `BARCODE ${barcodeX},72,"128",50,0,0,${narrow},${wide},"${sku}"\r\n`;
          }
          // Line 5: Small product reference numbers
          fullTspl += `TEXT ${skuX},136,"1",0,1,1,"${sku}"\r\n`;
        } else {
          // Line 1: Shop Name (bold, shifted 2mm left)
          fullTspl += `TEXT ${shopX},6,"2",0,1,1,"${shopTitle}"\r\n`;
          // Line 2: Solid continuous line (1mm below shop name)
          fullTspl += 'BAR 0,30,400,2\r\n';

          if (textLines.length > 1) {
            const line1X = Math.max(0, getCenteredX(textLines[0], fontType) - shiftDots);
            const line2X = Math.max(0, getCenteredX(textLines[1], fontType) - shiftDots);
            fullTspl += `TEXT ${line1X},32,${fontArgs},"${textLines[0]}"\r\n`;
            fullTspl += `TEXT ${line2X},50,${fontArgs},"${textLines[1]}"\r\n`;
            fullTspl += `BARCODE ${barcodeX},70,"128",32,0,0,${narrow},${wide},"${sku}"\r\n`;
          } else {
            const nameSpecsX = Math.max(0, getCenteredX(textLines[0], fontType) - shiftDots);
            fullTspl += `TEXT ${nameSpecsX},36,${fontArgs},"${textLines[0]}"\r\n`;
            fullTspl += `BARCODE ${barcodeX},62,"128",38,0,0,${narrow},${wide},"${sku}"\r\n`;
          }
          // Line 5: Small product reference numbers
          fullTspl += `TEXT ${skuX},104,"1",0,1,1,"${sku}"\r\n`;
          // Line 6: Price in large font 4
          const priceText = fmt(product.price).replace(/"/g, '');
          const priceX = getCenteredX(priceText, '4');
          fullTspl += `TEXT ${priceX},124,"4",0,1,1,"${priceText}"\r\n`;
        }

        fullTspl += 'PRINT 1,1\r\n';
        fullTspl += 'CLS\r\n';
      }

      await executeTSPLPrint(fullTspl, LABEL_PRINTER_NAME);
      console.log(`[✓] Printed ${products.length} barcode label(s) via TSPL on ${LABEL_PRINTER_NAME}`);
      return res.json({ ok: true, message: 'Barcodes printed successfully' });
    }

    const printer = createPrinter();

    for (const product of products) {
      printer.alignCenter();
      printer.bold(true);
      printer.setTextSize(1, 1);
      printer.println(storeName || 'PhoneShop Pro');
      printer.setTextNormal();
      printer.bold(false);
      
      printer.drawLine(); // solid line from edge to edge
      
      let specs = [];
      if (product.category === 'smartphone' || product.category === 'tablet') {
        if (product.storage && product.storage !== 'N/A') specs.push(product.storage);
        if (product.color) specs.push(product.color);
      } else {
        if (product.color) specs.push(product.color);
        if (product.location) specs.push(product.location);
        if (specs.length === 0 && product.category) specs.push(product.category.replace('_', ' '));
      }
      const specsPart = specs.slice(0, 2).join(' - ');
      const fullNameAndSpecs = `${product.name || ''} ${product.model || ''}${specsPart ? ` - ${specsPart}` : ''}`.trim();
      
      printer.println(fullNameAndSpecs); // normal font weight
      printer.newLine();
      
      try {
        printer.printBarcode(product.sku, 73, { // 73 is CODE128
          width: 2,
          height: 50,
          position: 'OFF', // remove text below barcode
          font: 'A',
          includeParity: true
        });
      } catch (err) {
        printer.println(`[${product.sku}]`);
      }

      if (!product.hidePrice) {
        printer.newLine();
        printer.bold(true);
        printer.setTextSize(1, 1);
        printer.println(fmt(product.price));
        printer.setTextNormal();
        printer.bold(false);
      } else {
        printer.newLine();
      }

      printer.newLine();
      printer.newLine();

      if (HAS_CUTTER) {
        printer.cut();
      } else {
        printer.newLine();
        printer.newLine();
      }
    }

    await executePrint(printer, LABEL_PRINTER_NAME);
    console.log(`[✓] Printed ${products.length} barcode label(s) on ${LABEL_PRINTER_NAME}`);

    res.json({ ok: true, message: 'Barcodes printed successfully' });
  } catch (err) {
    console.error('[✗] Barcode print failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// Print Custom Ticket / Phone Specs Slip (Fully Isolated)
// ============================================================
app.post('/print-custom-ticket', async (req, res) => {
  try {
    const { storeName, currency = 'DZD', storeAddress, storePhone, ticketData, copies = 1 } = req.body;

    if (!ticketData) {
      return res.status(400).json({ ok: false, error: 'Missing ticket data' });
    }

    const numCopies = Math.max(1, Math.min(parseInt(copies || 1, 10), 50));
    const format = ticketData.format || '80mm';

    // 1. If format is 'sticker' and a dedicated TSPL label printer is configured
    if (format === 'sticker' && isLabelPrinter(LABEL_PRINTER_NAME)) {
      const stickerSize = ticketData.stickerSize || '50x20';
      const is30mm = stickerSize === '50x30';
      const is25mm = stickerSize === '50x25';
      const labelMm = is30mm ? 30 : is25mm ? 25 : 20; // 50x20mm standard roll matching inventory label roll
      const totalDotsH = labelMm * 8; // 160 for 20mm, 200 for 25mm, 240 for 30mm
      const maxSafeY = totalDotsH - 4; // 156 dots on 20mm (strictly bounded to fit single physical sticker)

      // ─── Free-Text Blank Sticker (Centered Horizontally & Vertically) ───
      if (ticketData.mode === 'free_text') {
        const totalW = 400; // 50mm * 8 dots/mm

        const rawText = removeAccents(String(ticketData.freeText || '').trim());
        const hasStoreName = Boolean(ticketData.showStoreNameOnSticker);
        const shopTitle = hasStoreName ? removeAccents((storeName || 'PhoneShop Pro').replace(/"/g, '').trim().substring(0, 24)) : '';
        const barcodeVal = removeAccents((ticketData.barcodeValue || '').replace(/"/g, '').trim());
        const hasBarcode = ticketData.includeBarcode && barcodeVal.length > 0;
        const isQr = hasBarcode && ticketData.barcodeType === 'qr';

        // Font selection & line metrics
        let fontType = '2';
        let charW = 12;
        let charH = 18;
        let lineSpacing = 2;
        const reqSize = ticketData.fontSize || 'auto';

        if (reqSize === 'normal') {
          fontType = '1'; charW = 8; charH = 14; lineSpacing = 2;
        } else if (reqSize === 'large') {
          fontType = '2'; charW = 12; charH = 18; lineSpacing = 2;
        } else if (reqSize === 'huge') {
          fontType = '3'; charW = 16; charH = 22; lineSpacing = 3;
        } else if (reqSize === 'giant') {
          fontType = '4'; charW = 24; charH = 28; lineSpacing = 4;
        } else {
          // Auto size: pick best readable font based on line lengths and label height
          const rawLines = rawText.split('\n');
          const maxLineLen = rawLines.reduce((acc, l) => Math.max(acc, l.trim().length), 0);
          if (rawLines.length === 1 && maxLineLen <= 8 && labelMm > 20) {
            fontType = '4'; charW = 24; charH = 28; lineSpacing = 4;
          } else if (rawLines.length <= 2 && maxLineLen <= 12) {
            fontType = '3'; charW = 16; charH = 22; lineSpacing = 3;
          } else if (rawLines.length <= 3 && maxLineLen <= 22) {
            fontType = '2'; charW = 12; charH = 18; lineSpacing = 2;
          } else {
            fontType = '1'; charW = 8; charH = 14; lineSpacing = 2;
          }
        }

        // Wrap words to fit totalW (leaving margin on sides)
        const maxCharsPerLine = Math.max(4, Math.floor((totalW - 32) / charW));
        const wrappedLines = [];
        const paragraphs = rawText ? rawText.split('\n') : [''];
        for (const para of paragraphs) {
          if (!para.trim()) {
            wrappedLines.push('');
            continue;
          }
          const words = para.split(' ');
          let curLine = '';
          for (const w of words) {
            const test = curLine ? `${curLine} ${w}` : w;
            if (test.length <= maxCharsPerLine) {
              curLine = test;
            } else {
              if (curLine) wrappedLines.push(curLine);
              curLine = w;
            }
          }
          if (curLine) wrappedLines.push(curLine);
        }

        // Preamble — strictly mirroring inventory label
        let tspl = '';
        tspl += `SIZE 50 mm, ${labelMm} mm\r\n`;
        tspl += 'GAP 2 mm, 0 mm\r\n';
        tspl += 'REFERENCE 0,0\r\n';
        tspl += 'DIRECTION 1\r\n';
        tspl += 'CLS\r\n';

        // Top reserved zone
        let topReserved = 6;
        if (hasStoreName && shopTitle) {
          const shopX = Math.max(0, getCenteredX(shopTitle, '2') - 16);
          tspl += `TEXT ${shopX},6,"2",0,1,1,"${shopTitle}"\r\n`;
          tspl += 'BAR 0,28,400,2\r\n';
          topReserved = 32;
        }

        // Bottom reserved zone
        let bottomReserved = 6;
        if (hasBarcode && barcodeVal) {
          bottomReserved = isQr ? 46 : 36;
        }

        const availableH = Math.max(16, maxSafeY - topReserved - bottomReserved);
        const totalTextH = wrappedLines.length * charH + Math.max(0, wrappedLines.length - 1) * lineSpacing;
        const startY = Math.max(topReserved, topReserved + Math.floor((availableH - totalTextH) / 2));

        // Centered Text Lines
        let lineY = startY;
        for (const line of wrappedLines) {
          if (line && (lineY + charH <= maxSafeY - bottomReserved + 4)) {
            const cleanLine = line.replace(/"/g, "'").trim();
            let lineX = 16;
            if (ticketData.textAlign === 'left') {
              lineX = 16;
            } else if (ticketData.textAlign === 'right') {
              lineX = Math.max(16, totalW - (cleanLine.length * charW) - 16 - LABEL_OFFSET_X);
            } else {
              lineX = Math.max(0, getCenteredX(cleanLine, fontType));
            }
            tspl += `TEXT ${lineX},${lineY},"${fontType}",0,1,1,"${cleanLine}"\r\n`;
          }
          lineY += charH + lineSpacing;
        }

        // Optional Barcode / QR at bottom
        if (hasBarcode && barcodeVal) {
          if (isQr) {
            const qrX = Math.max(0, Math.floor((400 - 44) / 2) - LABEL_OFFSET_X);
            tspl += `QRCODE ${qrX},${maxSafeY - 44},M,2,A,0,"${barcodeVal}"\r\n`;
          } else {
            const { x: barcodeX, narrow, wide } = getBarcodeParams(barcodeVal);
            tspl += `BARCODE ${barcodeX},${maxSafeY - 34},"128",22,0,0,${narrow},${wide},"${barcodeVal}"\r\n`;
            const bTextX = Math.max(0, getCenteredX(barcodeVal, '1'));
            tspl += `TEXT ${bTextX},${maxSafeY - 10},"1",0,1,1,"${barcodeVal}"\r\n`;
          }
        }

        tspl += `PRINT ${numCopies},1\r\n`;
        tspl += 'CLS\r\n';

        await executeTSPLPrint(tspl, LABEL_PRINTER_NAME);
        console.log(`[✓] Free-text sticker printed (${numCopies} copies, ${labelMm}mm) on ${LABEL_PRINTER_NAME}`);
        return res.json({ ok: true, message: `Printed ${numCopies} sticker(s) on ${LABEL_PRINTER_NAME}` });
      }

      // ─── Spec-List Sticker (Mirroring Inventory Label Geometry) ──────────
      // Layout: Header (Shop) → Bar → Device Name → Spec Rows → Price → Barcode
      // ─────────────────────────────────────────────────────────────────────
      const shopTitle = removeAccents((storeName || 'PhoneShop Pro').replace(/"/g, '').trim().substring(0, 24));
      const hasStoreHeader = Boolean(ticketData.showStoreHeader);
      const shopX = Math.max(0, getCenteredX(shopTitle, '2') - 16);

      // Device name
      const deviceRaw = removeAccents((ticketData.deviceModel || ticketData.title || '').replace(/"/g, '').trim().substring(0, 26));
      const devX = Math.max(0, getCenteredX(deviceRaw, '2') - 16);

      // Build ordered spec list with space before & after colon
      const rawSpecs = [];
      if (ticketData.storage)       rawSpecs.push({ label: 'Stockage', value: removeAccents(ticketData.storage) });
      if (ticketData.ram)           rawSpecs.push({ label: 'RAM',      value: removeAccents(ticketData.ram) });
      if (ticketData.batteryHealth) rawSpecs.push({ label: 'Batterie', value: removeAccents(ticketData.batteryHealth) });
      if (ticketData.condition)     rawSpecs.push({ label: 'Etat',     value: removeAccents(ticketData.condition) });
      if (ticketData.warranty)      rawSpecs.push({ label: 'Garantie', value: removeAccents(ticketData.warranty) });
      if (ticketData.color)         rawSpecs.push({ label: 'Couleur',  value: removeAccents(ticketData.color) });
      if (ticketData.imei)          rawSpecs.push({ label: 'IMEI',     value: removeAccents(ticketData.imei) });
      if (Array.isArray(ticketData.specs)) {
        for (const s of ticketData.specs) {
          if (s.label && s.value) {
            rawSpecs.push({
              label: removeAccents(String(s.label).replace(/:/g, '').replace(/"/g, '').trim().substring(0, 10)),
              value: removeAccents(String(s.value).replace(/"/g, '').trim().substring(0, 16)),
            });
          }
        }
      }

      // Barcode / QR
      const barcodeVal = removeAccents((ticketData.barcodeValue || ticketData.imei || '').replace(/"/g, '').trim());
      const hasBarcode = ticketData.includeBarcode !== false && barcodeVal.length > 0;
      const isQr = hasBarcode && ticketData.barcodeType === 'qr';
      const hasPrice = Boolean(ticketData.price);
      const cleanPriceStr = String(ticketData.price || '').replace(/\s*(DA|DZD|USD|EUR|GBP|\$|€|£)\s*$/i, '').trim();
      const priceVal = removeAccents(cleanPriceStr);
      const priceText = hasPrice && priceVal ? removeAccents(`PRIX : ${priceVal} ${currency}`) : '';

      // Bottom reservation calculations
      // Price: pinned right above barcode or pinned at bottom of label
      // Barcode: pinned at bottom
      const barcodeReserve = hasBarcode ? (isQr ? 46 : 36) : 0;
      const priceReserve = hasPrice ? (hasBarcode ? 22 : 28) : 0;
      const specsBottomLimit = maxSafeY - barcodeReserve - priceReserve;

      // Preamble — strictly mirroring inventory label
      let tspl = '';
      tspl += `SIZE 50 mm, ${labelMm} mm\r\n`;
      tspl += 'GAP 2 mm, 0 mm\r\n';
      tspl += 'REFERENCE 0,0\r\n';
      tspl += 'DIRECTION 1\r\n';
      tspl += 'CLS\r\n';

      let curY = 6;

      // Header row
      if (hasStoreHeader && shopTitle) {
        tspl += `TEXT ${shopX},6,"2",0,1,1,"${shopTitle}"\r\n`;
        tspl += 'BAR 0,30,400,2\r\n';
        curY = 32;
        if (deviceRaw) {
          tspl += `TEXT ${devX},${curY},"2",0,1,1,"${deviceRaw}"\r\n`;
          curY += 20;
          tspl += `BAR 0,${curY},400,1\r\n`;
          curY += 3;
        }
      } else if (deviceRaw) {
        tspl += `TEXT ${devX},6,"2",0,1,1,"${deviceRaw}"\r\n`;
        tspl += 'BAR 0,30,400,2\r\n';
        curY = 34;
      }

      // Spec rows — dynamically adjust between 1-column and 2-column to fit within specsBottomLimit
      const availableSpecsH = Math.max(0, specsBottomLimit - curY);
      const ROW_H = 14; // font 1 height (~13) + 1 dot gap
      const maxRows = Math.max(1, Math.floor(availableSpecsH / ROW_H));

      if (rawSpecs.length <= maxRows) {
        // Single column: "Label : Value"
        for (const s of rawSpecs) {
          if (curY + ROW_H <= specsBottomLimit + 2) {
            const line = `${s.label} : ${s.value}`.substring(0, 42);
            tspl += `TEXT 12,${curY},"1",0,1,1,"${line}"\r\n`;
            curY += ROW_H;
          }
        }
      } else {
        // Two columns paired: "Label: Val | Label: Val"
        for (let i = 0; i < rawSpecs.length && (curY + ROW_H <= specsBottomLimit + 2); i += 2) {
          const s1 = rawSpecs[i];
          const s2 = rawSpecs[i + 1];
          const col1 = `${s1.label} : ${s1.value}`.substring(0, 18);
          const col2 = s2 ? `${s2.label} : ${s2.value}`.substring(0, 18) : '';
          const line = col2 ? `${col1.padEnd(20, ' ')}| ${col2}` : col1;
          tspl += `TEXT 10,${curY},"1",0,1,1,"${line}"\r\n`;
          curY += ROW_H;
        }
      }

      // Price row (pinned right above barcode or bottom)
      if (hasPrice) {
        const priceY = maxSafeY - barcodeReserve - (hasBarcode ? 20 : 26);
        tspl += `BAR 0,${priceY - 2},400,1\r\n`;
        // Choose best font for price: Font 4 if fits, else Font 3 or Font 2
        let priceFont = '2';
        if (!hasBarcode && priceText.length * 24 <= 380) {
          priceFont = '4';
        } else if (priceText.length * 16 <= 380) {
          priceFont = '3';
        }
        const priceX = Math.max(12, getCenteredX(priceText, priceFont));
        tspl += `TEXT ${priceX},${priceY},"${priceFont}",0,1,1,"${priceText}"\r\n`;
      }

      // Barcode / QR row (pinned strictly at bottom of label)
      if (hasBarcode && barcodeVal) {
        const barStartY = maxSafeY - barcodeReserve;
        tspl += `BAR 0,${barStartY - 2},400,1\r\n`;
        if (isQr) {
          const qrX = Math.max(0, Math.floor((400 - 44) / 2) - LABEL_OFFSET_X);
          tspl += `QRCODE ${qrX},${barStartY + 1},M,2,A,0,"${barcodeVal}"\r\n`;
        } else {
          const { x: barcodeX, narrow, wide } = getBarcodeParams(barcodeVal);
          tspl += `BARCODE ${barcodeX},${barStartY + 1},"128",20,0,0,${narrow},${wide},"${barcodeVal}"\r\n`;
          const bTextX = Math.max(0, getCenteredX(barcodeVal, '1'));
          tspl += `TEXT ${bTextX},${barStartY + 23},"1",0,1,1,"${barcodeVal}"\r\n`;
        }
      }

      tspl += `PRINT ${numCopies},1\r\n`;
      tspl += 'CLS\r\n';

      await executeTSPLPrint(tspl, LABEL_PRINTER_NAME);
      console.log(`[✓] Custom spec sticker printed (${numCopies} copies, ${labelMm}mm) on ${LABEL_PRINTER_NAME}`);
      return res.json({ ok: true, message: `Printed ${numCopies} sticker(s) on ${LABEL_PRINTER_NAME}` });
    }


    // 2. Standard Thermal Paper Print (80mm or 58mm) on PRINTER_NAME
    const widthChars = format === '58mm' ? 32 : 42;
    const targetPrinter = PRINTER_NAME;

    if (ticketData.mode === 'free_text') {
      for (let c = 0; c < numCopies; c++) {
        const printer = new ThermalPrinter({
          type: PrinterTypes.EPSON,
          characterSet: CharacterSet.PC852_LATIN2,
          removeSpecialCharacters: false,
          lineCharacter: '-',
          width: widthChars,
        });

        if (ticketData.showStoreNameOnSticker && storeName) {
          printer.alignCenter();
          printer.bold(true);
          printer.println(storeName.substring(0, widthChars));
          printer.drawLine();
          printer.bold(false);
        }

        printer.newLine();
        if (ticketData.textAlign === 'left') {
          printer.alignLeft();
        } else if (ticketData.textAlign === 'right') {
          printer.alignRight();
        } else {
          printer.alignCenter();
        }

        printer.bold(ticketData.isBold !== false);
        if (ticketData.fontSize === 'huge' || ticketData.fontSize === 'giant') {
          printer.setTextSize(1, 1);
        }

        const lines = (ticketData.freeText || '').split('\n');
        for (const l of lines) {
          printer.println(l);
        }
        printer.setTextNormal();
        printer.bold(false);

        if (ticketData.includeBarcode && ticketData.barcodeValue) {
          printer.drawLine();
          printer.alignCenter();
          const bcVal = ticketData.barcodeValue.trim();
          if (ticketData.barcodeType === 'qr') {
            try { printer.printQR(bcVal, { cellSize: 4, correction: 'M', model: 2 }); } catch (_) { printer.println(`[${bcVal}]`); }
          } else {
            try { printer.printBarcode(bcVal, 73, { height: 36, width: 2, position: 'BELOW' }); } catch (_) { printer.println(`*${bcVal}*`); }
          }
        }

        printer.newLine();
        printer.newLine();
        printer.newLine();
        if (HAS_CUTTER) {
          printer.cut();
        } else {
          printer.newLine();
          printer.newLine();
        }

        await new Promise((resolve, reject) => {
          try {
            const buffer = printer.getBuffer();
            const randomSuffix = Math.random().toString(36).substring(2, 8);
            const tmpFilePath = path.join(os.tmpdir(), `custom_ticket_free_${Date.now()}_${randomSuffix}.bin`);
            fs.writeFileSync(tmpFilePath, buffer);

            execFile('lpr', ['-P', PRINTER_NAME, '-o', 'raw', tmpFilePath], (error) => {
              try { fs.unlinkSync(tmpFilePath); } catch (_e) {}
              if (error) {
                reject(new Error(`lpr error: ${error.message}`));
                return;
              }
              resolve();
            });
          } catch (err) {
            reject(err);
          }
        });
      }
      return res.json({ ok: true, message: `Printed ${numCopies} slip(s) on ${PRINTER_NAME}` });
    }

    for (let c = 0; c < numCopies; c++) {
      const printer = new ThermalPrinter({
        type: PrinterTypes.EPSON,
        characterSet: CharacterSet.PC852_LATIN2,
        removeSpecialCharacters: false,
        lineCharacter: '-',
        width: widthChars,
      });

      // Store Header
      if (ticketData.showStoreHeader !== false) {
        printer.alignCenter();
        printer.bold(true);
        printer.setTextSize(1, 1);
        printer.println((storeName || 'PhoneShop Pro').substring(0, widthChars));
        printer.bold(false);
        printer.setTextNormal();

        if (storePhone) printer.println(`Tel: ${storePhone}`.substring(0, widthChars));
        if (storeAddress) printer.println(storeAddress.substring(0, widthChars));
        printer.drawLine();
      }

      // Ticket Title
      printer.alignCenter();
      printer.bold(true);
      printer.println((ticketData.title || '*** SPECIFICATION SLIP ***').substring(0, widthChars));
      printer.bold(false);
      if (ticketData.subtitle) {
        printer.println(ticketData.subtitle.substring(0, widthChars));
      }
      printer.println(new Date().toLocaleString());
      printer.drawLine();

      // Device Model
      if (ticketData.deviceModel) {
        printer.alignCenter();
        printer.bold(true);
        printer.setTextSize(1, 1);
        printer.println(ticketData.deviceModel.substring(0, widthChars));
        printer.bold(false);
        printer.setTextNormal();
        printer.drawLine();
      }

      // Two-column Specs List
      printer.alignLeft();
      const specsList = [];
      if (ticketData.condition) specsList.push({ label: 'Condition:', value: ticketData.condition });
      if (ticketData.storage) specsList.push({ label: 'Storage:', value: ticketData.storage });
      if (ticketData.ram) specsList.push({ label: 'RAM:', value: ticketData.ram });
      if (ticketData.color) specsList.push({ label: 'Color:', value: ticketData.color });
      if (ticketData.batteryHealth) specsList.push({ label: 'Battery:', value: ticketData.batteryHealth });
      if (ticketData.warranty) specsList.push({ label: 'Warranty:', value: ticketData.warranty });
      if (ticketData.imei) specsList.push({ label: 'IMEI/SN:', value: ticketData.imei });

      if (Array.isArray(ticketData.specs)) {
        for (const s of ticketData.specs) {
          if (s.label && s.value) {
            specsList.push({ label: s.label.endsWith(':') ? s.label : `${s.label}:`, value: s.value });
          }
        }
      }

      for (const s of specsList) {
        printer.println(twoColumnRow(s.label, s.value, widthChars));
      }

      // Price
      if (ticketData.price) {
        printer.drawLine();
        printer.bold(true);
        const cleanPrice = String(ticketData.price).replace(/\s*(DA|DZD|USD|EUR|GBP|\$|€|£)\s*$/i, '').trim();
        printer.println(twoColumnRow('PRICE:', `${cleanPrice} ${currency}`, widthChars));
        printer.bold(false);
      }

      // Notes
      if (ticketData.notes) {
        printer.drawLine();
        printer.alignLeft();
        printer.println('Notes / Details:');
        printer.println(ticketData.notes);
      }

      // Barcode or QR
      if (ticketData.includeBarcode && ticketData.barcodeValue) {
        printer.drawLine();
        printer.alignCenter();
        const codeVal = ticketData.barcodeValue.trim();
        if (ticketData.barcodeType === 'qr') {
          try {
            printer.printQR(codeVal, { cellSize: 4, correction: 'M', model: 2 });
          } catch (_e) {
            printer.println(`[${codeVal}]`);
          }
        } else {
          try {
            printer.printBarcode(codeVal, 73, { height: 40, width: 2, position: 'BELOW' });
          } catch (_e) {
            printer.println(`*${codeVal}*`);
          }
        }
      }

      // Footer
      if (ticketData.showStoreFooter !== false) {
        printer.drawLine();
        printer.alignCenter();
        printer.println((ticketData.customFooter || 'Thank you for choosing PhoneShop Pro!').substring(0, widthChars));
      }

      printer.newLine();
      printer.newLine();

      if (HAS_CUTTER && format !== 'sticker') {
        printer.cut();
      } else {
        printer.newLine();
      }

      // Dedicated isolated execution (custom_ticket_ file prefix)
      await new Promise((resolve, reject) => {
        try {
          const buffer = printer.getBuffer();
          const randomSuffix = Math.random().toString(36).substring(2, 8);
          const tmpFilePath = path.join(os.tmpdir(), `custom_ticket_${Date.now()}_${randomSuffix}.bin`);
          fs.writeFileSync(tmpFilePath, buffer);

          execFile('lpr', ['-P', targetPrinter, '-o', 'raw', tmpFilePath], (error) => {
            try { fs.unlinkSync(tmpFilePath); } catch (_e) {}
            if (error) {
              reject(new Error(`lpr error: ${error.message}`));
              return;
            }
            resolve();
          });
        } catch (err) {
          reject(err);
        }
      });
    }

    console.log(`[✓] Custom ticket printed (${numCopies} cop${numCopies > 1 ? 'ies' : 'y'}) on ${targetPrinter}`);
    return res.json({ ok: true, message: `Custom ticket printed successfully on ${targetPrinter}` });
  } catch (err) {
    console.error('[✗] Custom ticket print failed:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /calibrate-labels — Recalibrate the label printer's gap sensor
 * Sends TSPL GAPDETECT command to detect label pitch, followed by FORMFEED to sync at the gap.
 */
app.post('/calibrate-labels', async (req, res) => {
  try {
    if (!isLabelPrinter(LABEL_PRINTER_NAME)) {
      return res.status(400).json({ ok: false, error: `Configured printer "${LABEL_PRINTER_NAME}" is not a label printer.` });
    }
    // GAPDETECT calibrates the gap sensor; FORMFEED aligns right to the tear/gap line
    const tspl = 'GAPDETECT\r\nFORMFEED\r\n';
    await executeTSPLPrint(tspl, LABEL_PRINTER_NAME);
    console.log(`[✓] Gap sensor calibrated successfully on ${LABEL_PRINTER_NAME}`);
    return res.json({ ok: true, message: 'Label printer gap sensor calibrated and aligned successfully.' });
  } catch (err) {
    console.error('[✗] Label calibration failed:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// Start
// ============================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ┌──────────────────────────────────────────┐');
  console.log(`  │  🖨️  Print Server running on port ${PORT}     │`);
  console.log(`  │  Receipt: ${padRight(PRINTER_NAME, 30)}│`);
  console.log(`  │  Labels:  ${padRight(LABEL_PRINTER_NAME, 30)}│`);
  console.log(`  │  Cutter:  ${padRight(HAS_CUTTER ? 'Yes' : 'No', 30)}│`);
  console.log('  │                                          │');
  console.log(`  │  Health:  http://0.0.0.0:${PORT}/status     │`);
  console.log('  └──────────────────────────────────────────┘');
  console.log('');
});
