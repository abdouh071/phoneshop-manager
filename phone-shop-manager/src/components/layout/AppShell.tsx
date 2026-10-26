import React, { useState, useEffect } from 'react';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { MobileBottomNav } from './MobileBottomNav';
import { useSettingsStore } from '../../store/settingsStore';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../ui/Toast';
import { OfflineBanner } from './OfflineBanner';
import { PrinterStatusPill } from './PrinterStatusPill';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useGlobalBarcodeScanner } from '../../hooks/useGlobalBarcodeScanner';
import { useMidnightAutoClose } from '../../hooks/useMidnightAutoClose';
import { usePrintQueue } from '../../hooks/usePrintQueue';
import { usePrivacyStore } from '../../store/privacyStore';
import { PrivacyCurtainButton } from './PrivacyCurtainButton';
import { ApprovalsNotificationButton } from '../../features/approvals/ApprovalsNotificationButton';
import { UserLogoutButton } from './UserLogoutButton';
import styles from './AppShell.module.css';

interface AppShellProps {
  children: React.ReactNode;
}

const IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const { theme, colorTheme, currency, storeName, fetchSettings, isInitialized } = useSettingsStore();
  const { user, isHistoryUnlocked, lockHistory } = useAuthStore();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const toast = useToast();

  // Fetch global settings on app load & set up real-time listener
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    fetchSettings().then(unsub => {
      unsubscribe = unsub;
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [fetchSettings]);

  // Auto-lock for workers when idle
  useEffect(() => {
    // Only apply if the terminal is unlocked and the user is NOT a full admin
    if (!isHistoryUnlocked || !user || user.role === 'admin') return;

    let timeoutId: NodeJS.Timeout;

    const resetTimer = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        lockHistory();
        toast.info('Terminal Locked', 'Admin access was revoked due to 3 minutes of inactivity.');
      }, IDLE_TIMEOUT_MS);
    };

    resetTimer();

    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
    events.forEach(e => window.addEventListener(e, resetTimer));

    return () => {
      clearTimeout(timeoutId);
      events.forEach(e => window.removeEventListener(e, resetTimer));
    };
  }, [isHistoryUnlocked, user, lockHistory, toast]);

  let actualTheme = theme;
  if (theme === 'system') {
    actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  useKeyboardShortcuts();
  useGlobalBarcodeScanner();
  useMidnightAutoClose();
  usePrintQueue();

  const isPrivacyActive = usePrivacyStore((s) => s.isPrivacyActive);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', actualTheme);
    document.documentElement.setAttribute('data-color-theme', colorTheme || 'default');
    document.documentElement.setAttribute('data-privacy', isPrivacyActive ? 'active' : 'inactive');
  }, [actualTheme, colorTheme, isPrivacyActive]);

  return (
    <>
      <OfflineBanner />
      <div 
        className={styles.shell} 
        data-theme={actualTheme} 
        data-color-theme={colorTheme || 'default'}
        data-privacy={isPrivacyActive ? 'active' : 'inactive'}
      >
        <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
        
        <main className={styles.main}>
          {/* Desktop Top Header Bar */}
          <header className={styles.desktopHeader}>
            <ApprovalsNotificationButton variant="badge" />
            <PrivacyCurtainButton variant="badge" />
            <PrinterStatusPill />
            <UserLogoutButton variant="header" />
          </header>

          {/* Mobile Header */}
          <header className={styles.mobileHeader}>
            <button 
              className={styles.menuBtn} 
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open Menu"
            >
              <Menu size={20} />
            </button>
            <div className={styles.mobileTitle}>{storeName || 'PhoneShop Pro'}</div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <PrivacyCurtainButton variant="icon" />
              <PrinterStatusPill />
              <UserLogoutButton variant="mobile" />
            </div>
          </header>

          <div className={styles.content} key={`${currency}-${storeName}`}>
            {!isInitialized ? (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '50%',
                  border: '3px solid var(--color-surface-variant)',
                  borderTopColor: 'var(--color-primary)',
                  animation: 'spin 1s linear infinite'
                }}></div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            ) : (
              children
            )}
          </div>
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <MobileBottomNav onMenuOpen={() => setIsSidebarOpen(true)} />
    </>
  );
};
