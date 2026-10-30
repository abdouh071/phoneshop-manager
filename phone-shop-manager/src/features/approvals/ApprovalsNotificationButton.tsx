import React, { useEffect, useRef } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useApprovalStore } from '../../store/approvalStore';
import { AdminApprovalsModal } from './AdminApprovalsModal';
import { useToast } from '../../components/ui/Toast';
import { useTranslation } from 'react-i18next';

interface ApprovalsNotificationButtonProps {
  variant?: 'badge' | 'sidebar' | 'icon' | 'mobile-tab';
}

export const ApprovalsNotificationButton: React.FC<ApprovalsNotificationButtonProps> = ({
  variant = 'badge',
}) => {
  const { user } = useAuthStore();
  const { pendingRequests, pendingCount, isModalOpen, openModal, closeModal, subscribeToPending } = useApprovalStore();
  const toast = useToast();
  const { t } = useTranslation();
  const prevPendingIdsRef = useRef<Set<string>>(new Set());

  const isAdmin = user?.role === 'admin' || user?.isSuperAdmin === true;

  // Subscribe to pending requests
  useEffect(() => {
    if (!isAdmin) return;
    const unsubscribe = subscribeToPending();
    return () => {
      unsubscribe();
    };
  }, [isAdmin, subscribeToPending]);

  // Alert admin on new incoming pending request with toast
  useEffect(() => {
    if (!isAdmin) return;

    const currentIds = new Set(pendingRequests.map(r => r.id));
    const newRequests = pendingRequests.filter(r => !prevPendingIdsRef.current.has(r.id));

    if (prevPendingIdsRef.current.size > 0 && newRequests.length > 0) {
      newRequests.forEach(req => {
        toast.info(
          'Approval Requested',
          `${req.requestedBy.name} is requesting approval: "${req.actionLabel}"`
        );
      });
    }

    prevPendingIdsRef.current = currentIds;
  }, [isAdmin, pendingRequests, toast]);

  if (!isAdmin) return null;

  if (variant === 'sidebar') {
    return (
      <button
        type="button"
        onClick={openModal}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '10px 14px',
          borderRadius: '10px',
          border: 'none',
          background: pendingCount > 0 ? 'rgba(239, 68, 68, 0.12)' : 'var(--color-surface-variant, rgba(0,0,0,0.04))',
          color: pendingCount > 0 ? '#ef4444' : 'var(--color-on-surface, #333333)',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 600,
          transition: 'all 0.2s ease',
        }}
        title="Staff Approval Requests"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ShieldAlert size={18} style={{ color: pendingCount > 0 ? '#ef4444' : 'var(--color-primary, #4f46e5)' }} />
          <span>{t('common.staffApprovals', 'Staff Approvals')}</span>
        </div>

        {pendingCount > 0 ? (
          <span style={{
            background: '#ef4444',
            color: '#ffffff',
            fontSize: '11px',
            fontWeight: 700,
            padding: '2px 7px',
            borderRadius: '12px',
            animation: 'pulseBadge 2s infinite',
          }}>
            {pendingCount}
          </span>
        ) : (
          <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant, #888)' }}>
            0
          </span>
        )}
      </button>
    );
  }

  if (variant === 'mobile-tab') {
    // Just a small red dot badge overlaid above the More menu icon
    return pendingCount > 0 ? (
      <>
        <span
          onClick={openModal}
          style={{
            position: 'absolute',
            top: 6,
            right: '50%',
            transform: 'translateX(calc(50% + 6px))',
            width: 8,
            height: 8,
            background: '#ef4444',
            borderRadius: '50%',
            border: '1.5px solid var(--color-surface)',
            zIndex: 5,
            animation: 'pulseBadge 2s infinite',
            cursor: 'pointer',
          }}
          title={`${pendingCount} approval request(s) pending`}
        />
        <AdminApprovalsModal isOpen={isModalOpen} onClose={closeModal} />
        <style>{`
          @keyframes pulseBadge {
            0% { transform: translateX(calc(50% + 6px)) scale(1); }
            50% { transform: translateX(calc(50% + 6px)) scale(1.3); }
            100% { transform: translateX(calc(50% + 6px)) scale(1); }
          }
        `}</style>
      </>
    ) : null;
  }

  // Header Pill / Badge Variant (also mounts the AdminApprovalsModal)
  return (
    <>
      <button
        type="button"
        onClick={openModal}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          borderRadius: '20px',
          border: pendingCount > 0 ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid var(--color-outline, #e2e8f0)',
          background: pendingCount > 0 ? 'rgba(239, 68, 68, 0.1)' : 'var(--color-surface, #ffffff)',
          color: pendingCount > 0 ? '#b91c1c' : 'var(--color-on-surface-variant, #64748b)',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 600,
          transition: 'all 0.15s ease',
        }}
        title="Admin Staff Approvals"
      >
        <ShieldAlert size={15} style={{ color: pendingCount > 0 ? '#ef4444' : 'var(--color-primary, #4f46e5)' }} />
        <span>Approvals</span>
        {pendingCount > 0 && (
          <span style={{
            background: '#ef4444',
            color: '#ffffff',
            fontSize: '11px',
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: '10px',
            animation: 'pulseBadge 2s infinite',
          }}>
            {pendingCount}
          </span>
        )}
      </button>

      <AdminApprovalsModal isOpen={isModalOpen} onClose={closeModal} />

      <style>{`
        @keyframes pulseBadge {
          0% { transform: scale(1); }
          50% { transform: scale(1.15); }
          100% { transform: scale(1); }
        }
      `}</style>
    </>
  );
};
