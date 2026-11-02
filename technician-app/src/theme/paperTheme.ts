import { DefaultTheme } from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper';
import { colors, radius, ramp } from './tokens';

/**
 * The app's Paper theme.
 *
 * `DefaultTheme` is Material Design 3, so its palette is the Material baseline
 * purple. The screens were written against an indigo/slate brand, and the theme
 * block that used to live in App.tsx set MD2 keys (`accent`, `text`,
 * `placeholder`) that the MD3 theme ignores — so Paper components kept rendering
 * lavender neutrals next to hand-written slate styles.
 *
 * Annotating this as `MD3Theme` is deliberate: the object literal is excess-
 * property checked, so a key that the theme does not read will fail typecheck
 * instead of silently doing nothing.
 */
export const paperTheme: MD3Theme = {
  ...DefaultTheme,
  roundness: radius.lg,
  colors: {
    ...DefaultTheme.colors,

    primary: colors.brand,
    primaryContainer: ramp.indigo100,
    onPrimary: colors.onBrand,
    onPrimaryContainer: ramp.indigo900,

    secondary: ramp.teal600,
    secondaryContainer: ramp.teal100,
    onSecondary: colors.onBrand,
    onSecondaryContainer: ramp.teal900,

    tertiary: colors.violet,
    tertiaryContainer: colors.violetSoft,
    onTertiary: colors.onBrand,
    onTertiaryContainer: ramp.violet900,

    background: colors.background,
    onBackground: colors.textPrimary,

    surface: colors.surface,
    surfaceVariant: colors.surfaceMuted,
    onSurface: colors.textPrimary,
    onSurfaceVariant: colors.textSecondary,
    surfaceDisabled: 'rgba(15, 23, 42, 0.12)',
    onSurfaceDisabled: 'rgba(15, 23, 42, 0.38)',

    error: colors.danger,
    errorContainer: colors.dangerSoft,
    onError: colors.onBrand,
    onErrorContainer: colors.dangerText,

    outline: colors.textFaint,
    outlineVariant: colors.border,
    inverseSurface: ramp.slate800,
    inverseOnSurface: ramp.slate100,
    inversePrimary: ramp.indigo300,

    shadow: ramp.slate900,
    scrim: ramp.slate900,
    backdrop: 'rgba(15, 23, 42, 0.4)',

    // Solid tints, not alpha: transparent elevations make React Native push the
    // shadow onto child views instead of the surface.
    elevation: {
      level0: 'transparent',
      level1: '#fafbfc',
      level2: '#f4f6f8',
      level3: '#eef1f4',
      level4: '#e9edf1',
      level5: '#e4e9ee',
    },
  },
};
