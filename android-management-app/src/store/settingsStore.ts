/**
 * App settings.
 * =============
 * The profit percentage used to be editable from this phone and stored on the
 * technician's own profile — a number the counter's payout tab never read, so a
 * technician could believe they were on 60% while the owner's tab paid the
 * admin number. There is one truth now: the rate the shop pays, as set by the
 * administrator (a per-technician rate by name, or the shop default). This
 * store only displays it; it never writes it.
 */
import { create } from 'zustand';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuthStore } from './authStore';

const FALLBACK_PERCENTAGE = '50';

const toPercentageString = (value: unknown): string | null => {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? String(n) : null;
};

interface SettingsState {
  /** The rate that actually applies to this technician (admin rate or shop default). */
  profitPercentage: string;
  /** The shop-wide number streamed from settings/general. */
  shopPercentage: string | null;
  weekStartDay: number;
  technicianRates: Record<string, number>;
  getTechnicianRate: (technicianName?: string) => number;
  subscribeToSettings: () => () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  profitPercentage: FALLBACK_PERCENTAGE,
  shopPercentage: null,
  weekStartDay: 0,
  technicianRates: {},

  /** The admin rate for this person, else the shop default — the payout tab's rule. */
  getTechnicianRate: (technicianName?: string) => {
    if (technicianName) {
      const rate = get().technicianRates?.[technicianName];
      if (typeof rate === 'number' && Number.isFinite(rate)) return rate;
    }
    const shop = parseFloat(get().shopPercentage ?? FALLBACK_PERCENTAGE);
    return Number.isFinite(shop) ? shop : parseFloat(FALLBACK_PERCENTAGE);
  },

  subscribeToSettings: () => {
    const docRef = doc(db, 'settings', 'general');
    return onSnapshot(docRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const patch: Partial<SettingsState> = {};
      if (data.weekStartDay !== undefined) patch.weekStartDay = data.weekStartDay;
      if (data.technicianRates !== undefined) patch.technicianRates = data.technicianRates || {};
      if (data.technicianProfitPercentage !== undefined) {
        const shop = toPercentageString(data.technicianProfitPercentage);
        if (shop !== null) patch.shopPercentage = shop;
      }
      if (Object.keys(patch).length) set(patch as SettingsState);
      // The displayed number always mirrors what the counter will pay this
      // technician — recomputed whenever the admin touches the rates.
      const userName = useAuthStore.getState().user?.name;
      set({ profitPercentage: String(get().getTechnicianRate(userName)) });
    });
  },
}));
