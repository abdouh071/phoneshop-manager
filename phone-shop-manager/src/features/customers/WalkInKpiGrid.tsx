import React from 'react';
import { Wrench, Clock, CheckCircle2, DollarSign } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatPrivateCurrency } from '../../utils/formatCurrency';
import type { WalkInMetrics } from './customersPageData';
import type { WalkInStatusFilter } from './customersPageTypes';
import styles from './Customers.module.css';

interface WalkInKpiGridProps {
  walkInMetrics: WalkInMetrics;
  walkInStatusFilter: WalkInStatusFilter;
  setWalkInStatusFilter: React.Dispatch<React.SetStateAction<WalkInStatusFilter>>;
  setWalkInPage: React.Dispatch<React.SetStateAction<number>>;
}

export const WalkInKpiGrid: React.FC<WalkInKpiGridProps> = ({
  walkInMetrics,
  walkInStatusFilter,
  setWalkInStatusFilter,
  setWalkInPage,
}) => {
  const { t } = useTranslation();

  return (
    <>
          {/* Walk-in Repairs KPI Summary Grid */}
          <div className={styles.summaryGrid}>
            <div
              className={[
                styles.summaryCard,
                walkInStatusFilter === 'all' && styles.summaryCardActive
              ].filter(Boolean).join(' ')}
              onClick={() => { setWalkInStatusFilter('all'); setWalkInPage(1); }}
              title="Click to view all walk-in repairs"
              style={{ cursor: 'pointer' }}
            >
              <div className={styles.summaryCardTop}>
                <span className={styles.summaryLabel}>{t('customers.walkinTotalRepairs', 'Total Walk-in Repairs')}</span>
                <div className={[styles.summaryIconWrap, styles.iconTotal].join(' ')}>
                  <Wrench size={16} />
                </div>
              </div>
              <p className={styles.summaryValue}>{walkInMetrics.total}</p>
              <p className={styles.summarySub}>{t('customers.walkinNoPhoneSub', 'Repairs without phone number')}</p>
            </div>

            <div
              className={[
                styles.summaryCard,
                walkInStatusFilter === 'active' && styles.summaryCardActive
              ].filter(Boolean).join(' ')}
              onClick={() => { setWalkInStatusFilter('active'); setWalkInPage(1); }}
              title="Click to filter active repairs in workshop"
              style={{ cursor: 'pointer' }}
            >
              <div className={styles.summaryCardTop}>
                <span className={styles.summaryLabel}>{t('customers.activeInWorkshop', 'Active in Workshop')}</span>
                <div className={[styles.summaryIconWrap, styles.iconRepeat].join(' ')}>
                  <Clock size={16} />
                </div>
              </div>
              <p className={styles.summaryValue}>{walkInMetrics.active}</p>
              <p className={styles.summarySub}>
                {walkInMetrics.inProgress} in progress · {walkInMetrics.ready} ready
              </p>
            </div>

            <div
              className={[
                styles.summaryCard,
                walkInStatusFilter === 'completed' && styles.summaryCardActive
              ].filter(Boolean).join(' ')}
              onClick={() => { setWalkInStatusFilter('completed'); setWalkInPage(1); }}
              title="Click to filter completed repairs"
              style={{ cursor: 'pointer' }}
            >
              <div className={styles.summaryCardTop}>
                <span className={styles.summaryLabel}>{t('customers.completedPickedUp', 'Completed & Picked Up')}</span>
                <div className={[styles.summaryIconWrap, styles.iconNew].join(' ')}>
                  <CheckCircle2 size={16} />
                </div>
              </div>
              <p className={styles.summaryValue}>{walkInMetrics.completed}</p>
              <p className={styles.summarySub}>{t('customers.pickedUpByWalkIn', 'Picked up by walk-in clients')}</p>
            </div>

            <div className={styles.summaryCard} style={{ cursor: 'default' }}>
              <div className={styles.summaryCardTop}>
                <span className={styles.summaryLabel}>{t('customers.totalBilled', 'Total Billed')}</span>
                <div className={[styles.summaryIconWrap, styles.iconLtv].join(' ')}>
                  <DollarSign size={16} />
                </div>
              </div>
              <p className={styles.summaryValue}>
                {formatPrivateCurrency(walkInMetrics.totalBilled)}
              </p>
              <p className={styles.summarySub}>
                {formatPrivateCurrency(walkInMetrics.totalPaid)} {t('customers.collected', 'collected')}
                {walkInMetrics.unpaidBalance > 0 && ` · ${formatPrivateCurrency(walkInMetrics.unpaidBalance)} ${t('customers.due', 'due')}`}
              </p>
            </div>
          </div>
    </>
  );
};
