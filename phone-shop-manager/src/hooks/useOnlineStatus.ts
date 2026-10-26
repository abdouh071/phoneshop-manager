import { useState, useEffect } from 'react';

/**
 * Hook that tracks the browser online/offline status and
 * broadcasts a custom event when we come back online so
 * other parts of the app can trigger a sync.
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [justCameOnline, setJustCameOnline] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setJustCameOnline(true);
      window.dispatchEvent(new CustomEvent('app:online'));
      setTimeout(() => setJustCameOnline(false), 3000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setJustCameOnline(false);
      window.dispatchEvent(new CustomEvent('app:offline'));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { isOnline, justCameOnline };
}
