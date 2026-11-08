/**
 * Search folding for the desktop lists, kept in step with the phone app's
 * `normalizeForSearch` so one query finds the same row on both devices.
 */

/** Fields arrive from Firestore as anything: missing, null, a number, an object. */
const asText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return '';
};

/**
 * Folds Arabic-Indic digits to ASCII, drops tatweel and harakat, NFD-normalises
 * so accents and hamza carriers collapse to their base letter, folds the three
 * Arabic letters NFD leaves alone, and turns punctuation into spaces — so
 * أسامة finds اسامة, مـحـمد finds محمد, فاطمة finds فاطمه and iPhone-15 finds
 * iPhone 15.
 */
export const normalizeArabic = (value: unknown): string =>
  asText(value)
    // Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) → ASCII
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    // Extended Arabic-Indic digits (۰۱۲۳۴۵۶۷۸۹) → ASCII
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
    // Tatweel (ـ) — decorative elongation, never part of a root
    .replace(/\u0640/g, '')
    // NFD splits base+diacritic so the strip below can target diacritics alone
    .normalize('NFD')
    // Latin accents, Arabic harakat, the marks NFD split off أ إ ؤ ئ آ, and the
    // superscript alef (U+0670), which has no decomposition of its own.
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '')
    // Teh marbuta, alef maksura and alef wasla survive NFD untouched.
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ٱ/g, 'ا')
    .toLowerCase()
    .replace(/[^a-z0-9 \u0600-\u06ff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Digits of a query that is nothing but a phone number: separators and an
 * international `+` are ignored, but a query carrying letters returns '' so the
 * digits inside a model name ("A54", "S22") stop matching every phone that
 * happens to contain them. Arabic-Indic digits are folded first — `\D` on the
 * raw query would erase a number typed on an Arabic keyboard.
 */
export const phoneQueryDigits = (query: unknown): string => {
  const text = normalizeArabic(query).replace(/\s/g, '');
  const digits = text.replace(/\D/g, '');
  return digits && digits === text ? digits : '';
};