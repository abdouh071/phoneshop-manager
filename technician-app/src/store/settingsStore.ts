import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface SettingsState {
  profitPercentage: string;
  weekStartDay: number;
  setProfitPercentage: (percentage: string) => void;
  subscribeToSettings: () => () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      profitPercentage: '50', // default to 50%
      weekStartDay: 0, // default Sunday
      setProfitPercentage: (percentage) => set({ profitPercentage: percentage }),
      subscribeToSettings: () => {
        const docRef = doc(db, 'settings', 'general');
        return onSnapshot(docRef, (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            if (data.weekStartDay !== undefined) {
              set({ weekStartDay: data.weekStartDay });
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
