import { describe, it, expect } from 'vitest';
import { AVAILABLE_LABEL_FONTS, getLabelFontConfig } from './labelFontConfig';

describe('labelFontConfig', () => {
  it('provides all 6 distinct TSPL thermal label fonts', () => {
    expect(AVAILABLE_LABEL_FONTS.length).toBe(6);
    const keys = AVAILABLE_LABEL_FONTS.map((f) => f.key);
    expect(keys).toEqual(['2', '1', '1x2', '3', '4', '0']);
  });

  it('every font has valid positive char dimensions and maxLines', () => {
    for (const font of AVAILABLE_LABEL_FONTS) {
      expect(font.charWidth).toBeGreaterThan(0);
      expect(font.lineHeight).toBeGreaterThan(0);
      expect(font.maxLines).toBeGreaterThanOrEqual(2);
      expect(font.maxLines).toBeLessThanOrEqual(3);
      expect(font.cssStyle.fontSize).toBeDefined();
      expect(font.cssStyle.fontFamily).toBeDefined();
    }
  });

  it('getLabelFontConfig returns matching config or defaults to Font 2', () => {
    expect(getLabelFontConfig('1').key).toBe('1');
    expect(getLabelFontConfig('3').key).toBe('3');
    expect(getLabelFontConfig('unknown').key).toBe('2');
    expect(getLabelFontConfig(undefined).key).toBe('2');
  });
});
