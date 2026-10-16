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
const PRINT_SERVER_URL = typeof window !== 'undefined' && window.location.hostname
  ? `http://${window.location.hostname}:3355`
  : 'http://localhost:3355';

export function usePrinterStatus(): PrinterStatusInfo {
  const [status, setStatus] = useState<Omit<PrinterStatusInfo, 'refresh'>>({
    isOnline: false,
    isChecking: true,
  });

  const checkStatus = async () => {
    try {
      const res = await fetch(`${PRINT_SERVER_URL}/status`, {
        signal: AbortSignal.timeout(2500),
      });
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
