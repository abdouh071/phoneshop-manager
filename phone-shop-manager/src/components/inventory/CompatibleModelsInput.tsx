import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

interface CompatibleModelsInputProps {
  models: string[];
  onChange: (models: string[]) => void;
  error?: string;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  addLabel?: string;
  maxEntries?: number;
}

/**
 * One input per compatible device: add with "+", edit in place, delete with ✕.
 * The last remaining row cannot be deleted so the list is never empty.
 */
export const CompatibleModelsInput: React.FC<CompatibleModelsInputProps> = ({
  models,
  onChange,
  error,
  disabled = false,
  label = 'Compatible Device(s)',
  placeholder = 'e.g. iPhone 13 Pro',
  addLabel = 'Add another device',
  maxEntries = 20,
}) => {
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  const setRow = (index: number, value: string) => {
    onChange(models.map((m, i) => (i === index ? value : m)));
  };

  const removeRow = (index: number) => {
    setFocusIndex(null);
    onChange(models.filter((_, i) => i !== index));
  };

  const addRow = () => {
    if (models.length >= maxEntries) return;
    onChange([...models, '']);
    setFocusIndex(models.length);
  };

  return (
    <div>
      <span
        style={{
          fontSize: '13px',
          fontWeight: 600,
          color: 'var(--color-on-surface)',
          display: 'block',
          marginBottom: '6px',
        }}
      >
        {label}
      </span>
      {models.map((value, i) => (
        <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', marginBottom: '6px' }}>
          <div style={{ flex: 1 }}>
            <Input
              placeholder={placeholder}
              value={value}
              onChange={(e) => setRow(i, e.target.value)}
              disabled={disabled}
              autoFocus={focusIndex === i}
            />
          </div>
          <Button
            variant="ghost"
            onClick={() => removeRow(i)}
            disabled={disabled || models.length <= 1}
            aria-label="Remove device"
            title="Remove device"
            style={{ padding: '0 8px', height: '42px', color: '#b91c1c', minWidth: '40px' }}
          >
            <X size={16} />
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        onClick={addRow}
        disabled={disabled || models.length >= maxEntries}
        style={{ fontSize: '12px', padding: '4px 12px' }}
      >
        + {addLabel}
      </Button>
      {error && (
        <span style={{ color: '#b91c1c', fontSize: '12px', display: 'block', marginTop: '6px' }}>{error}</span>
      )}
    </div>
  );
};
