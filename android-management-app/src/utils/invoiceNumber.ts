/**
 * The arithmetic of an invoice number, with no Firebase in it.
 *
 * The phone read its own clock for a reference: `INV-` plus six digits of
 * milliseconds, which runs back to the start every sixteen and a half minutes. Two
 * sales in one busy hour could then carry the same number, and the sale-to-debt match
 * both apps run on `invoiceNumber` would file a payment against the wrong invoice.
 * The counter's till has the same rule and the same counter document, so a sale made
 * on the phone and one made at the counter draw from one sequence per day.
 */

/** `261104` — the shop's own calendar day, not the server's UTC one. */
export const invoiceDayKey = (date: Date = new Date()): string => {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

/**
 * The book this phone writes into. A phone only sells over the counter, so it shares
 * the counter's retail sequence — and stays out of the parts book, which is the
 * desktop's alone.
 */
export const invoiceCounterDocId = (dayKey: string): string => `invoices_retail_${dayKey}`;

export const nextInvoiceNumber = (
  dayKey: string,
  lastNumber: number | undefined | null
): string => {
  const current = Number.isFinite(lastNumber as number) ? Math.max(0, Math.floor(lastNumber as number)) : 0;
  return `INV-${dayKey}-${String(current + 1).padStart(4, '0')}`;
};

/** The clock's guess, kept only for the minutes the counter cannot be reached. */
export const clockInvoiceNumber = (nowMs: number = Date.now()): string =>
  `INV-${String(nowMs).slice(-6)}`;
