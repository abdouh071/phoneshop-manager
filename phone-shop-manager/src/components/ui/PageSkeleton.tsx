import React from 'react';
import styles from './PageSkeleton.module.css';

export const PageSkeleton: React.FC = () => {
  return (
    <div className={styles.skeletonContainer} aria-busy="true" aria-label="Loading content">
      {/* Header Silhouette */}
      <div className={styles.headerRow}>
        <div className={`${styles.titleBox} ${styles.shimmer}`} />
        <div className={`${styles.buttonBox} ${styles.shimmer}`} />
      </div>

      {/* Filter / Search Silhouette */}
      <div className={styles.filterRow}>
        <div className={`${styles.searchBar} ${styles.shimmer}`} />
        <div className={`${styles.filterPill} ${styles.shimmer}`} />
        <div className={`${styles.filterPill} ${styles.shimmer}`} />
      </div>

      {/* Card Grid Silhouettes */}
      <div className={styles.cardGrid}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className={`${styles.card} ${styles.shimmer}`} />
        ))}
      </div>
    </div>
  );
};
