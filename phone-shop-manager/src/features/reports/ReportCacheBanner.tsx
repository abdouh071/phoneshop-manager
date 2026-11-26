import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import type { ReportData, ReportSourceName } from '../../services/reportsService';

const SOURCE_LABELS: Record<ReportSourceName, string> = {
  sales: 'Sales',
  repairs: 'Repairs',
  inventory: 'Inventory',
  eod: 'End-of-Day Closings',
  debts: 'Customer Debts',
};

interface ReportCacheBannerProps {
  data: Pick<ReportData, 'isCached' | 'isIncomplete' | 'cachedSources' | 'incompleteSources'>;
  onRetry?: () => void;
}

export const ReportCacheBanner: React.FC<ReportCacheBannerProps> = ({ data, onRetry }) => {
  if (!data.isCached && !data.isIncomplete) return null;

  const incompleteList = (data.incompleteSources || []).map(s => SOURCE_LABELS[s] || s).join(', ');
  const cachedList = (data.cachedSources || []).map(s => SOURCE_LABELS[s] || s).join(', ');

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '12px 16px',
        marginBottom: '16px',
        borderRadius: '10px',
        border: `1px solid ${data.isIncomplete ? '#ef4444' : '#f59e0b'}`,
        backgroundColor: data.isIncomplete ? '#fef2f2' : '#fffbeb',
        color: data.isIncomplete ? '#991b1b' : '#92400e',
        fontSize: '13px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <AlertTriangle size={18} aria-hidden="true" />
        <div>
          {data.isIncomplete ? (
            <strong>Incomplete Report Data: </strong>
          ) : (
            <strong>Cached Report Data: </strong>
          )}
          <span>
            {data.isIncomplete
              ? `Could not load live or cached records for ${incompleteList || 'some collections'}.`
              : `Showing locally cached records${cachedList ? ` for ${cachedList}` : ''}. Totals may omit recent changes from other terminals.`}
          </span>
        </div>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" leftIcon={<RefreshCw size={14} />} onClick={onRetry}>
          Retry Live Sync
        </Button>
      )}
    </div>
  );
};
