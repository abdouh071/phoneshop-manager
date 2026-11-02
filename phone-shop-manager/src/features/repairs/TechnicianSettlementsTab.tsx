import React, { useMemo, useState, useEffect } from 'react';
import { useRepairStore } from '../../store/repairStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useAuthStore } from '../../store/authStore';
import {
  Users,
  DollarSign,
  Package,
  TrendingUp,
  Percent,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Clock,
  Search,
  Wrench,
  Building2,
  ArrowRight,
  Filter,
} from 'lucide-react';
import { useFormatCurrency } from '../../utils/formatCurrency';
import type { RepairTicket } from '../../types';
import styles from './TechnicianSettlements.module.css';

type ViewMode = 'daily' | 'weekly' | 'monthly' | 'custom';

interface TechStats {
  name: string;
  tickets: RepairTicket[];
  grossRevenue: number;
  totalPartsCost: number;
  netRevenue: number;
  techProfit: number;
  readyCount: number;
  completedCount: number;
  commissionRate: number;
}

interface DayBreakdown {
  date: Date;
  dateStr: string;
  dayName: string;
  dayNum: number;
  repairsCount: number;
  grossRevenue: number;
  totalPartsCost: number;
  netRevenue: number;
  techProfit: number;
  isToday: boolean;
}

