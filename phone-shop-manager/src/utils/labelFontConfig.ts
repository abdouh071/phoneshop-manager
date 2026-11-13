export type LabelFontKey = '1' | '1x2' | '2' | '3' | '4' | '0';

export interface LabelFontConfig {
  key: LabelFontKey;
  label: string;
  badge: string;
  badgeColor: string;
  description: string;
  specs: string;
  tsplFont: string;
  mulX: number;
  mulY: number;
  charWidth: number;
  lineHeight: number;
  maxLines: number;
  cssStyle: {
    fontFamily: string;
    fontSize: string;
    fontWeight: string | number;
    letterSpacing?: string;
    lineHeight?: string;
    transform?: string;
    transformOrigin?: string;
  };
}

export const AVAILABLE_LABEL_FONTS: LabelFontConfig[] = [
  {
    key: '2',
    label: 'Font 2 — Standard (12×20)',
    badge: 'Recommended',
    badgeColor: '#2563eb',
    description: 'Clean medium typography with balanced character spacing and high contrast.',
    specs: '12×20 dots (~2.5mm) • Up to 19 chars/line',
    tsplFont: '2',
    mulX: 1,
    mulY: 1,
    charWidth: 16,
    lineHeight: 21,
    maxLines: 3,
    cssStyle: {
      fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontSize: '9px',
      fontWeight: '600',
      lineHeight: '1.1',
    },
  },
  {
    key: '1',
    label: 'Font 1 — Compact (8×12)',
    badge: 'Compact',
    badgeColor: '#059669',
    description: 'Sharp compact monospace fitting maximum text without clipping long descriptions.',
    specs: '8×12 dots (~1.5mm) • Up to 30 chars/line',
    tsplFont: '1',
    mulX: 1,
    mulY: 1,
    charWidth: 10,
    lineHeight: 16,
    maxLines: 3,
    cssStyle: {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: '7.5px',
      fontWeight: '600',
      letterSpacing: '-0.2px',
      lineHeight: '1.1',
    },
  },
  {
    key: '1x2',
    label: 'Font 1 Tall — Condensed (8×24)',
    badge: 'Condensed & Tall',
    badgeColor: '#d97706',
    description: 'Double vertical height with narrow character width for prominent visibility.',
    specs: '8×24 dots (~3.0mm) • Up to 30 chars/line',
    tsplFont: '1',
    mulX: 1,
    mulY: 2,
    charWidth: 10,
    lineHeight: 24,
    maxLines: 3,
    cssStyle: {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: '8px',
      fontWeight: '700',
      lineHeight: '1.1',
      transform: 'scaleY(1.3)',
      transformOrigin: 'center',
    },
  },
  {
    key: '3',
    label: 'Font 3 — Bold (16×24)',
    badge: 'Bold & High Contrast',
    badgeColor: '#7c3aed',
    description: 'Heavy bold weight with elevated height. Ideal for quick shelf reading.',
    specs: '16×24 dots (~3.0mm) • Up to 15 chars/line',
    tsplFont: '3',
    mulX: 1,
    mulY: 1,
    charWidth: 20,
    lineHeight: 25,
    maxLines: 2,
    cssStyle: {
      fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontSize: '10.5px',
      fontWeight: '700',
      letterSpacing: '0.1px',
      lineHeight: '1.1',
    },
  },
  {
    key: '4',
    label: 'Font 4 — Extra Large (24×32)',
    badge: 'Headline',
    badgeColor: '#dc2626',
    description: 'Prominent headline size for short part codes and high impact tags.',
    specs: '24×32 dots (~4.0mm) • Up to 12 chars/line',
    tsplFont: '4',
    mulX: 1,
    mulY: 1,
    charWidth: 24,
    lineHeight: 32,
    maxLines: 2,
    cssStyle: {
      fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontSize: '12px',
      fontWeight: '800',
      letterSpacing: '0.2px',
      lineHeight: '1.1',
    },
  },
  {
    key: '0',
    label: 'Font 0 — Smooth Vector',
    badge: 'Smooth Vector',
    badgeColor: '#0891b2',
    description: 'TrueType-style curved vector font supported on modern TSC and Xprinter label engines.',
    specs: 'Scalable vector (~2.6mm) • Up to 21 chars/line',
    tsplFont: '0',
    mulX: 1,
    mulY: 1,
    charWidth: 14,
    lineHeight: 22,
    maxLines: 3,
    cssStyle: {
      fontFamily: "'Segoe UI', Roboto, -apple-system, BlinkMacSystemFont, sans-serif",
      fontSize: '9.5px',
      fontWeight: '500',
      lineHeight: '1.1',
    },
  },
];

export function getLabelFontConfig(key?: string): LabelFontConfig {
  return AVAILABLE_LABEL_FONTS.find((f) => f.key === key) || AVAILABLE_LABEL_FONTS[0];
}
