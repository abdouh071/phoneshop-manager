import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enTranslations from './locales/en/translation.json';
import frTranslations from './locales/fr/translation.json';
import arTranslations from './locales/ar/translation.json';

const resources = {
  en: {
    translation: enTranslations
  },
  fr: {
    translation: frTranslations
  },
  ar: {
    translation: arTranslations
  }
};

// Arabic has six CLDR plural categories (zero/one/two/few/many/other); English, French and
// the rest of this file's translations are authored with two. i18next picks the suffix from
// Intl.PluralRules and has no cross-category fallback, so an Arabic count of 2 or 7 looked
// for `_two`/`_few`, found nothing, and rendered the English string instead. Filling the
// gaps from `_other` keeps every count in Arabic — and `_other` is already the correct
// Arabic plural form for 3-10, the range these badges actually show.
const ARABIC_CATEGORIES_FROM_OTHER = ['_zero', '_two', '_few', '_many'] as const;

const aliasArabicPluralForms = (namespace: Record<string, unknown>): void => {
  for (const [key, value] of Object.entries(namespace)) {
    if (value !== null && typeof value === 'object') {
      aliasArabicPluralForms(value as Record<string, unknown>);
      continue;
    }
    if (!key.endsWith('_other') || typeof value !== 'string') continue;
    const base = key.slice(0, -'_other'.length);
    for (const suffix of ARABIC_CATEGORIES_FROM_OTHER) {
      const aliasedKey = base + suffix;
      if (!(aliasedKey in namespace)) namespace[aliasedKey] = value;
    }
  }
};

aliasArabicPluralForms(resources.ar.translation as Record<string, unknown>);

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false // React already escapes by default
    }
  });

// Handle RTL direction when switching to/from Arabic
const updateDirection = (lang: string) => {
  if (typeof document !== 'undefined') {
    const isArabic = lang.startsWith('ar');
    document.documentElement.dir = isArabic ? 'rtl' : 'ltr';
    document.documentElement.lang = isArabic ? 'ar' : lang;
  }
};

updateDirection(i18n.language || 'en');
i18n.on('languageChanged', updateDirection);

export default i18n;
