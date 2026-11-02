import React from 'react';
import { Calendar, TrendingUp, Filter } from 'lucide-react';
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

  return (
    <div className={styles.filterContainer}>
      <div className={styles.mainTabs}>
        <button
          className={[styles.mainTabBtn, mainTab === 'daily' && styles.mainTabActive].filter(Boolean).join(' ')}
          onClick={() => handleMainTabChange('daily')}
        >
          <Calendar size={14} /> {t('reports.daily', 'Daily')}
        </button>
        <button
          className={[styles.mainTabBtn, mainTab === 'weekly' && styles.mainTabActive].filter(Boolean).join(' ')}
          onClick={() => handleMainTabChange('weekly')}
        >
          <Calendar size={14} /> {t('reports.weekly', 'Weekly')}
        </button>
        <button
          className={[styles.mainTabBtn, mainTab === 'monthly' && styles.mainTabActive].filter(Boolean).join(' ')}
          onClick={() => handleMainTabChange('monthly')}
        >
          <Calendar size={14} /> {t('reports.monthly', 'Monthly')}
        </button>
        <button
          className={[styles.mainTabBtn, mainTab === 'yearly' && styles.mainTabActive].filter(Boolean).join(' ')}
          onClick={() => handleMainTabChange('yearly')}
        >
          <TrendingUp size={14} /> {t('reports.yearly', 'Yearly')}
        </button>
        <button
          className={[styles.mainTabBtn, mainTab === 'custom' && styles.mainTabActive].filter(Boolean).join(' ')}
          onClick={() => handleMainTabChange('custom')}
        >
          <Filter size={14} /> {t('reports.custom', 'Custom Range')}
        </button>
      </div>

      {/* Sub-Filters Toolbar */}
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
              {t('reports.thisWeek', 'This Week')} ({startDayName} - {t('reports.today', 'Today')})
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
            <div className={styles.customDateInputs}>
              <span>Select Year:</span>
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
              Apply Range
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
