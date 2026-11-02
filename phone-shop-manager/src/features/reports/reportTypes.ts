import type { ReportFilterOptions } from '../../services/reportsService';

export type MainTab = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

export type DailyCategoryFilter = 'all' | 'pos' | 'repairs' | 'parts';

export type LedgerTab = 'sales' | 'repairs';

export type SubFilterClickHandler = (
  filterKey: string,
  extraOpts?: Partial<Omit<ReportFilterOptions, 'dateRange' | 'weekStartDay'>>
) => void;
