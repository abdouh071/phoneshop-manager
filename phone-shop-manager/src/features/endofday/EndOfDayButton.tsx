import React, { useState, useEffect } from 'react';
import { Moon, CheckCircle2 } from 'lucide-react';
import { useEndOfDayStore } from '../../store/endOfDayStore';
import { EndOfDayModal } from './EndOfDayModal';

interface Props {
  /** Visual variant */
  variant?: 'button' | 'widget' | 'compact';
}

/**
 * EOD trigger button — drop this anywhere you need it (Drawer, POS, Repairs, Dashboard).
 */
export const EndOfDayButton: React.FC<Props> = ({ variant = 'button' }) => {
  const { checkTodayRecord, todayRecord } = useEndOfDayStore();
  const [open, setOpen] = useState(false);

  // On mount: check if today already has a record
  useEffect(() => {
    checkTodayRecord();
  }, [checkTodayRecord]);

  const alreadyClosed = !!todayRecord;

  if (variant === 'compact') {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={alreadyClosed ? 'View today\'s End of Day Report' : 'Close the day & lock today\'s report'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '5px 11px',
            borderRadius: '7px',
            border: `1px solid ${alreadyClosed ? '#bbf7d0' : '#c7d2fe'}`,
            background: alreadyClosed ? '#f0fdf4' : '#eef2ff',
            color: alreadyClosed ? '#15803d' : '#4338ca',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          {alreadyClosed ? <CheckCircle2 size={13} /> : <Moon size={13} />}
          {alreadyClosed ? 'Day Closed' : 'End of Day'}
        </button>
        <EndOfDayModal isOpen={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  if (variant === 'widget') {
    return (
      <>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: alreadyClosed
              ? 'linear-gradient(135deg,#f0fdf4,#dcfce7)'
              : 'linear-gradient(135deg,#1e1b4b,#312e81)',
            borderRadius: '12px',
            padding: '14px 16px',
            gap: '12px',
            cursor: 'pointer',
            boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onClick={() => setOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && setOpen(true)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: 38, height: 38, borderRadius: '50%',
              background: alreadyClosed ? '#bbf7d0' : 'rgba(255,255,255,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: alreadyClosed ? '#15803d' : '#fff',
            }}>
              {alreadyClosed ? <CheckCircle2 size={20} /> : <Moon size={20} />}
            </div>
            <div>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: alreadyClosed ? '#14532d' : '#fff' }}>
                {alreadyClosed ? '✓ Day Closed' : 'End of Day'}
              </p>
              <p style={{ margin: 0, fontSize: '11px', color: alreadyClosed ? '#16a34a' : 'rgba(255,255,255,0.7)' }}>
                {alreadyClosed
                  ? `Closed at ${new Date(todayRecord!.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'Click to close & lock today\'s report'}
              </p>
            </div>
          </div>
          <span style={{ fontSize: '11px', fontWeight: 600, color: alreadyClosed ? '#16a34a' : 'rgba(255,255,255,0.8)', textDecoration: 'underline' }}>
            {alreadyClosed ? 'View Report →' : 'Close Now →'}
          </span>
        </div>
        <EndOfDayModal isOpen={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  // Default: button
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '7px',
          padding: '8px 16px',
          borderRadius: '9px',
          border: 'none',
          background: alreadyClosed
            ? 'linear-gradient(135deg,#16a34a,#15803d)'
            : 'linear-gradient(135deg,#1e1b4b,#4338ca)',
          color: '#fff',
          fontSize: '13px',
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          transition: 'opacity 0.15s, transform 0.1s',
        }}
        onMouseOver={e => (e.currentTarget.style.opacity = '0.9')}
        onMouseOut={e => (e.currentTarget.style.opacity = '1')}
      >
        {alreadyClosed ? <CheckCircle2 size={15} /> : <Moon size={15} />}
        {alreadyClosed ? 'View Day Report' : 'End of Day'}
      </button>
      <EndOfDayModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
};
