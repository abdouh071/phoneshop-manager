/**
 * The single source of truth for the mobile palette, spacing, radius and type.
 *
 * Every value here is a plain literal — this module must stay importable from
 * `node --test` and from the Paper theme, so it cannot import react-native.
 *
 * Status colours live here too. They used to be duplicated as per-screen
 * `switch` statements that disagreed with each other (Workbench knew about
 * `cancelled`, TicketDetail did not), which is how the same ticket could be
 * amber on one screen and slate on another.
 */

/** Raw ramps. Screens should use `colors` below instead of picking from these. */
export const ramp = {
  white: '#ffffff',
  black: '#000000',

  slate50: '#f8fafc',
  slate100: '#f1f5f9',
  slate200: '#e2e8f0',
  slate300: '#cbd5e1',
  slate400: '#94a3b8',
  slate500: '#64748b',
  slate600: '#475569',
  slate700: '#334155',
  slate800: '#1e293b',
  slate900: '#0f172a',

  indigo50: '#eef2ff',
  indigo100: '#e0e7ff',
  indigo200: '#c7d2fe',
  indigo300: '#a5b4fc',
  indigo500: '#6366f1',
  indigo600: '#4f46e5',
  indigo700: '#4338ca',
  indigo900: '#312e81',

  teal100: '#ccfbf1',
  teal500: '#14b8a6',
  teal600: '#0d9488',
  teal900: '#134e4a',

  violet100: '#ede9fe',
  violet600: '#7c3aed',
  violet700: '#8b5cf6',
  violet900: '#4c1d95',

  amber100: '#fef3c7',
  amber200: '#fde68a',
  amber500: '#f59e0b',
  amber600: '#d97706',
  amber700: '#b45309',
  amber800: '#92400e',

  green50: '#f0fdf4',
  green100: '#dcfce7',
  green500: '#22c55e',
  green600: '#16a34a',
  green700: '#059669',

  emerald100: '#d1fae5',
  emerald500: '#10b981',

  red100: '#fee2e2',
  red200: '#fecaca',
  red500: '#ef4444',
  red600: '#dc2626',
  red900: '#7f1d1d',

  blue100: '#dbeafe',
  blue500: '#3b82f6',
  blue600: '#2563eb',

  // Sky: the "for your information" note, distinct from the actionable blue.
  sky100: '#e0f2fe',
  sky200: '#bae6fd',
  sky700: '#0369a1',
} as const;

/** Semantic colours. Reference these from screen styles. */
export const colors = {
  // Surfaces
  background: ramp.slate50,
  surface: ramp.white,
  surfaceMuted: ramp.slate100,
  surfaceRaised: ramp.white,

  // Text
  textPrimary: ramp.slate900,
  textSecondary: ramp.slate600,
  textMuted: ramp.slate500,
  textFaint: ramp.slate400,
  textInverse: ramp.white,

  // Lines
  border: ramp.slate200,
  borderStrong: ramp.slate300,

  /** One scrim value for every hand-rolled modal and for Paper's dialogs. */
  backdrop: 'rgba(15, 23, 42, 0.4)',

  /** The camera screen is the one place that wants true black, not slate. */
  cameraCanvas: ramp.black,
  cameraScrim: 'rgba(0, 0, 0, 0.6)',

  // Brand
  brand: ramp.indigo600,
  brandPressed: ramp.indigo700,
  brandSoft: ramp.indigo50,
  brandSoftStrong: ramp.indigo100,
  brandBorder: ramp.indigo200,
  onBrand: ramp.white,

  // Secondary accents
  accent: ramp.teal500,
  accentSoft: ramp.teal100,
  violet: ramp.violet600,
  violetSoft: ramp.violet100,

  // Feedback
  success: ramp.green600,
  successSoft: ramp.green100,
  warning: ramp.amber500,
  /** For amber surfaces that carry white text — `warning` is too light for AA there. */
  warningSolid: ramp.amber600,
  warningSoft: ramp.amber100,
  warningBorder: ramp.amber200,
  warningText: ramp.amber700,
  /** Deep amber for body copy sitting on `warningSoft`. */
  warningInk: ramp.amber800,
  danger: ramp.red600,
  dangerSoft: ramp.red100,
  dangerBorder: ramp.red200,
  dangerText: ramp.red900,
  info: ramp.blue500,
  infoSoft: ramp.sky100,
  infoBorder: ramp.sky200,
  infoText: ramp.sky700,

  /**
   * WhatsApp's own green. It stays on the share button because a green that is
   * not *that* green stops reading as WhatsApp — but it belongs here, not in a
   * screen's style sheet.
   */
  whatsapp: '#25d366',

  /**
   * The two profit-report modes. Green is cash actually collected at the
   * counter; blue is every repair the technician finished, picked up or not.
   */
  modeTaken: ramp.green700,
  modeWork: ramp.blue600,

  /** Copy, dividers and scrims that sit on top of a `mode*` / brand surface. */
  onBrandSoft: 'rgba(255, 255, 255, 0.88)',
  onBrandFaint: 'rgba(255, 255, 255, 0.25)',
  onBrandHairline: 'rgba(255, 255, 255, 0.15)',
  onBrandScrim: 'rgba(0, 0, 0, 0.2)',
  /** A negative money figure printed on that same saturated surface. */
  lossOnBrand: ramp.red200,
} as const;

