import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import styles from './Toast.module.css';

import { useSettingsStore } from '../../store/settingsStore';

// ---- Types ----
type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
}

interface ToastContextValue {
  toast: (opts: Omit<Toast, 'id'>) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

// ---- Context ----
const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle size={18} />,
  error: <AlertCircle size={18} />,
  warning: <AlertTriangle size={18} />,
  info: <Info size={18} />,
};

// ---- Provider ----
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((opts: Omit<Toast, 'id'>) => {
    const { enableNotifications } = useSettingsStore.getState();
    // If notifications are disabled in settings, suppress success and info toasts (allow errors and warnings)
    if (!enableNotifications && (opts.variant === 'success' || opts.variant === 'info')) {
      return;
    }
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev.slice(-2), { ...opts, id }]); // max 3 toasts
    setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);

  const ctx: ToastContextValue = {
    toast: addToast,
    success: (title, message) => addToast({ variant: 'success', title, message }),
    error: (title, message) => addToast({ variant: 'error', title, message }),
    warning: (title, message) => addToast({ variant: 'warning', title, message }),
    info: (title, message) => addToast({ variant: 'info', title, message }),
  };

  globalToastHandler = ctx;

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div className={styles.container} role="status" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={[styles.toast, styles[t.variant]].join(' ')}>
            <span className={styles.icon}>{ICONS[t.variant]}</span>
            <div className={styles.content}>
              <p className={styles.toastTitle}>{t.title}</p>
              {t.message && <p className={styles.toastMessage}>{t.message}</p>}
            </div>
            <button className={styles.dismissBtn} onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
            <div className={styles.progressBar} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

// ---- Global Toast Handler & Hook ----
let globalToastHandler: ToastContextValue | null = null;

export const toast = {
  success: (title: string, message?: string) => globalToastHandler?.success(title, message),
  error: (title: string, message?: string) => globalToastHandler?.error(title, message),
  warning: (title: string, message?: string) => globalToastHandler?.warning(title, message),
  info: (title: string, message?: string) => globalToastHandler?.info(title, message),
};

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
};

