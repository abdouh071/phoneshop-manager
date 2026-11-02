import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { usePrivacyStore } from '../../store/privacyStore';
import { useToast } from '../ui/Toast';
import { useTranslation } from 'react-i18next';

interface Props {
  variant?: 'icon' | 'badge' | 'sidebar';
  className?: string;
}

export const PrivacyCurtainButton: React.FC<Props> = ({ variant = 'badge', className }) => {
  const { isPrivacyActive, togglePrivacy } = usePrivacyStore();
  const toast = useToast();
  const { t } = useTranslation();

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    togglePrivacy();
    if (!isPrivacyActive) {
      toast.info('🛡️ Privacy Curtain ON', 'Sensitive profits and balances are now masked.');
    } else {
      toast.success('Privacy Curtain OFF', 'Financial figures are visible.');
    }
  };

  if (variant === 'sidebar') {
    return (
      <button
        type="button"
        onClick={handleToggle}
        title="Toggle Privacy Curtain Mode (Alt + P)"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 12px',
          width: '100%',
          borderRadius: '8px',
          border: isPrivacyActive ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid var(--color-outline-variant, #cbd5e1)',
          background: isPrivacyActive ? 'rgba(245, 158, 11, 0.12)' : 'var(--color-surface-container, #f1f5f9)',
          color: isPrivacyActive ? '#d97706' : 'var(--color-on-surface-variant)',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 600,
          transition: 'all 0.15s ease',
        }}
        className={className}
      >
        {isPrivacyActive ? <EyeOff size={16} /> : <Eye size={16} />}
        <span style={{ flex: 1, textAlign: 'left' }}>
          {isPrivacyActive ? t('common.curtainActive', 'Curtain Active (Masked)') : t('common.privacyCurtain', 'Privacy Curtain')}
        </span>
        <span
          style={{
            fontSize: '10px',
            padding: '1px 5px',
            borderRadius: '4px',
            background: isPrivacyActive ? '#d97706' : 'var(--color-surface-container-high, #e2e8f0)',
            color: isPrivacyActive ? '#ffffff' : 'var(--color-outline)',
            fontWeight: 700,
          }}
        >
          Alt+P
        </span>
      </button>
    );
  }

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleToggle}
        title={isPrivacyActive ? 'Privacy Curtain is ON (Alt + P)' : 'Enable Privacy Curtain Mode (Alt + P)'}
        aria-label="Toggle Privacy Curtain"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '34px',
          height: '34px',
          borderRadius: '8px',
          border: isPrivacyActive ? '1.5px solid #f59e0b' : '1px solid var(--color-outline-variant, #cbd5e1)',
          background: isPrivacyActive ? '#fef3c7' : 'var(--color-surface-container-lowest, #ffffff)',
          color: isPrivacyActive ? '#b45309' : 'var(--color-on-surface-variant)',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
        }}
        className={className}
      >
        {isPrivacyActive ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      title="Toggle Privacy Curtain Mode (Hotkey: Alt + P)"
      aria-label="Toggle Privacy Curtain Mode"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        borderRadius: '9999px',
        border: isPrivacyActive ? '1.5px solid #f59e0b' : '1px solid var(--color-outline-variant, #cbd5e1)',
        background: isPrivacyActive ? 'rgba(245, 158, 11, 0.15)' : 'var(--color-surface-container-lowest, #ffffff)',
        color: isPrivacyActive ? '#b45309' : 'var(--color-on-surface-variant)',
        fontSize: '12px',
        fontWeight: 700,
        cursor: 'pointer',
        boxShadow: isPrivacyActive ? '0 0 10px rgba(245, 158, 11, 0.25)' : '0 1px 3px rgba(0, 0, 0, 0.05)',
        transition: 'all 0.15s ease',
      }}
      className={className}
    >
      {isPrivacyActive ? (
        <>
          <EyeOff size={14} style={{ color: '#d97706' }} />
          <span>Blind ON (•••••)</span>
          <span
            style={{
              fontSize: '10px',
              padding: '1px 5px',
              borderRadius: '9999px',
              background: '#f59e0b',
              color: '#ffffff',
              fontWeight: 800,
              marginLeft: '2px',
            }}
          >
            Alt+P
          </span>
        </>
      ) : (
        <>
          <Eye size={14} style={{ color: 'var(--color-primary)' }} />
          <span>{t('common.privacyCurtain', 'Privacy Curtain')}</span>
          <span
            style={{
              fontSize: '10px',
              color: 'var(--color-outline)',
              fontWeight: 600,
              opacity: 0.8,
            }}
          >
            Alt+P
          </span>
        </>
      )}
    </button>
  );
};
