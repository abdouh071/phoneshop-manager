import { describe, it, expect } from 'vitest';
import { normalizeArabic, phoneQueryDigits } from './normalizeText';

describe('normalizeArabic', () => {
  it('folds the hamza carriers onto their base letter', () => {
    expect(normalizeArabic('أسامة')).toBe(normalizeArabic('اسامة'));
    expect(normalizeArabic('إسلام')).toBe('اسلام');
    expect(normalizeArabic('آية')).toBe(normalizeArabic('اية'));
    expect(normalizeArabic('مؤمن')).toBe('مومن');
    expect(normalizeArabic('شيئ')).toBe('شيي');
  });

  it('folds the three letters NFD leaves alone, like the phone does', () => {
    expect(normalizeArabic('فاطمة')).toBe(normalizeArabic('فاطمه'));
    expect(normalizeArabic('على')).toBe(normalizeArabic('علي'));
    expect(normalizeArabic('ٱلله')).toBe(normalizeArabic('الله'));
    expect(normalizeArabic('هٰذا')).toBe(normalizeArabic('هذا'));
  });

  it('drops tatweel and harakat', () => {
    expect(normalizeArabic('مـحـمد')).toBe('محمد');
    expect(normalizeArabic('مُحَمَّد')).toBe('محمد');
  });

  it('folds both Arabic digit ranges to ASCII', () => {
    expect(normalizeArabic('٠٧٧٠١٢٣٤٥٦')).toBe('0770123456');
    expect(normalizeArabic('۰۷۷۰')).toBe('0770');
  });

  it('folds Latin accents', () => {
    expect(normalizeArabic('ÀÉÎÕÜ')).toBe('aeiou');
    expect(normalizeArabic('Çà et là')).toBe('ca et la');
  });

  it('treats punctuation as a separator on both sides of a comparison', () => {
    expect(normalizeArabic('iPhone-15')).toBe('iphone 15');
    expect(normalizeArabic('Samsung/A54')).toBe('samsung a54');
    expect(normalizeArabic('TKT-0039')).toBe(normalizeArabic('TKT 0039'));
  });

  it('collapses whitespace so a double space is not a different query', () => {
    expect(normalizeArabic('  Karim   Tech  ')).toBe('karim tech');
    expect(normalizeArabic('Oppo\ta5s')).toBe('oppo a5s');
  });

  it('reads a missing or non-text field as empty instead of throwing', () => {
    expect(normalizeArabic(undefined)).toBe('');
    expect(normalizeArabic(null)).toBe('');
    expect(normalizeArabic({})).toBe('');
    expect(normalizeArabic([])).toBe('');
    expect(normalizeArabic(Number.NaN)).toBe('');
    expect(normalizeArabic(42)).toBe('42');
  });
});

describe('phoneQueryDigits', () => {
  it('reads a phone typed with separators, a plus, or Arabic digits', () => {
    expect(phoneQueryDigits('0770 12 34 56')).toBe('0770123456');
    expect(phoneQueryDigits('0770-12-34-56')).toBe('0770123456');
    expect(phoneQueryDigits('+213 770 12 34 56')).toBe('213770123456');
    expect(phoneQueryDigits('٠٧٧٠١٢٣٤٥٦')).toBe('0770123456');
    expect(phoneQueryDigits(770123456)).toBe('770123456');
  });

  it('refuses the digits inside a model name, which matched every phone containing them', () => {
    expect(phoneQueryDigits('A54')).toBe('');
    expect(phoneQueryDigits('Samsung S22')).toBe('');
    expect(phoneQueryDigits('iPhone 15')).toBe('');
    expect(phoneQueryDigits('Redmi Note 12')).toBe('');
  });

  it('is empty for a query with no number in it', () => {
    expect(phoneQueryDigits('محمد')).toBe('');
    expect(phoneQueryDigits('')).toBe('');
    expect(phoneQueryDigits('   ')).toBe('');
    expect(phoneQueryDigits(null)).toBe('');
  });
});