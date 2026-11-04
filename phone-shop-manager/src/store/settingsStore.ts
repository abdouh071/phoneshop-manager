import { create } from 'zustand';
import { settingsService } from '../services/settingsService';
import type { StoreSettings, ColorThemeKey } from '../services/settingsService';
import { errorMessage } from '../utils/errorUtils';

/** The fallback a technician earns when no rate is configured anywhere. */
const DEFAULT_TECHNICIAN_PERCENT = 50;

interface SettingsState extends StoreSettings {
  colorTheme: ColorThemeKey;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  technicianRates: Record<string, number>;
  getTechnicianRate: (techName?: string) => number;
  setTechnicianRate: (techName: string, rate: number) => Promise<void>;
  fetchSettings: () => Promise<() => void>;
  updateSetting: <K extends keyof StoreSettings>(key: K, value: StoreSettings[K]) => Promise<void>;
  updateSettingsBulk: (settings: Partial<StoreSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: 'light',
  colorTheme: 'default',
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
  technicianProfitPercentage: DEFAULT_TECHNICIAN_PERCENT, // default fallback
  technicianRates: {},
  weekStartDay: 0, // 0 = Sunday
  receiptPaperWidth: '80mm',
  autoCutReceipt: true,
  isLoading: false,
  isInitialized: false,
  error: null,

  getTechnicianRate: (techName?: string) => {
    if (techName) {
      const custom = get().technicianRates?.[techName];
      if (custom !== undefined && custom !== null && !isNaN(custom)) {
        return custom;
      }
    }
    const def = get().technicianProfitPercentage;
    return (def !== undefined && def !== null && !isNaN(def)) ? def : DEFAULT_TECHNICIAN_PERCENT;
  },

  setTechnicianRate: async (techName: string, rate: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(rate)));
    const updated = { ...(get().technicianRates || {}), [techName]: clamped };
    set({ technicianRates: updated });
    try {
      await settingsService.updateSettings({ technicianRates: updated });
    } catch (err: unknown) {
      set({ error: errorMessage(err) || 'Failed to sync technician rate' });
    }
  },

  fetchSettings: async () => {
    set({ isLoading: true, error: null });
    
    // Subscribe to real-time Firestore updates
    const unsubscribe = settingsService.subscribeSettings((remoteSettings) => {
      set({ 
        ...remoteSettings, 
        colorTheme: remoteSettings.colorTheme || 'default',
        technicianRates: remoteSettings.technicianRates || {},
        technicianProfitPercentage: remoteSettings.technicianProfitPercentage ?? DEFAULT_TECHNICIAN_PERCENT,
        isLoading: false, 
        isInitialized: true 
      });
      if (remoteSettings.storeName) {
        document.title = `${remoteSettings.storeName} - Phone Shop Manager`;
      }
    });

    // Also do an initial fetch to handle case when doc doesn't exist yet
    const remoteSettings = await settingsService.getSettings();
    if (remoteSettings) {
      set({ 
        ...remoteSettings, 
        colorTheme: remoteSettings.colorTheme || 'default',
        technicianRates: remoteSettings.technicianRates || {},
        technicianProfitPercentage: remoteSettings.technicianProfitPercentage ?? DEFAULT_TECHNICIAN_PERCENT,
        isLoading: false, 
        isInitialized: true 
      });
      if (remoteSettings.storeName) {
        document.title = `${remoteSettings.storeName} - Phone Shop Manager`;
      }
    } else {
      // If it doesn't exist, we write the defaults to Firestore
      const defaults: StoreSettings = {
        theme: get().theme,
        colorTheme: get().colorTheme || 'default',
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
        technicianProfitPercentage: get().technicianProfitPercentage ?? 50,
        technicianRates: get().technicianRates || {},
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
    set({ [key]: value } as Partial<SettingsState>);
    if (key === 'storeName' && typeof value === 'string') {
      document.title = `${value} - Phone Shop Manager`;
    }
    try {
      await settingsService.updateSettings({ [key]: value });
    } catch (err: unknown) {
      set({ error: errorMessage(err) || 'Failed to sync settings with Firestore' });
    }
  },

  updateSettingsBulk: async (newSettings) => {
    set(newSettings);
    if (newSettings.storeName) {
      document.title = `${newSettings.storeName} - Phone Shop Manager`;
    }
    try {
      await settingsService.updateSettings(newSettings);
    } catch (err: unknown) {
      set({ error: errorMessage(err) || 'Failed to sync settings with Firestore' });
    }
  }
}));
