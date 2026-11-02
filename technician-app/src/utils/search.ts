/**
 * Local search helpers for the technician app.
 *
 * Filtering runs over lists that are already in memory — this never issues a
 * Firestore query, so keystrokes stay off the Spark plan bill.
 *
 * The reason it exists: every screen used to do `field.toLowerCase().includes(q)`
 * inline. That crashes on any record with a missing name (`c.name.toLowerCase()`),
 * misses Arabic because أ and ا are different characters to `includes`, and
 * re-normalises every field of every row on every keystroke.
 */

/** Arabic harakat and superscript alef, plus tatweel (the stretch character). */
const ARABIC_MARKS = /[ـ\u064B-\u0652\u0670]/g;
/** Combining marks left over from Latin names typed with a dead key. */
const COMBINING_MARKS = /[\u0300-\u035F]/g;

const ARABIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

const ARABIC_FOLDS: [RegExp, string][] = [
  [/[آأإٱ]/g, 'ا'],
  [/ؤ/g, 'و'],
  [/ئ/g, 'ي'],
  [/ة/g, 'ه'],
  [/ى/g, 'ي'],
];

const LATIN_FOLDS: [RegExp, string][] = [
  [/[àáâãäå]/g, 'a'],
  [/[èéêë]/g, 'e'],
  [/[ìíîï]/g, 'i'],
  [/[òóôõö]/g, 'o'],
  [/[ùúûü]/g, 'u'],
  [/ñ/g, 'n'],
  [/ç/g, 'c'],
];

/**
 * Anything that is not a letter, a digit or a space becomes a space, so hyphens
 * and slashes never make two records that read the same compare differently.
 * Deliberately avoids `\p{...}` classes, which need ICU in the JS engine.
 */
const NON_ALPHANUMERIC = /[^a-z0-9 \u0600-\u06FF]/g;

/** Fields arrive from Firestore as anything: missing, null, a number, an object. */
const asText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return '';
};

/**
 * Case-folded, diacritic-stripped, letter-folded, whitespace-collapsed text that
 * two records can be compared in even when one was typed on an Arabic keyboard
 * and the other was stored by the desktop app.
 */
export const normalizeForSearch = (value: unknown): string => {
  let text = asText(value).toLowerCase();
  text = text.replace(ARABIC_MARKS, '').replace(COMBINING_MARKS, '');
  for (const [pattern, replacement] of ARABIC_FOLDS) text = text.replace(pattern, replacement);
  for (const [pattern, replacement] of LATIN_FOLDS) text = text.replace(pattern, replacement);
  // Arabic-Indic digits are folded so a phone typed on an Arabic keyboard matches the
  // ASCII digits the desktop app stored.
  text = text.replace(ARABIC_DIGITS, (ch) =>
    String(ch.charCodeAt(0) - (ch.charCodeAt(0) >= 0x06f0 ? 0x06f0 : 0x0660))
  );
  return text.replace(NON_ALPHANUMERIC, ' ').replace(/\s+/g, ' ').trim();
};

/** Every digit in the values, concatenated — so `0770 12 34 56` matches `0770123456`. */
const digitsOf = (values: readonly unknown[]): string =>
  values.map(asText).join('').replace(/\D/g, '');

export type SearchDoc = {
  /** Normalised, space-separated haystack for this record. */
  text: string;
  /** Digits only, for phone numbers, IMEIs, ticket numbers and barcodes. */
  digits: string;
};

/**
 * Build once per record and reuse for every keystroke:
 * `useMemo(() => items.map(i => buildSearch(i.name, i.phone)), [items])`.
 */
export const buildSearch = (...fields: readonly unknown[]): SearchDoc => {
  const values = fields.map(asText);
  return {
    text: normalizeForSearch(values.join(' ')),
    digits: digitsOf(values),
  };
};

const isDigitToken = (token: string): boolean => /^[0-9]+$/.test(token);

/**
 * True when every token of the query appears in the record. Tokens are ANDed and
 * may be typed in any order, so "1234 samsung" finds the same row as "samsung 1234".
 * An empty or whitespace-only query matches everything, which is what the screens
 * want before the user has typed.
 */
export const matchesSearch = (doc: SearchDoc, query: unknown): boolean => {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return true;
  const queryDigits = digitsOf([query]);

  return normalizedQuery.split(' ').every((token) =>
    doc.text.includes(token) ||
    // Digits typed with separators or grouping still find the row.
    (isDigitToken(token) && queryDigits.includes(token) && doc.digits.includes(token))
  );
};
