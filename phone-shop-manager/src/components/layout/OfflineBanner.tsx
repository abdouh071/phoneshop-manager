import React, { useState, useEffect } from 'react';
import { WifiOff, WifiIcon, RefreshCw } from 'lucide-react';
import { unifiedOfflineSyncService } from '../../services/unifiedOfflineSyncService';
import styles from './OfflineBanner.module.css';

export const OfflineBanner: React.FC = () => {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [justCameOnline, setJustCameOnline] = useState(false);
  const [pendingCount, setPendingCount] = useState(unifiedOfflineSyncService.getTotalPendingCount());
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      setJustCameOnline(true);
      setIsSyncing(true);
      setTimeout(() => {
        setJustCameOnline(false);
        setIsSyncing(false);
      }, 4000);
    };
    const handleOffline = () => {
      setIsOffline(true);
      setJustCameOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Subscribe to total pending offline records across all models
    const unsubscribe = unifiedOfflineSyncService.subscribe(count => setPendingCount(count));

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, []);

  if (!isOffline && !justCameOnline && pendingCount === 0) return null;

  if (justCameOnline) {
    return (
      <div className={[styles.banner, styles.bannerOnline].join(' ')} role="status">
        {isSyncing ? (
          <RefreshCw size={14} className={styles.spinIcon} />
        ) : (
          <WifiIcon size={14} />
        )}
        <span>
          {isSyncing
            ? 'Back online — syncing queued changes…'
            : 'Connection restored. All changes synced.'}
        </span>
      </div>
    );
  }

  return (
    <div className={styles.banner} role="status">
      <WifiOff size={14} />
      <span>
        Offline Mode — Data is saved locally.
        {pendingCount > 0 && (
          <strong style={{ marginLeft: 4 }}>
            {pendingCount} change{pendingCount > 1 ? 's' : ''} will auto-sync when online.
          </strong>
        )}
      </span>
    </div>
  );
};
