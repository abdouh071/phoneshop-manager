import React from 'react';
import { Calendar, Download } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import type { DailyIncomeDetail, ReportData } from '../../services/reportsService';
import type { EndOfDayRecord } from '../../services/endOfDayService';
import type { DailyCategoryFilter, MainTab } from './reportTypes';
import styles from './Reports.module.css';
import { DailyCategoryFilterBar } from './DailyCategoryFilterBar';
import { AnnualBreakdownTable } from './AnnualBreakdownTable';
import { DailyDetailView } from './DailyDetailView';
import { MultiDayIncomeTable } from './MultiDayIncomeTable';

interface DailyIncomeCardProps {
  data: ReportData;
  mainTab: MainTab;
  selectedYear: number;
  dailyCategoryFilter: DailyCategoryFilter;
  setDailyCategoryFilter: (value: DailyCategoryFilter) => void;
  handleExportDailyIncomeCSV: () => void;
  handlePrintThermalZReport: (day: DailyIncomeDetail) => Promise<void>;
  setSelectedEodRecord: (record: EndOfDayRecord | null) => void;
  setIsEodModalOpen: (open: boolean) => void;
}

export const DailyIncomeCard: React.FC<DailyIncomeCardProps> = ({
  data,
  mainTab,
  selectedYear,
  dailyCategoryFilter,
  setDailyCategoryFilter,
  handleExportDailyIncomeCSV,
  handlePrintThermalZReport,
  setSelectedEodRecord,
  setIsEodModalOpen,
}) => {
  return (
    <Card padding="none" className={styles.spanFull}>
      <div className={styles.cardHeaderWithAction}>
        <div>
          <h3 className={styles.cardTitle}>
            <Calendar size={18} /> Detailed Daily Income (POS, Repairs & Parts)
          </h3>
          <p style={{ margin: '3px 0 0 0', fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
            Breakdown by day respecting user End-of-Day closings & real verified cash
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <DailyCategoryFilterBar
            dailyCategoryFilter={dailyCategoryFilter}
            setDailyCategoryFilter={setDailyCategoryFilter}
          />

          <button
            type="button"
            className={styles.subFilterBtn}
            onClick={handleExportDailyIncomeCSV}
            title="Export Daily Income CSV"
          >
            <Download size={13} /> Export CSV
          </button>
        </div>
      </div>

      {/* If Main Tab is Yearly, show the 12-Month Calendar Performance Table first */}
      {mainTab === 'yearly' && data.monthlyBreakdown && data.monthlyBreakdown.length > 0 && (
        <AnnualBreakdownTable
          data={data}
          selectedYear={selectedYear}
          dailyCategoryFilter={dailyCategoryFilter}
        />
      )}

      {/* Daily View: Side-by-Side 3 Cards */}
      {mainTab === 'daily' && data.dailyIncomeDetails.length > 0 ? (
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {(() => {
            const day = data.dailyIncomeDetails[0];
            if (!day) return null;
            return (
              <DailyDetailView
                day={day}
                dailyCategoryFilter={dailyCategoryFilter}
                handlePrintThermalZReport={handlePrintThermalZReport}
                setSelectedEodRecord={setSelectedEodRecord}
                setIsEodModalOpen={setIsEodModalOpen}
              />
            );
          })()}
        </div>
      ) : (
        // ─── MULTI-DAY DETAILED TABLE (WEEKLY, MONTHLY, YEARLY, CUSTOM) ───
        <MultiDayIncomeTable
          data={data}
          dailyCategoryFilter={dailyCategoryFilter}
          setSelectedEodRecord={setSelectedEodRecord}
          setIsEodModalOpen={setIsEodModalOpen}
        />
      )}
    </Card>
  );
};
