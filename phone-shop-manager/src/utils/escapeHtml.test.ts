import { describe, it, expect } from 'vitest';
import { escapeHtml } from './escapeHtml';

describe('escapeHtml', () => {
  it('escapes the five HTML-sensitive characters', () => {
    expect(escapeHtml(`<img src=x onerror="alert('xss')"> & Co`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt; &amp; Co'
    );
  });

  it('turns null and undefined into empty text', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('stringifies numbers and booleans', () => {
    expect(escapeHtml(0)).toBe('0');
    expect(escapeHtml(false)).toBe('false');
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('iPhone 14 Pro Max 128GB')).toBe('iPhone 14 Pro Max 128GB');
  });
});
