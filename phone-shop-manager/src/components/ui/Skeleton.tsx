import React from 'react';
import styles from './Skeleton.module.css';

interface SkeletonProps {
  variant?: 'line' | 'circle' | 'rect';
  width?: string;
  height?: string;
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  variant = 'line',
  width,
  height,
  className,
}) => (
  <span
    className={[styles.skeleton, styles[variant], className].filter(Boolean).join(' ')}
    style={{ width, height }}
    aria-hidden="true"
  />
);

export const SkeletonTableRows: React.FC<{ rows?: number; cols?: number }> = ({
  rows = 5,
  cols = 6,
}) => (
  <>
    {Array.from({ length: rows }).map((_, ri) => (
      <tr key={ri} className={styles.row}>
        {Array.from({ length: cols }).map((_, ci) => (
          <td key={ci} className={styles.cell}>
            <Skeleton width={ci === 0 ? '120px' : ci === cols - 1 ? '60px' : '80px'} />
          </td>
        ))}
      </tr>
    ))}
  </>
);

export const SkeletonCard: React.FC = () => (
  <div className={styles.cardSkeleton}>
    <Skeleton variant="rect" height="20px" width="40%" />
    <Skeleton variant="rect" height="36px" width="60%" />
    <Skeleton variant="rect" height="14px" width="30%" />
  </div>
);
