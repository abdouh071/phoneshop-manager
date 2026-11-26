import { create } from 'zustand';
import { reportsService } from '../services/reportsService';
import { useSettingsStore } from './settingsStore';
import type { ReportData, ReportFetchOptions, ReportFilterOptions } from '../services/reportsService';
import { errorMessage } from '../utils/errorUtils';

/** Only the newest requested report may finish the load — see fetchData. */
let fetchSequence = 0;

interface ReportState {
  data: ReportData | null;
  isLoading: boolean;
  error: string | null;
  activeOptions: ReportFilterOptions;
  fetchData: (options?: ReportFilterOptions | string, fetchOptions?: ReportFetchOptions) => Promise<void>;
  setFilterOptions: (options: Partial<ReportFilterOptions>) => void;
}

export const useReportStore = create<ReportState>((set, get) => ({
  data: null,
  isLoading: false,
  error: null,
  activeOptions: {
    dateRange: 'last_7_days'
  },

  fetchData: async (options?: ReportFilterOptions | string, fetchOptions?: ReportFetchOptions) => {
    const rawActive = options
      ? (typeof options === 'string' ? { dateRange: options } : options)
      : get().activeOptions;

    const currentWeekStart = useSettingsStore.getState().weekStartDay ?? 0;
    const active: ReportFilterOptions = {
      weekStartDay: currentWeekStart,
      ...rawActive,
    };

    // A slow fetch for an abandoned filter must not stamp its numbers over the
    // ones the till just asked for: only the latest request may finish the load.
    const sequence = ++fetchSequence;
    set({ isLoading: true, error: null, activeOptions: active });
    try {
      const data = fetchOptions
        ? await reportsService.getDashboardData(active, fetchOptions)
        : await reportsService.getDashboardData(active);
      if (sequence !== fetchSequence) return;
      set({ data, isLoading: false });
    } catch (err: unknown) {
      if (sequence !== fetchSequence) return;
      console.error(err);
      set({ error: errorMessage(err) || 'Failed to load business reports', isLoading: false });
    }
  },

  setFilterOptions: (newOpts: Partial<ReportFilterOptions>) => {
    const updated = { ...get().activeOptions, ...newOpts };
    get().fetchData(updated);
  }
}));
