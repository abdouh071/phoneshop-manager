import { create } from 'zustand';
import { reportsService } from '../services/reportsService';
import { useSettingsStore } from './settingsStore';
import type { ReportData, ReportFilterOptions } from '../services/reportsService';

interface ReportState {
  data: ReportData | null;
  isLoading: boolean;
  error: string | null;
  activeOptions: ReportFilterOptions;
  fetchData: (options?: ReportFilterOptions | string) => Promise<void>;
  setFilterOptions: (options: Partial<ReportFilterOptions>) => void;
}

export const useReportStore = create<ReportState>((set, get) => ({
  data: null,
  isLoading: false,
  error: null,
  activeOptions: {
    dateRange: 'last_7_days'
  },

  fetchData: async (options?: ReportFilterOptions | string) => {
    const rawActive = options
      ? (typeof options === 'string' ? { dateRange: options } : options)
      : get().activeOptions;

    const currentWeekStart = useSettingsStore.getState().weekStartDay ?? 0;
    const active: ReportFilterOptions = {
      weekStartDay: currentWeekStart,
      ...rawActive,
    };

    set({ isLoading: true, error: null, activeOptions: active });
    try {
      const data = await reportsService.getDashboardData(active);
      set({ data, isLoading: false });
    } catch (err: any) {
      console.error(err);
      set({ error: err.message || 'Failed to load business reports', isLoading: false });
    }
  },

  setFilterOptions: (newOpts: Partial<ReportFilterOptions>) => {
    const updated = { ...get().activeOptions, ...newOpts };
    get().fetchData(updated);
  }
}));
