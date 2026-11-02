import React, { useState } from 'react';
import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';
import { LogoutConfirmModal } from './LogoutConfirmModal';

interface UserLogoutButtonProps {
  variant?: 'header' | 'mobile' | 'icon';
}

export const UserLogoutButton: React.FC<UserLogoutButtonProps> = ({
  variant = 'header',
}) => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [isModalOpen, setIsModalOpen] = useState(false);

  if (!user) return null;

  const ROLE_COLORS: Record<string, string> = {
    admin: '#6366f1',
    sales_agent: '#10b981',
    repair_agent: '#f59e0b',
  };

  const ROLE_SHORT_LABELS: Record<string, string> = {
    admin: 'Admin',
    sales_agent: 'Sales',
    repair_agent: 'Repair',
  };

  if (variant === 'mobile' || variant === 'icon') {
    return (
      <>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          style={{
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '8px',
            color: '#ef4444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '6px',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          title={`${t('sidebar.logout')} — ${user.name}`}
          aria-label={t('sidebar.logout')}
        >
          <LogOut size={16} />
        </button>

        <LogoutConfirmModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      </>
    );
  }

  // Header Variant (Pill with user avatar, name, and logout button)
  return (
    <>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        background: 'var(--color-surface, #ffffff)',
        border: '1px solid var(--color-outline, #e2e8f0)',
        borderRadius: '20px',
        padding: '3px 4px 3px 10px',
        gap: '8px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
      }}>
        {/* User Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{
            width: '22px',
            height: '22px',
            borderRadius: '50%',
            background: ROLE_COLORS[user.role] || 'var(--color-primary, #6366f1)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '11px',
            fontWeight: 700,
          }}>
            {user.avatar || (user.name ? user.name[0].toUpperCase() : 'U')}
          </div>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-on-surface, #0f172a)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.name}
          </span>
          <span style={{
            fontSize: '10px',
            fontWeight: 700,
            padding: '1px 5px',
            borderRadius: '4px',
            background: 'rgba(0,0,0,0.05)',
            color: ROLE_COLORS[user.role] || '#444',
            textTransform: 'uppercase',
          }}>
            {ROLE_SHORT_LABELS[user.role] || user.role}
          </span>
        </div>

        {/* Vertical divider */}
        <div style={{ width: '1px', height: '16px', background: 'var(--color-outline, #e2e8f0)' }} />

        {/* Logout action button */}
        <button
          type="button"
          data-logout-trigger="true"
          onClick={() => setIsModalOpen(true)}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--color-on-surface-variant, #64748b)',
            cursor: 'pointer',
            padding: '4px 6px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '11px',
            fontWeight: 600,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#ef4444';
            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--color-on-surface-variant, #64748b)';
            e.currentTarget.style.background = 'transparent';
          }}
          title={`${t('sidebar.logout')} (Alt+L)`}
        >
          <LogOut size={13} />
          <span>{t('sidebar.logout')}</span>
        </button>
      </div>

      <LogoutConfirmModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
};
