import { useEffect, useRef } from 'react';

interface BarcodeScannerOptions {
  onScan: (sku: string) => void;
  /** Minimum characters a scan must carry before Enter fires it. */
  minLength?: number;
  /** Milliseconds without a keystroke before the buffer is dropped as hand typing. */
  resetAfterMs?: number;
}

/**
 * Listens for a hardware barcode scanner: fast typed characters followed by
 * Enter while no input is focused. Typing inside fields never triggers a scan.
 * The callback is kept in a ref so the listener is registered once and never
 * re-subscribes when the page's data changes.
 */
export function useBarcodeScanner({ onScan, minLength = 4, resetAfterMs = 100 }: BarcodeScannerOptions) {
  const buffer = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInputFocused = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (isInputFocused) return;

      if (e.key === 'Enter') {
        if (buffer.current.length >= minLength) {
          onScanRef.current(buffer.current);
        }
        buffer.current = '';
        if (timer.current) clearTimeout(timer.current);
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        buffer.current += e.key;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          buffer.current = '';
        }, resetAfterMs);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [minLength, resetAfterMs]);
}
