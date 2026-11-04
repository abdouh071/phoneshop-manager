/**
 * The arithmetic of an invoice number, with no Firebase in it.
 *
 * The till used to read its own clock: `INV-PARTS-` plus six digits of milliseconds.
 * That sequence repeats every sixteen and a half minutes, so two parts sales inside
 * one busy hour could print the same number — and the sale↔debt match both apps run
 * on `invoiceNumber` would then attach a payment to the wrong invoice. A number is
 * now drawn once per sale from a shared daily counter, in both apps.
 */

export type InvoiceScope = 'retail' | 'parts';

/** The paper keeps saying which book a number belongs to, so the prefixes stay. */
const PREFIX: Record<InvoiceScope, string> = {
  retail: 'INV',
  parts: 'INV-PARTS',
};

/** `261104` — the shop's own calendar day, not the server's UTC day. */
export const invoiceDayKey = (date: Date = new Date()): string => {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

/** One counter document per scope per day, so a parts line never eats a retail one. */
export const invoiceCounterDocId = (scope: InvoiceScope, dayKey: string): string =>
  `invoices_${scope}_${dayKey}`;

export const nextInvoiceNumber = (
  scope: InvoiceScope,
  dayKey: string,
  lastNumber: number | undefined | null
): string => {
  const current = Number.isFinite(lastNumber as number) ? Math.max(0, Math.floor(lastNumber as number)) : 0;
  return `${PREFIX[scope]}-${dayKey}-${String(current + 1).padStart(4, '0')}`;
};

/** The clock's guess, kept only for the minutes the counter cannot be reached. */
export const clockInvoiceNumber = (scope: InvoiceScope, nowMs: number = Date.now()): string =>
  `${PREFIX[scope]}-${String(nowMs).slice(-6)}`;
