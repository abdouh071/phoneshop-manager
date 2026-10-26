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
import { registerOfflineHandlers } from './services/offlineHandlers';
import { unifiedOfflineSyncService } from './services/unifiedOfflineSyncService';

// Register all domain-specific offline sync handlers once at app startup
registerOfflineHandlers();

/**
 * Smart lazy loader with automatic deployment-recovery.
 * If a new version was deployed and an older chunk hash is requested
 * (causing MIME type error or failed fetch), it automatically reloads the
 * window once to seamlessly load the latest bundle without an error screen.
 */
function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (error: any) {
      console.warn('[LazyLoader] Dynamic chunk failed to load:', error);
      const msg = (error?.message || '').toLowerCase();
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
const LoginPage = lazyWithRetry(() => import('./features/auth/LoginPage').then(m => ({ default: m.LoginPage })));
const CustomerTrackingPage = lazyWithRetry(() => import('./features/tracking/CustomerTrackingPage').then(m => ({ default: m.CustomerTrackingPage })));

function App() {
  const { isAuthenticated, isInitializing } = useAuthStore();

  useEffect(() => {
    const cleanupCustomers = offlineCustomerSyncService.init();
    const cleanupQueue = offlineQueue.init();
    const cleanupUnified = unifiedOfflineSyncService.init();
    return () => {
      cleanupCustomers();
      cleanupQueue();
      cleanupUnified();
    };
  }, []);

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
                          <Route path="*" element={<DashboardPage />} />
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
