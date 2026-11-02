import type { EndOfDayRecord } from '../services/endOfDayService';
import type { DayFigures } from './dayFigures';

/** Half a cent: figures are summed from stored decimals, so anything below this is float noise. */
const CENT = 0.005;

interface ComparedField {
  seal: keyof EndOfDayRecord;
  live: keyof DayFigures;
  label: string;
}

/**
 * Seal field names and live-figure field names are not spelled the same, so the pairs
 * are listed rather than inferred. A seal that never stored a field is skipped instead
 * of being read as zero, which would report a phantom drift on every older day.
 */
const COMPARED_FIELDS: ComparedField[] = [
  { seal: 'salesCount', live: 'salesCount', label: 'Sales transactions' },
  { seal: 'salesTotalRevenue', live: 'salesGrossRevenue', label: 'Sales revenue' },
  { seal: 'salesCogs', live: 'salesCOGS', label: 'Cost of goods' },
  { seal: 'salesNetProfit', live: 'salesNetProfit', label: 'Sales profit' },
  { seal: 'salesCash', live: 'salesCash', label: 'Sales cash' },
  { seal: 'salesCard', live: 'salesCard', label: 'Sales card' },
  { seal: 'salesMobile', live: 'salesMobile', label: 'Sales mobile' },
  { seal: 'salesTransfer', live: 'salesTransfer', label: 'Sales transfer' },
  { seal: 'salesStoreCredit', live: 'salesStoreCredit', label: 'Sales store credit' },
  { seal: 'salesDebt', live: 'salesDebt', label: 'Sales on credit' },
  { seal: 'refundsCash', live: 'refundsCash', label: 'Cash refunds' },
  { seal: 'repairsCompleted', live: 'repairsCompletedCount', label: 'Repairs completed' },
  { seal: 'repairsTotalRevenue', live: 'repairsRevenue', label: 'Repair revenue' },
  { seal: 'repairsPartsCost', live: 'repairsPartsCost', label: 'Repair parts cost' },
  { seal: 'repairsNetProfit', live: 'repairsNetProfit', label: 'Repair profit' },
  { seal: 'repairsCash', live: 'repairsCash', label: 'Repair cash' },
  { seal: 'repairHandoversCash', live: 'repairsHandoverCash', label: 'Repair handovers' },
  { seal: 'repairDepositsCash', live: 'repairsDepositCash', label: 'Repair deposits' },
  { seal: 'repairsDebt', live: 'repairsDebt', label: 'Repair debt' },
  { seal: 'partsSalesCount', live: 'partsCount', label: 'Parts invoices' },
  { seal: 'partsSalesRevenue', live: 'partsRevenue', label: 'Parts revenue' },
  { seal: 'partsCash', live: 'partsCash', label: 'Parts cash' },
  { seal: 'partsCard', live: 'partsCard', label: 'Parts card' },
  { seal: 'partsMobile', live: 'partsMobile', label: 'Parts mobile' },
  { seal: 'partsTransfer', live: 'partsTransfer', label: 'Parts transfer' },
  { seal: 'partsCogs', live: 'partsCOGS', label: 'Parts cost' },
  { seal: 'debtCollectedCash', live: 'debtCollectedCash', label: 'Debt collected' },
  { seal: 'totalRevenue', live: 'totalRevenue', label: 'Total revenue' },
  { seal: 'totalNetProfit', live: 'totalNetProfit', label: 'Total profit' },
  { seal: 'totalCash', live: 'totalCash', label: 'Cash in drawer' },
  { seal: 'totalCard', live: 'totalCard', label: 'Card total' },
  { seal: 'totalMobile', live: 'totalMobile', label: 'Mobile total' },
];

export interface EodDrift {
  field: string;
  label: string;
  sealed: number;
  live: number;
  /** Positive means the day's records now show more than the seal did. */
  delta: number;
}

export interface EodReconciliation {
  date: string;
  sealedAt?: string;
  /** The seal was made while the till was offline and never reached the server. */
  isLocalOnly: boolean;
  /** Seals written before seal metadata exists carry fewer fields, so fewer were comparable. */
  isLegacySeal: boolean;
  drifts: EodDrift[];
  hasDrift: boolean;
  revenueDelta: number;
  cashDelta: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function reconcileEodDay(sealed: EndOfDayRecord, live: DayFigures): EodReconciliation {
  const drifts: EodDrift[] = [];

  for (const field of COMPARED_FIELDS) {
    const sealedValue = sealed[field.seal];
    if (typeof sealedValue !== 'number') continue;
    const liveValue = live[field.live];
    if (Math.abs(liveValue - sealedValue) < CENT) continue;
    drifts.push({
      field: String(field.seal),
      label: field.label,
      sealed: sealedValue,
      live: liveValue,
      delta: round2(liveValue - sealedValue),
    });
  }

  const findDelta = (sealField: string): number =>
    drifts.find(d => d.field === sealField)?.delta ?? 0;

  return {
    date: sealed.date,
    sealedAt: sealed.closedAt,
    isLocalOnly: sealed.id.startsWith('offline_'),
    isLegacySeal: !sealed.sealVersion,
    drifts,
    hasDrift: drifts.length > 0,
    revenueDelta: findDelta('totalRevenue'),
    cashDelta: findDelta('totalCash'),
  };
}
