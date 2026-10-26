import React, { useRef, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import styles from './PullToRefresh.module.css';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  threshold?: number;
}

/**
 * PullToRefresh — wraps a scrollable content area and shows a spinner
 * when the user pulls down past the threshold. Triggers the onRefresh
 * callback and shows a loading indicator until it resolves.
 *
 * Only active on touch devices (mobile/tablet).
 */
export const PullToRefresh: React.FC<PullToRefreshProps> = ({
  onRefresh,
  children,
  threshold = 72,
}) => {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const el = containerRef.current;
    if (!el || el.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (startY.current === null) return;
    const el = containerRef.current;
    if (!el || el.scrollTop > 0) { startY.current = null; return; }

    const delta = e.touches[0].clientY - startY.current;
    if (delta > 0) {
      setPullDistance(Math.min(delta * 0.45, threshold * 1.3));
    }
  }, [threshold]);

  const handleTouchEnd = useCallback(async () => {
    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(threshold);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
    startY.current = null;
  }, [pullDistance, threshold, isRefreshing, onRefresh]);

  const progress = Math.min(pullDistance / threshold, 1);
  const showIndicator = pullDistance > 8;

  return (
    <div
      ref={containerRef}
      className={styles.container}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull Indicator */}
      {showIndicator && (
        <div
          className={styles.indicator}
          style={{ height: pullDistance, opacity: progress }}
        >
          <div
            className={[styles.spinner, (isRefreshing || progress >= 1) && styles.spinnerActive].filter(Boolean).join(' ')}
            style={{ transform: `rotate(${progress * 360}deg)` }}
          >
            <RefreshCw size={20} />
          </div>
          <span className={styles.label}>
            {isRefreshing ? 'Refreshing…' : progress >= 1 ? 'Release to refresh' : 'Pull to refresh'}
          </span>
        </div>
      )}

      {children}
    </div>
  );
};
