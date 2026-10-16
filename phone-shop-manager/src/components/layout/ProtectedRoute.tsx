import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { usePermissions } from '../../hooks/usePermissions';
import type { Permissions } from '../../types/permissions';

export const ProtectedRoute: React.FC<{ children: React.ReactNode, requiredPermission?: keyof Permissions }> = ({ children, requiredPermission }) => {
  const { isAuthenticated, isInitializing } = useAuthStore();
  const permissions = usePermissions();
  const location = useLocation();

  // Wait for Firebase to restore the auth session before deciding
  if (isInitializing) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--color-bg, #0a0a12)',
      }}>
        <div style={{
          width: 36,
          height: 36,
          border: '3px solid rgba(255,255,255,0.1)',
          borderTopColor: 'var(--color-accent, #6366f1)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredPermission && !permissions[requiredPermission]) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
