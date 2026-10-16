import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { ToastProvider } from './components/ui/Toast';
import { PageSkeleton } from './components/ui/PageSkeleton';
import { useAuthStore } from './store/authStore';

// Lazy-loaded routes for instant initial application startup
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })));
const InventoryPage = lazy(() => import('./features/inventory/InventoryPage').then(m => ({ default: m.InventoryPage })));
const PurchasingPage = lazy(() => import('./features/purchasing/PurchasingPage').then(m => ({ default: m.PurchasingPage })));
const POSPage = lazy(() => import('./features/pos/POSPage').then(m => ({ default: m.POSPage })));
const PartsPage = lazy(() => import('./features/parts/PartsPage').then(m => ({ default: m.PartsPage })));
const RepairsPage = lazy(() => import('./features/repairs/RepairsPage').then(m => ({ default: m.RepairsPage })));
const CustomersPage = lazy(() => import('./features/customers/CustomersPage').then(m => ({ default: m.CustomersPage })));
const ReportsPage = lazy(() => import('./features/reports/ReportsPage').then(m => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage').then(m => ({ default: m.SettingsPage })));
const ActivityPage = lazy(() => import('./features/activity/ActivityPage').then(m => ({ default: m.ActivityPage })));
const CustomTicketPage = lazy(() => import('./features/customTicket/CustomTicketPage').then(m => ({ default: m.CustomTicketPage })));
const LoginPage = lazy(() => import('./features/auth/LoginPage').then(m => ({ default: m.LoginPage })));
const CustomerTrackingPage = lazy(() => import('./features/tracking/CustomerTrackingPage').then(m => ({ default: m.CustomerTrackingPage })));

function App() {
  const { isAuthenticated, isInitializing } = useAuthStore();

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
