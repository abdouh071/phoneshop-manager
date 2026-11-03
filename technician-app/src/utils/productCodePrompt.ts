/**
 * Asking the technician which product they meant.
 *
 * Two rows claiming one code is a data problem, not a search problem, and the
 * person standing at the counter is the only one who can tell them apart. The
 * alternative — picking one for them — is the bug this replaces.
 */
import { Alert } from 'react-native';
import i18n from '../i18n';
import type { PhoneModel } from '../types/index.ts';
import type { CodeMatch } from './productCode.ts';

/** Alert gives a phone one thumb's worth of buttons; past three the codes need fixing in inventory. */
const MAX_CHOICES = 3;

const describe = ({ product }: CodeMatch): string =>
  [product.name, product.model, product.sku].filter(Boolean).join(' · ');

export const askWhichProduct = (
  code: string,
  candidates: readonly CodeMatch[],
  onPick: (product: PhoneModel) => void
): void => {
  const shown = candidates.slice(0, MAX_CHOICES);
  Alert.alert(
    i18n.t('productCode.duplicateTitle', 'Same code on more than one product'),
    i18n.t(
      'productCode.duplicateBody',
      '"{{code}}" is saved on {{total}} products. Pick the one you meant — an admin should give one of them a new code.',
      { code, total: candidates.length }
    ),
    [
      ...shown.map((match) => ({
        text: describe(match),
        onPress: () => onPick(match.product),
      })),
      { text: i18n.t('common.cancel', 'Cancel'), style: 'cancel' as const },
    ]
  );
};
