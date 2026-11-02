import React, { useState } from 'react';
import { LogOut, AlertTriangle, Lock } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import '../ui/Badge';
import { useAuthStore } from '../../store/authStore';
import { useCartStore } from '../../store/cartStore';
import { useToast } from '../ui/Toast';

interface LogoutConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LogoutConfirmModal: React.FC<LogoutConfirmModalProps> = ({ isOpen, onClose }) => {
  const { user, logout, lockHistory } = useAuthStore();
  const cartItems = useCartStore((s) => s.items);
  const toast = useToast();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  if (!user) return null;

  const hasActiveCart = cartItems.length > 0;

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      toast.info('Logged Out', 'You have been safely signed out.');
      onClose();
    } catch (err: unknown) {
      console.error('Logout error:', err);
      // Even if an error occurs, force close modal
      onClose();
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleQuickLock = () => {
    lockHistory();
    toast.info('Terminal Locked', 'Admin privileges locked. Worker mode active.');
    onClose();
  };

  const ROLE_COLORS: Record<string, string> = {
    admin: '#6366f1',
    sales_agent: '#10b981',
    repair_agent: '#f59e0b',
  };

  const ROLE_LABELS: Record<string, string> = {
    admin: 'Administrator',
    sales_agent: 'Sales Agent',
    repair_agent: 'Repair Agent',
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Sign Out of Session"
      size="sm"
    >
      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        
        {/* User Profile Card */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '14px 16px',
          background: 'var(--color-surface-variant, #f8fafc)',
          borderRadius: '12px',
          border: '1px solid var(--color-outline, #e2e8f0)',
        }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '50%',
            background: ROLE_COLORS[user.role] || 'var(--color-primary, #6366f1)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px',
            fontWeight: 700,
            flexShrink: 0,
          }}>
            {user.avatar || (user.name ? user.name[0].toUpperCase() : 'U')}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-on-surface, #0f172a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.name}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant, #64748b)', marginTop: '1px' }}>
              {user.email}
            </div>
            <div style={{ marginTop: '4px' }}>
              <span style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: '6px',
                background: 'rgba(0,0,0,0.06)',
                color: ROLE_COLORS[user.role] || '#333',
              }}>
                {ROLE_LABELS[user.role] || user.role}
              </span>
            </div>
          </div>
        </div>

        {/* Warning if cart has items */}
        {hasActiveCart && (
          <div style={{
            padding: '12px 14px',
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            fontSize: '12px',
            color: '#b45309',
            lineHeight: 1.4,
          }}>
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>Active Sale Warning:</strong>
              <div>
                You currently have <strong>{cartItems.length} item(s)</strong> in your POS sale cart. You can suspend the cart before logging out if you wish to resume it later.
              </div>
            </div>
          </div>
        )}

        <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-on-surface-variant, #64748b)', lineHeight: 1.5 }}>
          Are you sure you want to end your current session and return to the login screen?
        </p>

        {/* Action Buttons */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          marginTop: '6px',
        }}>
          {user.role === 'admin' ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleQuickLock}
              leftIcon={<Lock size={14} />}
              title="Lock administrative permissions while keeping app open"
            >
              Lock Terminal
            </Button>
          ) : <div />}

          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={isLoggingOut}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleLogout}
              isLoading={isLoggingOut}
              leftIcon={<LogOut size={15} />}
            >
              Log Out
            </Button>
          </div>
        </div>

      </div>
    </Modal>
  );
};
