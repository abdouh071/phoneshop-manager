import { create } from 'zustand';
import { settingsService } from '../services/settingsService';
import type { StoreSettings } from '../services/settingsService';

interface SettingsState extends StoreSettings {
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  fetchSettings: () => Promise<() => void>;
  updateSetting: <K extends keyof StoreSettings>(key: K, value: StoreSettings[K]) => Promise<void>;
  updateSettingsBulk: (settings: Partial<StoreSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: 'light',
  currency: 'USD',
  enableNotifications: true,
  storeName: 'PhoneShop Pro',
  allowedIp: '',
  receiptHeader: 'Thank you for shopping with us!',
  receiptFooter: 'Returns accepted within 14 days with original receipt.',
  logoUrl: '',
  trackingBaseUrl: '',
  storePhone: '',
  storeAddress: '',
  technicianProfitPercentage: 0,
  weekStartDay: 0, // 0 = Sunday
  receiptPaperWidth: '80mm',
  autoCutReceipt: true,
  isLoading: false,
  isInitialized: false,
  error: null,

  fetchSettings: async () => {
    set({ isLoading: true, error: null });
    
    // Subscribe to real-time Firestore updates
    const unsubscribe = settingsService.subscribeSettings((remoteSettings) => {
      set({ ...remoteSettings, isLoading: false, isInitialized: true });
      if (remoteSettings.storeName) {
        document.title = `${remoteSettings.storeName} - Phone Shop Manager`;
      }
    });

    // Also do an initial fetch to handle case when doc doesn't exist yet
    const remoteSettings = await settingsService.getSettings();
    if (remoteSettings) {
      set({ ...remoteSettings, isLoading: false, isInitialized: true });
      if (remoteSettings.storeName) {
        document.title = `${remoteSettings.storeName} - Phone Shop Manager`;
      }
    } else {
      // If it doesn't exist, we write the defaults to Firestore
      const defaults: StoreSettings = {
        theme: get().theme,
        currency: get().currency,
        enableNotifications: get().enableNotifications,
        storeName: get().storeName,
        allowedIp: get().allowedIp,
        receiptHeader: get().receiptHeader,
        receiptFooter: get().receiptFooter,
        logoUrl: get().logoUrl || '',
        trackingBaseUrl: get().trackingBaseUrl || '',
        storePhone: get().storePhone || '',
        storeAddress: get().storeAddress || '',
        technicianProfitPercentage: get().technicianProfitPercentage ?? 0,
        weekStartDay: get().weekStartDay ?? 0,
        receiptPaperWidth: get().receiptPaperWidth || '80mm',
        autoCutReceipt: get().autoCutReceipt ?? true,
      };
      await settingsService.updateSettings(defaults).catch(console.error);
      set({ isLoading: false, isInitialized: true });
    }

    return unsubscribe;
  },

  updateSetting: async (key, value) => {
    // Optimistic UI update
    set({ [key]: value } as any);
    if (key === 'storeName' && typeof value === 'string') {
      document.title = `${value} - Phone Shop Manager`;
    }
    try {
      await settingsService.updateSettings({ [key]: value });
    } catch (err: any) {
      set({ error: err.message || 'Failed to sync settings with Firestore' });
    }
  },

  updateSettingsBulk: async (newSettings) => {
    set(newSettings as any);
    if (newSettings.storeName) {
      document.title = `${newSettings.storeName} - Phone Shop Manager`;
    }
    try {
      await settingsService.updateSettings(newSettings);
    } catch (err: any) {
      set({ error: err.message || 'Failed to sync settings with Firestore' });
    }
  }
}));
