import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { ToastProvider } from './components/ui/Toast';
import { PageSkeleton } from './components/ui/PageSkeleton';
import { useAuthStore } from './store/authStore';
import { offlineCustomerSyncService } from './services/offlineCustomerSyncService';
import { offlineQueue } from './services/offlineQueue';
import { offlineQueueMirror } from './services/offlineQueueMirror';
import { registerOfflineHandlers } from './services/offlineHandlers';
import { unifiedOfflineSyncService } from './services/unifiedOfflineSyncService';
import { errorMessage } from './utils/errorUtils';

// Register all domain-specific offline sync handlers once at app startup
registerOfflineHandlers();

/**
 * Smart lazy loader with automatic deployment-recovery.
 * If a new version was deployed and an older chunk hash is requested
 * (causing MIME type error or failed fetch), it automatically reloads the
 * window once to seamlessly load the latest bundle without an error screen.
 */
function lazyWithRetry<T extends React.ComponentType<object>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (error: unknown) {
      console.warn('[LazyLoader] Dynamic chunk failed to load:', error);
      const msg = (errorMessage(error) || '').toLowerCase();
      const isChunkError =
        msg.includes('mime type') ||
        msg.includes('failed to fetch dynamically imported') ||
        msg.includes('importing a module script failed') ||
        msg.includes('error loading dynamically imported');

      const lastReload = Number(sessionStorage.getItem('last_chunk_reload_ts') || 0);
      const now = Date.now();

      if (isChunkError && now - lastReload > 8000) {
        sessionStorage.setItem('last_chunk_reload_ts', String(now));
        window.location.reload();
        return new Promise<{ default: T }>(() => {});
      }

      throw error;
    }
  });
}

// Lazy-loaded routes for instant initial application startup with stale-chunk resilience
const DashboardPage = lazyWithRetry(() => import('./features/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })));
const InventoryPage = lazyWithRetry(() => import('./features/inventory/InventoryPage').then(m => ({ default: m.InventoryPage })));
const PurchasingPage = lazyWithRetry(() => import('./features/purchasing/PurchasingPage').then(m => ({ default: m.PurchasingPage })));
const POSPage = lazyWithRetry(() => import('./features/pos/POSPage').then(m => ({ default: m.POSPage })));
const PartsPage = lazyWithRetry(() => import('./features/parts/PartsPage').then(m => ({ default: m.PartsPage })));
const RepairsPage = lazyWithRetry(() => import('./features/repairs/RepairsPage').then(m => ({ default: m.RepairsPage })));
const CustomersPage = lazyWithRetry(() => import('./features/customers/CustomersPage').then(m => ({ default: m.CustomersPage })));
const ReportsPage = lazyWithRetry(() => import('./features/reports/ReportsPage').then(m => ({ default: m.ReportsPage })));
const SettingsPage = lazyWithRetry(() => import('./features/settings/SettingsPage').then(m => ({ default: m.SettingsPage })));
const ActivityPage = lazyWithRetry(() => import('./features/activity/ActivityPage').then(m => ({ default: m.ActivityPage })));
const CustomTicketPage = lazyWithRetry(() => import('./features/customTicket/CustomTicketPage').then(m => ({ default: m.CustomTicketPage })));
const NotFoundPage = lazyWithRetry(() => import('./components/layout/NotFoundPage').then(m => ({ default: m.NotFoundPage })));
const LoginPage = lazyWithRetry(() => import('./features/auth/LoginPage').then(m => ({ default: m.LoginPage })));
const CustomerTrackingPage = lazyWithRetry(() => import('./features/tracking/CustomerTrackingPage').then(m => ({ default: m.CustomerTrackingPage })));

function App() {
  const { isAuthenticated, isInitializing } = useAuthStore();

  useEffect(() => {
    // Only start background authenticated synchronization when a session is ready.
    // On logout or while unauthenticated, listeners/timers stop without clearing queued work.
    if (isInitializing || !isAuthenticated) {
      return;
    }

    let abandoned = false;
    const cleanups: Array<() => void> = [];

    const startSync = () => {
      if (abandoned) return;
      cleanups.push(offlineCustomerSyncService.init());
      cleanups.push(offlineQueue.init());
      cleanups.push(unifiedOfflineSyncService.init());
    };

    // Sync starts only once the mirror restore has settled: an initial flush that runs
    // against the pre-restore queue replays the wrong contents, and the budget inside
    // restoreAll() guarantees it always settles.
    void offlineQueueMirror
      .restoreAll()
      .then(startSync)
      .catch(e => {
        console.error('[App] Offline mirror restore failed, starting sync on localStorage alone:', errorMessage(e));
        startSync();
      });

    return () => {
      abandoned = true;
      cleanups.forEach(cleanup => cleanup());
    };
  }, [isAuthenticated, isInitializing]);

  return (
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter>
          <Suspense fallback={<PageSkeleton />}>
            <Routes>
              {/* Public Routes — No authentication required */}
              <Route
                path="/login"
                element={
                  isInitializing ? null :
                  isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />
                }
              />
              <Route path="/track" element={<CustomerTrackingPage />} />
              <Route path="/track/:ticketNumber" element={<CustomerTrackingPage />} />

              {/* Protected Routes */}
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <AppShell>
                      <Suspense fallback={<PageSkeleton />}>
                        <Routes>
                          <Route path="/" element={<DashboardPage />} />
                          <Route path="/pos" element={<ProtectedRoute requiredPermission="pos"><POSPage /></ProtectedRoute>} />
                          <Route path="/parts" element={<ProtectedRoute requiredPermission="inventory_parts"><PartsPage /></ProtectedRoute>} />
                          <Route path="/repairs" element={<ProtectedRoute requiredPermission="repairs"><RepairsPage /></ProtectedRoute>} />
                          <Route path="/inventory" element={<ProtectedRoute requiredPermission="inventory_products"><InventoryPage /></ProtectedRoute>} />
                          <Route path="/purchasing" element={<ProtectedRoute requiredPermission="inventory_edit"><PurchasingPage /></ProtectedRoute>} />
                          <Route path="/customers" element={<ProtectedRoute requiredPermission="customers"><CustomersPage /></ProtectedRoute>} />
                          <Route path="/reports" element={<ProtectedRoute requiredPermission="reports"><ReportsPage /></ProtectedRoute>} />
                          <Route path="/activity" element={<ProtectedRoute requiredPermission="activity"><ActivityPage /></ProtectedRoute>} />
                          <Route path="/custom-ticket" element={<CustomTicketPage />} />
                          <Route path="/settings" element={<SettingsPage />} />
                          <Route path="*" element={<NotFoundPage />} />
                        </Routes>
                      </Suspense>
                    </AppShell>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
