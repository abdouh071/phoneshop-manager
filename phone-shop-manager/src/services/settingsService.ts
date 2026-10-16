import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';

export interface StoreSettings {
  theme: 'light' | 'dark' | 'system';
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
  // What day does the week start? (0 = Sunday, 1 = Monday, ... 5 = Friday, 6 = Saturday)
  weekStartDay?: number;
  // Hardware printer configuration
  receiptPaperWidth?: '80mm' | '58mm';
  autoCutReceipt?: boolean;
}

const COLLECTION = 'settings';
const DOCUMENT_ID = 'general';

export const settingsService = {
  getSettings: async (): Promise<StoreSettings | null> => {
    try {
      const docRef = doc(db, COLLECTION, DOCUMENT_ID);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return snap.data() as StoreSettings;
      }
      return null;
    } catch (err) {
      console.error('Failed to fetch settings from Firestore:', err);
      return null;
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
