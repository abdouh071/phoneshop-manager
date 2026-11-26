// @vitest-environment jsdom
/**
 * Phase 8 TDD Tests — Reports Explicit Refresh Button & 404 NotFound Routing.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  fetchData: vi.fn(async () => undefined),
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, defaultVal?: string) => defaultVal || _key,
      i18n: { language: 'en' },
    }),
  };
});

vi.mock('../../components/ui/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('../../store/authStore', () => ({
  useAuthStore: () => ({
    isAuthenticated: true,
    isInitializing: false,
    user: { id: 'admin-1', name: 'Admin', role: 'admin' },
    isHistoryUnlocked: true,
  }),
}));

vi.mock('../../store/settingsStore', () => {
  const state = {
    storeName: 'Test Shop',
    currency: 'DZD',
    weekStartDay: 1,
    fetchSettings: vi.fn(async () => () => undefined),
  };
  return {
    useSettingsStore: Object.assign(
      (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
      { getState: () => state }
    ),
  };
});

vi.mock('../../store/privacyStore', () => ({
  usePrivacyStore: (selector?: (s: { isPrivacyActive: boolean }) => unknown) =>
    selector ? selector({ isPrivacyActive: false }) : { isPrivacyActive: false },
}));

vi.mock('../../store/reportStore', () => ({
  useReportStore: () => ({
    data: null,
    isLoading: false,
    error: null,
    activeOptions: { dateRange: 'last_7_days', weekStartDay: 1 },
    fetchData: mocks.fetchData,
    setFilterOptions: vi.fn(),
  }),
}));

vi.mock('../../components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

vi.mock('../../components/layout/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../services/offlineCustomerSyncService', () => ({
  offlineCustomerSyncService: { init: vi.fn(() => () => undefined) },
}));

vi.mock('../../services/offlineQueue', () => ({
  offlineQueue: { init: vi.fn(() => () => undefined) },
}));

vi.mock('../../services/offlineQueueMirror', () => ({
  offlineQueueMirror: { restoreAll: vi.fn(async () => undefined) },
}));

vi.mock('../../services/offlineHandlers', () => ({
  registerOfflineHandlers: vi.fn(),
}));

vi.mock('../../services/unifiedOfflineSyncService', () => ({
  unifiedOfflineSyncService: { init: vi.fn(() => () => undefined) },
}));

vi.mock('../../features/dashboard/DashboardPage', () => ({
  DashboardPage: () => <div data-testid="dashboard-page">Mock Dashboard</div>,
}));

vi.mock('../../features/auth/LoginPage', () => ({
  LoginPage: () => <div data-testid="login-page">Mock Login</div>,
}));

vi.mock('../../features/tracking/CustomerTrackingPage', () => ({
  CustomerTrackingPage: () => <div data-testid="tracking-page">Mock Tracking</div>,
}));

vi.mock('../endofday/EndOfDayButton', () => ({
  EndOfDayButton: () => <button type="button">Close Day</button>,
}));

vi.mock('../endofday/EndOfDayModal', () => ({
  EndOfDayModal: () => null,
}));

vi.mock('./TimeframeFilterBar', () => ({
  TimeframeFilterBar: () => <div data-testid="timeframe-bar" />,
}));

import { ReportsPage } from './ReportsPage';
import App from '../../App';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('Phase 8 — Reports Refresh & 404 Routing', () => {
  it('fetches live on Reports mount and bypasses session cache when Refresh is clicked', () => {
    render(<ReportsPage />);

    expect(mocks.fetchData).toHaveBeenCalledWith(
      expect.objectContaining({ dateRange: 'last_7_days' }),
      { forceRefresh: true }
    );

    mocks.fetchData.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(mocks.fetchData).toHaveBeenCalledTimes(1);
    expect(mocks.fetchData).toHaveBeenCalledWith(undefined, { forceRefresh: true });
  });

  it('renders 404 NotFoundPage for unknown routes instead of silently displaying Dashboard', async () => {
    window.history.pushState({}, '', '/definitely-does-not-exist-404');
    render(<App />);

    expect(await screen.findByText('404')).toBeTruthy();
    expect(screen.getByText(/This page does not exist/i)).toBeTruthy();
    expect(screen.queryByTestId('dashboard-page')).toBeNull();
  });

  it('renders DashboardPage at the root route', async () => {
    window.history.pushState({}, '', '/');
    render(<App />);

    expect(await screen.findByTestId('dashboard-page')).toBeTruthy();
    expect(screen.queryByText('404')).toBeNull();
  });
});
