// @vitest-environment jsdom
/**
 * Phase 7 TDD Tests — Custom-Label Free-Text Wrap Parity, Overflow Warning,
 * Size & Weight Preservation (No Automatic Shrinking).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { CustomTicketData } from './customTicketTypes';
import { computeFreeTextStickerLayout } from '../../utils/customLabelWrap';

vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

import { LivePreviewPanel } from './LivePreviewPanel';
import { StickerTextInputCard } from './StickerTextInputCard';
import { buildCustomTicketHTML } from './customTicketTemplate';

const baseTicket = (overrides: Partial<CustomTicketData> = {}): CustomTicketData => ({
  mode: 'free_text',
  format: 'sticker',
  stickerSize: '50x20',
  title: '',
  subtitle: '',
  deviceModel: '',
  storage: '',
  ram: '',
  batteryHealth: '',
  condition: '',
  warranty: '',
  color: '',
  imei: '',
  price: '',
  notes: '',
  specs: [],
  includeBarcode: false,
  barcodeType: 'barcode',
  barcodeValue: '',
  freeText: '',
  textAlign: 'center',
  fontSize: 'large',
  isBold: true,
  showStoreHeader: true,
  showStoreFooter: false,
  customFooter: '',
  showStoreNameOnSticker: false,
  copies: 1,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('Phase 7 — Custom-label wrap parity & overflow detection', () => {
  it('handles empty text without overflow or stray breaks', () => {
    const layout = computeFreeTextStickerLayout(baseTicket({ freeText: '' }), 'PhoneShop');
    expect(layout.wrappedLines).toEqual(['']);
    expect(layout.clippedLines).toBe(0);
    expect(layout.isOverflow).toBe(false);
  });

  it('splits long uninterrupted words using printer font metrics and flags excess height before printing', () => {
    // Font '2' ('large'): charW = 16 -> floor((400 - 32)/16) = 23 chars/line.
    // On 50x20mm with store header (32) + barcode (36) -> availableH = 156 - 32 - 36 = 88 dots -> max 4 lines (each 18+2=20).
    // A single 115-char uninterrupted token has 0 newlines, yet wraps into 5 lines on the printer!
    const longToken = 'X'.repeat(115);
    const layout = computeFreeTextStickerLayout(
      baseTicket({
        freeText: longToken,
        fontSize: 'large',
        stickerSize: '50x20',
        showStoreNameOnSticker: true,
        includeBarcode: true,
        barcodeValue: '123456',
        barcodeType: 'barcode',
      }),
      'PhoneShop'
    );

    expect(layout.maxCharsPerLine).toBe(23);
    expect(layout.wrappedLines).toHaveLength(5);
    expect(layout.wrappedLines.every(l => l.length <= 23)).toBe(true);
    expect(layout.isOverflow).toBe(true);
    expect(layout.clippedLines).toBeGreaterThan(0);
  });

  it('accounts for 50x25 and 50x30 heights and header + QR combinations accurately', () => {
    const sixLines = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].join('\n');
    const on20Qr = computeFreeTextStickerLayout(
      baseTicket({
        freeText: sixLines,
        fontSize: 'normal',
        stickerSize: '50x20',
        showStoreNameOnSticker: true,
        includeBarcode: true,
        barcodeValue: 'QR123',
        barcodeType: 'qr',
      }),
      'PhoneShop'
    );
    const on30Qr = computeFreeTextStickerLayout(
      baseTicket({
        freeText: sixLines,
        fontSize: 'normal',
        stickerSize: '50x30',
        showStoreNameOnSticker: true,
        includeBarcode: true,
        barcodeValue: 'QR123',
        barcodeType: 'qr',
      }),
      'PhoneShop'
    );

    // 50x20 with header (32) + QR (46) leaves only 78 dots -> 6 lines @16 dots clip
    expect(on20Qr.isOverflow).toBe(true);
    // 50x30 with header (32) + QR (46) leaves 158 dots -> 6 lines fit comfortably
    expect(on30Qr.isOverflow).toBe(false);
    expect(on30Qr.clippedLines).toBe(0);
  });

  it('preserves explicit chosen font size and weight in preview without automatic shrinking even when overflowing', () => {
    const ticket = baseTicket({
      freeText: 'Supercalifragilisticexpialidocious',
      fontSize: 'giant',
      isBold: false,
      stickerSize: '50x20',
    });

    const layout = computeFreeTextStickerLayout(ticket, 'PhoneShop');
    expect(layout.fontType).toBe('4'); // Chosen 'giant' never downsized to '1' or '2'

    render(
      <LivePreviewPanel
        ticket={ticket}
        setTicket={vi.fn()}
        storeName="PhoneShop"
        currencySymbol="DZD"
        livePreviewHtml=""
        isOnline={false}
        isPrinting={false}
        isCalibrating={false}
        handleCalibrateSensor={vi.fn(async () => undefined)}
        handlePrintAction={vi.fn()}
        handleSelectPreset={vi.fn()}
        toast={{ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } as never}
      />
    );

    const previewTextEl = screen.getByTestId('blank-sticker-preview-text');
    // Font weight stays 500 (not forced bold), font size stays giant (34px), and text reflects exact printer line splits
    expect(previewTextEl.style.fontWeight).toBe('500');
    expect(previewTextEl.style.fontSize).toBe('34px');
    expect(previewTextEl.textContent?.split('\n')).toEqual(layout.wrappedLines);

    // HTML export preserves normal weight and wrapped lines too
    const html = buildCustomTicketHTML(ticket, 'PhoneShop', 'DZD');
    expect(html).toContain('font-weight:normal');
    expect(html).toContain('font-size:18px');
    expect(html).toContain(layout.wrappedLines[0]);
  });

  it('shows Height Alert warning before printing when computed layout overflows', () => {
    const ticket = baseTicket({ freeText: 'Z'.repeat(180), fontSize: 'large', stickerSize: '50x20' });
    const layout = computeFreeTextStickerLayout(ticket, 'PhoneShop');
    expect(layout.isOverflow).toBe(true);

    render(
      <StickerTextInputCard
        ticket={ticket}
        setTicket={vi.fn()}
        blankStickerOverflowWarning={{
          isOverflow: true,
          lineCount: layout.wrappedLines.length,
          clippedLines: layout.clippedLines,
          maxEstimatedLines: layout.maxLines,
          stickerSize: layout.stickerSize,
        }}
      />
    );
    expect(screen.getByText(/Height Alert:/i)).toBeTruthy();
  });
});
