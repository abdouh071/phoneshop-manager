import React from 'react';
import inputStyles from './Input.module.css';
import styles from './Textarea.module.css';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  rows?: number;
}

export const Textarea: React.FC<TextareaProps> = ({
  label,
  error,
  id,
  rows = 4,
  className,
  autoCorrect = 'off',
  spellCheck = false,
  autoCapitalize = 'off',
  ...rest
}) => {
  const textareaId = id || label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className={inputStyles.wrapper}>
      {label && <label className={inputStyles.label} htmlFor={textareaId}>{label}</label>}
      <textarea
        id={textareaId}
        rows={rows}
        className={[styles.textarea, error && inputStyles.hasError, className].filter(Boolean).join(' ')}
        autoCorrect={autoCorrect}
        spellCheck={spellCheck}
        autoCapitalize={autoCapitalize}
        {...rest}
      />
      {error && <p className={inputStyles.error}>{error}</p>}
    </div>
  );
};
