// @vitest-environment jsdom
/**
 * Phase 6 TDD Tests — Settings subscription single-owner cleanup + re-login,
 * setTechnicianRate boolean return, AppShell currency/storeName remount survival.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, act, fireEvent } from '@testing-library/react';
import React from 'react';

const svc = vi.hoisted(() => ({
  subscribeCalls: 0,
  unsubCalls: 0,
  failWrite: false,
  callback: null as ((s: Record<string, unknown>) => void) | null,
}));

vi.mock('../services/settingsService', () => ({
  settingsService: {
    getSettings: vi.fn(async () => ({
      theme: 'light',
      colorTheme: 'default',
      currency: 'DZD',
      enableNotifications: true,
      storeName: 'PhoneShop Pro',
      allowedIp: '',
      receiptPaperWidth: '80mm',
      autoCutReceipt: true,
      labelFont: '2',
      technicianProfitPercentage: 50,
      technicianRates: {},
    })),
    subscribeSettings: vi.fn((cb: (s: Record<string, unknown>) => void) => {
      svc.subscribeCalls++;
      svc.callback = cb;
      return () => {
        svc.unsubCalls++;
      };
    }),
    updateSettings: vi.fn(async () => {
      if (svc.failWrite) throw new Error('Firestore permission-denied');
    }),
  },
}));

vi.mock('./repairStore', () => ({
  useRepairStore: (sel: (s: { subscribeLiveRepairs: () => () => void }) => unknown) =>
    sel({ subscribeLiveRepairs: () => () => undefined }),
}));

vi.mock('./authStore', () => ({
  useAuthStore: Object.assign(
    () => ({ user: { id: 'admin', name: 'Admin', role: 'admin' }, isHistoryUnlocked: true, lockHistory: vi.fn() }),
    { getState: () => ({ user: { id: 'admin', name: 'Admin', role: 'admin' } }) }
  ),
}));

vi.mock('./privacyStore', () => ({
  usePrivacyStore: (sel: (s: { isPrivacyActive: boolean }) => unknown) => sel({ isPrivacyActive: false }),
}));

vi.mock('../components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('../components/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../components/layout/MobileBottomNav', () => ({ MobileBottomNav: () => null }));
vi.mock('../components/layout/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('../components/layout/DroppedWritesBanner', () => ({ DroppedWritesBanner: () => null }));
vi.mock('../components/layout/PrinterStatusPill', () => ({ PrinterStatusPill: () => null }));
vi.mock('../components/layout/PrivacyCurtainButton', () => ({ PrivacyCurtainButton: () => null }));
vi.mock('../features/approvals/ApprovalsNotificationButton', () => ({ ApprovalsNotificationButton: () => null }));
vi.mock('../components/layout/UserLogoutButton', () => ({ UserLogoutButton: () => null }));
vi.mock('../hooks/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: () => undefined }));
vi.mock('../hooks/useGlobalBarcodeScanner', () => ({ useGlobalBarcodeScanner: () => undefined }));
vi.mock('../hooks/useMidnightAutoClose', () => ({ useMidnightAutoClose: () => undefined }));
vi.mock('../hooks/usePrintQueue', () => ({ usePrintQueue: () => undefined }));

import { useSettingsStore } from './settingsStore';
import { AppShell } from '../components/layout/AppShell';

beforeEach(() => {
  svc.subscribeCalls = 0;
  svc.unsubCalls = 0;
  svc.failWrite = false;
  svc.callback = null;
  vi.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }),
  });
});

afterEach(cleanup);

describe('Phase 6 — settingsStore subscription ownership & AppShell stability', () => {
  it('cleans up single subscription on final owner unmount so subsequent re-login re-subscribes reliably', async () => {
    const unsub1 = await useSettingsStore.getState().fetchSettings();
    const unsub2 = await useSettingsStore.getState().fetchSettings();
    expect(svc.subscribeCalls).toBe(1);

    unsub2();
    expect(svc.unsubCalls).toBe(0);

    unsub1();
    expect(svc.unsubCalls).toBe(1);

    const unsub3 = await useSettingsStore.getState().fetchSettings();
    expect(svc.subscribeCalls).toBe(2);
    unsub3();
    expect(svc.unsubCalls).toBe(2);
  });

  it('returns false from setTechnicianRate when Firestore write fails', async () => {
    svc.failWrite = true;
    const saved = await useSettingsStore.getState().setTechnicianRate('Ali', 65);
    expect(saved).toBe(false);
    expect(useSettingsStore.getState().error).toBeTruthy();
  });

  it('does not remount child page components or wipe input drafts when currency or storeName changes', async () => {
    const DraftForm = () => {
      const [draft, setDraft] = React.useState('');
      const mountId = React.useRef(Math.random().toString(36).slice(2));
      return (
        <div>
          <span data-testid="mount-id">{mountId.current}</span>
          <input aria-label="unsaved-draft" value={draft} onChange={e => setDraft(e.target.value)} />
        </div>
      );
    };

    render(
      <AppShell>
        <DraftForm />
      </AppShell>
    );
    await act(async () => { await Promise.resolve(); });

    const initialMountId = screen.getByTestId('mount-id').textContent;
    const input = screen.getByLabelText('unsaved-draft') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Customer IMEI 998877' } });
    expect(input.value).toBe('Customer IMEI 998877');

    act(() => {
      useSettingsStore.setState({ storeName: 'Updated Store Name', currency: 'EUR', isInitialized: true });
    });

    expect(screen.getByTestId('mount-id').textContent).toBe(initialMountId);
    expect((screen.getByLabelText('unsaved-draft') as HTMLInputElement).value).toBe('Customer IMEI 998877');
  });
});
