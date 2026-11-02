import { describe, expect, it } from 'vitest';
import arTranslations from './locales/ar/translation.json';
import i18n from './i18n';

/**
 * Intl.PluralRules gives Arabic six categories while the translations are authored in two,
 * and i18next has no fallback between them: a missing `_few` renders the English string.
 * These tests pin the gap-closing step in `i18n.ts` — both the data invariant and the
 * user-visible result — because the failure is silent and reads as "working" at count 1.
 */
const ARABIC_CATEGORIES = ['one', 'two', 'few', 'many', 'zero', 'other'] as const;

const flattenKeys = (value: unknown, prefix = ''): string[] =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([k, v]) => flattenKeys(v, `${prefix}${k}.`))
    : [prefix.slice(0, -1)];

const readByPath = (value: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, part) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[part];
  }, value);

describe('Arabic plural resources', () => {
  const pluralBases = [...new Set(
    flattenKeys(arTranslations)
      .filter(key => key.endsWith('_other'))
      .map(key => key.slice(0, -'_other'.length)),
  )];

  it('finds Arabic plural keys to check', () => {
    expect(pluralBases.length).toBeGreaterThan(0);
  });

  it('covers every CLDR category Arabic selects for, not just one and other', () => {
    for (const base of pluralBases) {
      for (const category of ARABIC_CATEGORIES) {
        const path = `${base}_${category}`;
        expect(typeof readByPath(arTranslations, path), path).toBe('string');
      }
    }
  });
});

describe('Arabic translation at runtime', () => {
  const counts = [0, 1, 2, 3, 7, 11, 100];

  it('keeps the dropped-writes badge in Arabic for every count it can show', () => {
    for (const count of counts) {
      const arabic = i18n.t('common.droppedWrites', { count, lng: 'ar' });
      const english = i18n.t('common.droppedWrites', { count, lng: 'en' });
      expect(arabic, `count=${count}`).not.toBe(english);
      // Only the `_one` form spells the number out as a word.
      if (count !== 1) expect(arabic, `count=${count}`).toContain(String(count));
    }
  });

  it('interpolates the count into the pre-existing offline banner strings too', () => {
    for (const count of [2, 3, 11]) {
      const arabic = i18n.t('common.pendingChanges', { count, lng: 'ar' });
      const english = i18n.t('common.pendingChanges', { count, lng: 'en' });
      expect(arabic, `count=${count}`).not.toBe(english);
    }
  });

  it('leaves English and French plural resolution untouched', () => {
    expect(i18n.t('common.droppedWrites', { count: 1, lng: 'en' })).toBe(
      '1 offline write was dropped and never reached the database.',
    );
    expect(i18n.t('common.droppedWrites', { count: 4, lng: 'en' })).toBe(
      '4 offline writes were dropped and never reached the database.',
    );

    const french = i18n.t('common.droppedWrites', { count: 4, lng: 'fr' });
    expect(french).not.toBe(i18n.t('common.droppedWrites', { count: 4, lng: 'en' }));
    expect(french).toContain('4');
  });
});
