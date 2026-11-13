import { describe, it, expect } from 'vitest';
import { normalizeCompatibleModels, modelsFromProduct, joinModels } from './compatibleModels';

describe('normalizeCompatibleModels', () => {
  it('trims, collapses inner spaces and drops empty entries', () => {
    expect(normalizeCompatibleModels(['  A50 ', '', ' 7 /  A70 ', '   '])).toEqual(['A50', '7 / A70']);
  });

  it('dedupes case-insensitively, keeping the first spelling', () => {
    expect(normalizeCompatibleModels(['A50', 'a50', 'A50', 'B10'])).toEqual(['A50', 'B10']);
  });

  it('returns an empty array when nothing is entered', () => {
    expect(normalizeCompatibleModels([])).toEqual([]);
    expect(normalizeCompatibleModels(['', '   '])).toEqual([]);
  });
});

describe('modelsFromProduct', () => {
  it('prefers the compatibleModels list when present', () => {
    expect(modelsFromProduct({ model: 'A50 B10', compatibleModels: ['A50', 'B10'] })).toEqual(['A50', 'B10']);
  });

  it('keeps the legacy model string as one editable entry, never dropping it', () => {
    expect(modelsFromProduct({ model: '7/A70/A60S/A50/A05S ORG 100%' })).toEqual(['7/A70/A60S/A50/A05S ORG 100%']);
  });

  it('yields an empty list when the product has neither', () => {
    expect(modelsFromProduct({ model: '', compatibleModels: [] })).toEqual([]);
    expect(modelsFromProduct({ model: '  ' })).toEqual([]);
  });
});

describe('joinModels', () => {
  it('joins normalized values into the legacy model field', () => {
    expect(joinModels(['A50', '', ' B10 ', 'b10'])).toBe('A50 B10');
  });
});
