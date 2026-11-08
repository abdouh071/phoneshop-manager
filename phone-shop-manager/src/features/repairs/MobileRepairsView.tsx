import React, { useMemo, useState, useCallback } from 'react';
import { Wrench, Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRepairStore } from '../../store/repairStore';
import { useAuthStore } from '../../store/authStore';
import { RepairTicketSwipeCard } from './RepairTicketSwipeCard';
import { PullToRefresh } from '../../components/ui/PullToRefresh';
import styles from './MobileRepairsView.module.css';
import type { RepairTicket } from '../../types';
import { normalizeArabic } from '../../utils/normalizeText';

type FilterStatus = 'all' | 'today' | 'pending' | 'in_progress' | 'ready';

interface MobileRepairsViewProps {
  onTicketClick: (ticket: RepairTicket) => void;
  onNewTicket: () => void;
}

export const MobileRepairsView: React.FC<MobileRepairsViewProps> = ({
  onTicketClick,
  onNewTicket,
}) => {
  const { t } = useTranslation();
  const { tickets, fetchTickets } = useRepairStore();
  const { user } = useAuthStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');

  const handleRefresh = useCallback(async () => {
    await fetchTickets();
  }, [fetchTickets]);

  const today = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }, []);

  const filtered = useMemo(() => {
    let list = tickets.filter(t =>
      t.status !== 'completed' && t.status !== 'cancelled' && t.status !== 'returned'
    );

    if (statusFilter === 'today') {
      list = list.filter(t => {
        const d = new Date(t.createdAt); d.setHours(0, 0, 0, 0);
        return d.getTime() === today.getTime();
      });
    } else if (statusFilter !== 'all') {
      list = list.filter(t => t.status === statusFilter);
    }

    if (search.trim()) {
      const q = normalizeArabic(search);
      list = list.filter(t =>
        normalizeArabic([t.ticketNumber, t.customerName, t.deviceBrand, t.deviceModel, t.issue].filter(Boolean).join(' ')).includes(q)
      );
    }

    return list;
  }, [tickets, statusFilter, search, today]);

  const todayCount = useMemo(() =>
    tickets.filter(t => {
      const d = new Date(t.createdAt); d.setHours(0, 0, 0, 0);
      return d.getTime() === today.getTime() && t.status !== 'completed' && t.status !== 'cancelled';
    }).length,
    [tickets, today]
  );

  const FILTER_OPTIONS: { value: FilterStatus; label: string; count?: number }[] = [
    { value: 'all',         label: t('mobile.allActive') },
    { value: 'today',       label: t('mobile.todayCount', { count: todayCount }) },
    { value: 'pending',     label: t('status.pending') },
    { value: 'in_progress', label: t('status.in_progress') },
    { value: 'ready',       label: t('status.ready') },
  ];

  return (
    <div className={styles.wrapper}>
      {/* Sticky header */}
      <div className={styles.stickyHeader}>
        <div className={styles.headerTop}>
          <div>
            <h2 className={styles.title}>{t('sidebar.repairs')}</h2>
            <p className={styles.subtitle}>
              {t('mobile.hiTickets', { name: user?.name?.split(' ')[0], count: filtered.length })}
            </p>
          </div>
          <button className={styles.fabBtn} onClick={onNewTicket} aria-label={t('repairs.newTicket')}>
            <Plus size={20} />
          </button>
        </div>

        {/* Search */}
        <div className={styles.searchRow}>
          <Search size={15} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            type="search"
            placeholder={t('repairs.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Status filter chips */}
        <div className={styles.filterRow}>
          {FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className={[styles.filterChip, statusFilter === opt.value && styles.filterChipActive].filter(Boolean).join(' ')}
              onClick={() => setStatusFilter(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Ticket list with pull-to-refresh */}
      <PullToRefresh onRefresh={handleRefresh}>
        <div className={styles.list}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>
              <Wrench size={36} className={styles.emptyIcon} />
              <p>{t('repairs.noTickets')}</p>
              <button className={styles.newTicketBtn} onClick={onNewTicket}>
                <Plus size={16} /> {t('repairs.newTicket')}
              </button>
            </div>
          ) : (
            filtered.map(ticket => (
              <RepairTicketSwipeCard
                key={ticket.id}
                ticket={ticket}
                onClick={() => onTicketClick(ticket)}
              />
            ))
          )}
        </div>
      </PullToRefresh>
    </div>
  );
};
