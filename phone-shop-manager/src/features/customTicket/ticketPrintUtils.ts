import type { TextFontSize } from './customTicketTypes';

// Compute responsive font size for blank sticker centered text
export const getComputedFontSize = (text: string, sizePref?: TextFontSize, isCompact: boolean = true) => {
  if (sizePref === 'normal') return isCompact ? '13px' : '15px';
  if (sizePref === 'large') return isCompact ? '17px' : '20px';
  if (sizePref === 'huge') return isCompact ? '22px' : '26px';
  if (sizePref === 'giant') return isCompact ? '28px' : '34px';

  const lines = (text || '').split('\n');
  const maxLineLen = lines.reduce((acc, l) => Math.max(acc, l.trim().length), 0);
  if (lines.length === 1 && maxLineLen <= 10) return isCompact ? '26px' : '32px';
  if (lines.length <= 2 && maxLineLen <= 16) return isCompact ? '20px' : '25px';
  if (lines.length <= 4 && maxLineLen <= 24) return isCompact ? '16px' : '20px';
  return isCompact ? '13px' : '15px';
};
