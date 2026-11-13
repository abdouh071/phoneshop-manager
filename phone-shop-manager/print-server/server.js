/**
 * Phone Shop Print Server
 * 
 * Local Express server that receives receipt data from the web app
 * and sends ESC/POS commands directly to the XP-T80Q thermal printer
 * via the macOS CUPS print queue.
 *
 * This process writes to real paper and to printer firmware, so it is closed
 * by default: it listens on loopback only, answers only the till's own browser
 * origins (or a bearer token for anything else), treats every text field in a
 * payload as data that must never reach the command stream, and spools one job
 * at a time. See print-server/README.md for the env flags that reopen any of it.
 *
 * Usage:
 *   1. Copy .env.example to .env and set your PRINTER_NAME
 *   2. npm install
 *   3. npm start
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Resolve .env across all possible paths (direct, parent, resources)
const candidateEnvPaths = [
  process.env.DOTENV_CONFIG_PATH,
  path.join(__dirname, '.env'),
  path.join(__dirname, '..', 'print-server', '.env'),
  path.join(process.resourcesPath || '', 'print-server', '.env'),
  path.join(process.resourcesPath || '', '.env'),
];
for (const p of candidateEnvPaths) {
  if (p && fs.existsSync(p)) {
    require('dotenv').config({ path: p });
    break;
  }
}

const express = require('express');
const crypto = require('crypto');
const http = require('http');
const { execFile } = require('child_process');
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

// ============================================================
// Hardening configuration
// ============================================================
// Everything below is the difference between "a service the till uses" and
// "a service anything on the network can hand raw printer firmware to".

const SERVICE_ID = 'phone-shop-print-server';
const SERVER_VERSION = '2.0';

const flagFrom = (value, dflt) =>
  value === undefined || value === '' ? dflt : /^(1|true|yes|on)$/i.test(String(value));

const intFrom = (value, dflt, min, max) => {
  const n = Number.parseInt(String(value === undefined || value === null ? '' : value).trim(), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
};

const PORT = intFrom(process.env.PORT, 3355, 1, 65535);
const PRINTER_NAME = process.env.PRINTER_NAME || 'Printer_POS_80';
const LABEL_PRINTER_NAME = process.env.LABEL_PRINTER_NAME || 'Xprinter_XP_420B';
const HAS_CUTTER = process.env.HAS_CUTTER !== 'false'; // default true
const LABEL_OFFSET_X = parseInt(process.env.LABEL_OFFSET_X || '12', 10); // dots to shift left to compensate for printer's built-in left margin

/** Loopback unless the operator asks for the LAN; `0.0.0.0` was never a deliberate choice. */
const LAN_MODE = flagFrom(process.env.PRINT_SERVER_LAN_MODE, false);
const BIND_HOST = String(process.env.PRINT_SERVER_HOST || (LAN_MODE ? '0.0.0.0' : '127.0.0.1')).trim() || '127.0.0.1';
/** Escape hatch that restores the pre-hardening behaviour without a code change. */
const OPEN_MODE = flagFrom(process.env.PRINT_SERVER_ALLOW_UNAUTHENTICATED, false);
/** Only implied by LAN mode: a tablet browsing the till over the shop Wi-Fi. */
const TRUST_PRIVATE_ORIGINS = flagFrom(process.env.PRINT_SERVER_TRUST_PRIVATE_ORIGINS, LAN_MODE);
/** Printing to the system default queue is how a receipt ends up on the office laser printer. */
const ALLOW_DEFAULT_PRINTER = flagFrom(process.env.PRINT_SERVER_ALLOW_DEFAULT_PRINTER, false);

const MAX_COPIES = intFrom(process.env.PRINT_SERVER_MAX_COPIES, 25, 1, 999);
const MAX_LABELS_PER_JOB = intFrom(process.env.PRINT_SERVER_MAX_LABELS_PER_JOB, 120, 1, 500);
/** A 2 mb body can declare a 20 000 × 20 000 bitmap; the size is checked before decoding. */
const MAX_LOGO_PIXELS = intFrom(process.env.PRINT_SERVER_MAX_LOGO_PIXELS, 4000000, 10000, 50000000);
const MAX_TEXT_LEN = intFrom(process.env.PRINT_SERVER_MAX_TEXT_LEN, 4096, 64, 1000000);
const MAX_ARRAY_LEN = intFrom(process.env.PRINT_SERVER_MAX_ARRAY_LEN, 1000, 10, 20000);
const MAX_QUEUE_DEPTH = intFrom(process.env.PRINT_SERVER_MAX_QUEUE_DEPTH, 12, 1, 200);
const LPR_TIMEOUT_MS = intFrom(process.env.PRINT_SERVER_LPR_TIMEOUT_MS, 20000, 2000, 300000);
const CUPS_QUERY_TIMEOUT_MS = intFrom(process.env.PRINT_SERVER_CUPS_QUERY_TIMEOUT_MS, 5000, 500, 60000);
const RATE_WINDOW_MS = intFrom(process.env.PRINT_SERVER_RATE_WINDOW_MS, 60000, 5000, 3600000);
const RATE_MAX_JOBS = intFrom(process.env.PRINT_SERVER_RATE_MAX_JOBS, 40, 1, 100000);

const ALLOWED_ORIGINS = [
  'https://phoneshop-mgr-pro-2026.web.app',
  ...(process.env.PRINT_SERVER_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
];

/**
 * The token is what a non-browser client (curl, another service, a scripted
 * spooler) must present. Browsers are covered by the Origin check instead, so
 * the hosted till and the desktop app keep working with no configuration.
 */
const TOKEN_DIR = path.join(os.homedir() || os.tmpdir(), '.phone-shop-print-server');
const TOKEN_FILE = path.join(TOKEN_DIR, 'token');

const readTokenFile = (p) => {
  try {
    return fs.readFileSync(p, 'utf8').trim();
  } catch {
    return '';
  }
};

function resolvePrintToken() {
  const configured = String(process.env.PRINT_SERVER_TOKEN || '').trim();
  if (configured.length >= 16) return configured;
  const stored = readTokenFile(TOKEN_FILE);
  if (stored.length >= 16) return stored;
  const generated = crypto.randomBytes(24).toString('hex');
  try {
    fs.mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(TOKEN_FILE, generated, { mode: 0o600 });
  } catch (err) {
    console.warn(`[PrintServer] Could not persist a print token to ${TOKEN_FILE} (${err.message}); set PRINT_SERVER_TOKEN for non-browser clients.`);
  }
  return generated;
}

const PRINT_TOKEN = resolvePrintToken();

function tokenMatches(candidate) {
  if (typeof candidate !== 'string' || PRINT_TOKEN.length === 0) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(PRINT_TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (h.endsWith('.local')) return true;
  return (
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(h) ||
    /^169\.254\./.test(h)
  );
}

/** A browser sets this header itself and a page cannot forge it — that is the whole defence. */
function originAllowed(origin) {
  if (!origin || origin === 'null') return false;
  let url;
  try {
    url = new URL(String(origin));
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return TRUST_PRIVATE_ORIGINS && isPrivateHost(host);
}

function authorize(req) {
  if (OPEN_MODE) return { allowed: true, via: 'open' };
  if (tokenMatches(req.headers['x-print-token'])) return { allowed: true, via: 'token' };
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== '') {
    return originAllowed(origin)
      ? { allowed: true, via: 'origin' }
      : { allowed: false, status: 403, code: 'origin_not_allowed', error: `Origin not allowed: ${origin}` };
  }
  return { allowed: false, status: 401, code: 'token_required', error: 'Missing X-Print-Token header.' };
}

// --- Middleware ---
// Chrome's Private Network Access preflight is answered for origins we already
// accept, so the hosted till keeps reaching loopback and no other page can.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const trusted = typeof origin === 'string' && originAllowed(origin);
  res.setHeader('Vary', 'Origin');
  if (trusted) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Print-Token');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
  }
  if (req.method === 'OPTIONS') {
    if (trusted) return res.sendStatus(204);
    return res.status(403).json({ ok: false, code: 'origin_not_allowed', error: 'Origin not allowed.' });
  }
  next();
});

