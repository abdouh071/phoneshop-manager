import React, { useState, useRef, useEffect } from 'react';
import { Printer } from 'lucide-react';
import { usePrinterStatus } from '../../hooks/usePrinterStatus';
import { useTranslation } from 'react-i18next';
import styles from './PrinterStatusPill.module.css';

export const PrinterStatusPill: React.FC = () => {
  const { t } = useTranslation();
  const { isOnline, printer, labelPrinter, hasCutter, isChecking, refresh } = usePrinterStatus();
  const [showPopover, setShowPopover] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pillRef.current && !pillRef.current.contains(e.target as Node)) {
        setShowPopover(false);
      }
    };
    if (showPopover) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showPopover]);

  const handleClick = () => {
    refresh();
    setShowPopover(prev => !prev);
  };

  return (
    <div
      ref={pillRef}
      className={[styles.pill, isOnline ? styles.online : styles.offline].join(' ')}
      onClick={handleClick}
      title={isOnline
        ? t('common.receiptTooltip', { printer, label: labelPrinter })
        : t('common.printServerOfflineTitle')}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') handleClick(); }}
    >
      <div className={[styles.dot, isOnline ? styles.dotOnline : styles.dotOffline].join(' ')} />
      <Printer size={13} />
      <span>{isChecking ? t('common.checking', 'Checking...') : isOnline ? t('common.printersReady', 'Printers Ready') : t('common.browserPrint', 'Browser Print')}</span>

      {/* Detail Popover */}
      {showPopover && (
        <div className={styles.popover} onClick={(e) => e.stopPropagation()}>
          <div className={styles.popoverTitle}>
            <span>{t('common.thermalHardware')}</span>
            <span style={{ fontSize: '10px', color: isOnline ? '#059669' : '#d97706' }}>
              {isOnline ? `${t('common.online')} :3355` : t('common.offline')}
            </span>
          </div>
          {isOnline ? (
            <>
              <div className={styles.printerRow}>
                <span>{t('common.receiptPrinter')}</span>
                <span className={styles.printerVal}>{printer}</span>
              </div>
              <div className={styles.printerRow}>
                <span>{t('common.labelPrinter')}</span>
                <span className={styles.printerVal}>{labelPrinter}</span>
              </div>
              <div className={styles.printerRow}>
                <span>{t('common.autoCutter')}</span>
                <span className={styles.printerVal}>{hasCutter ? t('common.enabled') : t('common.disabled')}</span>
              </div>
            </>
          ) : (
            <div style={{ color: '#64748b', fontSize: '11px', lineHeight: '1.4' }}>
              {t('common.printServerNotDetected')}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
