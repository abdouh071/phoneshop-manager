import React from 'react';
import type { StockStatus, RepairStatus } from '../../types';
import styles from './Badge.module.css';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface BadgeProps {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({ variant = 'neutral', className, children }) => (
  <span className={[styles.badge, styles[variant], className].filter(Boolean).join(' ')}>
    {children}
  </span>
);

// Convenience helpers for domain-specific badges
export const StockBadge: React.FC<{ status: StockStatus }> = ({ status }) => {
  const map: Record<StockStatus, { variant: BadgeVariant; label: string }> = {
    in_stock: { variant: 'success', label: 'In Stock' },
    low_stock: { variant: 'warning', label: 'Low Stock' },
    out_of_stock: { variant: 'danger', label: 'Out of Stock' },
  };
  const { variant, label } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
};

export const RepairStatusBadge: React.FC<{ status: RepairStatus }> = ({ status }) => {
  const map: Record<RepairStatus, { variant: BadgeVariant; label: string; glowClass?: string }> = {
    pending: { variant: 'warning', label: 'Pending', glowClass: styles.glowPending },
    in_progress: { variant: 'info', label: 'In Progress', glowClass: styles.glowProgress },
    ready: { variant: 'success', label: 'Ready', glowClass: styles.glowReady },
    completed: { variant: 'neutral', label: 'Completed' },
    cancelled: { variant: 'danger', label: 'Cancelled' },
    returned: { variant: 'danger', label: 'Returned' },
  };
  const { variant, label, glowClass } = map[status];
  return (
    <span className={[styles.badge, styles[variant], glowClass].filter(Boolean).join(' ')}>
      {label}
    </span>
  );
};
