import React, { useMemo, useState } from 'react';
import { useRepairStore } from '../../store/repairStore';
import { useSettingsStore } from '../../store/settingsStore';
import { ChevronDown, ChevronUp, Users, DollarSign, Package, TrendingUp, Percent } from 'lucide-react';
import styles from './TechnicianSettlements.module.css';

type DatePreset = 'today' | 'week' | 'month' | 'custom';

const getStartOfDay = (d: Date) => {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
};

const getStartOfWeek = (d: Date, startDay: number) => {
  const r = new Date(d);
  const day = r.getDay();
  const diffToStart = (day - startDay + 7) % 7;
  r.setDate(r.getDate() - diffToStart);
  r.setHours(0, 0, 0, 0);
  return r;
};

const getStartOfMonth = (d: Date) => {
  const r = new Date(d);
  r.setDate(1);
  r.setHours(0, 0, 0, 0);
  return r;
};

interface TechStats {
  name: string;
  tickets: any[];
  grossRevenue: number;
  totalPartsCost: number;
  netRevenue: number;
  techProfit: number;
}

export const TechnicianSettlementsTab: React.FC = () => {
  const { tickets } = useRepairStore();
  const settings = useSettingsStore();
  const percentage = settings.technicianProfitPercentage ?? 0;

  const [preset, setPreset] = useState<DatePreset>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [expandedTech, setExpandedTech] = useState<string | null>(null);

  // Date range
  const { rangeStart, rangeEnd } = useMemo(() => {
    const now = new Date();
    let start: Date;
    let end = new Date(now);
    end.setHours(23, 59, 59, 999);

    switch (preset) {
      case 'today':
        start = getStartOfDay(now);
        break;
      case 'week':
        start = getStartOfWeek(now, settings.weekStartDay ?? 0);
        break;
      case 'month':
        start = getStartOfMonth(now);
        break;
      case 'custom':
        start = customFrom ? getStartOfDay(new Date(customFrom)) : getStartOfDay(now);
        end = customTo ? new Date(new Date(customTo).setHours(23, 59, 59, 999)) : end;
        break;
      default:
        start = getStartOfDay(now);
    }

    return { rangeStart: start, rangeEnd: end };
  }, [preset, customFrom, customTo]);

  // Filter completed tickets in the date range
  const completedInRange = useMemo(() => {
    return tickets.filter(t => {
      if (t.status !== 'completed') return false;
      const completedDate = t.completedAt ? new Date(t.completedAt) : null;
      if (!completedDate) return false;
      return completedDate >= rangeStart && completedDate <= rangeEnd;
    });
  }, [tickets, rangeStart, rangeEnd]);

  // Group by technician & calculate stats
  const techData: TechStats[] = useMemo(() => {
    const grouped: Record<string, any[]> = {};

    completedInRange.forEach(t => {
      const techName = t.assignedTechnician || 'Unassigned';
      if (!grouped[techName]) grouped[techName] = [];
      grouped[techName].push(t);
    });

    return Object.entries(grouped).map(([name, tix]) => {
      let grossRevenue = 0;
      let totalPartsCost = 0;

      tix.forEach(t => {
        const rev = parseFloat(t.actualCost ?? t.estimatedCost ?? 0) || 0;
        grossRevenue += rev;
        if (t.partsUsed && Array.isArray(t.partsUsed)) {
          t.partsUsed.forEach((p: any) => {
            totalPartsCost += (parseFloat(p.cost) || 0);
          });
        }
      });

      const netRevenue = grossRevenue - totalPartsCost;
      const techProfit = netRevenue * (percentage / 100);

      return { name, tickets: tix, grossRevenue, totalPartsCost, netRevenue, techProfit };
    }).sort((a, b) => b.netRevenue - a.netRevenue);
  }, [completedInRange, percentage]);

  // Global totals
  const totals = useMemo(() => {
    let gross = 0, parts = 0;
    techData.forEach(t => {
      gross += t.grossRevenue;
      parts += t.totalPartsCost;
    });
    const net = gross - parts;
    const profit = net * (percentage / 100);
    return { gross, parts, net, profit };
  }, [techData, percentage]);

  const formatNum = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

  return (
    <div className={styles.container}>
      {/* Header with date filter */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Users size={22} />
          <h2 className={styles.headerTitle}>Technician Settlements</h2>
        </div>

        <div className={styles.dateFilter}>
          <div className={styles.datePresets}>
            {(['today', 'week', 'month', 'custom'] as DatePreset[]).map(p => (
              <button
                key={p}
                type="button"
                className={[styles.presetBtn, preset === p && styles.presetBtnActive].filter(Boolean).join(' ')}
                onClick={() => setPreset(p)}
              >
                {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'Custom'}
              </button>
            ))}
          </div>

          {preset === 'custom' && (
            <>
              <input
                type="date"
                className={styles.dateInput}
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
              />
              <span style={{ color: '#64748b' }}>→</span>
              <input
                type="date"
                className={styles.dateInput}
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
              />
            </>
          )}
        </div>
      </div>

      {/* Global Summary Cards */}
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}><DollarSign size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> Gross Revenue</span>
          <span className={styles.summaryValueGross}>{formatNum(totals.gross)} DA</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}><Package size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> Total Parts Cost</span>
          <span className={styles.summaryValueParts}>-{formatNum(totals.parts)} DA</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}><TrendingUp size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> Net Revenue</span>
          <span className={styles.summaryValueNet}>{formatNum(totals.net)} DA</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}><Percent size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> Total Tech Profit ({percentage}%)</span>
          <span className={styles.summaryValueProfit}>{formatNum(totals.profit)} DA</span>
        </div>
      </div>

      {/* Per-technician cards */}
      {techData.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>📋</div>
          <div className={styles.emptyText}>No completed repairs found in this period.</div>
        </div>
      ) : (
        <div className={styles.techGrid}>
          {techData.map(tech => {
            const isExpanded = expandedTech === tech.name;
            return (
              <div key={tech.name} className={styles.techCard}>
                {/* Card Header */}
                <div className={styles.techCardHeader}>
                  <div className={styles.techAvatar}>
                    {tech.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className={styles.techName}>{tech.name}</div>
                    <div className={styles.techTicketCount}>{tech.tickets.length} repair{tech.tickets.length !== 1 ? 's' : ''}</div>
                  </div>
                </div>

                {/* Stats */}
                <div className={styles.techStats}>
                  <div className={styles.techStatRow}>
                    <span className={styles.techStatLabel}>Gross Revenue</span>
                    <span className={styles.techStatValue} style={{ color: '#3b82f6' }}>{formatNum(tech.grossRevenue)} DA</span>
                  </div>
                  <div className={styles.techStatRow}>
                    <span className={styles.techStatLabel}>Parts Cost</span>
                    <span className={styles.techStatValue} style={{ color: '#ef4444' }}>-{formatNum(tech.totalPartsCost)} DA</span>
                  </div>
                  <div className={styles.techStatRow}>
                    <span className={styles.techStatLabel}>Net Revenue</span>
                    <span className={styles.techStatValue} style={{ color: '#10b981' }}>{formatNum(tech.netRevenue)} DA</span>
                  </div>
                  <div className={styles.techProfitRow}>
                    <span className={styles.techProfitLabel}>Profit ({percentage}%)</span>
                    <span className={styles.techProfitValue}>{formatNum(tech.techProfit)} DA</span>
                  </div>
                </div>

                {/* Expandable ticket list */}
                {isExpanded && (
                  <div className={styles.techTicketList}>
                    {tech.tickets.map((t: any) => {
                      const rev = parseFloat(t.actualCost ?? t.estimatedCost ?? 0) || 0;
                      let pc = 0;
                      if (t.partsUsed) t.partsUsed.forEach((p: any) => { pc += (parseFloat(p.cost) || 0); });
                      const net = rev - pc;
                      return (
                        <div key={t.id} className={styles.techTicketItem}>
                          <div className={styles.ticketInfo}>
                            <span className={styles.ticketInfoNum}>{t.ticketNumber}</span>
                            <span className={styles.ticketInfoDevice}>{t.deviceBrand} {t.deviceModel}</span>
                          </div>
                          <div className={styles.ticketAmounts}>
                            <span className={styles.ticketGross}>{rev} DA</span>
                            {pc > 0 && <span className={styles.ticketParts}>Parts: -{pc} DA</span>}
                            <span className={styles.ticketNet}>Net: {net} DA</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Toggle button */}
                <button
                  type="button"
                  className={styles.toggleBtn}
                  onClick={() => setExpandedTech(isExpanded ? null : tech.name)}
                >
                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {isExpanded ? 'Hide Tickets' : 'Show Tickets'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
