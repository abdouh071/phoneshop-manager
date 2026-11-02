import React from 'react';
import { useTranslation } from 'react-i18next';
import type { RepairTicket } from '../../types';
import type { WalkInMetrics } from './customersPageData';
import type { WalkInStatusFilter } from './customersPageTypes';
import styles from './Customers.module.css';

interface WalkInFilterPillsProps {
  walkInTickets: RepairTicket[];
  walkInMetrics: WalkInMetrics;
  walkInStatusFilter: WalkInStatusFilter;
  setWalkInStatusFilter: React.Dispatch<React.SetStateAction<WalkInStatusFilter>>;
  setWalkInPage: React.Dispatch<React.SetStateAction<number>>;
}

export const WalkInFilterPills: React.FC<WalkInFilterPillsProps> = ({
  walkInTickets,
  walkInMetrics,
  walkInStatusFilter,
  setWalkInStatusFilter,
  setWalkInPage,
}) => {
  const { t } = useTranslation();

  return (
    <>
          {/* Walk-in Status Quick Filter Pills */}
          <div className={styles.filterPills}>
            {[
              { label: t('customers.allWalkInRepairs', 'All Walk-in Repairs'), value: 'all', count: walkInTickets.length },
              { label: t('customers.activeInWorkshop', 'Active in Workshop'), value: 'active', count: walkInMetrics.active },
              { label: t('customers.pendingIntake', 'Pending Intake'), value: 'pending', count: walkInMetrics.pending },
              { label: t('customers.inProgress', 'In Progress'), value: 'in_progress', count: walkInMetrics.inProgress },
              { label: t('customers.readyForPickup', 'Ready for Pickup'), value: 'ready', count: walkInMetrics.ready },
              { label: t('customers.completed', 'Completed'), value: 'completed', count: walkInMetrics.completed },
            ].map((pill) => (
              <button
                key={pill.value}
                type="button"
                className={[
                  styles.filterPill,
                  walkInStatusFilter === pill.value ? styles.filterPillActive : ''
                ].filter(Boolean).join(' ')}
                onClick={() => {
                  setWalkInStatusFilter(pill.value as typeof walkInStatusFilter);
                  setWalkInPage(1);
                }}
              >
                <span>{pill.label}</span>
                <span className={styles.pillCount}>{pill.count}</span>
              </button>
            ))}
          </div>
    </>
  );
};
