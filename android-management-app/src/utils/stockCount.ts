/**
 * Reading a stocktake count off the keypad.
 *
 * The adjust sheet promises "New Exact Stock Count" and then writes that number to
 * the shelf, so what the field holds has to be a whole number of units or nothing.
 * The old reader used `parseInt`, which sees an Arabic-keyboard ١٠ as no digits at
 * all and silently fell back to the previous total, and accepted "12abc" as 12.
 */
import { foldDigitsToAscii } from './phone.ts';

/** `null` means the field is not a count; the sheet must not offer to write it. */
export const parseStockCount = (value: unknown): number | null => {
  const raw = foldDigitsToAscii(value).trim();
  if (!/^\d+$/.test(raw)) return null;
  const counted = Number(raw);
  return Number.isSafeInteger(counted) ? counted : null;
};