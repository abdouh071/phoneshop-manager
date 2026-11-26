import type { CustomTicketData, TextFontSize } from '../features/customTicket/customTicketTypes';

export type ResolvedStickerSize = '50x20' | '50x25' | '50x30';
export type TsplFontType = '1' | '2' | '3' | '4';
export type ResolvedFontKey = 'normal' | 'large' | 'huge' | 'giant';

export interface FreeTextStickerLayout {
  stickerSize: ResolvedStickerSize;
  labelMm: number;
  totalWidthDots: number;
  totalHeightDots: number;
  maxSafeY: number;
  fontType: TsplFontType;
  resolvedSizeKey: ResolvedFontKey;
  charW: number;
  charH: number;
  lineSpacing: number;
  maxCharsPerLine: number;
  wrappedLines: string[];
  topReserved: number;
  bottomReserved: number;
  availableHeightDots: number;
  maxLines: number;
  clippedLines: number;
  isOverflow: boolean;
}

const TSPL_FONT_1_WIDTH = 10;
const TSPL_FONT_2_WIDTH = 16;
const TOTAL_WIDTH_DOTS = 400; // 50mm * 8 dots/mm

const FONT_METRICS: Record<ResolvedFontKey, { fontType: TsplFontType; charW: number; charH: number; lineSpacing: number }> = {
  normal: { fontType: '1', charW: TSPL_FONT_1_WIDTH, charH: 14, lineSpacing: 2 },
  large: { fontType: '2', charW: TSPL_FONT_2_WIDTH, charH: 18, lineSpacing: 2 },
  huge: { fontType: '3', charW: 16, charH: 22, lineSpacing: 3 },
  giant: { fontType: '4', charW: 24, charH: 28, lineSpacing: 4 },
};

/**
 * Wraps free text using the exact same word & long-token break logic as
 * `print-server/server.js` `wrapFreeTextLines`.
 */
export function wrapFreeTextLines(rawText: string, maxCharsPerLine: number): string[] {
  const limit = Math.max(1, maxCharsPerLine);
  const wrappedLines: string[] = [];
  const paragraphs = rawText ? String(rawText).split('\n') : [''];
  for (const para of paragraphs) {
    if (!para.trim()) {
      wrappedLines.push('');
      continue;
    }
    const words = para.split(' ');
    let curLine = '';
    for (const word of words) {
      let remaining = word;
      while (remaining.length > limit) {
        if (curLine) {
          wrappedLines.push(curLine);
          curLine = '';
        }
        wrappedLines.push(remaining.slice(0, limit));
        remaining = remaining.slice(limit);
      }
      if (!remaining) continue;
      const test = curLine ? `${curLine} ${remaining}` : remaining;
      if (test.length <= limit) {
        curLine = test;
      } else {
        if (curLine) wrappedLines.push(curLine);
        curLine = remaining;
      }
    }
    if (curLine) wrappedLines.push(curLine);
  }
  return wrappedLines;
}

export function resolveFreeTextFontKey(
  rawText: string,
  sizePref: TextFontSize | undefined,
  labelMm: number
): ResolvedFontKey {
  // Explicit user sizes are strictly preserved — never auto-shrunk.
  if (sizePref === 'normal' || sizePref === 'large' || sizePref === 'huge' || sizePref === 'giant') {
    return sizePref;
  }
  const rawLines = (rawText || '').split('\n');
  const maxLineLen = rawLines.reduce((acc, l) => Math.max(acc, l.trim().length), 0);
  if (rawLines.length === 1 && maxLineLen <= 8 && labelMm > 20) return 'giant';
  if (rawLines.length <= 2 && maxLineLen <= 12) return 'huge';
  if (rawLines.length <= 3 && maxLineLen <= 22) return 'large';
  return 'normal';
}

/**
 * Computes exact TSPL layout, character wrap bounds, and vertical overflow count
 * matching `print-server/server.js` `buildCustomFreeTextTSPL`.
 */
export function computeFreeTextStickerLayout(
  ticket: Pick<
    CustomTicketData,
    | 'freeText'
    | 'stickerSize'
    | 'fontSize'
    | 'showStoreNameOnSticker'
    | 'includeBarcode'
    | 'barcodeValue'
    | 'barcodeType'
  >,
  storeName: string = 'PhoneShop Pro'
): FreeTextStickerLayout {
  const stickerSize: ResolvedStickerSize =
    ticket.stickerSize === '50x30' ? '50x30' : ticket.stickerSize === '50x25' ? '50x25' : '50x20';
  const labelMm = stickerSize === '50x30' ? 30 : stickerSize === '50x25' ? 25 : 20;
  const totalHeightDots = labelMm * 8;
  const maxSafeY = totalHeightDots - 4;

  const rawText = (ticket.freeText || '').trim();
  const resolvedSizeKey = resolveFreeTextFontKey(rawText, ticket.fontSize, labelMm);
  const { fontType, charW, charH, lineSpacing } = FONT_METRICS[resolvedSizeKey];

  const maxCharsPerLine = Math.max(4, Math.floor((TOTAL_WIDTH_DOTS - 32) / charW));
  const wrappedLines = wrapFreeTextLines(rawText, maxCharsPerLine);

  const hasHeader = Boolean(ticket.showStoreNameOnSticker && (storeName || 'PhoneShop Pro').trim());
  const topReserved = hasHeader ? 32 : 6;

  const barcodeVal = (ticket.barcodeValue || '').trim();
  const hasBarcode = Boolean(ticket.includeBarcode && barcodeVal.length > 0);
  const isQr = hasBarcode && ticket.barcodeType === 'qr';
  const bottomReserved = hasBarcode ? (isQr ? 46 : 36) : 6;

  const availableHeightDots = Math.max(16, maxSafeY - topReserved - bottomReserved);
  const step = charH + lineSpacing;
  const totalTextH = wrappedLines.length * charH + Math.max(0, wrappedLines.length - 1) * lineSpacing;
  const startY = Math.max(topReserved, topReserved + Math.floor((availableHeightDots - totalTextH) / 2));

  let lineY = startY;
  let clippedLines = 0;
  for (const line of wrappedLines) {
    if (line && !(lineY + charH <= maxSafeY - bottomReserved + 4)) {
      clippedLines++;
    }
    lineY += step;
  }

  const maxLines = Math.max(1, Math.floor((availableHeightDots + 4 + lineSpacing) / step));

  return {
    stickerSize,
    labelMm,
    totalWidthDots: TOTAL_WIDTH_DOTS,
    totalHeightDots,
    maxSafeY,
    fontType,
    resolvedSizeKey,
    charW,
    charH,
    lineSpacing,
    maxCharsPerLine,
    wrappedLines,
    topReserved,
    bottomReserved,
    availableHeightDots,
    maxLines,
    clippedLines,
    isOverflow: clippedLines > 0,
  };
}
