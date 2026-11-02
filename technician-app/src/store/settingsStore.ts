/**
 * App settings.
 * =============
 * The profit percentage used to be saved only in AsyncStorage while the
 * `settings/general` listener kept overwriting it with the shop-wide number, so a
 * technician's own setting visibly "worked" for a minute and then reverted.
 *
 * `settings/general` is admin-write-only in the security rules, so the personal
 * value cannot live there. It goes on `users/{uid}` — the rules let a worker edit
 * their own profile for anything except role, permissions, isSuperAdmin and
 * approvalPin — which means the number follows the technician to any device and
 * never fights the shop default again.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteField, doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuthStore } from './authStore';

/** Field on users/{uid}. `isSuperAdmin`/`role`/`permissions`/`approvalPin` are untouched. */
const PROFILE_FIELD = 'mobileProfitPercentage';
const FALLBACK_PERCENTAGE = '50';

const toPercentageString = (value: unknown): string | null => {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? String(n) : null;
};

interface SettingsState {
  profitPercentage: string;
  /** This technician's own number; null means "follow the shop". */
  personalPercentage: string | null;
  /** The shop-wide number streamed from settings/general. */
  shopPercentage: string | null;
  weekStartDay: number;
  technicianRates: Record<string, number>;
  getTechnicianRate: (technicianName?: string) => number;
  saveProfitPercentage: (percentage: string) => Promise<boolean>;
  followShopDefault: () => Promise<boolean>;
  subscribeToSettings: () => () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      profitPercentage: FALLBACK_PERCENTAGE,
      personalPercentage: null,
      shopPercentage: null,
      weekStartDay: 0,
      technicianRates: {},

      /** Admin rate for this person → their own setting → the shop default. */
      getTechnicianRate: (technicianName?: string) => {
        if (technicianName) {
          const rates = get().technicianRates || {};
          const rate = rates[technicianName];
          if (rate !== undefined && rate !== null) return rate;
        }
        const parsed = parseFloat(get().profitPercentage);
        return !isNaN(parsed) ? parsed : parseFloat(FALLBACK_PERCENTAGE);
      },

      saveProfitPercentage: async (percentage: string) => {
        const normalized = toPercentageString(percentage);
        if (normalized === null) return false;

        // Optimistic: the report screens should reflect the new margin immediately
        // even if the profile write is still in flight.
        set({ personalPercentage: normalized, profitPercentage: normalized });

        const uid = useAuthStore.getState().user?.id;
        if (!uid) return false;
        try {
          await updateDoc(doc(db, 'users', uid), { [PROFILE_FIELD]: parseFloat(normalized) });
          return true;
        } catch (err) {
          console.warn('[SettingsStore] Could not save the personal profit % to the profile:', err);
          return false;
        }
      },

      followShopDefault: async () => {
        const shop = get().shopPercentage;
        set({
          personalPercentage: null,
          profitPercentage: shop ?? FALLBACK_PERCENTAGE,
        });
        const uid = useAuthStore.getState().user?.id;
        if (!uid) return true;
        try {
          await updateDoc(doc(db, 'users', uid), { [PROFILE_FIELD]: deleteField() });
          return true;
        } catch (err) {
          console.warn('[SettingsStore] Could not clear the personal profit %:', err);
          return false;
        }
      },

      subscribeToSettings: () => {
        const uid = useAuthStore.getState().user?.id;
        if (uid) {
          // Read the technician's own number once per session, then keep it in sync.
          void getDoc(doc(db, 'users', uid))
            .then((snap) => {
              const personal = toPercentageString(snap.data()?.[PROFILE_FIELD]);
              set((state) => ({
                personalPercentage: personal,
                profitPercentage: personal ?? state.shopPercentage ?? FALLBACK_PERCENTAGE,
              }));
            })
            .catch((err) => console.warn('[SettingsStore] Could not read the profile profit %:', err));
        }

        const docRef = doc(db, 'settings', 'general');
        return onSnapshot(docRef, (snap) => {
          if (!snap.exists()) return;
          const data = snap.data();
          const patch: Partial<SettingsState> = {};
          if (data.weekStartDay !== undefined) patch.weekStartDay = data.weekStartDay;
          if (data.technicianRates !== undefined) patch.technicianRates = data.technicianRates || {};
          if (data.technicianProfitPercentage !== undefined) {
            const shop = toPercentageString(data.technicianProfitPercentage);
            if (shop !== null) {
              patch.shopPercentage = shop;
              // A technician's own setting wins; the shop number only fills the gap.
              if (!get().personalPercentage) patch.profitPercentage = shop;
            }
          }
          if (Object.keys(patch).length) set(patch as SettingsState);
        });
      }
    }),
    {
      name: 'technician-settings',
      storage: createJSONStorage(() => AsyncStorage),
      // Only the personal choice is worth keeping across restarts; the shop number
      // and the rates stream from Firestore.
      partialize: (state) => ({
        profitPercentage: state.profitPercentage,
        personalPercentage: state.personalPercentage,
      }),
    }
  )
);
