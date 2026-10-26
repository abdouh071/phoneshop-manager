import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface SettingsState {
  profitPercentage: string;
  weekStartDay: number;
  technicianRates: Record<string, number>;
  getTechnicianRate: (technicianName?: string) => number;
  setProfitPercentage: (percentage: string) => void;
  subscribeToSettings: () => () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      profitPercentage: '50', // default to 50%
      weekStartDay: 0, // default Sunday
      technicianRates: {},
      getTechnicianRate: (technicianName?: string) => {
        if (technicianName) {
          const rates = get().technicianRates || {};
          if (rates[technicianName] !== undefined && rates[technicianName] !== null) {
            return rates[technicianName];
          }
        }
        const parsed = parseFloat(get().profitPercentage);
        return !isNaN(parsed) ? parsed : 50;
      },
      setProfitPercentage: (percentage) => set({ profitPercentage: percentage }),
      subscribeToSettings: () => {
        const docRef = doc(db, 'settings', 'general');
        return onSnapshot(docRef, (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            if (data.weekStartDay !== undefined) {
              set({ weekStartDay: data.weekStartDay });
            }
            if (data.technicianRates !== undefined) {
              set({ technicianRates: data.technicianRates || {} });
            }
            if (data.technicianProfitPercentage !== undefined) {
              set({ profitPercentage: String(data.technicianProfitPercentage) });
            }
          }
        });
      }
    }),
    {
      name: 'technician-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ profitPercentage: state.profitPercentage }), // only persist local overrides if needed, though we sync now
    }
  )
);
