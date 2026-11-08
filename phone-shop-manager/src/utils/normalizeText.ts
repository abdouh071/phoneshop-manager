/**
 * Folds Arabic-Indic and Extended Arabic-Indic digits to ASCII, removes tatweel
 * and harakat diacritics, NFD-normalises, strips combining characters, and
 * lowercases — so a cashier typing أسامة finds اسامة, and مـحـمد finds محمد.
 */
export const normalizeArabic = (s: string): string =>
  (s ?? '')
    // Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) → ASCII
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    // Extended Arabic-Indic digits (۰۱۲۳۴۵۶۷۸۹) → ASCII
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
    // Tatweel (ـ) — decorative elongation, never part of a root
    .replace(/\u0640/g, '')
    // NFD splits base+diacritic so the strip below can target diacritics alone
    .normalize('NFD')
    // Latin combining marks (accents) + Arabic harakat (tashkeel)
    .replace(/[\u0300-\u036f\u064b-\u065f]/g, '')
    .toLowerCase()
    .trim();
