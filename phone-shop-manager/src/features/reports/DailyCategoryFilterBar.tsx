import React from 'react';
import type { DailyCategoryFilter } from './reportTypes';

interface DailyCategoryFilterBarProps {
  dailyCategoryFilter: DailyCategoryFilter;
  setDailyCategoryFilter: (value: DailyCategoryFilter) => void;
}

export const DailyCategoryFilterBar: React.FC<DailyCategoryFilterBarProps> = ({
  dailyCategoryFilter,
  setDailyCategoryFilter,
}) => {
  return (
    <div style={{ display: 'flex', gap: '4px', background: 'var(--color-surface-container, #e2e8f0)', padding: '2px', borderRadius: '8px' }}>
      <button
        type="button"
        style={{
          padding: '4px 10px',
          fontSize: '11.5px',
          fontWeight: 600,
          borderRadius: '6px',
          border: 'none',
          cursor: 'pointer',
          background: dailyCategoryFilter === 'all' ? '#ffffff' : 'transparent',
          color: dailyCategoryFilter === 'all' ? 'var(--color-primary, #4f46e5)' : 'var(--color-on-surface-variant)',
          boxShadow: dailyCategoryFilter === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
        }}
        onClick={() => setDailyCategoryFilter('all')}
      >
        All Streams
      </button>
      <button
        type="button"
        style={{
          padding: '4px 10px',
          fontSize: '11.5px',
          fontWeight: 600,
          borderRadius: '6px',
          border: 'none',
          cursor: 'pointer',
          background: dailyCategoryFilter === 'pos' ? '#ffffff' : 'transparent',
          color: dailyCategoryFilter === 'pos' ? 'var(--color-primary, #4f46e5)' : 'var(--color-on-surface-variant)',
          boxShadow: dailyCategoryFilter === 'pos' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
        }}
        onClick={() => setDailyCategoryFilter('pos')}
      >
        POS Sales Only
      </button>
      <button
        type="button"
        style={{
          padding: '4px 10px',
          fontSize: '11.5px',
          fontWeight: 600,
          borderRadius: '6px',
          border: 'none',
          cursor: 'pointer',
          background: dailyCategoryFilter === 'repairs' ? '#ffffff' : 'transparent',
          color: dailyCategoryFilter === 'repairs' ? 'var(--color-primary, #4f46e5)' : 'var(--color-on-surface-variant)',
          boxShadow: dailyCategoryFilter === 'repairs' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
        }}
        onClick={() => setDailyCategoryFilter('repairs')}
      >
        Repairs Only
      </button>
      <button
        type="button"
        style={{
          padding: '4px 10px',
          fontSize: '11.5px',
          fontWeight: 600,
          borderRadius: '6px',
          border: 'none',
          cursor: 'pointer',
          background: dailyCategoryFilter === 'parts' ? '#ffffff' : 'transparent',
          color: dailyCategoryFilter === 'parts' ? 'var(--color-primary, #4f46e5)' : 'var(--color-on-surface-variant)',
          boxShadow: dailyCategoryFilter === 'parts' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
        }}
        onClick={() => setDailyCategoryFilter('parts')}
      >
        Parts B2B Only
      </button>
    </div>
  );
};