app.use(express.json({ limit: process.env.PRINT_SERVER_BODY_LIMIT || '2mb' }));

// --- Payload sanitising ---
// Base64 image payloads are decoded and validated by the raster code, not the
// printer command stream, so they keep their bytes.
const RAW_IMAGE_KEYS = new Set(['logo', 'image', 'base64', 'dataurl', 'logodata', 'stampimage', 'signatureimage']);

/**
 * Tabs and newlines survive: ticket layout splits free text on \n and aligns
 * columns with \t. Every other C0 control byte is a printer command prefix.
 * null/undefined become empty text rather than the words "null"/"undefined".
 */
function stripControlChars(value, maxLen = MAX_TEXT_LEN) {
  if (value === null || value === undefined) return '';
  const clean = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return clean.length > maxLen ? clean.slice(0, maxLen) : clean;
}

function sanitizePayload(value, keyHint, depth = 0) {
  if (typeof value === 'string') {
    if (RAW_IMAGE_KEYS.has(String(keyHint).toLowerCase())) return value;
    if (value.length > MAX_TEXT_LEN) {
      console.warn(`[PrintServer] Field "${keyHint}" was ${value.length} chars and has been trimmed to ${MAX_TEXT_LEN}.`);
    }
    return stripControlChars(value);
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 8) return null;
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LEN) {
      console.warn(`[PrintServer] Collection "${keyHint}" had ${value.length} entries; only the first ${MAX_ARRAY_LEN} print.`);
    }
    return value.slice(0, MAX_ARRAY_LEN).map((v) => sanitizePayload(v, keyHint, depth + 1));
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    // An IPC payload can carry an own "__proto__"; assigning that would change
    // the object's prototype instead of adding a field.
    if (k === '__proto__') continue;
    out[k] = sanitizePayload(v, k, depth + 1);
  }
  return out;
}

app.use((req, _res, next) => {
  if (req.body && typeof req.body === 'object') req.body = sanitizePayload(req.body, 'body');
  next();
});

/**
 * Text that goes inside a quoted TSPL field: one line, no quote that could end
 * the field, no backslash, bounded length. Everything the label printer reads
 * after this point is data.
 */