/** 4pt spacing scale. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  pill: 20,
  circle: 9999,
} as const;

export const fontSize = {
  /** Badge and pill labels — the only size below `caption`. */
  micro: 10,
  caption: 11,
  label: 12,
  body: 13,
  bodyStrong: 15,
  subtitle: 17,
  title: 20,
  headline: 24,
  display: 30,
} as const;

/**
 * Two levels only. Anything raised above the page (bottom nav, sticky bars,
 * modals) uses `overlay`; cards use `card`, which is a hairline border rather
 * than a shadow — the coloured glows the screens used to carry read as
 * decoration on a shop-floor tool and cost frames to render.
 */
export const elevation = {
  card: {},
  overlay: {
    shadowColor: ramp.slate900,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
    elevation: 4,
  },
} as const;

export type StatusAppearance = {
  /** Solid ink for badges, dots and left rails. */
  ink: string;
  /** Soft background to pair with `ink` text. */
  tint: string;
};

/** Repair ticket lifecycle. */
export const repairStatusColors: Record<string, StatusAppearance> = {
  pending: { ink: ramp.amber500, tint: ramp.amber100 },
  in_progress: { ink: ramp.blue500, tint: ramp.blue100 },
  ready: { ink: ramp.emerald500, tint: ramp.emerald100 },
  completed: { ink: ramp.violet700, tint: ramp.violet100 },
  returned: { ink: ramp.red500, tint: ramp.red100 },
  cancelled: { ink: ramp.slate400, tint: ramp.slate100 },
};

/** Stock levels. */
export const stockStatusColors: Record<string, StatusAppearance> = {
  in_stock: { ink: ramp.green600, tint: ramp.green100 },
  low_stock: { ink: ramp.amber500, tint: ramp.amber100 },
  out_of_stock: { ink: ramp.red600, tint: ramp.red100 },
};

/** Sales transaction states. */
export const saleStatusColors: Record<string, StatusAppearance> = {
  completed: { ink: ramp.green600, tint: ramp.green100 },
  voided: { ink: ramp.red600, tint: ramp.red100 },
  refunded: { ink: ramp.red500, tint: ramp.red100 },
  pending_approval: { ink: ramp.amber500, tint: ramp.amber100 },
};

const NEUTRAL: StatusAppearance = { ink: ramp.slate500, tint: ramp.slate100 };

export const statusAppearance = (
  table: Record<string, StatusAppearance>,
  status: string | null | undefined
): StatusAppearance => (status && table[status]) || NEUTRAL;

/**
 * The ~12 % wash that goes behind an `ink` colour — icon circles, pills. One
 * alpha value so a tint means the same thing on every screen.
 */
export const softTint = (ink: string): string => `${ink}1F`;

/**
 * A tinted pill: soft background with the ink as the label colour. Falls back
 * to the brand when no colour is passed, which is what the filter chips want.
 */
export const tintedPill = (ink?: string): { backgroundColor: string; color: string } => {
  const base = ink ?? colors.brand;
  return { backgroundColor: softTint(base), color: base };
};
