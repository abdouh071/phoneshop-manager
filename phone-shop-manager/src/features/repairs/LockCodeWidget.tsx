import React, { useState, useRef, useCallback } from 'react';
import { Lock, Key, Hash, Eye, EyeOff, RotateCcw, Copy, Check, Grid, ShieldAlert } from 'lucide-react';
import styles from './LockCodeWidget.module.css';

// 3x3 Grid point definition (dots 1 to 9)
// (x, y) coordinates on a 210 x 210 SVG viewBox
const DOT_COORDINATES: Record<number, { x: number; y: number }> = {
  1: { x: 35,  y: 35 },
  2: { x: 105, y: 35 },
  3: { x: 175, y: 35 },
  4: { x: 35,  y: 105 },
  5: { x: 105, y: 105 },
  6: { x: 175, y: 105 },
  7: { x: 35,  y: 175 },
  8: { x: 105, y: 175 },
  9: { x: 175, y: 175 },
};

/**
 * Parses pattern string like "1-2-5-8-9" or "12589" into number array [1, 2, 5, 8, 9]
 */
export const parsePatternString = (val: string = ''): number[] => {
  if (!val) return [];
  if (val.includes('-')) {
    return val.split('-').map(Number).filter(n => n >= 1 && n <= 9);
  }
  return val.split('').map(Number).filter(n => n >= 1 && n <= 9);
};

export const formatPatternString = (dots: number[]): string => {
  return dots.join('-');
};

// ============================================================
// 1. 3x3 Android Pattern Lock Component (Interactive & Readonly)
// ============================================================
interface PatternLockProps {
  value: string; // e.g. "1-2-5-8-9"
  onChange?: (val: string) => void;
  readOnly?: boolean;
  size?: number;
}

