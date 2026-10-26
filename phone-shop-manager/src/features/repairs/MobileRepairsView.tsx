import React, { useMemo, useState, useCallback } from 'react';
import { Wrench, Plus, Search, ChevronDown } from 'lucide-react';
import { useRepairStore } from '../../store/repairStore';
import { useAuthStore } from '../../store/authStore';
import { RepairTicketSwipeCard } from './RepairTicketSwipeCard';
import { PullToRefresh } from '../../components/ui/PullToRefresh';
import styles from './MobileRepairsView.module.css';
import type { RepairTicket } from '../../types';

type FilterStatus = 'all' | 'today' | 'pending' | 'in_progress' | 'ready';

interface MobileRepairsViewProps {
  onTicketClick: (ticket: RepairTicket) => void;
  onNewTicket: () => void;
}

export const MobileRepairsView: React.FC<MobileRepairsViewProps> = ({
  onTicketClick,
  onNewTicket,
}) => {
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
      const q = search.toLowerCase();
      list = list.filter(t =>
        `${t.ticketNumber} ${t.customerName} ${t.deviceBrand} ${t.deviceModel} ${t.issue}`.toLowerCase().includes(q)
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
    { value: 'all',         label: 'All Active' },
    { value: 'today',       label: `Today (${todayCount})` },
    { value: 'pending',     label: 'Pending' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'ready',       label: 'Ready' },
  ];

  return (
    <div className={styles.wrapper}>
      {/* Sticky header */}
      <div className={styles.stickyHeader}>
        <div className={styles.headerTop}>
          <div>
            <h2 className={styles.title}>Repairs</h2>
            <p className={styles.subtitle}>
              Hi {user?.name?.split(' ')[0]} — {filtered.length} ticket{filtered.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button className={styles.fabBtn} onClick={onNewTicket} aria-label="New Ticket">
            <Plus size={20} />
          </button>
        </div>

        {/* Search */}
        <div className={styles.searchRow}>
          <Search size={15} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Search tickets, customer, device…"
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
              <p>No tickets found</p>
              <button className={styles.newTicketBtn} onClick={onNewTicket}>
                <Plus size={16} /> New Ticket
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