export const TechnicianSettlementsTab: React.FC = () => {
  const { tickets } = useRepairStore();
  const settings = useSettingsStore();
  const { staff, fetchStaff } = useAuthStore();
  const defaultPercentage = settings.technicianProfitPercentage ?? 50;
  const formatCur = useFormatCurrency();
  const weekStartDay = settings.weekStartDay ?? 0;

  // View mode: daily vs weekly vs monthly vs custom
  const [viewMode, setViewMode] = useState<ViewMode>('daily');

  // Dual Profit Mode: 'taken' (Real Profit on picked up phones) vs 'all_repaired' (Production / Work Done)
  const [profitType, setProfitType] = useState<'taken' | 'all_repaired'>('taken');

  // Technician filter ('all' or technician name)
  const [selectedTech, setSelectedTech] = useState<string>('all');

  // Search filter for tickets
  const [searchQuery, setSearchQuery] = useState('');

  // Per-technician local rate draft state while editing
  const [localRates, setLocalRates] = useState<Record<string, string>>({});
  const [savedTechHint, setSavedTechHint] = useState<string | null>(null);

  // Default store rate state
  const [defaultRateInput, setDefaultRateInput] = useState<string>(() => String(settings.technicianProfitPercentage ?? 50));
  const [savedDefaultHint, setSavedDefaultHint] = useState(false);

  // Daily mode date
  const [currentDate, setCurrentDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // Weekly mode date (start of week)
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() => {
    const d = new Date();
    const day = d.getDay();
    const diffToStart = (day - weekStartDay + 7) % 7;
    d.setDate(d.getDate() - diffToStart);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // Monthly mode date (1st of month)
  const [currentMonthDate, setCurrentMonthDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // Custom range
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().split('T')[0]);

  // Fetch staff members to ensure all technicians are listable
  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  // Keep defaultRateInput in sync when settings update from Firestore
  useEffect(() => {
    setDefaultRateInput(String(settings.technicianProfitPercentage ?? 50));
  }, [settings.technicianProfitPercentage]);

  // Sync start of week when weekStartDay setting changes
  useEffect(() => {
    const d = new Date(currentWeekStart);
    const day = d.getDay();
    const diffToStart = (day - weekStartDay + 7) % 7;
    d.setDate(d.getDate() - diffToStart);
    d.setHours(0, 0, 0, 0);
    setCurrentWeekStart(d);
  }, [weekStartDay]);

  const handleSaveDefaultRate = async (rateVal: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(rateVal)));
    await settings.updateSetting('technicianProfitPercentage', clamped);
    setDefaultRateInput(String(clamped));
    setSavedDefaultHint(true);
    setTimeout(() => setSavedDefaultHint(false), 2500);
  };

  const handleSaveTechRate = async (techName: string, rateVal: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(rateVal)));
    await settings.setTechnicianRate(techName, clamped);
    setLocalRates(prev => ({ ...prev, [techName]: String(clamped) }));
    setSavedTechHint(techName);
    setTimeout(() => setSavedTechHint(null), 2500);
  };

  // Compute active date range boundaries [rangeStart, rangeEnd]
  const { rangeStart, rangeEnd, periodLabel, periodBadge } = useMemo(() => {
    let start: Date;
    let end: Date;
    let label = '';
    let badge = '';

    if (viewMode === 'daily') {
      start = new Date(currentDate);
      start.setHours(0, 0, 0, 0);
      end = new Date(currentDate);
      end.setHours(23, 59, 59, 999);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const isToday = start.getTime() === today.getTime();

      label = currentDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      badge = isToday ? 'Today' : 'Daily';
    } else if (viewMode === 'weekly') {
      start = new Date(currentWeekStart);
      start.setHours(0, 0, 0, 0);
      end = new Date(currentWeekStart);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);

      const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endLabel = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      label = `${startLabel} – ${endLabel}`;
      badge = 'Week';
    } else if (viewMode === 'monthly') {
      start = new Date(currentMonthDate);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end = new Date(currentMonthDate);
      end.setMonth(end.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);

      label = currentMonthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      badge = 'Month';
    } else {
      start = customFrom ? new Date(customFrom) : new Date();
      start.setHours(0, 0, 0, 0);
      end = customTo ? new Date(customTo) : new Date();
      end.setHours(23, 59, 59, 999);

      label = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      badge = 'Custom';
    }

    return { rangeStart: start, rangeEnd: end, periodLabel: label, periodBadge: badge };
  }, [viewMode, currentDate, currentWeekStart, currentMonthDate, customFrom, customTo]);

  // Navigation handlers
  const navPrev = () => {
    if (viewMode === 'daily') {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 1);
      setCurrentDate(d);
    } else if (viewMode === 'weekly') {
      const d = new Date(currentWeekStart);
      d.setDate(d.getDate() - 7);
      setCurrentWeekStart(d);
    } else if (viewMode === 'monthly') {
      const d = new Date(currentMonthDate);
      d.setMonth(d.getMonth() - 1);
      setCurrentMonthDate(d);
    }
  };

  const navNext = () => {
    if (viewMode === 'daily') {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 1);
      setCurrentDate(d);
    } else if (viewMode === 'weekly') {
      const d = new Date(currentWeekStart);
      d.setDate(d.getDate() + 7);
      setCurrentWeekStart(d);
    } else if (viewMode === 'monthly') {
      const d = new Date(currentMonthDate);
      d.setMonth(d.getMonth() + 1);
      setCurrentMonthDate(d);
    }
  };

  const handleResetToCurrent = () => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    setCurrentDate(now);

    const d = new Date(now);
    const day = d.getDay();
    const diffToStart = (day - weekStartDay + 7) % 7;
    d.setDate(d.getDate() - diffToStart);
    setCurrentWeekStart(d);

    const m = new Date(now);
    m.setDate(1);
    setCurrentMonthDate(m);
  };

  // ── Filter qualifying repair tickets in range (repairedAt || completedAt) ──
  // Respects Dual Mode:
  // 'taken' = completed handovers only (realized cash collected)
  // 'all_repaired' = production work on all ready or completed repairs
  const qualifyingTickets = useMemo(() => {
    return tickets.filter(t => {
      if (profitType === 'taken') {
        if (t.status !== 'completed') return false;
        const dateToCheck = t.completedAt || t.repairedAt || t.updatedAt;
        if (!dateToCheck) return false;
        const tDate = new Date(dateToCheck);
        return tDate >= rangeStart && tDate <= rangeEnd;
      } else {
        if (t.status !== 'ready' && t.status !== 'completed') return false;
        const dateToCheck = t.repairedAt || t.completedAt || t.updatedAt;
        if (!dateToCheck) return false;
        const tDate = new Date(dateToCheck);
        return tDate >= rangeStart && tDate <= rangeEnd;
      }
    }).sort((a, b) => {
      if (profitType === 'taken') {
        const timeB = new Date(b.completedAt || b.repairedAt || b.updatedAt || 0).getTime();
        const timeA = new Date(a.completedAt || a.repairedAt || a.updatedAt || 0).getTime();
        return timeB - timeA;
      } else {
        const timeB = new Date(b.repairedAt || b.completedAt || b.updatedAt || 0).getTime();
        const timeA = new Date(a.repairedAt || a.completedAt || a.updatedAt || 0).getTime();
        return timeB - timeA;
      }
    });
  }, [tickets, rangeStart, rangeEnd, profitType]);

  // List of all technician names found in tickets + active repair staff
  const availableTechnicians = useMemo(() => {
    const techSet = new Set<string>();
    qualifyingTickets.forEach(t => {
      if (t.assignedTechnician?.trim()) {
        techSet.add(t.assignedTechnician.trim());
      }
    });
    staff.forEach(s => {
      if ((s.role === 'repair_agent' || s.role === 'admin') && s.name?.trim()) {
        techSet.add(s.name.trim());
      }
    });
    return Array.from(techSet).sort();
  }, [qualifyingTickets, staff]);

  // Filter tickets by selected technician
  const filteredTickets = useMemo(() => {
    let list = qualifyingTickets;
    if (selectedTech !== 'all') {
      list = list.filter(t => (t.assignedTechnician?.trim() || 'Unassigned') === selectedTech);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(t =>
        t.ticketNumber?.toLowerCase().includes(q) ||
        t.customerName?.toLowerCase().includes(q) ||
        t.customerPhone?.toLowerCase().includes(q) ||
        t.deviceBrand?.toLowerCase().includes(q) ||
        t.deviceModel?.toLowerCase().includes(q) ||
        (t.assignedTechnician && t.assignedTechnician.toLowerCase().includes(q))
      );
    }
    return list;
  }, [qualifyingTickets, selectedTech, searchQuery]);

  // Group by technician & compute performance stats using each technician's individual commission rate
  const techData: TechStats[] = useMemo(() => {
    const grouped: Record<string, RepairTicket[]> = {};

    availableTechnicians.forEach(name => {
      grouped[name] = [];
    });

    qualifyingTickets.forEach(t => {
      const techName = t.assignedTechnician?.trim() || 'Unassigned';
      if (!grouped[techName]) grouped[techName] = [];
      grouped[techName].push(t);
    });

    return Object.entries(grouped).map(([name, tix]) => {
      let grossRevenue = 0;
      let totalPartsCost = 0;
      let readyCount = 0;
      let completedCount = 0;

      tix.forEach(t => {
        const rev = parseFloat(String(t.actualCost ?? t.estimatedCost ?? 0)) || 0;
        grossRevenue += rev;

        if (t.partsUsed && Array.isArray(t.partsUsed)) {
          t.partsUsed.forEach((p) => {
            const cost = parseFloat(String(p.cost)) || 0;
            const qty = p.quantity || 1;
            totalPartsCost += cost * qty;
          });
        }

        if (t.status === 'ready') readyCount += 1;
        if (t.status === 'completed') completedCount += 1;
      });

      const netRevenue = grossRevenue - totalPartsCost;
      const commissionRate = settings.getTechnicianRate(name);
      const techProfit = netRevenue * (commissionRate / 100);

      return {
        name,
        tickets: tix,
        grossRevenue,
        totalPartsCost,
        netRevenue,
        techProfit,
        readyCount,
        completedCount,
        commissionRate,
      };
    }).sort((a, b) => b.netRevenue - a.netRevenue);
  }, [qualifyingTickets, availableTechnicians, settings]);

  // Global / Filtered Totals with per-technician calculated profit
  const totals = useMemo(() => {
    let gross = 0;
    let parts = 0;
    let readyCount = 0;
    let completedCount = 0;
    let totalTechProfit = 0;

    filteredTickets.forEach(t => {
      const rev = parseFloat(String(t.actualCost ?? t.estimatedCost ?? 0)) || 0;
      gross += rev;

      let ticketParts = 0;
      if (t.partsUsed && Array.isArray(t.partsUsed)) {
        t.partsUsed.forEach((p) => {
          const cost = parseFloat(String(p.cost)) || 0;
          const qty = p.quantity || 1;
          ticketParts += cost * qty;
        });
      }
      parts += ticketParts;

      const net = rev - ticketParts;
      const techName = t.assignedTechnician?.trim() || 'Unassigned';
      const techRate = settings.getTechnicianRate(techName);
      totalTechProfit += net * (techRate / 100);

      if (t.status === 'ready') readyCount += 1;
      if (t.status === 'completed') completedCount += 1;
    });

    const net = gross - parts;
    const shopRetained = net - totalTechProfit;
    const shopTotal = shopRetained + parts; // Retained profit + reimbursement for spare parts

    return {
      gross,
      parts,
      net,
      techProfit: totalTechProfit,
      shopRetained,
      shopTotal,
      totalCount: filteredTickets.length,
      readyCount,
      completedCount,
    };
  }, [filteredTickets, settings]);

  // ── 7-Day Day-by-Day Breakdown (Active in Weekly Mode) ──
  const weekDayBreakdown: DayBreakdown[] = useMemo(() => {
    if (viewMode !== 'weekly') return [];

    const days: DayBreakdown[] = [];
    const todayStr = new Date().toDateString();

    for (let i = 0; i < 7; i++) {
      const d = new Date(currentWeekStart);
      d.setDate(d.getDate() + i);
      const dStart = new Date(d);
      dStart.setHours(0, 0, 0, 0);
      const dEnd = new Date(d);
      dEnd.setHours(23, 59, 59, 999);

      // Find tickets produced on this day
      const dayTickets = qualifyingTickets.filter(t => {
        if (selectedTech !== 'all' && (t.assignedTechnician?.trim() || 'Unassigned') !== selectedTech) {
          return false;
        }
        const dateToCheck = t.repairedAt || t.completedAt || t.updatedAt;
        if (!dateToCheck) return false;
        const tDate = new Date(dateToCheck);
        return tDate >= dStart && tDate <= dEnd;
      });

      let dayGross = 0;
      let dayParts = 0;
      let dayTechProfit = 0;

      dayTickets.forEach(t => {
        const rev = parseFloat(String(t.actualCost ?? t.estimatedCost ?? 0)) || 0;
        dayGross += rev;
        let partsCost = 0;
        if (t.partsUsed && Array.isArray(t.partsUsed)) {
          t.partsUsed.forEach((p) => {
            partsCost += (parseFloat(String(p.cost)) || 0) * (p.quantity || 1);
          });
        }
        dayParts += partsCost;
        const net = rev - partsCost;
        const techName = t.assignedTechnician?.trim() || 'Unassigned';
        const rate = settings.getTechnicianRate(techName);
        dayTechProfit += net * (rate / 100);
      });

      const dayNet = dayGross - dayParts;

      days.push({
        date: d,
        dateStr: d.toISOString().split('T')[0],
        dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
        dayNum: d.getDate(),
        repairsCount: dayTickets.length,
        grossRevenue: dayGross,
        totalPartsCost: dayParts,
        netRevenue: dayNet,
        techProfit: dayTechProfit,
        isToday: d.toDateString() === todayStr,
      });
    }

    return days;
  }, [viewMode, currentWeekStart, qualifyingTickets, selectedTech, settings]);

  // Click on a day in the weekly strip → jump to daily mode for that day
  const handleSelectDay = (day: DayBreakdown) => {
    setCurrentDate(new Date(day.date));
    setViewMode('daily');
  };

  const fmt = (val: number) => formatCur.private(val);

  return (
    <div className={styles.container}>
      {/* ── Top Header & Mode Switcher ────────────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.headerIconCircle}>
            <Wrench size={22} />
          </div>
          <div>
            <h2 className={styles.headerTitle}>Technician Settlements & Profit Engine</h2>
            <p className={styles.headerSubtitle}>
              Daily & weekly production tracking, real net profit, parts deduction & commission payouts
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Dual Profit Mode Toggle Switcher */}
          <div className={styles.dualProfitWrapper}>
            <button
              type="button"
              className={[
                styles.dualProfitBtn,
                profitType === 'taken' && styles.dualProfitBtnActiveTaken,
              ].filter(Boolean).join(' ')}
              onClick={() => setProfitType('taken')}
              title="Real Profit on claimed & collected phones only"
            >
              <DollarSign size={14} />
              <span>Real Profit (Taken)</span>
            </button>
            <button
              type="button"
              className={[
                styles.dualProfitBtn,
                profitType === 'all_repaired' && styles.dualProfitBtnActiveAll,
              ].filter(Boolean).join(' ')}
              onClick={() => setProfitType('all_repaired')}
              title="Production on all repaired phones including ready on shelf"
            >
              <Wrench size={14} />
              <span>All Repaired (Work)</span>
            </button>
          </div>

          {/* View Mode Tabs (Daily / Weekly / Monthly / Custom) */}
          <div className={styles.modeTabs}>
            <button
              type="button"
              className={[styles.modeBtn, viewMode === 'daily' && styles.modeBtnActive].filter(Boolean).join(' ')}
              onClick={() => setViewMode('daily')}
            >
              <Clock size={14} />
              <span>Daily</span>
            </button>
            <button
              type="button"
              className={[styles.modeBtn, viewMode === 'weekly' && styles.modeBtnActive].filter(Boolean).join(' ')}
              onClick={() => setViewMode('weekly')}
            >
              <Calendar size={14} />
              <span>Weekly</span>
            </button>
            <button
              type="button"
              className={[styles.modeBtn, viewMode === 'monthly' && styles.modeBtnActive].filter(Boolean).join(' ')}
              onClick={() => setViewMode('monthly')}
            >
              <Calendar size={14} />
              <span>Monthly</span>
            </button>
            <button
              type="button"
              className={[styles.modeBtn, viewMode === 'custom' && styles.modeBtnActive].filter(Boolean).join(' ')}
              onClick={() => setViewMode('custom')}
            >
              <Filter size={14} />
              <span>Custom</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Commission Management Bar (Instant Live Sync) ─────────────────── */}
      <div className={styles.commissionBar}>
        <div className={styles.commissionBarLeft}>
          <span className={styles.commissionBarLabel}>
            <Percent size={14} style={{ color: '#4f46e5' }} />
            <span>Default Store Commission:</span>
          </span>
          <div className={styles.rateInputWrapper}>
            <input
              type="number"
              min={0}
              max={100}
              className={styles.rateInputField}
              value={defaultRateInput}
              onChange={e => setDefaultRateInput(e.target.value)}
              onBlur={() => {
                const parsed = parseFloat(defaultRateInput);
                if (!isNaN(parsed)) handleSaveDefaultRate(parsed);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const parsed = parseFloat(defaultRateInput);
                  if (!isNaN(parsed)) handleSaveDefaultRate(parsed);
                }
              }}
            />
            <span className={styles.ratePercentSymbol}>%</span>
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            {[30, 40, 50, 60, 70].map(r => (
              <button
                key={r}
                type="button"
                className={[
                  styles.quickRatePill,
                  defaultPercentage === r && styles.quickRatePillActive,
                ].filter(Boolean).join(' ')}
                onClick={() => handleSaveDefaultRate(r)}
              >
                {r}%
              </button>
            ))}
          </div>
          {savedDefaultHint && <span className={styles.saveHintBadge}>✓ Saved to cloud!</span>}
        </div>

        <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
          ⚡ Custom rates sync instantly to Desktop, Web &amp; Android Technician App
        </div>
      </div>

      {/* ── Date Navigation Bar ───────────────────────────────────────────── */}
      <div className={styles.navigatorRow}>
        <div className={styles.navControls}>
          {viewMode !== 'custom' ? (
            <>
              <button
                type="button"
                className={styles.navArrowBtn}
                onClick={navPrev}
                title="Previous Period"
              >
                <ChevronLeft size={18} />
              </button>
              <div className={styles.periodHeading}>
                <span>{periodLabel}</span>
                <span className={styles.periodBadge}>{periodBadge}</span>
              </div>
              <button
                type="button"
                className={styles.navArrowBtn}
                onClick={navNext}
                title="Next Period"
              >
                <ChevronRight size={18} />
              </button>
              <button
                type="button"
                className={styles.todayQuickBtn}
                onClick={handleResetToCurrent}
              >
                {viewMode === 'daily' ? 'Today' : viewMode === 'weekly' ? 'This Week' : 'This Month'}
              </button>
            </>
          ) : (
            <div className={styles.customDateInputs}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>From:</span>
              <input
                type="date"
                className={styles.dateInput}
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
              />
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>To:</span>
              <input
                type="date"
                className={styles.dateInput}
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
              />
            </div>
          )}
        </div>

        <div style={{ fontSize: '12.5px', color: '#64748b', fontWeight: 600 }}>
          Mode: <strong style={{ color: profitType === 'taken' ? '#059669' : '#2563eb' }}>
            {profitType === 'taken' ? 'Realized Profit (Taken Phones)' : 'Repaired Production (All Work)'}
          </strong>
        </div>
      </div>

      {/* ── 7-Day Day-by-Day Strip (in Weekly Mode) ───────────────────────── */}
      {viewMode === 'weekly' && weekDayBreakdown.length > 0 && (
        <div className={styles.weekDaysStrip}>
          {weekDayBreakdown.map(day => (
            <div
              key={day.dateStr}
              className={[
                styles.dayCard,
                day.isToday && styles.dayCardToday,
              ].filter(Boolean).join(' ')}
              onClick={() => handleSelectDay(day)}
              title={`Click to view ${day.dayName} ${day.dayNum} in Daily View`}
            >
              <span className={styles.dayCardName}>{day.dayName}</span>
              <span className={styles.dayCardNum}>{day.dayNum}</span>
              <span className={styles.dayCardRepairsBadge}>
                {day.repairsCount} repair{day.repairsCount !== 1 ? 's' : ''}
              </span>
              <span className={styles.dayCardProfit}>
                +{fmt(day.techProfit)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Technician Filter Pills ──────────────────────────────────────── */}
      <div className={styles.techFilterBar}>
        <span className={styles.filterLabel}>
          <Users size={14} /> Filter Tech:
        </span>
        <button
          type="button"
          className={[
            styles.techFilterChip,
            selectedTech === 'all' && styles.techFilterChipActive,
          ].filter(Boolean).join(' ')}
          onClick={() => setSelectedTech('all')}
        >
          <span className={styles.chipAvatar}>👥</span>
          <span>All Technicians</span>
          <span className={styles.chipCountBadge}>{qualifyingTickets.length}</span>
        </button>

        {availableTechnicians.map(techName => {
          const count = qualifyingTickets.filter(t => (t.assignedTechnician?.trim() || 'Unassigned') === techName).length;
          const isActive = selectedTech === techName;
          return (
            <button
              key={techName}
              type="button"
              className={[
                styles.techFilterChip,
                isActive && styles.techFilterChipActive,
              ].filter(Boolean).join(' ')}
              onClick={() => setSelectedTech(techName)}
            >
              <span className={styles.chipAvatar}>
                {techName.charAt(0).toUpperCase()}
              </span>
              <span>{techName}</span>
              <span className={styles.chipCountBadge}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* ── Summary Hero Grid ────────────────────────────────────────────── */}
      <div className={styles.summaryGrid}>
        {/* Hero Card: Total Tech Profit / Cut */}
        <div className={[styles.summaryCard, styles.heroTechCard].join(' ')}>
          <div className={styles.summaryLabel}>
            <Percent size={16} />
            <span>
              {selectedTech === 'all'
                ? 'Total Technicians Cut'
                : `${selectedTech}'s Profit (${settings.getTechnicianRate(selectedTech)}%)`}
            </span>
          </div>
          <div className={styles.summaryValue}>
            {fmt(totals.techProfit)}
          </div>
          <div className={styles.heroSubtitle}>
            {profitType === 'taken' ? 'Realized cash settled upon pickup' : 'Repaired production (incl. on shelf)'}
          </div>
        </div>

        {/* Card 2: Gross Revenue */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>
            <DollarSign size={15} style={{ color: '#2563eb' }} />
            <span>Gross Revenue</span>
          </div>
          <div className={[styles.summaryValue, styles.summaryValueGross].join(' ')}>
            {fmt(totals.gross)}
          </div>
          <div className={styles.summarySub}>Total client repair charges</div>
        </div>

        {/* Card 3: Spare Parts Cost Deduction */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>
            <Package size={15} style={{ color: '#ef4444' }} />
            <span>Parts Cost Deducted</span>
          </div>
          <div className={[styles.summaryValue, styles.summaryValueParts].join(' ')}>
            -{fmt(totals.parts)}
          </div>
          <div className={styles.summarySub}>Hardware cost paid by shop</div>
        </div>

        {/* Card 4: Net Labor / Added Value */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>
            <TrendingUp size={15} style={{ color: '#059669' }} />
            <span>Net Labor Profit</span>
          </div>
          <div className={[styles.summaryValue, styles.summaryValueNet].join(' ')}>
            {fmt(totals.net)}
          </div>
          <div className={styles.summarySub}>Gross minus spare parts</div>
        </div>

        {/* Card 5: Shop Retained Share */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>
            <Building2 size={15} style={{ color: '#0284c7' }} />
            <span>Shop Retained</span>
          </div>
          <div className={[styles.summaryValue, styles.summaryValueShop].join(' ')}>
            {fmt(totals.shopRetained)}
          </div>
          <div className={styles.summarySub}>
            {selectedTech === 'all'
              ? 'Shop cut + parts recovered'
              : `Shop cut (${100 - settings.getTechnicianRate(selectedTech)}%) + parts recovered`}
          </div>
        </div>
      </div>

      {/* ── Per-Technician Breakdown Cards (When "All Technicians" selected) ── */}
      {selectedTech === 'all' && techData.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1e293b', margin: 0 }}>
              👥 Performance by Technician ({techData.length})
            </h3>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              Click &quot;View Only&quot; to isolate a technician
            </span>
          </div>

          <div className={styles.techGrid}>
            {techData.map(tech => (
              <div key={tech.name} className={styles.techCard}>
                <div className={styles.techCardHeader}>
                  <div className={styles.techCardHeaderLeft}>
                    <div className={styles.techAvatar}>
                      {tech.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className={styles.techName}>{tech.name}</div>
                      <div className={styles.techTicketCount}>
                        <span>{tech.tickets.length} repairs</span>
                        <span>·</span>
                        <span style={{ color: '#059669', fontWeight: 700 }}>{tech.readyCount} Ready</span>
                        <span>·</span>
                        <span style={{ color: '#7c3aed', fontWeight: 700 }}>{tech.completedCount} Claimed</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.techStats}>
                  <div className={styles.techStatRow}>
                    <span className={styles.techStatLabel}>Gross Fees</span>
                    <span className={styles.techStatValue} style={{ color: '#2563eb' }}>
                      {fmt(tech.grossRevenue)}
                    </span>
                  </div>
                  <div className={styles.techStatRow}>
                    <span className={styles.techStatLabel}>Parts Deducted</span>
                    <span className={styles.techStatValue} style={{ color: '#ef4444' }}>
                      -{fmt(tech.totalPartsCost)}
                    </span>
                  </div>
                  <div className={styles.techStatRow}>
                    <span className={styles.techStatLabel}>Net Labor</span>
                    <span className={styles.techStatValue} style={{ color: '#059669' }}>
                      {fmt(tech.netRevenue)}
                    </span>
                  </div>

                  {/* Individual Commission (%) Editor */}
                  <div className={styles.techCommissionRow}>
                    <span className={styles.techCommissionLabel}>
                      Commission Rate:
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div className={styles.rateInputWrapper}>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          className={styles.rateInputField}
                          value={localRates[tech.name] !== undefined ? localRates[tech.name] : tech.commissionRate}
                          onChange={e => setLocalRates(prev => ({ ...prev, [tech.name]: e.target.value }))}
                          onBlur={() => {
                            const val = localRates[tech.name];
                            if (val !== undefined && val !== '') {
                              const parsed = parseFloat(val);
                              if (!isNaN(parsed)) handleSaveTechRate(tech.name, parsed);
                            }
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              const val = localRates[tech.name];
                              if (val !== undefined && val !== '') {
                                const parsed = parseFloat(val);
                                if (!isNaN(parsed)) handleSaveTechRate(tech.name, parsed);
                              }
                            }
                          }}
                        />
                        <span className={styles.ratePercentSymbol}>%</span>
                      </div>
                      {savedTechHint === tech.name && (
                        <span className={styles.saveHintBadge}>✓ Saved!</span>
                      )}
                    </div>
                  </div>

                  <div className={styles.techProfitHighlight}>
                    <span className={styles.techProfitHighlightLabel}>
                      Tech Cut ({tech.commissionRate}%)
                    </span>
                    <span className={styles.techProfitHighlightValue}>
                      {fmt(tech.techProfit)}
                    </span>
                  </div>
                </div>

                <div className={styles.techCardAction}>
                  <button
                    type="button"
                    className={styles.viewTechBtn}
                    onClick={() => setSelectedTech(tech.name)}
                  >
                    <span>View Only</span>
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Detailed Repair Tickets Ledger ────────────────────────────────── */}
      <div className={styles.ticketsSection}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>
            <Wrench size={18} style={{ color: '#4f46e5' }} />
            <span>
              Repair Tickets Breakdown
              {selectedTech !== 'all' ? ` · ${selectedTech}` : ''} ({filteredTickets.length})
            </span>
          </div>

          <div className={styles.searchBox}>
            <Search size={14} color="#94a3b8" />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search ticket, customer, device..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {filteredTickets.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📋</div>
            <div className={styles.emptyTitle}>No Qualifying Repairs in This Period</div>
            <div className={styles.emptySubtitle}>
              {searchQuery
                ? 'No repair tickets match your search query.'
                : 'Technicians receive profit when repairs are marked as "Ready" or "Completed".'}
            </div>
          </div>
        ) : (
          <div className={styles.ticketList}>
            {filteredTickets.map(t => {
              const rev = parseFloat(String(t.actualCost ?? t.estimatedCost ?? 0)) || 0;
              let partsCost = 0;
              const partsList: { name: string; cost: number; qty: number }[] = [];

              if (t.partsUsed && Array.isArray(t.partsUsed)) {
                t.partsUsed.forEach((p) => {
                  const c = parseFloat(String(p.cost)) || 0;
                  const q = p.quantity || 1;
                  partsCost += c * q;
                  partsList.push({ name: p.name || 'Part', cost: c * q, qty: q });
                });
              }

              const net = rev - partsCost;
              const techName = t.assignedTechnician?.trim() || 'Unassigned';
              const techRate = settings.getTechnicianRate(techName);
              const techCut = net * (techRate / 100);
              const isReadyOnly = t.status === 'ready';
              const dateTimestamp = t.repairedAt || t.completedAt || t.updatedAt;
              const formattedDate = dateTimestamp
                ? new Date(dateTimestamp).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'N/A';

              return (
                <div key={t.id} className={styles.ticketRow}>
                  {/* Left: Status & Identity */}
                  <div className={styles.ticketLeft}>
                    <span className={isReadyOnly ? styles.statusPillReady : styles.statusPillClaimed}>
                      {isReadyOnly ? 'READY (ON SHELF)' : 'CLAIMED / TAKEN'}
                    </span>
                    <div>
                      <div className={styles.ticketNumber}>
                        {t.ticketNumber} · {t.deviceBrand} {t.deviceModel}
                      </div>
                      <div className={styles.ticketCustomer}>
                        {t.customerName || 'Walk-in'} {t.customerPhone ? `(${t.customerPhone})` : ''} ·{' '}
                        <span style={{ color: '#4f46e5', fontWeight: 600 }}>
                          Tech: {techName} ({techRate}%)
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                        {isReadyOnly ? 'Repaired on: ' : 'Handed over: '} {formattedDate}
                      </div>
                    </div>
                  </div>

                  {/* Middle: Parts Breakdown */}
                  <div className={styles.ticketMiddle}>
                    {partsList.length > 0 ? (
                      <div className={styles.partsPillList}>
                        {partsList.map((p, idx) => (
                          <span key={idx} className={styles.partTag}>
                            📦 {p.name}: -{fmt(p.cost)} {p.qty > 1 ? `(x${p.qty})` : ''}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ fontSize: '11.5px', color: '#94a3b8', fontStyle: 'italic' }}>
                        No parts used (Labor only)
                      </span>
                    )}
                    {t.issueDescription && (
                      <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                        Issue: {t.issueDescription}
                      </span>
                    )}
                  </div>

                  {/* Right: Amounts & Tech Cut */}
                  <div className={styles.ticketRight}>
                    <span className={styles.ticketGrossText}>
                      Gross: {fmt(rev)}
                    </span>
                    {partsCost > 0 && (
                      <span style={{ fontSize: '12px', color: '#ef4444', fontWeight: 600 }}>
                        Parts: -{fmt(partsCost)}
                      </span>
                    )}
                    <span className={styles.ticketNetText}>
                      Net: {fmt(net)}
                    </span>
                    <span className={styles.ticketCutBadge}>
                      Cut ({techRate}%): +{fmt(techCut)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
