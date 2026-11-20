import React from 'react';
import { Search, X } from 'lucide-react';
import styles from './Input.module.css';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  error?: string;
  leftIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, leftIcon, id, className, autoCorrect = 'off', spellCheck = false, autoCapitalize = 'off', ...rest }, ref) => {
    const inputId = id || (typeof label === 'string' ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    return (
      <div className={[styles.wrapper, className].filter(Boolean).join(' ')}>
        {label && <label className={styles.label} htmlFor={inputId}>{label}</label>}
        <div className={styles.inputWrapper}>
          {leftIcon && <span className={styles.leftIcon}>{leftIcon}</span>}
          <input
            ref={ref}
            id={inputId}
            className={[styles.input, leftIcon && styles.hasIcon, error && styles.hasError].filter(Boolean).join(' ')}
            autoCorrect={autoCorrect}
            spellCheck={spellCheck}
            autoCapitalize={autoCapitalize}
            {...rest}
          />
        </div>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';

interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  /** Called when the user clicks the × clear button. If omitted, no clear button is shown. */
  onClear?: () => void;
  placeholder?: string;
  className?: string;
}

export const SearchInput: React.FC<SearchInputProps> = ({ value, onChange, onClear, placeholder = 'Search…', className, ...rest }) => (
  <div className={[styles.searchWrapper, className].filter(Boolean).join(' ')}>
    <Input
      type="search"
      leftIcon={<Search size={16} />}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      data-search-input="true"
      className={value && onClear ? styles.hasClearBtn : undefined}
      {...rest}
    />
    {value && onClear && (
      <button
        type="button"
        className={styles.clearBtn}
        onClick={onClear}
        aria-label="Clear search"
        tabIndex={-1}
      >
        <X size={14} />
      </button>
    )}
  </div>
);

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  rows?: number;
}

export const TextArea: React.FC<TextAreaProps> = ({ label, error, id, className, rows = 3, autoCorrect = 'off', spellCheck = false, autoCapitalize = 'off', ...rest }) => {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className={[styles.wrapper, className].filter(Boolean).join(' ')}>
      {label && <label className={styles.label} htmlFor={inputId}>{label}</label>}
      <textarea
        id={inputId}
        rows={rows}
        className={[styles.textarea, error && styles.hasError].filter(Boolean).join(' ')}
        autoCorrect={autoCorrect}
        spellCheck={spellCheck}
        autoCapitalize={autoCapitalize}
        {...rest}
      />
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
};
