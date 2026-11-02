import { useState, useEffect } from 'react';
import { WifiOff, WifiIcon, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { unifiedOfflineSyncService } from '../../services/unifiedOfflineSyncService';
import styles from './OfflineBanner.module.css';

export const OfflineBanner: React.FC = () => {
  const { t } = useTranslation();
  const { isOnline, justCameOnline } = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(unifiedOfflineSyncService.getTotalPendingCount());
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (justCameOnline) {
      setIsSyncing(true);
      const timer = setTimeout(() => setIsSyncing(false), 3000);
      return () => clearTimeout(timer);
    }
    setIsSyncing(false);
  }, [justCameOnline]);

  useEffect(() => {
    // Subscribe to total pending offline records across all models
    const unsubscribe = unifiedOfflineSyncService.subscribe(count => setPendingCount(count));
    return () => {
      unsubscribe();
    };
  }, []);

  const isOffline = !isOnline;

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
            ? t('common.backOnlineSyncing')
            : t('common.connectionRestored')}
        </span>
      </div>
    );
  }

  return (
    <div className={styles.banner} role="status">
      <WifiOff size={14} />
      <span>
        {t('common.offlineMode')}
        {pendingCount > 0 && (
          <strong style={{ marginLeft: 4 }}>
            {t('common.pendingChanges', { count: pendingCount })}
          </strong>
        )}
      </span>
    </div>
  );
};
