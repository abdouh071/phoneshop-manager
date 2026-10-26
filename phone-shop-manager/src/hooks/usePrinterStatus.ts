import { useState, useEffect } from 'react';

interface PrinterStatusInfo {
  isOnline: boolean;
  printer?: string;
  labelPrinter?: string;
  hasCutter?: boolean;
  isChecking: boolean;
  refresh: () => void;
}

const CHECK_INTERVAL_MS = 15_000; // 15 seconds

// Detect Electron desktop app (preload.cjs exposes window.electronAPI)
const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;

// Priority: Electron embedded server > env var > local hostname > fallback to localhost
const PRINT_SERVER_URL = (() => {
  // 1. Electron desktop app — always use the embedded local server
  if (electronAPI?.printServerUrl) return electronAPI.printServerUrl;
  // 2. Explicit env var override
  if (import.meta.env.VITE_PRINT_SERVER_URL) return import.meta.env.VITE_PRINT_SERVER_URL;
  // 3. Running locally in browser — use current hostname
  if (typeof window !== 'undefined' && window.location.hostname) {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.') || h.startsWith('10.') || h.startsWith('172.')) {
      return `http://${h}:3355`;
    }
  }
  // 4. Deployed cloud app — fall back to localhost (user must run print server locally)
  return 'http://localhost:3355';
})();

export function usePrinterStatus(): PrinterStatusInfo {
  const [status, setStatus] = useState<Omit<PrinterStatusInfo, 'refresh'>>({
    isOnline: false,
    isChecking: true,
  });

  const checkStatus = async () => {
    // ── Attempt 1: Electron native IPC (bypasses all network issues) ──
    if (electronAPI?.checkStatus) {
      try {
        const data = await electronAPI.checkStatus();
        if (data && (data.ok || data.connected)) {
          setStatus({
            isOnline: true,
            printer: data.printer || '80mm POS',
            labelPrinter: data.labelPrinter || 'Label Printer',
            hasCutter: data.hasCutter ?? true,
            isChecking: false,
          });
          return;
        }
      } catch (ipcErr) {
        console.warn('[PrinterStatus] IPC checkStatus failed, trying HTTP:', ipcErr);
      }
    }

    // ── Attempt 2: HTTP fetch (web browser fallback) ──
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${PRINT_SERVER_URL}/status`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        setStatus({
          isOnline: true,
          printer: data.printer || '80mm POS',
          labelPrinter: data.labelPrinter || 'Label Printer',
          hasCutter: data.hasCutter ?? true,
          isChecking: false,
        });
        return;
      }
    } catch {
      // Print server offline or unreachable
    }

    setStatus({
      isOnline: false,
      isChecking: false,
    });
  };

  useEffect(() => {
    checkStatus();
    const intervalId = setInterval(checkStatus, CHECK_INTERVAL_MS);
    window.addEventListener('focus', checkStatus);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', checkStatus);
    };
  }, []);

  return { ...status, refresh: checkStatus };
}
