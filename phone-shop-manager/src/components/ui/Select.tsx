import React from 'react';
import { ChevronDown } from 'lucide-react';
import styles from './Select.module.css';

interface SelectOption {
  value: string;
  label: string;
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
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <span className={styles.chevron}><ChevronDown size={16} /></span>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
};
