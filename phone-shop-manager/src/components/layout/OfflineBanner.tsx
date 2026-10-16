import React, { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import styles from './OfflineBanner.module.css';

export const OfflineBanner: React.FC = () => {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className={styles.banner} role="status">
      <WifiOff size={14} />
      <span>Offline Mode — Operations continue locally and will automatically sync when internet reconnects.</span>
    </div>
  );
};