export const PatternLock: React.FC<PatternLockProps> = ({
  value,
  onChange,
  readOnly = false,
  size = 210,
}) => {
  const sequence = parsePatternString(value);
  const [isDrawing, setIsDrawing] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const addDotToSequence = useCallback((dotNum: number) => {
    if (readOnly || !onChange) return;
    if (sequence.includes(dotNum)) return;
    const next = [...sequence, dotNum];
    onChange(formatPatternString(next));
  }, [sequence, readOnly, onChange]);

  const handlePointerDown = (dotNum: number) => {
    if (readOnly) return;
    setIsDrawing(true);
    if (!sequence.includes(dotNum)) {
      addDotToSequence(dotNum);
    }
  };

  const handlePointerEnter = (dotNum: number) => {
    if (readOnly || !isDrawing) return;
    if (!sequence.includes(dotNum)) {
      addDotToSequence(dotNum);
    }
  };

  const handlePointerUp = () => {
    setIsDrawing(false);
  };

  const clearPattern = () => {
    if (onChange) onChange('');
  };

  // Build SVG lines between points
  const lines = [];
  for (let i = 0; i < sequence.length - 1; i++) {
    const from = DOT_COORDINATES[sequence[i]];
    const to = DOT_COORDINATES[sequence[i + 1]];
    if (from && to) {
      lines.push(
        <line
          key={`line-${i}`}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          className={styles.patternLine}
        />
      );
    }
  }

  return (
    <div className={styles.patternContainer}>
      <svg
        ref={svgRef}
        viewBox="0 0 210 210"
        className={styles.patternSvg}
        style={{ width: size, height: size }}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Render Pattern Path Lines */}
        {lines}

        {/* Render 9 Dots */}
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => {
          const pt = DOT_COORDINATES[num];
          const seqIndex = sequence.indexOf(num);
          const isSelected = seqIndex !== -1;

          return (
            <g
              key={num}
              onPointerDown={() => handlePointerDown(num)}
              onPointerEnter={() => handlePointerEnter(num)}
              style={{ cursor: readOnly ? 'default' : 'pointer' }}
            >
              {/* Outer touch target */}
              <circle cx={pt.x} cy={pt.y} r={22} fill="transparent" />

              {/* Outer subtle halo ring if selected */}
              {isSelected && (
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={16}
                  fill="rgba(79, 70, 229, 0.15)"
                  stroke="#4f46e5"
                  strokeWidth={2}
                />
              )}

              {/* Inner Dot */}
              <circle
                cx={pt.x}
                cy={pt.y}
                r={isSelected ? 10 : 7}
                fill={isSelected ? '#4f46e5' : '#94a3b8'}
                className={[styles.patternDotCircle, isSelected && styles.patternDotActive].filter(Boolean).join(' ')}
              />

              {/* Step number badge (1, 2, 3...) inside dot */}
              {isSelected && (
                <text x={pt.x} y={pt.y} className={styles.patternOrderBadge}>
                  {seqIndex + 1}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Sequence Footer */}
      <div className={styles.patternFooter}>
        <span className={styles.patternSequenceText}>
          {sequence.length > 0 ? sequence.join(' ➔ ') : 'Draw pattern'}
        </span>
        {!readOnly && sequence.length > 0 && (
          <button type="button" className={styles.clearPatternBtn} onClick={clearPattern}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
};

// ============================================================
// 2. PIN / Passcode Component
// ============================================================
interface PinLockProps {
  value: string;
  onChange?: (val: string) => void;
  readOnly?: boolean;
}

export const PinLock: React.FC<PinLockProps> = ({ value, onChange, readOnly = false }) => {
  const [showPin, setShowPin] = useState(!readOnly);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const digits = value ? value.split('') : [];

  return (
    <div className={styles.pinContainer}>
      {readOnly ? (
        <>
          <div className={styles.pinDisplay}>
            {digits.length > 0 ? (
              digits.map((digit, idx) => (
                <div key={idx} className={[styles.pinDigitBox, styles.pinDigitBoxFilled].join(' ')}>
                  {showPin ? digit : '•'}
                </div>
              ))
            ) : (
              <span style={{ fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>No PIN set</span>
            )}
          </div>

          {digits.length > 0 && (
            <div className={styles.pinActionsRow}>
              <button
                type="button"
                className={styles.pinActionBtn}
                onClick={() => setShowPin(p => !p)}
              >
                {showPin ? <EyeOff size={13} /> : <Eye size={13} />}
                <span>{showPin ? 'Hide PIN' : 'Reveal PIN'}</span>
              </button>

              <button
                type="button"
                className={styles.pinActionBtn}
                onClick={handleCopy}
              >
                {copied ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          )}
        </>
      ) : (
        <div className={styles.pinInputWrapper}>
          <input
            type="text"
            value={value}
            onChange={e => onChange && onChange(e.target.value)}
            placeholder="e.g. 1234 or passcode"
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '10px',
              border: '1.5px solid var(--color-outline-variant, #cbd5e1)',
              fontSize: '16px',
              fontWeight: 700,
              textAlign: 'center',
              letterSpacing: '2px',
              fontFamily: 'monospace',
            }}
          />
        </div>
      )}
    </div>
  );
};

// ============================================================
// 3. Complete Lock Code Form Selector (For NewTicketModal)
// ============================================================
interface LockCodeInputProps {
  type: 'none' | 'pin' | 'pattern';
  value: string;
  onTypeChange: (type: 'none' | 'pin' | 'pattern') => void;
  onValueChange: (val: string) => void;
}

export const LockCodeInput: React.FC<LockCodeInputProps> = ({
  type,
  value,
  onTypeChange,
  onValueChange,
}) => {
  return (
    <div className={styles.wrapper}>
      {/* Type Tabs */}
      <div className={styles.typeTabs}>
        <button
          type="button"
          className={[styles.typeTab, type === 'none' && styles.typeTabActive].filter(Boolean).join(' ')}
          onClick={() => {
            onTypeChange('none');
            onValueChange('');
          }}
        >
          <span>No Lock</span>
        </button>

        <button
          type="button"
          className={[styles.typeTab, type === 'pin' && styles.typeTabActive].filter(Boolean).join(' ')}
          onClick={() => onTypeChange('pin')}
        >
          <Hash size={13} />
          <span>PIN / Passcode</span>
        </button>

        <button
          type="button"
          className={[styles.typeTab, type === 'pattern' && styles.typeTabActive].filter(Boolean).join(' ')}
          onClick={() => onTypeChange('pattern')}
        >
          <Grid size={13} />
          <span>3×3 Pattern Lock</span>
        </button>
      </div>

      {/* Dynamic Input widget based on mode */}
      {type === 'pin' && (
        <PinLock value={value} onChange={onValueChange} readOnly={false} />
      )}

      {type === 'pattern' && (
        <PatternLock value={value} onChange={onValueChange} readOnly={false} />
      )}
    </div>
  );
};

// ============================================================
// 4. Ticket Detail Lock Code Viewer Card (For TicketDetailPanel)
// ============================================================
interface LockCodeViewerProps {
  lockType?: 'none' | 'pin' | 'pattern' | 'password';
  lockValue?: string;
}

export const LockCodeViewer: React.FC<LockCodeViewerProps> = ({ lockType, lockValue }) => {
  if (!lockType || lockType === 'none' || !lockValue) {
    return (
      <div className={styles.detailLockCard}>
        <div className={styles.detailLockHeader}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Lock size={14} color="#94a3b8" />
            <span>Device Security</span>
          </span>
          <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>Swipe to unlock (No passcode)</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.detailLockCard}>
      <div className={styles.detailLockHeader}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Lock size={15} color="#4f46e5" />
          <span>Device Unlock Code</span>
        </span>
        <span className={styles.detailLockBadge}>
          {lockType === 'pattern' ? '3×3 Android Pattern' : 'Passcode PIN'}
        </span>
      </div>

      {lockType === 'pattern' && (
        <PatternLock value={lockValue} readOnly={true} size={190} />
      )}

      {(lockType === 'pin' || lockType === 'password') && (
        <PinLock value={lockValue} readOnly={true} />
      )}
    </div>
  );
};
