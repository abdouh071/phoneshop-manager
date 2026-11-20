import React from 'react';
import { Calendar, TrendingUp, Filter, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import type { MainTab, SubFilterClickHandler } from './reportTypes';
import { MONTH_NAMES } from './reportUtils';
import styles from './Reports.module.css';

interface TimeframeFilterBarProps {
  mainTab: MainTab;
  activeSubFilter: string;
  specificDate: string;
  customStart: string;
  customEnd: string;
  selectedYear: number;
  selectedMonth: number;
  yearOptions: number[];
  startDayName: string;
  handleMainTabChange: (tab: MainTab) => void;
  handleSubFilterClick: SubFilterClickHandler;
  setSpecificDate: (value: string) => void;
  setCustomStart: (value: string) => void;
  setCustomEnd: (value: string) => void;
  setSelectedYear: (value: number) => void;
  setSelectedMonth: (value: number) => void;
}

export const TimeframeFilterBar: React.FC<TimeframeFilterBarProps> = ({
  mainTab,
  activeSubFilter,
  specificDate,
  customStart,
  customEnd,
  selectedYear,
  selectedMonth,
  yearOptions,
  startDayName,
  handleMainTabChange,
  handleSubFilterClick,
  setSpecificDate,
  setCustomStart,
  setCustomEnd,
  setSelectedYear,
  setSelectedMonth,
}) => {
  const { t } = useTranslation();

  // Quick-access pills: single-click jump to any period
  const quickPills: { label: string; tab: MainTab; filter: string }[] = [
    { label: 'Today',       tab: 'daily',   filter: 'today' },
    { label: 'Yesterday',   tab: 'daily',   filter: 'yesterday' },
    { label: 'This Week',   tab: 'weekly',  filter: 'this_week' },
    { label: 'Last 7 Days', tab: 'weekly',  filter: 'last_7_days' },
    { label: 'This Month',  tab: 'monthly', filter: 'this_month' },
    { label: 'Last Month',  tab: 'monthly', filter: 'last_month' },
    { label: 'This Year',   tab: 'yearly',  filter: 'year_to_date' },
  ];

  return (
    <div className={styles.filterContainer}>

      {/* ── Quick-access pills ──────────────────────────────── */}
      <div className={styles.quickPillsRow}>
        {quickPills.map(pill => {
          const isActive = activeSubFilter === pill.filter;
          return (
            <button
              key={pill.filter}
              type="button"
              className={[styles.quickPill, isActive && styles.quickPillActive].filter(Boolean).join(' ')}
              onClick={() => {
                handleMainTabChange(pill.tab);
                // The mainTab change triggers its default sub-filter, then we override
                setTimeout(() => handleSubFilterClick(pill.filter), 0);
              }}
            >
              {pill.label}
            </button>
          );
        })}
        <span className={styles.quickPillDivider} />
        <button
          type="button"
          className={[styles.quickPill, mainTab === 'custom' && styles.quickPillActive].filter(Boolean).join(' ')}
          onClick={() => handleMainTabChange('custom')}
        >
          <Filter size={11} /> Custom
        </button>
      </div>

      {/* ── Period tabs + sub-filters ───────────────────────── */}
      <div className={styles.mainTabs}>
        {(['daily', 'weekly', 'monthly', 'yearly', 'custom'] as MainTab[]).map(tab => {
          const icons: Record<MainTab, React.ReactNode> = {
            daily:   <Calendar size={13} />,
            weekly:  <Calendar size={13} />,
            monthly: <Calendar size={13} />,
            yearly:  <TrendingUp size={13} />,
            custom:  <Filter size={13} />,
          };
          const labels: Record<MainTab, string> = {
            daily:   t('reports.daily', 'Daily'),
            weekly:  t('reports.weekly', 'Weekly'),
            monthly: t('reports.monthly', 'Monthly'),
            yearly:  t('reports.yearly', 'Yearly'),
            custom:  t('reports.custom', 'Custom'),
          };
          return (
            <button
              key={tab}
              className={[styles.mainTabBtn, mainTab === tab && styles.mainTabActive].filter(Boolean).join(' ')}
              onClick={() => handleMainTabChange(tab)}
            >
              {icons[tab]} {labels[tab]}
            </button>
          );
        })}
      </div>

      {/* ── Sub-filters per active tab ──────────────────────── */}
      <div className={styles.subFiltersBar}>
        {mainTab === 'daily' && (
          <>
            <button
              className={[styles.subFilterBtn, activeSubFilter === 'today' && styles.subFilterActive].filter(Boolean).join(' ')}
              onClick={() => handleSubFilterClick('today')}
            >
              {t('reports.today', 'Today')}
            </button>
            <button
              className={[styles.subFilterBtn, activeSubFilter === 'yesterday' && styles.subFilterActive].filter(Boolean).join(' ')}
              onClick={() => handleSubFilterClick('yesterday')}
            >
              {t('reports.yesterday', 'Yesterday')}
            </button>
            <ChevronRight size={12} style={{ color: 'var(--color-outline-variant)' }} />
            <div className={styles.customDateInputs}>
              <span>Specific Date:</span>
              <input
                type="date"
                className={styles.dateInput}
                value={specificDate}
                onChange={e => {
                  setSpecificDate(e.target.value);
                  handleSubFilterClick('specific_day', { specificDate: e.target.value });
                }}
              />
            </div>
          </>
        )}

        {mainTab === 'weekly' && (
          <>
            <button
              className={[styles.subFilterBtn, activeSubFilter === 'this_week' && styles.subFilterActive].filter(Boolean).join(' ')}
              onClick={() => handleSubFilterClick('this_week')}
            >
              {t('reports.thisWeek', 'This Week')} ({startDayName}–{t('reports.today', 'Today')})
            </button>
            <button
              className={[styles.subFilterBtn, activeSubFilter === 'last_7_days' && styles.subFilterActive].filter(Boolean).join(' ')}
              onClick={() => handleSubFilterClick('last_7_days')}
            >
              {t('reports.last7Days', 'Last 7 Days')}
            </button>
            <button
              className={[styles.subFilterBtn, activeSubFilter === 'last_week' && styles.subFilterActive].filter(Boolean).join(' ')}
              onClick={() => handleSubFilterClick('last_week')}
            >
              {t('reports.lastWeek', 'Last Full Week')}
            </button>
          </>
        )}

        {mainTab === 'monthly' && (
          <>
            <button
              className={[styles.subFilterBtn, activeSubFilter === 'this_month' && styles.subFilterActive].filter(Boolean).join(' ')}
              onClick={() => handleSubFilterClick('this_month')}
            >
              {t('reports.thisMonth', 'This Month')}
            </button>
            <button
              className={[styles.subFilterBtn, activeSubFilter === 'last_month' && styles.subFilterActive].filter(Boolean).join(' ')}
              onClick={() => handleSubFilterClick('last_month')}
            >
              {t('reports.lastMonth', 'Last Month')}
            </button>
            <ChevronRight size={12} style={{ color: 'var(--color-outline-variant)' }} />
            <div className={styles.customDateInputs}>
              <span>Month:</span>
              <select
                className={styles.dateInput}
                value={selectedMonth}
                onChange={e => {
                  const m = Number(e.target.value);
                  setSelectedMonth(m);
                  handleSubFilterClick('specific_month', { selectedYear, selectedMonth: m });
                }}
              >
                {MONTH_NAMES.map((name, idx) => (
                  <option key={idx} value={idx}>{name}</option>
                ))}
              </select>
              <select
                className={styles.dateInput}
                value={selectedYear}
                onChange={e => {
                  const yr = Number(e.target.value);
                  setSelectedYear(yr);
                  handleSubFilterClick('specific_month', { selectedYear: yr, selectedMonth });
                }}
              >
                {yearOptions.map(yr => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
            </div>
          </>
        )}

        {mainTab === 'yearly' && (
          <>
            <button
              className={[styles.subFilterBtn, activeSubFilter === 'year_to_date' && styles.subFilterActive].filter(Boolean).join(' ')}
              onClick={() => handleSubFilterClick('year_to_date')}
            >
              {t('reports.yearToDate', 'Year to Date')} ({new Date().getFullYear()})
            </button>
            <button
              className={[styles.subFilterBtn, activeSubFilter === 'full_year' && styles.subFilterActive].filter(Boolean).join(' ')}
              onClick={() => handleSubFilterClick('full_year', { selectedYear })}
            >
              {t('reports.fullYear', 'Full Year')}
            </button>
            <ChevronRight size={12} style={{ color: 'var(--color-outline-variant)' }} />
            <div className={styles.customDateInputs}>
              <span>Year:</span>
              <select
                className={styles.dateInput}
                value={selectedYear}
                onChange={e => {
                  const yr = Number(e.target.value);
                  setSelectedYear(yr);
                  handleSubFilterClick('full_year', { selectedYear: yr });
                }}
              >
                {yearOptions.map(yr => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
            </div>
          </>
        )}

        {mainTab === 'custom' && (
          <div className={styles.customDateInputs}>
            <span>From:</span>
            <input
              type="date"
              className={styles.dateInput}
              value={customStart}
              onChange={e => setCustomStart(e.target.value)}
            />
            <span>To:</span>
            <input
              type="date"
              className={styles.dateInput}
              value={customEnd}
              onChange={e => setCustomEnd(e.target.value)}
            />
            <Button
              size="sm"
              onClick={() => handleSubFilterClick('custom', { customStartDate: customStart, customEndDate: customEnd })}
            >
              Apply
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
