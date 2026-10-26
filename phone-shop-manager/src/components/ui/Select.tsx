import React from 'react';
import { ChevronDown } from 'lucide-react';
import styles from './Select.module.css';

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
}

interface SelectProps {
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  id?: string;
}

export const Select: React.FC<SelectProps> = ({
  label,
  options,
  value,
  onChange,
  placeholder,
  error,
  disabled,
  id,
}) => {
  const selectId = id || label?.toLowerCase().replace(/\s+/g, '-');
  const hasGroups = options.some(opt => Boolean(opt.group));

  return (
    <div className={styles.wrapper}>
      {label && <label className={styles.label} htmlFor={selectId}>{label}</label>}
      <div className={styles.selectWrapper}>
        <select
          id={selectId}
          className={[styles.select, error && styles.hasError].filter(Boolean).join(' ')}
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
        >
          {placeholder && <option value="" disabled>{placeholder}</option>}
          {hasGroups ? (
            (() => {
              const groups: { name: string; items: SelectOption[] }[] = [];
              const ungrouped: SelectOption[] = [];
              const groupMap = new Map<string, SelectOption[]>();

              for (const opt of options) {
                if (opt.group) {
                  if (!groupMap.has(opt.group)) {
                    const items: SelectOption[] = [];
                    groupMap.set(opt.group, items);
                    groups.push({ name: opt.group, items });
                  }
                  groupMap.get(opt.group)!.push(opt);
                } else {
                  ungrouped.push(opt);
                }
              }

              return (
                <>
                  {ungrouped.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                  {groups.map(grp => (
                    <optgroup key={grp.name} label={grp.name}>
                      {grp.items.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </>
              );
            })()
          ) : (
            options.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))
          )}
        </select>
        <span className={styles.chevron}><ChevronDown size={16} /></span>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
};
