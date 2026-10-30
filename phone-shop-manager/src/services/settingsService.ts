import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';

export type ColorThemeKey = 'default' | 'cyan' | 'emerald' | 'purple' | 'amber';

export interface StoreSettings {
  theme: 'light' | 'dark' | 'system';
  colorTheme?: ColorThemeKey;
  currency: string;
  enableNotifications: boolean;
  storeName: string;
  allowedIp: string;
  receiptHeader?: string;
  receiptFooter?: string;
  logoUrl?: string;
  // Customer Tracking Portal settings
  trackingBaseUrl?: string;
  storePhone?: string;
  storeAddress?: string;
  // Technician profit percentage
  technicianProfitPercentage?: number;
  // Per-technician customized commission percentages: { [technicianName]: percentage }
  technicianRates?: Record<string, number>;
  // What day does the week start? (0 = Sunday, 1 = Monday, ... 5 = Friday, 6 = Saturday)
  weekStartDay?: number;
  // Hardware printer configuration
  receiptPaperWidth?: '80mm' | '58mm';
  autoCutReceipt?: boolean;
}

const COLLECTION = 'settings';
const DOCUMENT_ID = 'general';

const LOCAL_STORAGE_KEY = 'offline_store_settings';

const getLocalSettings = (): StoreSettings | null => {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const saveLocalSettings = (settings: StoreSettings): void => {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error('Failed to save settings to localStorage', err);
  }
};

export const settingsService = {
  getSettings: async (): Promise<StoreSettings | null> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return getLocalSettings();
    }

    try {
      const docRef = doc(db, COLLECTION, DOCUMENT_ID);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const settings = snap.data() as StoreSettings;
        saveLocalSettings(settings);
        return settings;
      }
      return getLocalSettings();
    } catch (err) {
      console.warn('Failed to fetch settings from Firestore, using local cache:', err);
      return getLocalSettings();
    }
  },

  subscribeSettings: (callback: (settings: StoreSettings) => void) => {
    try {
      const docRef = doc(db, COLLECTION, DOCUMENT_ID);
      return onSnapshot(
        docRef,
        (snap) => {
          if (snap.exists()) {
            callback(snap.data() as StoreSettings);
          }
        },
        (err) => {
          console.error('Settings real-time listener error:', err);
        }
      );
    } catch (err) {
      console.error('Failed to subscribe to settings:', err);
      return () => {};
    }
  },

  updateSettings: async (settings: Partial<StoreSettings>): Promise<void> => {
    try {
      const docRef = doc(db, COLLECTION, DOCUMENT_ID);
      await setDoc(docRef, settings, { merge: true });
    } catch (err) {
      console.error('Failed to update settings in Firestore:', err);
      throw err;
    }
  }
};