function tsplText(value, maxLen = 60) {
  const oneLine = stripControlChars(value, maxLen)
    .replace(/["\\]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return oneLine.slice(0, maxLen);
}

/**
 * A TSPL field assembled from pieces that were sanitised individually: the
 * column padding carries the layout, so only the field-ending characters go.
 */
function tsplField(value, maxLen = 60) {
  const clean = stripControlChars(value, maxLen).replace(/["\\]/g, '').replace(/[\r\n\t]+/g, ' ');
  return clean.slice(0, maxLen);
}

/** A TSPL numeric parameter: never NaN, never a float, always inside the range. */
function tsplInt(value, dflt, min, max) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

const clampCopies = (value) => tsplInt(value, 1, 1, MAX_COPIES);

function printFailure(err) {
  const status = Number.isFinite(err && err.status) ? err.status : 500;
  return { ok: false, status, error: String((err && err.message) || 'Print failed') };
}

// --- Rate limiting ---
const rateBuckets = new Map();

function takeRateSlot(clientKey) {
  const now = Date.now();
  let bucket = rateBuckets.get(clientKey);
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
    rateBuckets.set(clientKey, bucket);
  }
  bucket.count += 1;
  if (rateBuckets.size > 500) {
    for (const [key, value] of rateBuckets) {
      if (now - value.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(key);
    }
  }
  return bucket.count > RATE_MAX_JOBS ? RATE_WINDOW_MS - (now - bucket.startedAt) : 0;
}

// --- Serialized print queue ---
// Two receipts spooled at once interleave into unreadable paper, so only one
// job ever reaches CUPS at a time.
let printChain = Promise.resolve();
let printQueueDepth = 0;

function enqueuePrint(label, job) {
  if (printQueueDepth >= MAX_QUEUE_DEPTH) {
    const err = new Error(`Print queue is full (${MAX_QUEUE_DEPTH} jobs waiting); ${label} rejected.`);
    err.status = 429;
    return Promise.reject(err);
  }
  printQueueDepth += 1;
  const startedAt = Date.now();
  const run = printChain.then(() => job());
  const tracked = run.then(
    (value) => {
      printQueueDepth -= 1;
      return value;
    },
    (err) => {
      printQueueDepth -= 1;
      throw err;
    }
  );
  printChain = tracked.then(
    () => undefined,
    () => undefined
  );
  return tracked.then((value) => {
    if (Date.now() - startedAt > 5000) {
      console.log(`[PrintServer] ${label} waited ${Date.now() - startedAt}ms behind other jobs.`);
    }
    return value;
  });
}

/**
 * Every route that moves paper goes through the same three gates: who is asking,
 * how often they have asked, and one job at a time on the queue below.
 */
function printRoute(handler) {
  return async (req, res) => {
    const auth = authorize(req);
    if (!auth.allowed) {
      console.warn(`[PrintServer] Rejected ${req.method} ${req.path}: ${auth.error}`);
      res.status(auth.status).json({ ok: false, code: auth.code, error: auth.error });
      return;
    }
    const retryAfterMs = takeRateSlot(`${req.socket.remoteAddress || 'unknown'}|${req.headers.origin || 'no-origin'}`);
    if (retryAfterMs > 0) {
      const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      res.set('Retry-After', String(seconds));
      console.warn(`[PrintServer] Rate limit hit for ${req.socket.remoteAddress}; ${req.path} rejected.`);
      res.status(429).json({ ok: false, status: 429, code: 'rate_limited', error: `Too many print jobs. Retry in ${seconds}s.` });
      return;
    }
    try {
      const result = await handler(req.body, req);
      res.status(result && result.ok ? 200 : (result && result.status) || 500).json(result);
    } catch (err) {
      console.error(`[✗] ${req.path} failed:`, err.stack || err.message);
      res.status(err.status || 500).json(printFailure(err));
    }
  };
}

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
/** The IHDR size, read before pngjs allocates for it. */
function pngDimensions(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function buildEscStarBitImage(pngBuffer, options = {}) {
  try {
    const declared = pngDimensions(pngBuffer);
    if (declared && declared.width * declared.height > MAX_LOGO_PIXELS) {
      console.warn(`[Logo Print] Refusing a ${declared.width}x${declared.height} image (over ${MAX_LOGO_PIXELS} pixels).`);
      return null;
    }
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

// --- Execute Print — Cross-platform (macOS/Linux: lpr, Windows: copy /b + winspool.drv fallback) ---

// Read embedded print-raw.ps1 script content to guarantee physical extraction if inside app.asar
let EMBEDDED_RAW_PRINT_SCRIPT = '';
try {
  const localPs1 = path.join(__dirname, 'print-raw.ps1');
  if (fs.existsSync(localPs1)) {
    EMBEDDED_RAW_PRINT_SCRIPT = fs.readFileSync(localPs1, 'utf8');
  }
} catch (_) {}

function getPhysicalScriptPath() {
  // 1. If running unpacked outside asar, use local file directly
  if (!__dirname.includes('app.asar')) {
    const local = path.join(__dirname, 'print-raw.ps1');
    if (fs.existsSync(local)) return local;
  }

  // 2. Check extraResources scripts folder (created by electron-builder)
  if (process.resourcesPath) {
    const resScript = path.join(process.resourcesPath, 'scripts', 'print-raw.ps1');
    if (fs.existsSync(resScript)) return resScript;

    const resPs = path.join(process.resourcesPath, 'print-server', 'print-raw.ps1');
    if (fs.existsSync(resPs)) return resPs;

    const resUnpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'print-raw.ps1');
    if (fs.existsSync(resUnpacked)) return resUnpacked;
  }

  // 3. Check unpacked asar path
  if (__dirname.includes('app.asar')) {
    const unpacked = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'print-raw.ps1');
    if (fs.existsSync(unpacked)) return unpacked;
  }

  // 4. Guaranteed physical fallback: write to temp directory so external powershell.exe can read it
  const tempScript = path.join(os.tmpdir(), 'phoneshop_print_raw.ps1');
  try {
    if (EMBEDDED_RAW_PRINT_SCRIPT) {
      fs.writeFileSync(tempScript, EMBEDDED_RAW_PRINT_SCRIPT, 'utf8');
      return tempScript;
    }
  } catch (err) {
    console.error('[PrintServer] Failed to write temp PowerShell script:', err.message);
  }
  return null;
}

function sendRawToWindowsPrinter(tmpFilePath, targetPrinter) {
  return new Promise((resolve, reject) => {
    const psScriptPath = getPhysicalScriptPath();

    if (psScriptPath) {
      // Primary: Use native winspool.drv via physical PowerShell script (instant, works for all USB & network printers)
      const safeScript = psScriptPath.replace(/'/g, "''");
      const safePrinter = (targetPrinter || '').replace(/'/g, "''");
      const safeFile = tmpFilePath.replace(/'/g, "''");
      const psCommand = `& '${safeScript}' -PrinterName '${safePrinter}' -FilePath '${safeFile}'; exit $LASTEXITCODE`;

      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 10000,
          windowsHide: true,
        },
        (psErr, stdout, stderr) => {
          if (!psErr) {
            try { fs.unlinkSync(tmpFilePath); } catch (e) {}
            console.log(`[PrintServer] ${stdout.trim() || 'Windows print completed'}`);
            return resolve();
          }

          // Fallback: Copy to shared printer if PowerShell failed
          execFile(
            'cmd.exe',
            ['/c', 'copy', '/b', tmpFilePath, `\\\\%COMPUTERNAME%\\${targetPrinter}`],
            { shell: false, windowsHide: true, timeout: 3000 },
            (copyErr) => {
              try { fs.unlinkSync(tmpFilePath); } catch (e) {}
              if (!copyErr) {
                return resolve();
              }
              const errMsg = stderr || stdout || psErr.message;
              reject(new Error(`Windows print error on '${targetPrinter}': ${errMsg.trim()}`));
            }
          );
        }
      );
    } else {
      // Fallback: Copy to shared printer if script not found
      execFile(
        'cmd.exe',
        ['/c', 'copy', '/b', tmpFilePath, `\\\\%COMPUTERNAME%\\${targetPrinter}`],
        { shell: false, windowsHide: true, timeout: 3000 },
        (copyErr) => {
          try { fs.unlinkSync(tmpFilePath); } catch (e) {}
          if (!copyErr) return resolve();
          reject(new Error(`Windows print error: Could not copy to '\\\\%COMPUTERNAME%\\${targetPrinter}' (${copyErr.message}) and print-raw.ps1 physical script could not be located.`));
        }
      );
    }
  });
}

function execPrint(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {
      timeout: opts.timeout || LPR_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: opts.maxBuffer || 1024 * 1024,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err) {
        const detail = err.killed
          ? `did not answer within ${opts.timeout || LPR_TIMEOUT_MS}ms`
          : String(stderr || err.message).trim();
        // lpr repeats its own name in stderr and ENOENT arrives as "spawn lpr …".
        const namesItself = detail.startsWith(`${cmd}:`) || detail.startsWith(`spawn ${cmd}`);
        const error = new Error(namesItself ? detail : `${cmd} ${detail}`);
        error.cause = err;
        return reject(error);
      }
      resolve(String(stdout || ''));
    });
  });
}

const lprToQueue = (tmpFilePath, queueName) =>
  execPrint('lpr', queueName ? ['-P', queueName, '-o', 'raw', tmpFilePath] : ['-o', 'raw', tmpFilePath]);

const jobIdFromLprOutput = (output) => {
  const match = /request id is\s+(\S+)/i.exec(String(output || ''));
  return match ? match[1] : null;
};

/** `null` means "CUPS could not be asked", which is different from "no queue matches". */
async function listCupsPrinters() {
  try {
    const out = await execPrint('lpstat', ['-e'], { timeout: CUPS_QUERY_TIMEOUT_MS });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (err) {
    console.warn(`[CUPS] lpstat -e failed: ${err.message}`);
    return null;
  }
}

const normalizePrinterName = (name) => String(name || '').replace(/[-_\s]/g, '').toLowerCase();

/**
 * A substitute queue has to carry the configured name. The old test also
 * accepted anything whose name contained "80", which is how a receipt job lands
 * on a unrelated queue. Short configured names get exact matching only.
 */
function chooseSubstitutePrinter(targetPrinter, printers, labelOnly) {
  if (!Array.isArray(printers) || printers.length === 0) return null;
  const cleanTarget = normalizePrinterName(targetPrinter);
  return (
    printers.find((p) => {
      if (p === targetPrinter) return false;
      if (labelOnly && !isLabelPrinter(p)) return false;
      const clean = normalizePrinterName(p);
      if (!clean) return false;
      if (clean === cleanTarget) return true;
      if (cleanTarget.length < 4) return false;
      return clean.includes(cleanTarget) || cleanTarget.includes(clean);
    }) || null
  );
}

/**
 * `lpr` only means the job reached CUPS, never that paper came out. The last
 * outcome is kept so /status can say so instead of the print call claiming more
 * than it knows.
 */
let lastJobOutcome = null;
function recordJobOutcome(outcome) {
  lastJobOutcome = { ...outcome, at: new Date().toISOString() };
}

/**
 * One spool write, one queue, no silent surprises.
 *
 * The old chain ended with `lpr` with no `-P`, which put a receipt or a raw TSPL
 * stream on whatever the machine's default printer happened to be. An
 * alternative queue is now only accepted when its name really matches the
 * configured one (and, for labels, when it is recognisably a label printer).
 */
async function sendRawToCups(tmpFilePath, targetPrinter, { labelOnly = false } = {}) {
  let lastError;
  try {
    const out = await lprToQueue(tmpFilePath, targetPrinter);
    const jobId = jobIdFromLprOutput(out);
    recordJobOutcome({ ok: true, printer: targetPrinter, jobId, queued: true });
    return { printer: targetPrinter, jobId, queued: true };
  } catch (err) {
    lastError = err;
    console.warn(`[CUPS] '${targetPrinter}' rejected the job: ${err.message}`);
  }

  const printers = await listCupsPrinters();
  const substitute = chooseSubstitutePrinter(targetPrinter, printers, labelOnly);
  if (substitute) {
    try {
      const out = await lprToQueue(tmpFilePath, substitute);
      console.warn(`[CUPS] Job spooled on substitute queue '${substitute}' instead of '${targetPrinter}'.`);
      recordJobOutcome({ ok: true, printer: substitute, substituted: true, warning: `Printed to '${substitute}', not the configured '${targetPrinter}'.` });
      return { printer: substitute, jobId: jobIdFromLprOutput(out), substituted: true };
    } catch (err) {
      lastError = err;
    }
  }

  if (ALLOW_DEFAULT_PRINTER) {
    try {
      const out = await lprToQueue(tmpFilePath, null);
      console.warn('[CUPS] Job went to the system default queue (PRINT_SERVER_ALLOW_DEFAULT_PRINTER=1).');
      recordJobOutcome({ ok: true, printer: 'system default', warning: 'Used the system default queue.' });
      return { printer: 'system default', jobId: jobIdFromLprOutput(out), usedDefault: true };
    } catch (err) {
      lastError = err;
    }
  }

  const hint = printers === null
    ? ' (CUPS queue listing failed — is lpstat installed?)'
    : substitute === null && !ALLOW_DEFAULT_PRINTER
      ? ` — no queue matches '${targetPrinter}' and the default-printer fallback is disabled. Set PRINT_SERVER_ALLOW_DEFAULT_PRINTER=1 only if this machine must use its default queue.`
      : '';
  const error = new Error(`Print failed on '${targetPrinter}': ${lastError.message}${hint}`);
  error.status = 502;
  recordJobOutcome({ ok: false, printer: targetPrinter, error: error.message });
  throw error;
}

function spoolBuffer(buffer, targetPrinter, kind, options) {
  const suffix = crypto.randomBytes(4).toString('hex');
  const tmpFilePath = path.join(os.tmpdir(), `${kind}_${Date.now()}_${suffix}.bin`);
  // The spool file holds customer names and phone numbers; it is not world-readable.
  fs.writeFileSync(tmpFilePath, buffer, { mode: 0o600 });

  const handOff = os.platform() === 'win32'
    ? sendRawToWindowsPrinter(tmpFilePath, targetPrinter).then(() => {
        recordJobOutcome({ ok: true, printer: targetPrinter, queued: true });
        return { printer: targetPrinter, queued: true };
      })
    : sendRawToCups(tmpFilePath, targetPrinter, options);

  return handOff.finally(() => {
    try { fs.unlinkSync(tmpFilePath); } catch (e) {}
  });
}

function executePrint(printer, targetPrinter = PRINTER_NAME) {
  const buffer = printer.getBuffer();
  return enqueuePrint(`receipt on ${targetPrinter}`, () => spoolBuffer(buffer, targetPrinter, 'receipt', { labelOnly: false }));
}

// --- Execute TSPL Print — Cross-platform (for Xprinter XP-420B / TSC label printers) ---
function executeTSPLPrint(tsplCommands, targetPrinter = LABEL_PRINTER_NAME) {
  // Ensure the TSPL stream starts with a buffer reset and ends with a clean CLS
  const cleanCommands = `\r\nCLS\r\n${tsplCommands.trim()}\r\nCLS\r\n`;
  const buffer = Buffer.from(cleanCommands, 'utf-8');
  return enqueuePrint(`label on ${targetPrinter}`, () => spoolBuffer(buffer, targetPrinter, 'label', { labelOnly: true }));
}

// Global Process Crash Guards
// Deliberately non-fatal: a shop must keep taking receipts, so an unexpected
// error is recorded against the last job (visible on /status) instead of being
// logged as a bare message and forgotten.
process.on('uncaughtException', (err) => {
  console.error('[PrintServer Crash Guard] Uncaught exception:', err && err.stack ? err.stack : err);
  recordJobOutcome({ ok: false, error: `Uncaught exception: ${(err && err.message) || String(err)}` });
});

process.on('unhandledRejection', (reason) => {
  console.error('[PrintServer Crash Guard] Unhandled rejection:', reason instanceof Error ? reason.stack : reason);
  recordJobOutcome({ ok: false, error: `Unhandled rejection: ${(reason && reason.message) || String(reason)}` });
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

// --- Left-pad helper for column alignment ---
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
 * Word-wrap a label line to a physical dot width so no glyph reaches the sticker
 * edge and loses letters. Keeps every word: a single word wider than the line is
 * split across lines rather than dropped, unlike a character cap that cuts the tail.
 */
function wrapTsplToWidth(text, charWidth, maxDots) {
  const maxChars = Math.max(1, Math.floor(maxDots / charWidth));
  const lines = [];
  let cur = '';
  for (const word of (text || '').split(' ')) {
    if (!word) continue;
    let rest = word;
    while (rest.length > maxChars) {
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    const test = cur ? `${cur} ${rest}` : rest;
    if (test.length <= maxChars) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = rest;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/**
 * Fit a single ticket line inside a physical dot width: keep the larger font
 * (2, 12 dots/char) when the text fits, otherwise drop to font 1 (8 dots/char)
 * and cap at the width. A long name/issue keeps every letter in smaller type
 * instead of running off the right edge and losing the last glyph mid-letter.
 */
function fitTsplLine(text, maxDots) {
  const clean = text || '';
  if (clean.length * 12 <= maxDots) {
    return { font: '2', text: clean };
  }
  const maxChars = Math.max(1, Math.floor(maxDots / 8));
  return { font: '1', text: clean.slice(0, maxChars) };
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
 * GET /status — Health check.
 *
 * Reachability answers are open (the desktop shell and the till both poll this),
 * but queue names are configuration, not health, so they only go to a caller that
 * passed the same guard a print request would have to pass.
 */
function handleStatus(auth) {
  const access = auth || { allowed: true, via: 'ipc' };
  return {
    ok: true,
    service: SERVICE_ID,
    version: SERVER_VERSION,
    connected: true,
    hasCutter: HAS_CUTTER,
    authenticated: access.allowed,
    authVia: access.via,
    bind: BIND_HOST,
    lanMode: LAN_MODE,
    queueDepth: printQueueDepth,
    maxCopies: MAX_COPIES,
    printer: access.allowed ? PRINTER_NAME : null,
    labelPrinter: access.allowed ? LABEL_PRINTER_NAME : null,
    lastJob: access.allowed ? lastJobOutcome : null,
  };
}

app.get('/status', (req, res) => {
  res.json(handleStatus(authorize(req)));
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
async function handlePrintReceipt(body) {
  try {
    const { storeName, currency, transaction, headerMessage, footerMessage, logo, translations = {} } = body || {};
    const t = (key, defaultText) => translations[key] || defaultText;

    if (!transaction || !Array.isArray(transaction.items)) {
      return { ok: false, status: 400, error: 'Missing transaction data' };
    }
    // A receipt with no lines is a document that lost its items, not a sale of nothing.
    // Printing it hands the customer a total for goods the paper never names, so the
    // caller hears about it instead. Every real flow sends at least one line: a repair
    // with no parts still prints the device and its labour.
    if (transaction.items.length === 0) {
      return { ok: false, status: 400, error: 'Receipt has no item lines' };
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
    printer.println(`${t('order', 'Order:')} ${transaction.id}`);

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
      const isReturn = Boolean(item.isReturn);
      const unitPrice = item.customReturnPrice !== undefined ? item.customReturnPrice : item.product.price;
      const name = `${isReturn ? `[${t('returnItem', 'RETURN')}] ` : ''}${item.quantity}x ${item.product.name} ${item.product.model || ''}`.trim();
      const lineTotal = unitPrice * item.quantity;
      const price = isReturn ? `-${fmt(Math.abs(lineTotal))}` : fmt(lineTotal);
      printer.println(twoColumnRow(name, price));
    }

    printer.drawLine();

    // ---- Subtotal ----
    printer.alignLeft();
    printer.println(twoColumnRow(t('subtotal', 'Subtotal'), fmt(transaction.subtotal)));

    // ---- Discount ----
    let discountAmount = 0;
    let discountLabel = t('discount', 'Discount');
    if (transaction.discount && Number(transaction.discount.value) > 0) {
      discountLabel = transaction.discount.type === 'percent'
        ? `${t('discount', 'Discount')} (${transaction.discount.value}%)`
        : t('discount', 'Discount');
      const base = transaction.exchangeSummary?.purchasedTotal ?? transaction.subtotal;
      discountAmount = transaction.discount.type === 'percent'
        ? base * (Number(transaction.discount.value) / 100)
        : Number(transaction.discount.value);
    } else if (!transaction.exchangeSummary && transaction.subtotal > transaction.total && transaction.total >= 0) {
      discountAmount = transaction.subtotal - transaction.total;
    }

    if (discountAmount > 0) {
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

    return { ok: true, message: 'Receipt printed successfully' };
  } catch (err) {
    console.error('[✗] Print failed:', err.message);
    return printFailure(err);
  }
}

app.post('/print-receipt', printRoute(handlePrintReceipt));

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
async function handlePrintRepairLabel(body) {
  try {
    const { storeName, currency = 'DZD', ticket, copies = 1, translations = {} } = body || {};
    const t = (key, defaultText) => removeAccents(translations[key] || defaultText);
    const copiesCount = clampCopies(copies);

    if (!ticket || !ticket.ticketNumber) {
      return { ok: false, status: 400, error: 'Missing ticket data' };
    }

    const fmt = (v) => formatCurrency(v, currency);
    const ticketNum = tsplText(ticket.ticketNumber, 24);
    const phoneName = tsplText(removeAccents(`${ticket.deviceBrand || ''} ${ticket.deviceModel || ''}`), 28);
    const custName = tsplText(removeAccents(ticket.customerName || ''), 24);
    const custPhone = tsplText(ticket.customerPhone, 16);
    const phoneHeader = tsplText(`${phoneName}${custPhone ? ` ${custPhone}` : ''}`, 28);
    const issueDesc = tsplText(removeAccents(ticket.issueDescription || ''), 34);
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
    priceText = tsplText(priceText, 44);

    if (isLabelPrinter(LABEL_PRINTER_NAME)) {
      let tspl = '';
      tspl += 'SIZE 50 mm, 25 mm\r\n';
      tspl += 'GAP 2 mm, 0 mm\r\n';
      tspl += 'REFERENCE 32,40\r\n';
      tspl += 'DIRECTION 1\r\n';
      tspl += 'CLS\r\n';
      
      const { x: barcodeX, narrow, wide } = getBarcodeParams(ticketNum);

      // Text starts at x=12 on a 400-dot label shifted by REFERENCE 32; 336 dots
      // is the proven-safe extent of the phone-name line, ending short of the edge.
      const TICKET_TEXT_MAX_DOTS = 336;

      // Line 1: Phone Name & Phone Number
      const line1 = fitTsplLine(tsplText(phoneHeader, 28), TICKET_TEXT_MAX_DOTS);
      tspl += `TEXT 12,6,"${line1.font}",0,1,1,"${line1.text}"\r\n`;
      // Divider
      tspl += 'BAR 0,28,400,1\r\n';
      // Line 2: Customer Name (up 1mm)
      const line2 = fitTsplLine(tsplText(`${t('client', 'Client')} : ${custName}`, 48), TICKET_TEXT_MAX_DOTS);
      tspl += `TEXT 12,34,"${line2.font}",0,1,1,"${line2.text}"\r\n`;
      // Line 3: Problem Description (down 1mm)
      const line3 = fitTsplLine(tsplText(`${t('issue', 'Issue')} : ${issueDesc || t('diagnostic', 'Diagnostic')}`, 52), TICKET_TEXT_MAX_DOTS);
      tspl += `TEXT 12,60,"${line3.font}",0,1,1,"${line3.text}"\r\n`;
      // Line 4: Price & Deposit (down 2mm)
      const line4 = fitTsplLine(tsplText(priceText, 44), TICKET_TEXT_MAX_DOTS);
      tspl += `TEXT 12,86,"${line4.font}",0,1,1,"${line4.text}"\r\n`;
      // Line 5: Barcode (down 1mm)
      tspl += `BARCODE ${barcodeX},110,"128",38,0,0,${narrow},${wide},"${tsplText(ticketNum, 24)}"\r\n`;
      // Line 6: Ticket reference text (down 1mm)
      const ticketRefX = Math.max(0, getCenteredX(ticketNum, '1') - 48);
      tspl += `TEXT ${ticketRefX},154,"1",0,1,1,"${tsplText(ticketNum, 24)}"\r\n`;
      tspl += `PRINT ${copiesCount},1\r\n`;
      tspl += 'CLS\r\n';

      await executeTSPLPrint(tspl, LABEL_PRINTER_NAME);
      console.log(`[✓] Repair back label printed via TSPL (${copiesCount} copies) — ${ticket.ticketNumber} on ${LABEL_PRINTER_NAME}`);
      return { ok: true, message: 'Repair label printed successfully' };
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

    return { ok: true, message: 'Repair label printed successfully' };
  } catch (err) {
    console.error('[✗] Label print failed:', err.message);
    return printFailure(err);
  }
}

app.post('/print-repair-label', printRoute(handlePrintRepairLabel));

/**
 * POST /print-repair-ticket — Print standard 80mm customer drop-off ticket on receipt printer
 */
async function handlePrintRepairTicket(body) {
  try {
    const { storeName, currency = 'DZD', ticket, headerMessage, footerMessage, logo, translations = {} } = body || {};
    const t = (key, defaultText) => removeAccents(translations[key] || defaultText);

    if (!ticket || !ticket.ticketNumber) {
      return { ok: false, status: 400, error: 'Missing ticket data' };
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

    return { ok: true, message: 'Repair intake ticket printed successfully' };
  } catch (err) {
    console.error('[✗] Repair ticket print failed:', err.message);
    return printFailure(err);
  }
}

app.post('/print-repair-ticket', printRoute(handlePrintRepairTicket));

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
async function handlePrintZReport(body) {
  try {
    const { storeName, currency, date, generatedBy, summary, translations = {} } = body || {};
    const t = (key, defaultText) => translations[key] || defaultText;

    if (!summary) {
      return { ok: false, status: 400, error: 'Missing summary data' };
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

    // ---- Exclusions & Refunds ----
    if (summary.refundsCount > 0 || (summary.cancelledCount && summary.cancelledCount > 0)) {
      printer.bold(true);
      printer.println(t('returnsRefunds', 'EXCLUSIONS & REFUNDS'));
      printer.bold(false);
      if (summary.refundsCount > 0) {
        printer.println(twoColumnRow(`${t('refundsGiven', 'Refunds')} (${summary.refundsCount} ${t('txs', 'txs')}):`, `-${fmt(summary.refundsAmount)}`));
      }
      if (summary.cancelledCount && summary.cancelledCount > 0) {
        printer.println(twoColumnRow(`${t('voidedCancelled', 'Voided / Cancelled')} (${summary.cancelledCount} ${t('txs', 'txs')}):`, fmt(0)));
      }
      printer.drawLine();
    }

    // ---- Physical Cash Breakdown ----
    printer.alignLeft();
    printer.bold(true);
    printer.println(t('cashDrawerRec', 'PHYSICAL CASH INFLOW (DETAILS)'));
    printer.bold(false);

    const posCash = summary.posRetailCash ?? summary.cashIn ?? 0;
    const partsCash = summary.partsB2BCash ?? 0;
    const repairPickups = summary.repairHandoversCash ?? summary.repairsCashIn ?? 0;
    const repairDeposits = summary.repairDepositsCash ?? 0;
    const debtCollected = summary.debtCollectedCash ?? 0;

    printer.println(twoColumnRow(t('retailPosCash', 'Retail POS Cash:'), fmt(posCash)));
    if (partsCash > 0) {
      printer.println(twoColumnRow(t('partsB2B', 'Parts B2B Wholesale:'), fmt(partsCash)));
    }
    printer.println(twoColumnRow(t('repairHandovers', 'Repair Handover Pickups:'), `+${fmt(repairPickups)}`));
    if (repairDeposits > 0) {
      printer.println(twoColumnRow(t('repairDeposits', 'Repair Intake Deposits:'), `+${fmt(repairDeposits)}`));
    }
    if (debtCollected > 0) {
      printer.println(twoColumnRow(t('debtRepaid', 'Customer Debt Repaid:'), `+${fmt(debtCollected)}`));
    }
    printer.drawLine();

    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.alignCenter();
    printer.println(t('netCashDrawer', 'NET PHYSICAL CASH IN DRAWER:'));
    printer.println(fmt(summary.netCash));
    printer.setTextNormal();
    printer.bold(false);
    printer.drawLine();

    // ---- Payment Methods / Tender Breakdown ----
    printer.alignLeft();
    printer.bold(true);
    printer.println(t('paymentMethods', 'PAYMENT METHODS (TENDER)'));
    printer.bold(false);
    printer.println(twoColumnRow(t('cashTender', 'Cash Tender:'), fmt(posCash + partsCash)));
    printer.println(twoColumnRow(t('cardTpe', 'Card / TPE Terminal:'), fmt(summary.cardTotal || 0)));
    printer.println(twoColumnRow(t('mobileMoney', 'Mobile / BaridiMob:'), fmt(summary.mobileTotal || 0)));
    if (summary.transferTotal && summary.transferTotal > 0) {
      printer.println(twoColumnRow(t('bankTransfers', 'Bank Transfers:'), fmt(summary.transferTotal)));
    }
    if (summary.debtTotal && summary.debtTotal > 0) {
      printer.println(twoColumnRow(t('chargedDebt', 'Charged to Debt Tab:'), fmt(summary.debtTotal)));
    }
    if (summary.creditTotal && summary.creditTotal > 0) {
      printer.println(twoColumnRow(t('storeCreditApplied', 'Store Credit Applied:'), fmt(summary.creditTotal)));
    }
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

    return { ok: true, message: 'Z-Report printed successfully' };
  } catch (err) {
    console.error('[✗] Z-Report print failed:', err.message);
    return printFailure(err);
  }
}

app.post('/print-z-report', printRoute(handlePrintZReport));

/**
 * POST /print-low-stock-report — Print Low Stock Replenishment Sheet on ESC/POS thermal printer
 */
async function handlePrintLowStockReport(body) {
  try {
    const {
      storeName,
      currency,
      category = 'all',
      subCategory = 'all',
      totalUnitsNeeded = 0,
      totalRestockCost = 0,
      canViewCosts = true,
      products = [],
    } = body || {};

    if (!Array.isArray(products) || products.length === 0) {
      return { ok: false, status: 400, error: 'No products to print' };
    }

    const printer = createPrinter();
    const fmt = (v) => formatCurrency(v, currency);

    // ---- Store Header ----
    printer.alignCenter();
    printer.bold(true);
    printer.setTextSize(1, 1);
    printer.println(removeAccents(storeName || 'PhoneShop Pro'));
    printer.bold(false);
    printer.setTextNormal();

    printer.drawLine();
    printer.bold(true);
    printer.println('*** LOW STOCK REPLENISHMENT ***');
    printer.bold(false);

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US');
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    printer.println(`Date: ${dateStr} ${timeStr}`);

    let scopeLabel = category === 'all' ? 'All Categories' : category.toUpperCase();
    if (category === 'accessory' && subCategory !== 'all') {
      scopeLabel += ` (${subCategory.toUpperCase()})`;
    }
    printer.println(`Scope: ${scopeLabel}`);
    printer.drawLine();

    // ---- Summary Metrics ----
    printer.alignLeft();
    printer.bold(true);
    printer.println('REPLENISHMENT SUMMARY');
    printer.bold(false);
    printer.println(twoColumnRow('Products Below Min:', `${products.length} items`));
    printer.println(twoColumnRow('Total Units to Order:', `+${totalUnitsNeeded} pcs`));
    if (canViewCosts && totalRestockCost > 0) {
      printer.println(twoColumnRow('Est. Restock Budget:', fmt(totalRestockCost)));
    }
    printer.drawLine();

    // ---- Itemized List (Grouped by Category) ----
    printer.bold(true);
    printer.println('ITEMIZED ORDER LIST (BY CATEGORY)');
    printer.bold(false);
    printer.drawLine();

    const catRank = { smartphone: 1, tablet: 2, wearable: 3, accessory: 4 };
    const sortedProducts = [...products].sort((a, b) => {
      const rankA = catRank[(a.category || '').toLowerCase()] || 99;
      const rankB = catRank[(b.category || '').toLowerCase()] || 99;
      if (rankA !== rankB) return rankA - rankB;

      if ((a.category || '').toLowerCase() === 'accessory' && (b.category || '').toLowerCase() === 'accessory') {
        const subA = a.accessorySubCategory || 'other';
        const subB = b.accessorySubCategory || 'other';
        if (subA !== subB) return subA.localeCompare(subB);
      }

      const nameA = `${a.name || ''} ${a.model || ''}`.toLowerCase();
      const nameB = `${b.name || ''} ${b.model || ''}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });

    let currentGroup = '';

    for (let i = 0; i < sortedProducts.length; i++) {
      const p = sortedProducts[i];
      let groupName = (p.category || 'other').toUpperCase();
      if (groupName === 'SMARTPHONE') groupName = 'SMARTPHONES';
      else if (groupName === 'TABLET') groupName = 'TABLETS';
      else if (groupName === 'WEARABLE') groupName = 'WEARABLES';
      else if (groupName === 'ACCESSORY') {
        const sub = p.accessorySubCategory ? ` - ${p.accessorySubCategory.toUpperCase()}` : '';
        groupName = `ACCESSORIES${sub}`;
      }

      if (groupName !== currentGroup) {
        currentGroup = groupName;
        printer.newLine();
        printer.bold(true);
        printer.println(`[ ${currentGroup} ]`);
        printer.bold(false);
        printer.drawLine();
      }

      const threshold = p.lowStockThreshold || 1;
      const deficit = Math.max(1, threshold - (p.stock || 0));
      const fullTitle = `${i + 1}. ${removeAccents(p.name || '')} ${removeAccents(p.model || '')}`.trim();

      printer.bold(true);
      printer.println(fullTitle.substring(0, 42));
      printer.bold(false);

      let catSub = p.category || '';
      if (p.accessorySubCategory) catSub += ` (${p.accessorySubCategory})`;
      if (p.sku) catSub += ` | ${p.sku}`;
      printer.println(catSub.substring(0, 42));

      const stockLine = `Stock: ${p.stock}/${threshold}  --> REORDER: +${deficit}`;
      printer.bold(true);
      printer.println(stockLine);
      printer.bold(false);

      if (p.supplier) {
        printer.println(`Supplier: ${removeAccents(p.supplier).substring(0, 30)}`);
      }
      if (canViewCosts && p.costPrice) {
        printer.println(twoColumnRow(`Unit: ${fmt(p.costPrice)}`, `Subtotal: ${fmt(p.costPrice * deficit)}`));
      }

      if (i < sortedProducts.length - 1) {
        printer.drawLine();
      }
    }

    printer.drawLine();
    printer.alignCenter();
    printer.println('*** END OF REPORT ***');
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
    console.log(`[✓] Low Stock Report printed on ${PRINTER_NAME}`);

    return { ok: true, message: 'Low Stock Report printed successfully' };
  } catch (err) {
    console.error('[✗] Low Stock Report print failed:', err.message);
    return printFailure(err);
  }
}

app.post('/print-low-stock-report', printRoute(handlePrintLowStockReport));

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
async function handlePrintBarcode(body) {
  try {
    const { storeName, currency, products } = body || {};

    if (!products || !Array.isArray(products) || products.length === 0) {
      return { ok: false, status: 400, error: 'Missing products data' };
    }

    const fmt = (v) => formatCurrency(v, currency);
    // A label sheet is one job per product line, so an uncapped array is a paper
    // jam waiting to happen rather than a print request.
    const labelItems = products.slice(0, MAX_LABELS_PER_JOB);

    if (isLabelPrinter(LABEL_PRINTER_NAME)) {
      let fullTspl = '';

      for (const product of labelItems) {
        fullTspl += 'SIZE 50 mm, 20 mm\r\n';
        fullTspl += 'GAP 2 mm, 0 mm\r\n';
        fullTspl += 'REFERENCE 0,0\r\n';
        fullTspl += 'DIRECTION 1\r\n';
        fullTspl += 'CLS\r\n';

        const sku = tsplText(product.sku, 32);
        const shopTitle = tsplText(storeName || 'PhoneShop Pro', 24);

        // Product Name: only product name + model (clean, bold, same size as store name)
        let fullText = tsplText(`${product.name || ''}${product.model ? ` ${product.model}` : ''}`, 60);

        const fontType = '1';
        const fontArgs = `"1",0,1,1`;
        const maxChars = 32;
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
        const { x: barcodeX, narrow, wide } = getBarcodeParams(sku);

        if (product.hidePrice) {
          fullTspl += `TEXT ${shopX},6,"2",0,1,1,"${shopTitle}"\r\n`;
          fullTspl += 'BAR 0,30,400,2\r\n';

          // Parts: larger type (font 2, 12 dots/char) wrapped to a safe physical
          // width so the name never reaches the sticker edge; every word is kept.
          const partLines = wrapTsplToWidth(fullText, 12, 288);
          let lastBottom = 60;
          partLines.forEach((line, i) => {
            const y = 40 + i * 24;
            const lineX = Math.max(0, getCenteredX(line, '2'));
            fullTspl += `TEXT ${lineX},${y},"2",0,1,1,"${tsplText(line, 60)}"\r\n`;
            lastBottom = y + 20;
          });
          // A wrapped name sits the barcode just below the text; a single short
          // name keeps the lower, taller bar so the label stays balanced.
          const barcodeY = partLines.length > 1 ? lastBottom + 8 : 112;
          const barcodeH = partLines.length > 1 ? 32 : 40;
          fullTspl += `BARCODE ${barcodeX},${barcodeY},"128",${barcodeH},0,0,${narrow},${wide},"${sku}"\r\n`;
        } else {
          fullTspl += `TEXT ${shopX},6,"2",0,1,1,"${shopTitle}"\r\n`;
          fullTspl += 'BAR 0,30,400,2\r\n';

          if (textLines.length > 1) {
            const line1X = Math.max(0, getCenteredX(textLines[0], fontType) - shiftDots);
            const line2X = Math.max(0, getCenteredX(textLines[1], fontType) - shiftDots);
            fullTspl += `TEXT ${line1X},40,${fontArgs},"${textLines[0]}"\r\n`;
            fullTspl += `TEXT ${line2X},64,${fontArgs},"${textLines[1]}"\r\n`;
            fullTspl += `BARCODE ${barcodeX},110,"128",24,0,0,${narrow},${wide},"${sku}"\r\n`;
          } else {
            const nameSpecsX = Math.max(0, getCenteredX(textLines[0], fontType) - shiftDots);
            fullTspl += `TEXT ${nameSpecsX},40,${fontArgs},"${textLines[0]}"\r\n`;
            fullTspl += `BARCODE ${barcodeX},102,"128",28,0,0,${narrow},${wide},"${sku}"\r\n`;
          }
          const priceText = tsplText(fmt(product.price), 20);
          const priceX = getCenteredX(priceText, '4');
          fullTspl += `TEXT ${priceX},140,"4",0,1,1,"${priceText}"\r\n`;
        }

        fullTspl += 'PRINT 1,1\r\n';
        fullTspl += 'CLS\r\n';
      }

      await executeTSPLPrint(fullTspl, LABEL_PRINTER_NAME);
      console.log(`[✓] Printed ${labelItems.length} barcode label(s) via TSPL on ${LABEL_PRINTER_NAME}`);
      return { ok: true, message: 'Barcodes printed successfully' };
    }

    const printer = createPrinter();

    for (const product of labelItems) {
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

    return { ok: true, message: 'Barcodes printed successfully' };
  } catch (err) {
    console.error('[✗] Barcode print failed:', err.message);
    return printFailure(err);
  }
}

app.post('/print-barcode', printRoute(handlePrintBarcode));

// ============================================================
// Print Custom Ticket / Phone Specs Slip (Fully Isolated)
// ============================================================
async function handlePrintCustomTicket(body) {
  try {
    const { storeName, currency = 'DZD', storeAddress, storePhone, ticketData, copies = 1 } = body || {};

    if (!ticketData) {
      return { ok: false, status: 400, error: 'Missing ticket data' };
    }

    const numCopies = clampCopies(copies);
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

        // Newlines are layout here — the per-line tsplText() below is what makes
        // each one safe to put inside a quoted TSPL field.
        const rawText = stripControlChars(ticketData.freeText, 2000).trim();
        const hasStoreName = Boolean(ticketData.showStoreNameOnSticker);
        const shopTitle = hasStoreName ? tsplText(removeAccents(storeName || 'PhoneShop Pro'), 24) : '';
        const barcodeVal = tsplText(removeAccents(ticketData.barcodeValue || ''), 48);
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
            const cleanLine = tsplText(line, 60);
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
        return { ok: true, message: `Printed ${numCopies} sticker(s) on ${LABEL_PRINTER_NAME}` };
      }

      // ─── Spec-List Sticker (Mirroring Inventory Label Geometry) ──────────
      // Layout: Header (Shop) → Bar → Device Name → Spec Rows → Price → Barcode
      // ─────────────────────────────────────────────────────────────────────
      const shopTitle = tsplText(removeAccents(storeName || 'PhoneShop Pro'), 24);
      const hasStoreHeader = Boolean(ticketData.showStoreHeader);
      const shopX = Math.max(0, getCenteredX(shopTitle, '2') - 16);

      // Device name
      const deviceRaw = tsplText(removeAccents(ticketData.deviceModel || ticketData.title || ''), 26);
      const devX = Math.max(0, getCenteredX(deviceRaw, '2') - 16);

      // Build ordered spec list with space before & after colon
      const rawSpecs = [];
      if (ticketData.storage)       rawSpecs.push({ label: 'Stockage', value: tsplText(removeAccents(ticketData.storage), 20) });
      if (ticketData.ram)           rawSpecs.push({ label: 'RAM',      value: tsplText(removeAccents(ticketData.ram), 20) });
      if (ticketData.batteryHealth) rawSpecs.push({ label: 'Batterie', value: tsplText(removeAccents(ticketData.batteryHealth), 20) });
      if (ticketData.condition)     rawSpecs.push({ label: 'Etat',     value: tsplText(removeAccents(ticketData.condition), 20) });
      if (ticketData.warranty)      rawSpecs.push({ label: 'Garantie', value: tsplText(removeAccents(ticketData.warranty), 20) });
      if (ticketData.color)         rawSpecs.push({ label: 'Couleur',  value: tsplText(removeAccents(ticketData.color), 20) });
      if (ticketData.imei)          rawSpecs.push({ label: 'IMEI',     value: tsplText(removeAccents(ticketData.imei), 20) });
      if (Array.isArray(ticketData.specs)) {
        for (const s of ticketData.specs) {
          if (s.label && s.value) {
            rawSpecs.push({
              label: tsplText(removeAccents(String(s.label).replace(/:/g, '')), 10),
              value: tsplText(removeAccents(String(s.value)), 16),
            });
          }
        }
      }

      // Barcode / QR
      const barcodeVal = tsplText(removeAccents(ticketData.barcodeValue || ticketData.imei || ''), 48);
      const hasBarcode = ticketData.includeBarcode !== false && barcodeVal.length > 0;
      const isQr = hasBarcode && ticketData.barcodeType === 'qr';
      const hasPrice = Boolean(ticketData.price);
      const cleanPriceStr = tsplText(String(ticketData.price || '').replace(/\s*(DA|DZD|USD|EUR|GBP|\$|€|£)\s*$/i, ''), 24);
      const priceVal = removeAccents(cleanPriceStr);
      const priceText = hasPrice && priceVal ? tsplText(`PRIX : ${priceVal} ${currency}`, 40) : '';

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
            tspl += `TEXT 12,${curY},"1",0,1,1,"${tsplField(line, 42)}"\r\n`;
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
          tspl += `TEXT 10,${curY},"1",0,1,1,"${tsplField(line, 42)}"\r\n`;
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
      return { ok: true, message: `Printed ${numCopies} sticker(s) on ${LABEL_PRINTER_NAME}` };
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

        await executePrint(printer, PRINTER_NAME);
      }
      return { ok: true, message: `Printed ${numCopies} slip(s) on ${PRINTER_NAME}` };
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

      // Dedicated cross-platform execution (supports Windows raw print and macOS lpr)
      await executePrint(printer, targetPrinter);
    }

    console.log(`[✓] Custom ticket printed (${numCopies} cop${numCopies > 1 ? 'ies' : 'y'}) on ${targetPrinter}`);
    return { ok: true, message: `Custom ticket printed successfully on ${targetPrinter}` };
  } catch (err) {
    console.error('[✗] Custom ticket print failed:', err.message);
    return printFailure(err);
  }
}

app.post('/print-custom-ticket', printRoute(handlePrintCustomTicket));

/**
 * POST /calibrate-labels — Recalibrate the label printer's gap sensor
 * Sends TSPL GAPDETECT command to detect label pitch, followed by FORMFEED to sync at the gap.
 */
async function handleCalibrateLabels() {
  try {
    if (!isLabelPrinter(LABEL_PRINTER_NAME)) {
      return { ok: false, status: 400, error: `Configured printer "${LABEL_PRINTER_NAME}" is not a label printer.` };
    }
    // GAPDETECT calibrates the gap sensor; FORMFEED aligns right to the tear/gap line
    const tspl = 'GAPDETECT\r\nFORMFEED\r\n';
    await executeTSPLPrint(tspl, LABEL_PRINTER_NAME);
    console.log(`[✓] Gap sensor calibrated successfully on ${LABEL_PRINTER_NAME}`);
    return { ok: true, message: 'Label printer gap sensor calibrated and aligned successfully.' };
  } catch (err) {
    console.error('[✗] Label calibration failed:', err.message);
    return printFailure(err);
  }
}

app.post('/calibrate-labels', printRoute(() => handleCalibrateLabels()));

// ============================================================
// JSON fallbacks — never an HTML error page for a machine client
// ============================================================

app.use((req, res) => {
  res.status(404).json({ ok: false, status: 404, code: 'not_found', error: `Unknown route: ${req.method} ${req.path}` });
});

app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode
    || (err.type === 'entity.parse.failed' ? 400 : err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(`[✗] ${req.method} ${req.path} failed:`, err.stack || err.message);
  else console.warn(`[✗] ${req.method} ${req.path} rejected: ${err.message}`);
  if (res.headersSent) return;
  res.status(status).json({
    ok: false,
    status,
    code: err.code || (status === 400 ? 'invalid_json' : status === 413 ? 'body_too_large' : 'print_server_error'),
    error: status >= 500 ? 'Print server error' : String(err.message || 'Invalid request'),
  });
});

// ============================================================
// Start (only when run directly; skip when required by Electron)
// ============================================================

function printStartupBanner(listenPort) {
  const row = (label, value) => `  │ ${String(label).padEnd(9)}: ${value}`;
  console.log('');
  console.log('  ┌─ PhoneShop Print Server ─────────────────────────────');
  console.log(row('listen', `${BIND_HOST}:${listenPort}${LAN_MODE ? '' : ' (loopback only — PRINT_SERVER_LAN_MODE=1 for LAN)'}`));
  console.log(row('receipt', PRINTER_NAME));
  console.log(row('labels', LABEL_PRINTER_NAME));
  console.log(row('cutter', HAS_CUTTER ? 'yes' : 'no'));
  console.log(row('platform', os.platform()));
  console.log(row('auth', OPEN_MODE
    ? 'DISABLED by PRINT_SERVER_ALLOW_UNAUTHENTICATED=1 — anyone who can reach this port can print'
    : 'allowlisted browser Origin, or X-Print-Token for everything else'));
  if (!OPEN_MODE) {
    console.log(row('token', PRINT_TOKEN
      ? `readable from ${TOKEN_FILE} or PRINT_SERVER_TOKEN (not printed here)`
      : 'not configured — set PRINT_SERVER_TOKEN for non-browser clients'));
  }
  console.log(row('health', `http://127.0.0.1:${listenPort}/status`));
  console.log('  └──────────────────────────────────────────────────────');
  console.log('');
}

/** Is the thing already holding this port our own print server? */
function probeExistingInstance(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/status', timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body = (body + chunk).slice(0, 8192); });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed && parsed.service === SERVICE_ID ? parsed : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function startServer(port) {
  const listenPort = intFrom(port, PORT, 1, 65535);
  return new Promise((resolve, reject) => {
    const server = app.listen(listenPort, BIND_HOST, () => {
      printStartupBanner(listenPort);
      resolve(server);
    });

    server.on('error', (err) => {
      if (err.code !== 'EADDRINUSE') {
        reject(err);
        return;
      }
      // Two instances of this server can share a port deliberately; a foreign
      // process on it cannot, and pretending otherwise prints to nobody.
      void probeExistingInstance(listenPort).then((existing) => {
        if (existing) {
          console.log(`[PrintServer] Port ${listenPort} is already served by this print server (v${existing.version}) — joining it.`);
          resolve(null);
          return;
        }
        reject(new Error(
          `Port ${listenPort} is in use by something that is not the PhoneShop print server. ` +
          'Refusing to start against it: free the port or set PORT in print-server/.env.'
        ));
      });
    });
  });
}

// Auto-start only when run directly (node server.js), not when require()'d by Electron
if (require.main === module) {
  startServer().catch((err) => {
    console.error(`[PrintServer] Did not start: ${err.message}`);
    process.exitCode = 1;
  });
}

// Export for embedding in Electron main process
module.exports = {
  app,
  startServer,
  PORT,
  SERVICE_ID,
  // The desktop shell hands this to anything that talks to the server without a
  // browser Origin; browsers are authorised by their Origin instead.
  getPrintServerToken: () => PRINT_TOKEN,
  handleStatus,
  handlePrintReceipt,
  handlePrintRepairLabel,
  handlePrintRepairTicket,
  handlePrintZReport,
  handlePrintBarcode,
  handlePrintCustomTicket,
  handleCalibrateLabels,
  handlePrintLowStockReport,
  // The Electron IPC path calls the handlers directly, so it never passes through
  // the HTTP body middleware. The shell must sanitise the payload itself.
  sanitizeIpcPayload: (payload) => sanitizePayload(payload, 'ipc'),
  // The guards around a printer that cannot be rehearsed on this machine are the
  // ones worth asserting on, so the test file can reach them without a print job.
  internals: {
    authorize,
    originAllowed,
    stripControlChars,
    sanitizePayload,
    tsplText,
    tsplField,
    tsplInt,
    wrapTsplToWidth,
    fitTsplLine,
    clampCopies,
    chooseSubstitutePrinter,
    isLabelPrinter,
    pngDimensions,
    limits: { MAX_COPIES, MAX_TEXT_LEN, MAX_ARRAY_LEN, MAX_LABELS_PER_JOB, MAX_LOGO_PIXELS },
  },
};
