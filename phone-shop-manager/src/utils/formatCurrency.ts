import { useSettingsStore } from '../store/settingsStore';
import { usePrivacyStore } from '../store/privacyStore';
import { useCallback } from 'react';

/**
 * Returns the short display symbol/code for a given currency (e.g. '$', 'DA', '€', '£').
 */
export const getCurrencySymbol = (currency?: string): string => {
  const curr = (currency || useSettingsStore.getState().currency || 'USD').toUpperCase();
  switch (curr) {
    case 'USD': return '$';
    case 'EUR': return '€';
    case 'DZD': return 'DA';
    case 'GBP': return '£';
    case 'CAD': return 'CA$';
    case 'AUD': return 'AU$';
    case 'TRY': return '₺';
    case 'SAR': return 'SAR';
    case 'AED': return 'AED';
    default: return curr;
  }
};

/**
 * Pure formatter for a specific currency code.
 */
export const formatCurrencyWith = (amount: number, currency: string = 'USD', noFractions = false): string => {
  if (isNaN(amount) || amount === null || amount === undefined) {
    amount = 0;
  }
  const curr = (currency || 'USD').toUpperCase();

  if (curr === 'DZD') {
    // Algerian Dinar: formatted as "41 000 DA"
    const formatted = noFractions
      ? Math.round(amount).toLocaleString('fr-FR').replace(/\s/g, ' ')
      : amount.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).replace(/\s/g, ' ');
    return `${formatted} DA`;
  }

  if (curr === 'EUR') {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: noFractions ? 0 : 2,
    }).format(amount);
  }

  if (curr === 'GBP') {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      maximumFractionDigits: noFractions ? 0 : 2,
    }).format(amount);
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: curr,
    maximumFractionDigits: noFractions ? 0 : 2,
  }).format(amount);
};

/**
 * Formats a monetary amount using the currently active store currency.
 */
export const formatCurrency = (amount: number, noFractions = false): string => {
  const { currency } = useSettingsStore.getState();
  return formatCurrencyWith(amount, currency || 'USD', noFractions);
};

/**
 * Formats a monetary amount, masking it to ••••• DA if Privacy Curtain Mode is active.
 */
export const formatPrivateCurrency = (amount: number, noFractions = false): string => {
  if (usePrivacyStore.getState().isPrivacyActive) {
    const { currency } = useSettingsStore.getState();
    const curr = (currency || 'USD').toUpperCase();
    if (curr === 'DZD') return '••••• DA';
    if (curr === 'EUR') return '••••• €';
    if (curr === 'GBP') return '£•••••';
    return '$•••••';
  }
  return formatCurrency(amount, noFractions);
};

/**
 * React hook that subscribes to the active currency and privacy mode,
 * returning a reactive formatter function with .private(amount) support.
 */
export const useFormatCurrency = () => {
  const currency = useSettingsStore((s) => s.currency);
  const isPrivacyActive = usePrivacyStore((s) => s.isPrivacyActive);

  const format = useCallback(
    (amount: number, noFractions = false) => {
      return formatCurrencyWith(amount, currency, noFractions);
    },
    [currency]
  );

  const privateFormat = useCallback(
    (amount: number, noFractions = false) => {
      if (isPrivacyActive) {
        const curr = (currency || 'USD').toUpperCase();
        if (curr === 'DZD') return '••••• DA';
        if (curr === 'EUR') return '••••• €';
        if (curr === 'GBP') return '£•••••';
        return '$•••••';
      }
      return formatCurrencyWith(amount, currency, noFractions);
    },
    [currency, isPrivacyActive]
  );

  return Object.assign(format, {
    private: privateFormat,
    isPrivacyActive,
  });
};

