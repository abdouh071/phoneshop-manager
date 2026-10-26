import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PrivacyState {
  isPrivacyActive: boolean;
  togglePrivacy: () => void;
  setPrivacy: (active: boolean) => void;
}

export const usePrivacyStore = create<PrivacyState>()(
  persist(
    (set, get) => ({
      isPrivacyActive: false,
      togglePrivacy: () => {
        const next = !get().isPrivacyActive;
        set({ isPrivacyActive: next });
        if (typeof document !== 'undefined') {
          const val = next ? 'active' : 'inactive';
          document.documentElement.setAttribute('data-privacy', val);
          document.body?.setAttribute('data-privacy', val);
          window.dispatchEvent(new CustomEvent('privacy-mode-change', { detail: { isPrivacyActive: next } }));
        }
      },
      setPrivacy: (active: boolean) => {
        set({ isPrivacyActive: active });
        if (typeof document !== 'undefined') {
          const val = active ? 'active' : 'inactive';
          document.documentElement.setAttribute('data-privacy', val);
          document.body?.setAttribute('data-privacy', val);
          window.dispatchEvent(new CustomEvent('privacy-mode-change', { detail: { isPrivacyActive: active } }));
        }
      },
    }),
    {
      name: 'phoneshop_privacy_mode',
      onRehydrateStorage: () => (state) => {
        if (typeof document !== 'undefined') {
          const val = state?.isPrivacyActive ? 'active' : 'inactive';
          document.documentElement.setAttribute('data-privacy', val);
          document.body?.setAttribute('data-privacy', val);
        }
      },
    }
  )
);

// Eagerly apply stored privacy state immediately before React mounts
if (typeof window !== 'undefined') {
  try {
    const raw = localStorage.getItem('phoneshop_privacy_mode');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.state?.isPrivacyActive) {
        document.documentElement.setAttribute('data-privacy', 'active');
        document.body?.setAttribute('data-privacy', 'active');
      }
    }
  } catch (_) {}
}
