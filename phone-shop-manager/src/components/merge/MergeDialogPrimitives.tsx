import React from 'react';
import { GitMerge } from 'lucide-react';
import { Button } from '../ui/Button';
import styles from './MergeDialog.module.css';

export interface MergeSelectOption {
  id: string;
  disabled?: boolean;
  label: React.ReactNode;
}

export interface MergePairOption {
  key: string;
  label: React.ReactNode;
}

export interface MergeSummaryItem {
  label: React.ReactNode;
  value: React.ReactNode;
  valueStyle?: React.CSSProperties;
}

export const MergeBanner: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className={styles.banner}>
    <GitMerge size={22} className={styles.bannerIcon} />
    <p className={styles.bannerText}>{children}</p>
  </div>
);

export const DetectedPairsBar: React.FC<{
  title: React.ReactNode;
  count: number;
  matchHint: React.ReactNode;
  manualSelectLabel: React.ReactNode;
  pairs: MergePairOption[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  batchLabel: React.ReactNode;
  onBatch: () => void;
  isBusy: boolean;
}> = ({ title, count, matchHint, manualSelectLabel, pairs, selectedIndex, onSelect, batchLabel, onBatch, isBusy }) => (
  <div className={styles.duplicateSelectorBar}>
    <div className={styles.duplicateBarHeader}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontWeight: 600 }}>⚡ {title} ({count})</span>
        <span style={{ fontSize: '11px', color: '#a16207' }}>{matchHint}</span>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onBatch}
        isLoading={isBusy}
        style={{
          fontSize: '11px',
          padding: '4px 10px',
          borderColor: '#ca8a04',
          color: '#854d0e',
          background: '#fefce8',
          fontWeight: 600,
        }}
      >
        ⚡ {batchLabel}
      </Button>
    </div>
    <select
      className={styles.duplicateSelect}
      value={selectedIndex}
      onChange={(e) => onSelect(Number(e.target.value))}
    >
      <option value={-1}>-- {manualSelectLabel} --</option>
      {pairs.map((pair, idx) => (
        <option key={pair.key} value={idx}>{pair.label}</option>
      ))}
    </select>
  </div>
);

export const EntitySelect: React.FC<{
  label: React.ReactNode;
  value: string;
  options: MergeSelectOption[];
  onChange: (id: string) => void;
  stopCardClick?: boolean;
}> = ({ label, value, options, onChange, stopCardClick }) => (
  <div
    className={styles.searchSelectWrap}
    onClick={stopCardClick ? (e => e.stopPropagation()) : undefined}
  >
    <label className={styles.selectLabel}>{label}:</label>
    <select
      style={{
        width: '100%',
        padding: '6px 10px',
        borderRadius: '6px',
        border: '1px solid #cbd5e1',
        fontSize: '13px',
        background: '#ffffff',
      }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map(opt => (
        <option key={opt.id} value={opt.id} disabled={opt.disabled}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);

export const PairComparisonGrid: React.FC<{
  left: React.ReactNode;
  right: React.ReactNode;
  leftActive?: boolean;
  rightActive?: boolean;
  onLeftCardClick?: () => void;
  onRightCardClick?: () => void;
}> = ({ left, right, leftActive, rightActive, onLeftCardClick, onRightCardClick }) => (
  <div className={styles.comparisonGrid}>
    <div
      className={[styles.accountCard, leftActive && styles.accountCardActive].filter(Boolean).join(' ')}
      onClick={onLeftCardClick}
      style={onLeftCardClick ? { cursor: 'pointer' } : undefined}
    >
      {left}
    </div>

    <div className={styles.mergeArrowWrap}>
      <div style={{
        background: '#e2e8f0',
        borderRadius: '50%',
        width: '36px',
        height: '36px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#475569',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}>
        <GitMerge size={18} />
      </div>
    </div>

    <div
      className={[styles.accountCard, rightActive && styles.accountCardActive].filter(Boolean).join(' ')}
      onClick={onRightCardClick}
      style={onRightCardClick ? { cursor: 'pointer' } : undefined}
    >
      {right}
    </div>
  </div>
);

export const MergeSummaryBox: React.FC<{
  title: React.ReactNode;
  items: MergeSummaryItem[];
  footnoteIcon?: React.ReactNode;
  footnote?: React.ReactNode;
}> = ({ title, items, footnoteIcon, footnote }) => (
  <div className={styles.summaryBox}>
    <span className={styles.summaryTitle}>{title}</span>
    <div className={styles.summaryGrid}>
      {items.map((item, idx) => (
        <div key={idx} className={styles.summaryItem}>
          <span className={styles.summaryItemLabel}>{item.label}</span>
          <span className={styles.summaryItemValue} style={item.valueStyle}>{item.value}</span>
        </div>
      ))}
    </div>
    {footnote && (
      <p style={{ margin: 0, fontSize: '12px', color: '#92400e', display: 'flex', alignItems: 'center', gap: '6px' }}>
        {footnoteIcon}
        {footnote}
      </p>
    )}
  </div>
);

export const MergeFooter: React.FC<{
  batchLabel?: React.ReactNode;
  onBatch?: () => void;
  cancelLabel: React.ReactNode;
  confirmLabel: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}> = ({ batchLabel, onBatch, cancelLabel, confirmLabel, onConfirm, onCancel, isSubmitting }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
    <div>
      {batchLabel && (
        <Button
          variant="outline"
          size="sm"
          onClick={onBatch}
          isLoading={isSubmitting}
          style={{
            borderColor: '#ca8a04',
            color: '#854d0e',
            background: '#fefce8',
            fontWeight: 600,
          }}
        >
          ⚡ {batchLabel}
        </Button>
      )}
    </div>
    <div style={{ display: 'flex', gap: '8px' }}>
      <Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>
        {cancelLabel}
      </Button>
      <Button
        variant="primary"
        onClick={onConfirm}
        isLoading={isSubmitting}
        leftIcon={<GitMerge size={16} />}
      >
        {confirmLabel}
      </Button>
    </div>
  </div>
);
