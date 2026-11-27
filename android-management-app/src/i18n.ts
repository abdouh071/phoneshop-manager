import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import { I18nManager, Platform } from 'react-native';
import * as Updates from 'expo-updates';

import enTranslations from './locales/en/translation.json';
import frTranslations from './locales/fr/translation.json';
import arTranslations from './locales/ar/translation.json';

const resources = {
  en: { translation: enTranslations },
  fr: { translation: frTranslations },
  ar: { translation: arTranslations }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: Localization.getLocales()[0]?.languageCode ?? 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false // react already safes from xss
    }
  });

const RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur'];

/**
 * Mirrors the whole layout for right-to-left languages. React Native reads the
 * flag once at startup, so a change only lands after a restart — this returns
 * true when that restart is owed.
 */
export const applyDirection = (language: string): boolean => {
  if (Platform.OS === 'web') return false;
  const wantsRTL = RTL_LANGUAGES.includes((language || 'en').split('-')[0]);
  if (I18nManager.isRTL === wantsRTL) return false;
  I18nManager.allowRTL(wantsRTL);
  I18nManager.forceRTL(wantsRTL);
  // Stated rather than inherited: physical `left`/`right`/`marginLeft` styles in
  // this app's stylesheets are written for LTR, and the swap is what mirrors them.
  I18nManager.swapLeftAndRightInRTL(true);
  return true;
};

/** Switches the copy and the layout direction together. */
export const setLanguage = async (language: string): Promise<boolean> => {
  await i18n.changeLanguage(language);
  return applyDirection(language);
};

/**
 * Restarts the app so the new direction takes effect. `expo-updates` is the
 * only in-app restart available on a standalone build; it is missing in Expo
 * Go, in which case the caller has to tell the user to relaunch by hand.
 */
export const restartForDirection = async (): Promise<boolean> => {
  try {
    await Updates.reloadAsync();
    return true;
  } catch {
    return false;
  }
};

// A language picked on another device (or a direction change the user never
// finished by restarting) is reconciled here, on every cold start.
applyDirection(i18n.language);

export default i18n;
