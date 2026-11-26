// @vitest-environment jsdom
/**
 * Phase 6 TDD Tests — App Authenticated Sync Lifecycle
 * Sync must start ONLY when authenticated & initialized, stop on logout,
 * and NEVER delete queued offline work on logout.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, act } from '@testing-library/react';
import React from 'react';

const hooks = vi.hoisted(() => ({
  custInit: vi.fn(),
  custCleanup: vi.fn(),
  queueInit: vi.fn(),
  queueCleanup: vi.fn(),
  unifiedInit: vi.fn(),
  unifiedCleanup: vi.fn(),
  restoreAll: vi.fn(),
  authState: { isAuthenticated: false, isInitializing: true },
}));

hooks.custInit.mockImplementation(() => hooks.custCleanup);
hooks.queueInit.mockImplementation(() => hooks.queueCleanup);
hooks.unifiedInit.mockImplementation(() => hooks.unifiedCleanup);
hooks.restoreAll.mockResolvedValue({ adopted: [] });

vi.mock('./store/authStore', () => ({
  useAuthStore: () => hooks.authState,
}));

vi.mock('./services/offlineCustomerSyncService', () => ({
  offlineCustomerSyncService: { init: hooks.custInit },
}));

vi.mock('./services/offlineQueue', () => ({
  offlineQueue: { init: hooks.queueInit },
}));

vi.mock('./services/unifiedOfflineSyncService', () => ({
  unifiedOfflineSyncService: { init: hooks.unifiedInit },
}));

vi.mock('./services/offlineQueueMirror', () => ({
  offlineQueueMirror: { restoreAll: hooks.restoreAll },
}));

vi.mock('./services/offlineHandlers', () => ({
  registerOfflineHandlers: vi.fn(),
}));

vi.mock('./components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./components/layout/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./components/layout/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./components/ui/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import App from './App';

const mockStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, value: string) => mockStorage.set(key, String(value)),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.clear();
  vi.stubGlobal('localStorage', localStorageMock);
  hooks.custInit.mockImplementation(() => hooks.custCleanup);
  hooks.queueInit.mockImplementation(() => hooks.queueCleanup);
  hooks.unifiedInit.mockImplementation(() => hooks.unifiedCleanup);
  hooks.restoreAll.mockResolvedValue({ adopted: [] });
  localStorage.setItem('offline_action_queue', JSON.stringify([{ id: 'queued_op_1', type: 'UPDATE_CUSTOMER' }]));
});

afterEach(cleanup);

describe('Phase 6 — Authenticated Sync Lifecycle in App', () => {
  it('does not start background sync while unauthenticated or initializing, starts on login, and stops cleanly on logout preserving queued work', async () => {
    hooks.authState = { isAuthenticated: false, isInitializing: true };
    const { rerender } = render(<App />);
    await act(async () => { await Promise.resolve(); });

    expect(hooks.custInit).not.toHaveBeenCalled();
    expect(hooks.queueInit).not.toHaveBeenCalled();
    expect(hooks.unifiedInit).not.toHaveBeenCalled();

    // Even after initialization finishes on /login (unauthenticated)
    hooks.authState = { isAuthenticated: false, isInitializing: false };
    rerender(<App />);
    await act(async () => { await Promise.resolve(); });

    expect(hooks.custInit).not.toHaveBeenCalled();
    expect(hooks.queueInit).not.toHaveBeenCalled();
    expect(hooks.unifiedInit).not.toHaveBeenCalled();

    // User signs in
    hooks.authState = { isAuthenticated: true, isInitializing: false };
    rerender(<App />);
    await act(async () => { await Promise.resolve(); });

    expect(hooks.custInit).toHaveBeenCalledTimes(1);
    expect(hooks.queueInit).toHaveBeenCalledTimes(1);
    expect(hooks.unifiedInit).toHaveBeenCalledTimes(1);

    // User logs out: listeners must be cleaned up, queued offline work must remain intact
    hooks.authState = { isAuthenticated: false, isInitializing: false };
    rerender(<App />);
    await act(async () => { await Promise.resolve(); });

    expect(hooks.custCleanup).toHaveBeenCalledTimes(1);
    expect(hooks.queueCleanup).toHaveBeenCalledTimes(1);
    expect(hooks.unifiedCleanup).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('offline_action_queue') || '[]')).toHaveLength(1);
  });
});
