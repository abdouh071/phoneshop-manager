import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Plus, Clock, Wrench, CheckCircle2, Archive, LayoutList, Columns, AlertTriangle, User, Smartphone, Sparkles, PauseCircle, PlayCircle, Trash2, Printer, XCircle, RotateCcw, Eye, GitMerge } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/Input';
import { useRepairStore } from '../../store/repairStore';
import { useCustomerStore } from '../../store/customerStore';
import { NewTicketModal } from './NewTicketModal';
import { TicketDetailPanel } from './TicketDetailPanel';
import { RepairSettlementModal } from './RepairSettlementModal';
import { PrintRepairTicketModal } from './PrintRepairTicketModal';
import { CustomerProfilePanel } from '../customers/CustomerProfilePanel';
import { MergeRepairsModal } from './MergeRepairsModal';
import { StatusTablesView } from './StatusTablesView';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../components/ui/Toast';
import type { RepairTicket, Customer } from '../../types';
import styles from './Kanban.module.css';
import { formatCurrency } from '../../utils/formatCurrency';
import { deduplicateTickets } from '../../utils/ticketDeduplication';
import { MobileRepairsView } from './MobileRepairsView';
import { EndOfDayButton } from '../endofday/EndOfDayButton';
import { TechnicianSettlementsTab } from './TechnicianSettlementsTab';
import { detectIssueTag, getBrandIcon, nextStatusMap, nextActionLabels } from './repairConstants';
import { isPhoneMatch, normalizePhoneDigits } from '../../utils/phoneUtils';
import { isTicketActiveReturnPending } from '../../utils/phoneLifecycle';

export type RepairViewMode = 'tables' | 'board' | 'completed' | 'history' | 'cancelled' | 'settlements';

const formatTimeAgo = (dateStr?: string) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 5) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

type KanbanStatus = 'pending' | 'in_progress' | 'ready' | 'completed';

const COLUMNS: { id: KanbanStatus; label: string; icon: React.ReactNode; dotClass: string; accentClass: string }[] = [
  { id: 'pending',     label: 'Pending',          icon: <Clock size={15} />,        dotClass: 'dot-pending',     accentClass: 'columnAccentPending' },
  { id: 'in_progress', label: 'In Progress',      icon: <Wrench size={15} />,       dotClass: 'dot-in_progress', accentClass: 'columnAccentInProgress' },
  { id: 'ready',       label: 'Ready for Pickup', icon: <CheckCircle2 size={15} />, dotClass: 'dot-ready',       accentClass: 'columnAccentReady' },
  { id: 'completed',   label: 'Completed',        icon: <Archive size={15} />,      dotClass: 'dot-completed',   accentClass: 'columnAccentCompleted' },
];

const TicketCard: React.FC<{
  ticket: RepairTicket;
  index: number;
  onClick: () => void;
  onAdvance: (e: React.MouseEvent, ticket: RepairTicket) => void;
  onPrint?: (e: React.MouseEvent, ticket: RepairTicket) => void;
  onOpenCustomerProfile?: (e: React.MouseEvent, ticket: RepairTicket) => void;
  onQuickSettle?: (e: React.MouseEvent, ticket: RepairTicket) => void;
}> = ({ ticket, index, onClick, onAdvance, onPrint, onOpenCustomerProfile, onQuickSettle }) => {
  const isOverdue = ticket.estimatedCompletionDate &&
    new Date(ticket.estimatedCompletionDate) < new Date() &&
    ticket.status !== 'completed' && ticket.status !== 'cancelled' && ticket.status !== 'returned';

  const isDueToday = ticket.estimatedCompletionDate &&
    new Date(ticket.estimatedCompletionDate).toDateString() === new Date().toDateString() &&
    ticket.status !== 'completed' && ticket.status !== 'cancelled' && ticket.status !== 'returned';

  const issue = detectIssueTag(ticket.issueDescription);
  const brandIcon = getBrandIcon(ticket.deviceBrand);

  const cardAccentClass =
    isOverdue ? styles.cardOverdue :
    ticket.status === 'returned' ? styles.cardAccentReturned :
    ticket.status === 'pending' ? styles.cardAccentPending :
    ticket.status === 'in_progress' ? styles.cardAccentInProgress :
    ticket.status === 'ready' ? styles.cardAccentReady :
    styles.cardAccentCompleted;

  const nextAction = nextActionLabels[ticket.status];

  return (
    <Draggable draggableId={ticket.id} index={index} key={ticket.id}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={[
            styles.kanbanCard,
            cardAccentClass,
            snapshot.isDragging && styles.kanbanCardDragging,
          ].filter(Boolean).join(' ')}
          onClick={onClick}
        >
          {/* Top Row: Ticket Code + Lock Badge + SLA Pill + Returned Pill */}
          <div className={styles.cardTopRow}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
              <span className={styles.cardTicketBadge}>{ticket.ticketNumber}</span>
              {ticket.isReturn && (
                <span
                  style={{
                    fontSize: '9.5px',
                    fontWeight: 700,
                    padding: '1px 5px',
                    borderRadius: '4px',
                    background: '#fef3c7',
                    color: '#92400e',
                    border: '1px solid #fde68a',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                  title={`Return Ticket belonging to parent #${ticket.parentTicketNumber || ticket.parentTicketId}`}
                >
                  🔁 Return {ticket.parentTicketNumber ? `of #${ticket.parentTicketNumber}` : ''}
                </span>
              )}
              {ticket.status === 'returned' && (
                <span className={styles.cardReturnedTag} title={ticket.returnReason ? `Return Reason: ${ticket.returnReason}` : 'Returned Phone'}>
                  <AlertTriangle size={9} /> Returned
                </span>
              )}
              {ticket.status === 'returned' && ticket.activeReturnTicketNumber && (
                <span
                  style={{
                    fontSize: '9.5px',
                    fontWeight: 700,
                    padding: '1px 5px',
                    borderRadius: '4px',
                    background: '#eff6ff',
                    color: '#1d4ed8',
                    border: '1px solid #bfdbfe',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                  title={`Active child return ticket: #${ticket.activeReturnTicketNumber}`}
                >
                  Child #{ticket.activeReturnTicketNumber}
                </span>
              )}
              {ticket.lockType && ticket.lockType !== 'none' && ticket.lockValue && (
                <span
                  style={{
                    fontSize: '9.5px',
                    fontWeight: 700,
                    padding: '1px 5px',
                    borderRadius: '4px',
                    background: 'rgba(79, 70, 229, 0.08)',
                    color: '#4f46e5',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                  title={`Unlock: ${ticket.lockType === 'pattern' ? '3x3 Pattern Lock' : 'PIN / Passcode'}`}
                >
                  🔒 {ticket.lockType === 'pattern' ? 'Pattern' : 'PIN'}
                </span>
              )}
            </div>
            {isOverdue ? (
              <span className={[styles.cardSlaPill, styles.slaOverdue].join(' ')}>
                <AlertTriangle size={10} /> Overdue
              </span>
            ) : isDueToday ? (
              <span className={[styles.cardSlaPill, styles.slaToday].join(' ')}>
                <Clock size={10} /> Due Today
              </span>
            ) : ticket.status === 'ready' ? (
              <span className={[styles.cardSlaPill, styles.slaReady].join(' ')}>
                <CheckCircle2 size={10} /> Ready
              </span>
            ) : null}
          </div>

          {/* Device & Issue Tag */}
          <div className={styles.cardDeviceRow}>
            <div className={styles.cardDeviceName}>
              <span>{brandIcon}</span>
              <span>{ticket.deviceBrand} {ticket.deviceModel}</span>
            </div>
            <div className={styles.cardProblemTag}>
              <span>{issue.icon}</span>
              <span>{issue.label}</span>
            </div>
          </div>

          {ticket.status === 'returned' && ticket.returnReason && (
            <div style={{ fontSize: '11px', color: '#b91c1c', background: '#fef2f2', border: '1px dashed #fca5a5', borderRadius: '5px', padding: '2px 6px', margin: '4px 0 2px' }} title={ticket.returnReason}>
              <strong>Return:</strong> {ticket.returnReason}
            </div>
          )}

          {/* Customer */}
          <div
            className={styles.cardCustomerRow}
            onClick={onOpenCustomerProfile ? (e) => { e.stopPropagation(); onOpenCustomerProfile(e, ticket); } : undefined}
            title={onOpenCustomerProfile ? "Click to view Customer 360° Profile & Ledger" : undefined}
            style={onOpenCustomerProfile ? { cursor: 'pointer' } : {}}
          >
            <User size={11} style={onOpenCustomerProfile ? { color: 'var(--color-primary)' } : {}} />
            <span style={onOpenCustomerProfile ? { textDecoration: 'underline', textDecorationColor: '#cbd5e1' } : {}}>{ticket.customerName}</span>
            {ticket.customerPhone && (
              <span style={{ opacity: 0.6, fontSize: '11px', marginLeft: 'auto' }}>
                {ticket.customerPhone}
              </span>
            )}
          </div>

          {/* Bottom Row: Cost & Technician / Action */}
          <div className={styles.cardFooter}>
            <div className={styles.cardCostBlock}>
              <span className={styles.cardCost}>
                {ticket.actualCost ? formatCurrency(ticket.actualCost) : `~${formatCurrency(ticket.estimatedCost)}`}
              </span>
              {ticket.status === 'completed' && (ticket.paymentStatus === 'debt' || ticket.paymentStatus === 'partial' || (ticket.paidAmount !== undefined && ticket.paidAmount < (ticket.actualCost || ticket.estimatedCost))) ? (
                <span style={{ fontSize: '10.5px', color: '#dc2626', fontWeight: 700 }}>
                  ⚠️ Debt: {formatCurrency(Math.max(0, (ticket.actualCost || ticket.estimatedCost) - (ticket.paidAmount || 0)))}
                </span>
              ) : ticket.status === 'completed' ? (
                <span style={{ fontSize: '10.5px', color: '#16a34a', fontWeight: 700 }}>
                  ✓ Fully Paid
                </span>
              ) : ticket.depositAmount && ticket.depositAmount > 0 ? (
                <span className={styles.cardDepositNote}>
                  Paid: {formatCurrency(ticket.depositAmount)}
                </span>
              ) : null}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {onPrint && (
                <button
                  type="button"
                  className={styles.cardPrintBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPrint(e, ticket);
                  }}
                  title="Quick Print Phone Sticker / Receipt"
                >
                  <Printer size={12} />
                </button>
              )}

              {/* Quick Settle button for Ready tickets */}
              {onQuickSettle && ticket.status === 'ready' && (
                <button
                  type="button"
                  className={styles.cardAdvanceBtn}
                  style={{ background: 'linear-gradient(135deg, #059669, #10b981)', color: '#fff', fontWeight: 700, fontSize: '11px', padding: '3px 8px' }}
                  onClick={(e) => { e.stopPropagation(); onQuickSettle(e, ticket); }}
                  title="Open Settlement & Handover"
                >
                  <span>💰 Settle</span>
                </button>
              )}

              {nextAction && !(ticket.status === 'returned' && ticket.activeReturnTicketId) && (
                <button
                  type="button"
                  className={styles.cardAdvanceBtn}
                  onClick={(e) => onAdvance(e, ticket)}
                  title={typeof nextAction === 'object' ? nextAction.title : `Advance to ${nextStatusMap[ticket.status]?.replace('_', ' ')}`}
                >
                  <span>{typeof nextAction === 'object' ? nextAction.label : nextAction}</span>
                </button>
              )}

              {ticket.assignedTechnician ? (
                <span className={styles.cardTech} title={`Assigned to ${ticket.assignedTechnician}`}>
                  <span className={styles.techAvatarCircle}>
                    {ticket.assignedTechnician[0]}
                  </span>
                  <span>{ticket.assignedTechnician}</span>
                </span>
              ) : (
                <span className={styles.cardTech} style={{ opacity: 0.4 }}>
                  Unassigned
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </Draggable>
  );
};

export const RepairsPage = () => {
  const {
    fetchTickets,
    searchQuery,
    setSearchQuery,
    updateStatus,
    tickets,
    getFilteredTickets,
    heldDrafts,
    resumeDraft,
    discardHeldDraft,
    clearActiveDraft,
    statusFilter,
    setStatusFilter,
    findDuplicates,
  } = useRepairStore();
  const { customers, fetchCustomers } = useCustomerStore();

  // Deduplication & safe fusion state
  const detectedDuplicateTickets = useMemo(() => findDuplicates(), [tickets, findDuplicates]);
  const [isMergeRepairsOpen, setIsMergeRepairsOpen] = useState(false);
  const [mergeInitialTicketA, setMergeInitialTicketA] = useState<RepairTicket | null>(null);
  const [mergeInitialTicketB, setMergeInitialTicketB] = useState<RepairTicket | null>(null);

  const [isNewOpen, setIsNewOpen] = useState(false);
  const [ticketToEdit, setTicketToEdit] = useState<RepairTicket | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<RepairTicket | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab') as RepairViewMode | null;
  const [viewMode, setViewModeState] = useState<RepairViewMode>(() => {
    if (urlTab && ['tables', 'board', 'completed', 'history', 'cancelled', 'settlements'].includes(urlTab)) {
      return urlTab;
    }
    return 'tables';
  });

  const setViewMode = useCallback((mode: RepairViewMode) => {
    setViewModeState(mode);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (mode === 'tables') {
        next.delete('tab');
      } else {
        next.set('tab', mode);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    if (urlTab && ['tables', 'board', 'completed', 'history', 'cancelled', 'settlements'].includes(urlTab) && urlTab !== viewMode) {
      setViewModeState(urlTab);
    }
  }, [urlTab, viewMode]);

  // Dedicated search and filter state for Completed Repairs Vault tab
  const [completedSearchQuery, setCompletedSearchQuery] = useState('');
  const [completedFilterTag, setCompletedFilterTag] = useState<'all' | 'walkin' | 'account' | 'today'>('all');
  const [selectedTech, setSelectedTech] = useState<string>('all');
  const toast = useToast();
  const location = useLocation();
  const { user } = useAuthStore();
  const [ticketRequiringUnlock, setTicketRequiringUnlock] = useState<RepairTicket | null>(null);
  const [settlementTicket, setSettlementTicket] = useState<RepairTicket | null>(null);
  const [printingTicket, setPrintingTicket] = useState<RepairTicket | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [prefillCustomer, setPrefillCustomer] = useState<{name: string; phone: string; deviceBrand?: string; deviceModel?: string; parentTicketId?: string} | null>(null);
  const [profileCustomer, setProfileCustomer] = useState<Customer | null>(null);

  const handlePrintTicket = (ticket: RepairTicket) => {
    setPrintingTicket(ticket);
  };

  const isToday = (dateStr?: string) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d.getTime() === today.getTime();
  };

  const handleEditTicket = (ticket: RepairTicket) => {
    const isLocked = ticket.status === 'completed' || ticket.status === 'cancelled' || !isToday(ticket.createdAt);
    if (user?.role === 'admin' || !isLocked) {
      setTicketToEdit(ticket);
      setIsNewOpen(true);
    } else {
      setTicketRequiringUnlock(ticket);
    }
  };

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const resultItemsRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    fetchTickets();
    fetchCustomers();
  }, [fetchTickets, fetchCustomers]);

  const handleOpenCustomerProfile = (e: React.MouseEvent, ticket: RepairTicket) => {
    e.stopPropagation();
    let found: Customer | undefined;
    if (ticket.customerId) {
      found = customers.find(c => c.id === ticket.customerId);
    }
    if (!found) {
      found = customers.find(c =>
        isPhoneMatch(c.phone, ticket.customerPhone) ||
        (c.normalizedPhone && isPhoneMatch(c.normalizedPhone, ticket.customerPhone)) ||
        (c.name.toLowerCase().trim() === ticket.customerName.toLowerCase().trim())
      );
    }
    if (found) {
      setProfileCustomer(found);
    } else {
      // Synthesize a walk-in Customer profile so staff can inspect all records for this walk-in customer
      const cleanDigits = normalizePhoneDigits(ticket.customerPhone);
      const walkInCustomer: Customer = {
        id: `walkin_${cleanDigits || ticket.id}`,
        name: ticket.customerName || 'Walk-in Client',
        phone: ticket.customerPhone || 'Walk-in',
        normalizedPhone: cleanDigits || undefined,
        accountType: 'retail',
        totalPurchases: 0,
        totalSpent: 0,
        lastVisitDate: ticket.createdAt,
        joinDate: ticket.createdAt,
        notes: 'Walk-in Customer Record',
      };
      setProfileCustomer(walkInCustomer);
    }
  };

  // Click outside to close search dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Deep links handling from Activity Log
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const search = params.get('search');
    if (search) setSearchQuery(search);
  }, [location.search, setSearchQuery]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const focusId = params.get('focusId');
    if (!focusId || tickets.length === 0) return;
    const match = tickets.find(t =>
      t.ticketNumber === focusId ||
      t.id === focusId ||
      t.ticketNumber.toLowerCase().includes(focusId.toLowerCase())
    );
    if (match) {
      const timer = setTimeout(() => setSelectedTicket(match), 400);
      return () => clearTimeout(timer);
    }
  }, [location.search, tickets]);

  // Autocomplete search results (top 8 matches) — child return tickets excluded
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    return tickets
      .filter(t => !t.isReturn)  // never surface child return tickets in search
      .filter(t =>
        (t.ticketNumber || '').toLowerCase().includes(q) ||
        (t.customerName || '').toLowerCase().includes(q) ||
        (t.deviceModel || '').toLowerCase().includes(q) ||
        (t.deviceBrand || '').toLowerCase().includes(q) ||
        (t.customerPhone || '').toLowerCase().includes(q) ||
        (t.issueDescription || '').toLowerCase().includes(q) ||
        (t.assignedTechnician || '').toLowerCase().includes(q)
      ).slice(0, 8);
  }, [tickets, searchQuery]);

  // Auto-scroll highlighted search item into view
  useEffect(() => {
    if (isSearchOpen && resultItemsRef.current[selectedIndex]) {
      resultItemsRef.current[selectedIndex]?.scrollIntoView({
        block: 'nearest',
      });
    }
  }, [selectedIndex, isSearchOpen]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isSearchOpen && searchResults.length > 0) {
        setIsSearchOpen(true);
        setSelectedIndex(0);
        return;
      }
      setSelectedIndex(prev => (prev < searchResults.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isSearchOpen && searchResults.length > 0) {
        setIsSearchOpen(true);
        setSelectedIndex(searchResults.length - 1);
        return;
      }
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : searchResults.length - 1));
    } else if (e.key === 'Enter') {
      if (searchResults.length > 0 && selectedIndex >= 0 && selectedIndex < searchResults.length) {
        e.preventDefault();
        const chosen = searchResults[selectedIndex];
        setSelectedTicket(chosen);
        setIsSearchOpen(false);
        (e.target as HTMLInputElement).blur();
      }
    } else if (e.key === 'Escape') {
      setIsSearchOpen(false);
      (e.target as HTMLInputElement).blur();
    }
  };

  // Barcode scanner listener for repair tickets
  useEffect(() => {
    let scanBuffer = '';
    let scanTimeout: ReturnType<typeof setTimeout>;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Enter') {
        if (scanBuffer.length > 3) {
          const scanned = scanBuffer.trim();
          const match = tickets.find(t => t.ticketNumber === scanned || t.id === scanned);
          if (match) {
            setSelectedTicket(match);
            toast.success('Ticket Scanned', `Opened ${match.ticketNumber}`);
          } else {
            toast.error('Scan Failed', `No ticket found for ${scanned}`);
          }
        }
        scanBuffer = '';
      } else if (e.key.length === 1) {
        scanBuffer += e.key;
        clearTimeout(scanTimeout);
        scanTimeout = setTimeout(() => { scanBuffer = ''; }, 50);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(scanTimeout);
    };
  }, [tickets, toast]);

  // Keyboard shortcut: N key to open New Ticket modal
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'n' || e.key === 'N') {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          setIsNewOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Deduplicated base list — child return tickets (isReturn: true) are excluded from
  // the main board/search; they are only visible inside the parent ticket detail panel.
  const uniqueTickets = useMemo(
    () => deduplicateTickets(tickets).filter(t => !t.isReturn),
    [tickets]
  );

  // Unique list of technicians
  const technicians = useMemo(() => {
    const set = new Set<string>();
    uniqueTickets.forEach(t => {
      if (t.assignedTechnician) set.add(t.assignedTechnician);
    });
    return Array.from(set);
  }, [uniqueTickets]);

  // Filtered dataset — directly reactive to uniqueTickets, searchQuery, selectedTech, and statusFilter
  const filtered = useMemo(() => {
    let list = uniqueTickets;

    // 1. Text Search Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const cleanQueryDigits = normalizePhoneDigits(searchQuery);
      const rawQueryDigits = searchQuery.replace(/\D/g, '');

      list = list.filter(t =>
        (t.customerName || '').toLowerCase().includes(q) ||
        (t.ticketNumber || '').toLowerCase().includes(q) ||
        (t.deviceModel || '').toLowerCase().includes(q) ||
        (t.deviceBrand || '').toLowerCase().includes(q) ||
        `${t.deviceBrand || ''} ${t.deviceModel || ''}`.toLowerCase().includes(q) ||
        (t.customerPhone || '').toLowerCase().includes(q) ||
        (t.assignedTechnician || '').toLowerCase().includes(q) ||
        (cleanQueryDigits.length >= 2 && isPhoneMatch(t.customerPhone, searchQuery)) ||
        (rawQueryDigits.length >= 2 && (t.customerPhone || '').replace(/\D/g, '').includes(rawQueryDigits)) ||
        (t.issueDescription || '').toLowerCase().includes(q)
      );
    }

    // 2. Technician Filter
    if (selectedTech !== 'all') {
      list = list.filter(t => t.assignedTechnician === selectedTech);
    }

    // 3. Status / Overdue Filter
    if (statusFilter === 'overdue') {
      list = list.filter(t =>
        t.estimatedCompletionDate &&
        new Date(t.estimatedCompletionDate) < new Date() &&
        t.status !== 'completed' &&
        t.status !== 'cancelled' &&
        t.status !== 'returned'
      );
    } else if (statusFilter === 'pending') {
      list = list.filter(t => t.status === 'pending' || isTicketActiveReturnPending(t, uniqueTickets));
    } else if (statusFilter === 'completed') {
      list = list.filter(t => t.status === 'completed' || (t.status === 'returned' && !isTicketActiveReturnPending(t, uniqueTickets)));
    } else if (statusFilter === 'returned') {
      list = list.filter(t => isTicketActiveReturnPending(t, uniqueTickets));
    } else if (statusFilter !== 'all') {
      list = list.filter(t => t.status === statusFilter);
    }

    return list;
  }, [uniqueTickets, searchQuery, selectedTech, statusFilter]);

  const returnedTickets = filtered.filter(t => isTicketActiveReturnPending(t, uniqueTickets));

  const getColumnTickets = (status: KanbanStatus) => {
    if (status === 'pending') {
      return filtered
        .filter(t => t.status === 'pending' || isTicketActiveReturnPending(t, uniqueTickets))
        .sort((a, b) => {
          const aRet = isTicketActiveReturnPending(a, uniqueTickets);
          const bRet = isTicketActiveReturnPending(b, uniqueTickets);
          if (aRet && !bRet) return -1;
          if (bRet && !aRet) return 1;
          return 0;
        });
    }
    if (status === 'completed') {
      return filtered.filter(t => t.status === 'completed' || (t.status === 'returned' && !isTicketActiveReturnPending(t, uniqueTickets)));
    }
    return filtered.filter(t => t.status === status);
  };

  const counts = useMemo(() => ({
    pending:     uniqueTickets.filter(t => t.status === 'pending' || isTicketActiveReturnPending(t, uniqueTickets)).length,
    in_progress: uniqueTickets.filter(t => t.status === 'in_progress').length,
    ready:       uniqueTickets.filter(t => t.status === 'ready').length,
    completed:   uniqueTickets.filter(t => t.status === 'completed' || (t.status === 'returned' && !isTicketActiveReturnPending(t, uniqueTickets))).length,
    returned:    uniqueTickets.filter(t => isTicketActiveReturnPending(t, uniqueTickets)).length,
    cancelled:   uniqueTickets.filter(t => t.status === 'cancelled').length,
    overdue:     uniqueTickets.filter(t =>
      t.estimatedCompletionDate &&
      new Date(t.estimatedCompletionDate) < new Date() &&
      t.status !== 'completed' &&
      t.status !== 'cancelled' &&
      isTicketActiveReturnPending(t, uniqueTickets)
    ).length,
  }), [uniqueTickets]);

  // Dedicated metrics for Completed Repairs Vault
  const completedMetrics = useMemo(() => {
    const completedList = uniqueTickets.filter(t => t.status === 'completed' || (t.status === 'returned' && !isTicketActiveReturnPending(t, uniqueTickets)));
    const totalCount = completedList.length;
    const walkInCount = completedList.filter(t => !t.customerId && (!t.customerPhone || !t.customerPhone.trim())).length;
    const accountCount = completedList.filter(t => Boolean(t.customerId || (t.customerPhone && t.customerPhone.trim().length >= 7))).length;
    const todayCount = completedList.filter(t => (t.completedAt && isToday(t.completedAt)) || (t.updatedAt && isToday(t.updatedAt))).length;
    const totalRevenue = completedList.reduce((sum, t) => sum + (t.actualCost ?? t.estimatedCost ?? 0), 0);
    return { totalCount, walkInCount, accountCount, todayCount, totalRevenue };
  }, [uniqueTickets]);

  // Dedicated filtered dataset for Completed Repairs Vault (supports client name, phone model, problem, technician, ticket #)
  const completedTicketsList = useMemo(() => {
    let list = uniqueTickets.filter(t => t.status === 'completed');

    if (completedFilterTag === 'walkin') {
      list = list.filter(t => !t.customerId && (!t.customerPhone || !t.customerPhone.trim()));
    } else if (completedFilterTag === 'account') {
      list = list.filter(t => Boolean(t.customerId || (t.customerPhone && t.customerPhone.trim().length >= 7)));
    } else if (completedFilterTag === 'today') {
      list = list.filter(t => (t.completedAt && isToday(t.completedAt)) || (t.updatedAt && isToday(t.updatedAt)));
    }

    if (completedSearchQuery.trim()) {
      const q = completedSearchQuery.toLowerCase().trim();
      const rawDigits = completedSearchQuery.replace(/\D/g, '');
      const cleanDigits = normalizePhoneDigits(completedSearchQuery);

      list = list.filter(t =>
        (t.customerName || '').toLowerCase().includes(q) ||
        (t.deviceModel || '').toLowerCase().includes(q) ||
        (t.deviceBrand || '').toLowerCase().includes(q) ||
        `${t.deviceBrand || ''} ${t.deviceModel || ''}`.toLowerCase().includes(q) ||
        (t.issueDescription || '').toLowerCase().includes(q) ||
        (t.assignedTechnician || '').toLowerCase().includes(q) ||
        (t.ticketNumber || '').toLowerCase().includes(q) ||
        (t.customerPhone || '').toLowerCase().includes(q) ||
        (cleanDigits.length >= 2 && isPhoneMatch(t.customerPhone, completedSearchQuery)) ||
        (rawDigits.length >= 2 && (t.customerPhone || '').replace(/\D/g, '').includes(rawDigits))
      );
    }

    return list.slice().sort((a, b) => {
      const dateA = a.completedAt || a.updatedAt || a.createdAt;
      const dateB = b.completedAt || b.updatedAt || b.createdAt;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });
  }, [uniqueTickets, completedSearchQuery, completedFilterTag]);

  const handleDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId) return;

    const newStatus = destination.droppableId as KanbanStatus;

    // Intercept drag into completed: open Settlement Modal
    if (newStatus === 'completed') {
      const draggedTicket = tickets.find(t => t.id === draggableId);
      if (draggedTicket) {
        setSettlementTicket(draggedTicket);
        return;
      }
    }

    await updateStatus(draggableId, newStatus);
    toast.success('Ticket moved', `Moved to ${newStatus.replace('_', ' ')}`);
  };

  const handleAdvanceCard = async (e: React.MouseEvent, ticket: RepairTicket) => {
    e.stopPropagation();
    const next = nextStatusMap[ticket.status];
    if (!next) return;

    // Intercept ready → completed: open Settlement Modal
    if (next === 'completed') {
      setSettlementTicket(ticket);
      return;
    }

    await updateStatus(ticket.id, next);
    toast.success('Status updated', `${ticket.ticketNumber} moved to ${next.replace('_', ' ')}.`);
  };

  // Dynamically resolve selectedTicket from live tickets array so it's always in sync
  const activeSelectedTicket = useMemo(() => {
    if (!selectedTicket) return null;
    return tickets.find(t => t.id === selectedTicket.id) || selectedTicket;
  }, [selectedTicket, tickets]);

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

  return (
    <div className={styles.page}>
      <NewTicketModal 
        isOpen={isNewOpen} 
        onClose={() => { setIsNewOpen(false); setTicketToEdit(null); setPrefillCustomer(null); }} 
        onTicketCreated={() => {
          setStatusFilter('all');
          setSelectedTech('all');
          setSearchQuery('');
        }}
        onPrintTicket={handlePrintTicket}
        ticketToEdit={ticketToEdit}
        prefillCustomer={prefillCustomer}
      />
      <PrintRepairTicketModal
        isOpen={!!printingTicket}
        onClose={() => setPrintingTicket(null)}
        ticket={printingTicket}
      />
      <TicketDetailPanel 
        ticket={activeSelectedTicket} 
        onClose={() => setSelectedTicket(null)} 
        onEdit={() => {
          if (activeSelectedTicket) {
            handleEditTicket(activeSelectedTicket);
          }
        }}
        onViewCustomerProfile={(cust) => setProfileCustomer(cust)}
        onRequestSettlement={(tk) => {
          setSettlementTicket(tk);
        }}
        onRepairAgain={(tk) => {
          setPrefillCustomer({
            name: tk.customerName,
            phone: tk.customerPhone,
            deviceBrand: tk.deviceBrand,
            deviceModel: tk.deviceModel,
            parentTicketId: tk.parentTicketId || tk.id,
          });
          setTicketToEdit(null);
          setIsNewOpen(true);
        }}
        onSelectTicket={(tk) => setSelectedTicket(tk)}
      />
      <RepairSettlementModal
        isOpen={!!settlementTicket}
        onClose={() => setSettlementTicket(null)}
        ticket={settlementTicket}
        onSettled={() => {
          setSettlementTicket(null);
          setSelectedTicket(null);
        }}
      />
      <AdminUnlockModal
        isOpen={!!ticketRequiringUnlock}
        onClose={() => setTicketRequiringUnlock(null)}
        onSuccess={() => {
          if (ticketRequiringUnlock) {
            setTicketToEdit(ticketRequiringUnlock);
            setIsNewOpen(true);
          }
          setTicketRequiringUnlock(null);
        }}
        actionName="edit a closed or past-day repair ticket"
      />
      <CustomerProfilePanel
        isOpen={!!profileCustomer}
        onClose={() => setProfileCustomer(null)}
        customer={profileCustomer}
        onNewRepair={(c, lastDevice) => {
          setProfileCustomer(null);
          setTicketToEdit(null);
          setIsNewOpen(true);
        }}
      />
      <MergeRepairsModal
        isOpen={isMergeRepairsOpen}
        onClose={() => {
          setIsMergeRepairsOpen(false);
          setMergeInitialTicketA(null);
          setMergeInitialTicketB(null);
        }}
        initialTicketA={mergeInitialTicketA}
        initialTicketB={mergeInitialTicketB}
      />

      {isMobile ? (
        <MobileRepairsView
          onTicketClick={(ticket) => setSelectedTicket(ticket)}
          onNewTicket={() => setIsNewOpen(true)}
        />
      ) : (
        <>
          {/* Header */}
          <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Repairs Management</h1>
          <p className={styles.subtitle}>{tickets.length} total active tickets across workshop</p>
        </div>

        <div className={styles.headerActions}>
          {/* Autocomplete Search Bar */}
          <div className={styles.searchContainer} ref={searchContainerRef}>
            <SearchInput
              value={searchQuery}
              onChange={val => {
                setSearchQuery(val);
                setIsSearchOpen(val.trim().length > 0);
                setSelectedIndex(0);
              }}
              onFocus={() => {
                if (searchQuery.trim().length > 0) setIsSearchOpen(true);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search tickets… (↑↓ navigate, ↵ open)"
              className={styles.search}
            />

            {/* Dropdown Results */}
            {isSearchOpen && searchQuery.trim().length > 0 && (
              <div className={styles.searchDropdown}>
                <div className={styles.searchDropdownHeader}>
                  <span>Quick Results ({searchResults.length})</span>
                  <span style={{ fontSize: '10px', opacity: 0.7 }}>↑↓ Navigate · ↵ Open · Esc Close</span>
                </div>

                {searchResults.length === 0 ? (
                  <div className={styles.searchResultEmpty}>
                    No repair tickets found matching "{searchQuery}"
                  </div>
                ) : (
                  searchResults.map((t, idx) => {
                    const issue = detectIssueTag(t.issueDescription);
                    const brandIcon = getBrandIcon(t.deviceBrand);
                    const isHighlighted = idx === selectedIndex;

                    return (
                      <div
                        key={t.id}
                        ref={el => { resultItemsRef.current[idx] = el; }}
                        className={[
                          styles.searchResultItem,
                          isHighlighted && styles.searchResultItemActive,
                        ].filter(Boolean).join(' ')}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        onClick={() => {
                          setSelectedTicket(t);
                          setIsSearchOpen(false);
                        }}
                      >
                        <div className={styles.searchResultTop}>
                          <span className={styles.searchResultTicketNum}>{t.ticketNumber}</span>
                          <span className={styles.searchResultDevice}>
                            {brandIcon} {t.deviceBrand} {t.deviceModel}
                          </span>
                          <span
                            className={styles.searchResultStatus}
                            style={{
                              background:
                                t.status === 'ready' ? 'rgba(16, 185, 129, 0.12)' :
                                t.status === 'in_progress' ? 'rgba(59, 130, 246, 0.12)' :
                                t.status === 'completed' ? 'rgba(100, 116, 139, 0.12)' :
                                'rgba(245, 158, 11, 0.12)',
                              color:
                                t.status === 'ready' ? '#059669' :
                                t.status === 'in_progress' ? '#2563eb' :
                                t.status === 'completed' ? '#475569' :
                                '#d97706',
                            }}
                          >
                            {t.status.replace('_', ' ')}
                          </span>
                        </div>

                        <div className={styles.searchResultBottom}>
                          <span className={styles.searchResultCustomer}>
                            👤 {t.customerName} {t.customerPhone ? `(${t.customerPhone})` : ''}
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                            <span>{issue.icon} {issue.label}</span>
                            <span>·</span>
                            <span style={{ color: 'var(--color-on-surface)' }}>
                              {t.actualCost ? formatCurrency(t.actualCost) : `~${formatCurrency(t.estimatedCost)}`}
                            </span>
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}

                {searchResults.length > 0 && (
                  <div className={styles.searchResultFooter}>
                    <span>Showing top {searchResults.length} match{searchResults.length === 1 ? '' : 'es'}</span>
                    <span>Press <strong>Enter ↵</strong> to view ticket</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Segmented View Switcher */}
          <div className={styles.viewSwitcher}>
            <button
              type="button"
              className={[styles.viewSwitcherBtn, viewMode === 'tables' && styles.viewSwitcherBtnActive].filter(Boolean).join(' ')}
              onClick={() => setViewMode('tables')}
              title="4 Dedicated Status Tables"
            >
              <LayoutList size={15} />
              <span>Tables</span>
            </button>
            <button
              type="button"
              className={[styles.viewSwitcherBtn, viewMode === 'board' && styles.viewSwitcherBtnActive].filter(Boolean).join(' ')}
              onClick={() => setViewMode('board')}
              title="Kanban Board View"
            >
              <Columns size={15} />
              <span>Board</span>
            </button>
            <button
              type="button"
              className={[styles.viewSwitcherBtn, viewMode === 'completed' && styles.viewSwitcherBtnActive].filter(Boolean).join(' ')}
              onClick={() => setViewMode('completed')}
              title="Completed Repairs Vault"
              style={{ position: 'relative' }}
            >
              <CheckCircle2 size={15} />
              <span>Completed</span>
              {counts.completed > 0 && (
                <span style={{
                  minWidth: '16px',
                  height: '16px',
                  borderRadius: '8px',
                  background: viewMode === 'completed' ? 'rgba(255, 255, 255, 0.25)' : 'rgba(16, 185, 129, 0.15)',
                  color: viewMode === 'completed' ? '#ffffff' : '#059669',
                  fontSize: '10px',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 4px',
                  marginLeft: '4px',
                }}>{counts.completed}</span>
              )}
            </button>
            <button
              type="button"
              className={[styles.viewSwitcherBtn, viewMode === 'history' && styles.viewSwitcherBtnActive].filter(Boolean).join(' ')}
              onClick={() => setViewMode('history')}
              title="All History & Logs"
            >
              <Archive size={15} />
              <span>History</span>
            </button>
            <button
              type="button"
              className={[styles.viewSwitcherBtn, viewMode === 'cancelled' && styles.viewSwitcherBtnActive].filter(Boolean).join(' ')}
              onClick={() => setViewMode('cancelled')}
              title="Cancelled Repairs"
              style={{ position: 'relative' }}
            >
              <XCircle size={15} />
              <span>Cancelled</span>
              {counts.cancelled > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  minWidth: '16px',
                  height: '16px',
                  borderRadius: '8px',
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: '10px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 4px',
                }}>{counts.cancelled}</span>
              )}
            </button>

            <button
              type="button"
              className={[styles.viewSwitcherBtn, viewMode === 'settlements' && styles.viewSwitcherBtnActive].filter(Boolean).join(' ')}
              onClick={() => setViewMode('settlements')}
              title="Technician Settlements"
            >
              <User size={15} />
              <span>Settlements</span>
            </button>
          </div>

          <EndOfDayButton variant="compact" />
          <Button leftIcon={<Plus size={16} />} onClick={() => setIsNewOpen(true)} title="New Ticket (N)">
            New Ticket
          </Button>
        </div>
      </div>

      {/* Detected Duplicate Repairs Alert Banner */}
      {detectedDuplicateTickets.length > 0 && (
        <div style={{
          background: '#fefce8',
          border: '1px solid #fde047',
          borderRadius: '10px',
          padding: '12px 18px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '14px',
          flexWrap: 'wrap',
          boxShadow: '0 1px 4px rgba(234, 179, 8, 0.1)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              background: '#fef08a',
              color: '#854d0e',
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <GitMerge size={20} />
            </div>
            <div>
              <h4 style={{ margin: '0 0 2px 0', fontSize: '13.5px', fontWeight: 700, color: '#854d0e' }}>
                {detectedDuplicateTickets.length} Duplicate Repair Ticket{detectedDuplicateTickets.length !== 1 ? 's' : ''} Detected
              </h4>
              <p style={{ margin: 0, fontSize: '12px', color: '#a16207' }}>
                Duplicate repair tickets detected for the same customer and device. You can safely fusion them without deleting any database records.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="primary"
            leftIcon={<GitMerge size={14} />}
            onClick={() => {
              setMergeInitialTicketA(detectedDuplicateTickets[0].ticketA);
              setMergeInitialTicketB(detectedDuplicateTickets[0].ticketB);
              setIsMergeRepairsOpen(true);
            }}
          >
            Resolve Duplicates ({detectedDuplicateTickets.length})
          </Button>
        </div>
      )}

      {/* Interactive KPI Summary Cards */}
      <div className={styles.overviewGrid}>
        {[
          { key: 'pending',     label: 'Pending Approval',  count: counts.pending,     icon: <Clock size={20} />,        color: 'warning' },
          { key: 'in_progress', label: 'In Progress',       count: counts.in_progress, icon: <Wrench size={20} />,       color: 'info' },
          { key: 'ready',       label: 'Ready for Pickup',  count: counts.ready,       icon: <CheckCircle2 size={20} />, color: 'success' },
          { key: 'completed',   label: 'Completed / Claimed', count: counts.completed, icon: <Archive size={20} />,      color: 'neutral' },
        ].map(({ key, label, count, icon, color }) => {
          const isActive = statusFilter === key;
          return (
            <div
              key={key}
              className={[styles.overviewCard, isActive && styles.overviewCardActive].filter(Boolean).join(' ')}
              onClick={() => setStatusFilter(isActive ? 'all' : key as KanbanStatus)}
              title={`Click to filter by ${label}`}
            >
              <div className={[styles.overviewIcon, styles[`icon-${color}`]].join(' ')}>{icon}</div>
              <div className={styles.overviewMeta}>
                <p className={styles.overviewValue}>{count}</p>
                <p className={styles.overviewLabel}>{label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Filter Toolbar */}
      <div className={styles.filterToolbar}>
        <div className={styles.filterPills}>
          <button
            type="button"
            className={[styles.filterPill, statusFilter === 'all' && styles.filterPillActive].filter(Boolean).join(' ')}
            onClick={() => setStatusFilter('all')}
          >
            <Sparkles size={13} /> All ({tickets.length})
          </button>
          {counts.overdue > 0 && (
            <button
              type="button"
              className={[styles.filterPill, statusFilter === 'overdue' && styles.filterPillActive].filter(Boolean).join(' ')}
              onClick={() => setStatusFilter(statusFilter === 'overdue' ? 'all' : 'overdue')}
              style={{ color: '#dc2626', borderColor: 'rgba(239, 68, 68, 0.3)' }}
            >
              <AlertTriangle size={13} /> Overdue ({counts.overdue})
            </button>
          )}
          <button
            type="button"
            className={[styles.filterPill, statusFilter === 'ready' && styles.filterPillActive].filter(Boolean).join(' ')}
            onClick={() => setStatusFilter(statusFilter === 'ready' ? 'all' : 'ready')}
          >
            <CheckCircle2 size={13} /> Ready for Pickup ({counts.ready})
          </button>
          <button
            type="button"
            className={[styles.filterPill, statusFilter === 'in_progress' && styles.filterPillActive].filter(Boolean).join(' ')}
            onClick={() => setStatusFilter(statusFilter === 'in_progress' ? 'all' : 'in_progress')}
          >
            <Wrench size={13} /> In Work ({counts.in_progress})
          </button>
          {counts.returned > 0 && (
            <button
              type="button"
              className={[styles.filterPill, statusFilter === 'returned' && styles.filterPillActive].filter(Boolean).join(' ')}
              onClick={() => setStatusFilter(statusFilter === 'returned' ? 'all' : 'returned')}
              style={{ color: '#b91c1c', borderColor: 'rgba(185, 28, 28, 0.3)' }}
            >
              <AlertTriangle size={13} /> Returned ({counts.returned})
            </button>
          )}
        </div>

        {/* Technician Filter Dropdown */}
        {technicians.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-on-surface-variant)' }}>Technician:</span>
            <select
              value={selectedTech}
              onChange={e => setSelectedTech(e.target.value)}
              className={styles.techSelect}
            >
              <option value="all">All Technicians</option>
              {technicians.map(tech => (
                <option key={tech} value={tech}>{tech}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Held Ticket Drafts Strip */}
      {heldDrafts.length > 0 && (
        <div className={styles.heldDraftsStrip}>
          <div className={styles.heldDraftsHeader}>
            <PauseCircle size={15} color="#6366f1" />
            <span className={styles.heldDraftsTitle}>
              {heldDrafts.length} Held Draft{heldDrafts.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className={styles.heldDraftsList}>
            {heldDrafts.map(draft => {
              const label = [draft.deviceBrand, draft.deviceModel].filter(Boolean).join(' ') || 'Untitled';
              const timeAgo = (() => {
                const diff = Date.now() - new Date(draft.date).getTime();
                const mins = Math.floor(diff / 60000);
                if (mins < 1) return 'just now';
                if (mins < 60) return `${mins}m ago`;
                const hrs = Math.floor(mins / 60);
                if (hrs < 24) return `${hrs}h ago`;
                return `${Math.floor(hrs / 24)}d ago`;
              })();
              return (
                <div key={draft.id} className={styles.heldDraftCard}>
                  <div className={styles.heldDraftInfo}>
                    <span className={styles.heldDraftLabel}>
                      <Smartphone size={13} color="#6366f1" />
                      {label}
                    </span>
                    {draft.customerName && (
                      <span className={styles.heldDraftSub}>
                        <User size={11} /> {draft.customerName}
                      </span>
                    )}
                    <span className={styles.heldDraftTime}>{timeAgo}</span>
                  </div>
                  <div className={styles.heldDraftActions}>
                    <button
                      type="button"
                      className={styles.heldDraftResumeBtn}
                      onClick={() => {
                        resumeDraft(draft.id);
                        setIsNewOpen(true);
                        toast.info('Draft resumed', `Restored ${label} ticket draft`);
                      }}
                      title="Resume this draft"
                    >
                      <PlayCircle size={14} /> Resume
                    </button>
                    <button
                      type="button"
                      className={styles.heldDraftDiscardBtn}
                      onClick={() => {
                        discardHeldDraft(draft.id);
                        toast.info('Draft discarded', `Removed ${label} draft`);
                      }}
                      title="Discard this draft"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4 DEDICATED STATUS TABLES VIEW */}
      {viewMode === 'tables' && (
        <StatusTablesView
          tickets={filtered}
          onSelectTicket={setSelectedTicket}
          onAdvanceStatus={handleAdvanceCard}
          onPrintTicket={handlePrintTicket}
          onOpenCustomerProfile={handleOpenCustomerProfile}
        />
      )}

      {/* BOARD VIEW */}
      {viewMode === 'board' && (
        <>
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className={styles.kanbanBoard}>
              {COLUMNS.filter(col => showCompleted || col.id !== 'completed').map(col => {
                const columnTickets = getColumnTickets(col.id);
                return (
                  <div key={col.id} className={[styles.kanbanColumn, styles[col.accentClass]].join(' ')}>
                    <div className={styles.columnHeader}>
                      <div className={styles.columnTitle}>
                        <span className={[styles.columnDot, styles[col.dotClass]].join(' ')} />
                        {col.icon}
                        <span>{col.label}</span>
                      </div>
                      <span className={styles.columnCount}>{columnTickets.length}</span>
                    </div>

                    <Droppable droppableId={col.id}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={[
                            styles.columnBody,
                            snapshot.isDraggingOver && styles.columnBodyDragging,
                          ].filter(Boolean).join(' ')}
                        >
                          {columnTickets.length === 0 && !snapshot.isDraggingOver && (
                            <div className={styles.emptyColumn}>
                              <span>No tickets in {col.label.toLowerCase()}</span>
                            </div>
                          )}
                          {columnTickets.map((ticket, index) => (
                            <TicketCard
                              key={ticket.id}
                              ticket={ticket}
                              index={index}
                              onClick={() => setSelectedTicket(ticket)}
                              onAdvance={handleAdvanceCard}
                              onPrint={(e, t) => handlePrintTicket(t)}
                              onOpenCustomerProfile={handleOpenCustomerProfile}
                              onQuickSettle={(e, t) => { e.stopPropagation(); setSettlementTicket(t); }}
                            />
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                );
              })}
            </div>
          </DragDropContext>

          {/* Show/Hide Completed Toggle */}
          <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--color-on-surface-variant)',
                cursor: 'pointer',
                userSelect: 'none',
                padding: '6px 14px',
                borderRadius: '8px',
                background: showCompleted ? 'rgba(99, 102, 241, 0.08)' : 'var(--color-surface-variant, #f1f5f9)',
                border: '1px solid var(--color-border, #e2e8f0)',
                transition: 'all 0.15s ease',
              }}
            >
              <input
                type="checkbox"
                checked={showCompleted}
                onChange={(e) => setShowCompleted(e.target.checked)}
                style={{ accentColor: '#6366f1' }}
              />
              <Archive size={13} />
              Show Completed ({counts.completed})
            </label>
          </div>

          {statusFilter === 'returned' && returnedTickets.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-on-surface-variant)' }}>
              <p style={{ fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>No Returned Repairs</p>
              <p style={{ fontSize: '13px' }}>There are currently no repairs flagged as returned or under warranty claim.</p>
            </div>
          )}
        </>
      )}

      {/* COMPLETED REPAIRS VAULT VIEW */}
      {viewMode === 'completed' && (
        <div className={styles.completedVaultContainer}>
          {/* Header & Metrics Bar */}
          <div className={styles.completedVaultHeader}>
            <div className={styles.completedMetricsGrid}>
              <div className={styles.completedMetricCard}>
                <div className={styles.completedMetricIcon} style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#059669' }}>
                  <CheckCircle2 size={20} />
                </div>
                <div className={styles.completedMetricContent}>
                  <span className={styles.completedMetricValue}>{completedMetrics.totalCount}</span>
                  <span className={styles.completedMetricLabel}>Total Completed Repairs</span>
                </div>
              </div>

              <div className={styles.completedMetricCard}>
                <div className={styles.completedMetricIcon} style={{ background: 'rgba(79, 70, 229, 0.1)', color: 'var(--color-primary, #4f46e5)' }}>
                  <Archive size={20} />
                </div>
                <div className={styles.completedMetricContent}>
                  <span className={styles.completedMetricValue}>{formatCurrency(completedMetrics.totalRevenue)}</span>
                  <span className={styles.completedMetricLabel}>Total Settled Value</span>
                </div>
              </div>

              <div className={styles.completedMetricCard}>
                <div className={styles.completedMetricIcon} style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#2563eb' }}>
                  <Clock size={20} />
                </div>
                <div className={styles.completedMetricContent}>
                  <span className={styles.completedMetricValue}>{completedMetrics.todayCount}</span>
                  <span className={styles.completedMetricLabel}>Settled Today</span>
                </div>
              </div>

              <div className={styles.completedMetricCard}>
                <div className={styles.completedMetricIcon} style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#d97706' }}>
                  <User size={20} />
                </div>
                <div className={styles.completedMetricContent}>
                  <span className={styles.completedMetricValue}>{completedMetrics.walkInCount}</span>
                  <span className={styles.completedMetricLabel}>Walk-in (No Account)</span>
                </div>
              </div>
            </div>

            {/* Dedicated Search Bar & Quick Filter Pills */}
            <div className={styles.completedToolbar}>
              <div className={styles.completedSearchWrapper}>
                <SearchInput
                  placeholder="Search past repairs by client name, phone model, problem, technician, ticket #..."
                  value={completedSearchQuery}
                  onChange={setCompletedSearchQuery}
                />
              </div>

              <div className={styles.completedFilterPills}>
                <button
                  type="button"
                  className={[styles.filterPill, completedFilterTag === 'all' && styles.filterPillActive].filter(Boolean).join(' ')}
                  onClick={() => setCompletedFilterTag('all')}
                >
                  All ({completedMetrics.totalCount})
                </button>
                <button
                  type="button"
                  className={[styles.filterPill, completedFilterTag === 'walkin' && styles.filterPillActive].filter(Boolean).join(' ')}
                  onClick={() => setCompletedFilterTag('walkin')}
                  title="Repairs registered without customer phone/account"
                >
                  Walk-in Only ({completedMetrics.walkInCount})
                </button>
                <button
                  type="button"
                  className={[styles.filterPill, completedFilterTag === 'account' && styles.filterPillActive].filter(Boolean).join(' ')}
                  onClick={() => setCompletedFilterTag('account')}
                  title="Repairs linked to customer accounts"
                >
                  With Account ({completedMetrics.accountCount})
                </button>
                <button
                  type="button"
                  className={[styles.filterPill, completedFilterTag === 'today' && styles.filterPillActive].filter(Boolean).join(' ')}
                  onClick={() => setCompletedFilterTag('today')}
                >
                  Today ({completedMetrics.todayCount})
                </button>
              </div>
            </div>
          </div>

          {/* Completed Repairs Table List */}
          <div className={styles.historyTableWrapper}>
            <table className={styles.historyTable}>
              <thead>
                <tr>
                  <th style={{ width: '110px' }}>Ticket #</th>
                  <th>Device</th>
                  <th>Issue / Problem</th>
                  <th>Client Name</th>
                  <th>Contact</th>
                  <th>Settled Total</th>
                  <th>Technician</th>
                  <th>Settled Date</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {completedTicketsList.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--color-on-surface-variant)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '28px' }}>📦</span>
                        <span style={{ fontWeight: 700, fontSize: '15px' }}>
                          {completedSearchQuery.trim() ? `No past repairs matching "${completedSearchQuery}"` : 'No completed repairs found in this filter'}
                        </span>
                        <span style={{ fontSize: '12px', opacity: 0.75 }}>
                          {completedSearchQuery.trim() ? 'Try checking spelling or search by phone model, problem or technician.' : 'Repairs marked as completed and settled will be archived here.'}
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  completedTicketsList.map(ticket => {
                    const issue = detectIssueTag(ticket.issueDescription);
                    const brandIcon = getBrandIcon(ticket.deviceBrand);
                    const hasPhone = Boolean(ticket.customerPhone && ticket.customerPhone.trim().length >= 7);
                    const hasAccount = Boolean(ticket.customerId || hasPhone);
                    const finalCost = ticket.actualCost ?? ticket.estimatedCost ?? 0;
                    const settledDate = ticket.completedAt || ticket.updatedAt || ticket.createdAt;

                    return (
                      <tr
                        key={ticket.id}
                        className={styles.historyTableRow}
                        onClick={() => setSelectedTicket(ticket)}
                      >
                        <td>
                          <span className={styles.cardTicketBadge}>{ticket.ticketNumber}</span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            {brandIcon} {ticket.deviceBrand} {ticket.deviceModel}
                          </span>
                        </td>
                        <td>
                          <span className={styles.cardProblemTag}>
                            <span>{issue.icon}</span>
                            <span>{issue.label}</span>
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap' }}>
                            {hasAccount ? (
                              <button
                                type="button"
                                onClick={(e) => handleOpenCustomerProfile(e, ticket)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  padding: 0,
                                  color: 'inherit',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  fontWeight: 600,
                                }}
                                title="Open Customer Profile & History"
                              >
                                <User size={12} style={{ color: 'var(--color-primary)' }} />
                                <span style={{ textDecoration: 'underline' }}>{ticket.customerName}</span>
                              </button>
                            ) : (
                              <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <User size={12} style={{ opacity: 0.5 }} />
                                <span>{ticket.customerName}</span>
                              </span>
                            )}
                            {!hasAccount && (
                              <span className={styles.walkinBadge} title="Registered without customer phone/account">
                                Walk-in
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          {ticket.customerPhone ? (
                            <span style={{ fontWeight: 500 }}>{ticket.customerPhone}</span>
                          ) : (
                            <span style={{ color: 'var(--color-on-surface-variant)', opacity: 0.5, fontStyle: 'italic', fontSize: '11.5px' }}>
                              — No Phone
                            </span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <strong style={{ fontSize: '13px' }}>{formatCurrency(finalCost)}</strong>
                            <span style={{ fontSize: '10px', color: '#059669', fontWeight: 700 }}>✓ Settled</span>
                          </div>
                        </td>
                        <td>
                          {ticket.assignedTechnician ? (
                            <span className={styles.cardTech}>
                              <span className={styles.techAvatarCircle}>{ticket.assignedTechnician[0]}</span>
                              {ticket.assignedTechnician}
                            </span>
                          ) : (
                            <span style={{ opacity: 0.4 }}>—</span>
                          )}
                        </td>
                        <td style={{ fontSize: '11.5px', color: 'var(--color-on-surface-variant)' }}>
                          <div>{new Date(settledDate).toLocaleDateString()}</div>
                          <div style={{ fontSize: '10px', opacity: 0.7 }}>{formatTimeAgo(settledDate)}</div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }} onClick={e => e.stopPropagation()}>
                            <button
                              type="button"
                              className={styles.cardPrintBtn}
                              onClick={() => handlePrintTicket(ticket)}
                              title="Print thermal device sticker / receipt"
                            >
                              <Printer size={12} />
                            </button>
                            <button
                              type="button"
                              className={styles.cardPrintBtn}
                              onClick={() => setSelectedTicket(ticket)}
                              title="View full ticket details"
                            >
                              <Eye size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* HISTORY TABLE VIEW */}
      {viewMode === 'history' && (
        <div className={styles.historyTableWrapper}>
          <table className={styles.historyTable}>
            <thead>
              <tr>
                <th>Ticket #</th>
                <th>Device</th>
                <th>Issue / Problem</th>
                <th>Customer</th>
                <th>Contact</th>
                <th>Cost</th>
                <th>Technician</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '40px', color: 'var(--color-on-surface-variant)' }}>
                    No repair tickets match your filters.
                  </td>
                </tr>
              ) : (
                filtered
                  .slice()
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                  .map(ticket => {
                    const issue = detectIssueTag(ticket.issueDescription);
                    const brandIcon = getBrandIcon(ticket.deviceBrand);
                    return (
                      <tr
                        key={ticket.id}
                        className={styles.historyTableRow}
                        onClick={() => setSelectedTicket(ticket)}
                      >
                        <td>
                          <span className={styles.cardTicketBadge}>{ticket.ticketNumber}</span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 700 }}>{brandIcon} {ticket.deviceBrand} {ticket.deviceModel}</span>
                        </td>
                        <td>
                          <span className={styles.cardProblemTag}>
                            <span>{issue.icon}</span>
                            <span>{issue.label}</span>
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={(e) => handleOpenCustomerProfile(e, ticket)}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              color: 'inherit',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontWeight: 600,
                            }}
                            title="Open Customer Profile & History"
                          >
                            <User size={12} style={{ color: 'var(--color-primary)' }} />
                            <span style={{ textDecoration: 'underline' }}>{ticket.customerName}</span>
                          </button>
                        </td>
                        <td style={{ color: 'var(--color-on-surface-variant)' }}>{ticket.customerPhone || '—'}</td>
                        <td>
                          <strong>{ticket.actualCost ? formatCurrency(ticket.actualCost) : `~${formatCurrency(ticket.estimatedCost)}`}</strong>
                        </td>
                        <td>
                          {ticket.assignedTechnician ? (
                            <span className={styles.cardTech}>
                              <span className={styles.techAvatarCircle}>{ticket.assignedTechnician[0]}</span>
                              {ticket.assignedTechnician}
                            </span>
                          ) : (
                            <span style={{ opacity: 0.4 }}>—</span>
                          )}
                        </td>
                        <td>
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            background:
                              ticket.status === 'ready' ? 'rgba(16, 185, 129, 0.1)' :
                              ticket.status === 'in_progress' ? 'rgba(59, 130, 246, 0.1)' :
                              ticket.status === 'completed' ? 'rgba(100, 116, 139, 0.1)' :
                              ticket.status === 'returned' ? 'rgba(239, 68, 68, 0.1)' :
                              ticket.status === 'cancelled' ? 'rgba(100, 116, 139, 0.1)' :
                              'rgba(245, 158, 11, 0.1)',
                            color:
                              ticket.status === 'ready' ? '#059669' :
                              ticket.status === 'in_progress' ? '#2563eb' :
                              ticket.status === 'completed' ? '#475569' :
                              ticket.status === 'returned' ? '#dc2626' :
                              ticket.status === 'cancelled' ? '#64748b' :
                              '#d97706',
                          }}>
                            {ticket.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td style={{ fontSize: '11.5px', color: 'var(--color-on-surface-variant)' }}>
                          {new Date(ticket.createdAt).toLocaleDateString()}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={e => e.stopPropagation()}>
                            <button
                              type="button"
                              className={styles.cardPrintBtn}
                              onClick={() => handlePrintTicket(ticket)}
                              title="Print thermal device sticker / receipt"
                            >
                              <Printer size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* CANCELLED TICKETS VIEW */}
      {viewMode === 'cancelled' && (
        <div className={styles.historyTableWrapper}>
          {(() => {
            const cancelledTickets = uniqueTickets
              .filter(t => t.status === 'cancelled')
              .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());

            return cancelledTickets.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '60px 20px',
                color: 'var(--color-on-surface-variant)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
              }}>
                <XCircle size={40} style={{ opacity: 0.3 }} />
                <p style={{ fontSize: '15px', fontWeight: 600 }}>No cancelled repairs</p>
                <p style={{ fontSize: '12.5px', opacity: 0.7 }}>Cancelled tickets will appear here with an option to restore them.</p>
              </div>
            ) : (
              <table className={styles.historyTable}>
                <thead>
                  <tr>
                    <th>Ticket #</th>
                    <th>Device</th>
                    <th>Issue / Problem</th>
                    <th>Customer</th>
                    <th>Cost</th>
                    <th>Cancelled On</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cancelledTickets.map(ticket => {
                    const issue = detectIssueTag(ticket.issueDescription);
                    const brandIcon = getBrandIcon(ticket.deviceBrand);
                    return (
                      <tr
                        key={ticket.id}
                        className={styles.historyTableRow}
                        onClick={() => setSelectedTicket(ticket)}
                      >
                        <td>
                          <span className={styles.cardTicketBadge}>{ticket.ticketNumber}</span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '16px' }}>{brandIcon}</span>
                            <div>
                              <span style={{ fontWeight: 600, fontSize: '12.5px' }}>{ticket.deviceBrand}</span>
                              <br />
                              <span style={{ fontSize: '11.5px', color: 'var(--color-on-surface-variant)' }}>{ticket.deviceModel}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ fontSize: '14px' }}>{issue.icon}</span>
                            <span style={{ fontSize: '12px' }}>{issue.label}</span>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontSize: '12.5px' }}>{ticket.customerName}</span>
                        </td>
                        <td style={{ fontWeight: 600, fontSize: '12.5px' }}>
                          {formatCurrency(ticket.actualCost || ticket.estimatedCost || 0)}
                        </td>
                        <td style={{ fontSize: '11.5px', color: 'var(--color-on-surface-variant)' }}>
                          {ticket.updatedAt
                            ? new Date(ticket.updatedAt).toLocaleDateString()
                            : new Date(ticket.createdAt).toLocaleDateString()}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={e => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={async () => {
                                await updateStatus(ticket.id, 'pending');
                                toast.success('Ticket Restored', `Ticket ${ticket.ticketNumber} moved back to Pending.`);
                              }}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                padding: '5px 12px',
                                borderRadius: '8px',
                                background: '#eff6ff',
                                color: '#2563eb',
                                fontSize: '11.5px',
                                fontWeight: 700,
                                border: '1px solid #bfdbfe',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                              }}
                              title="Restore this ticket back to Pending"
                            >
                              <RotateCcw size={13} /> Restore
                            </button>
                            <button
                              type="button"
                              className={styles.cardPrintBtn}
                              onClick={() => handlePrintTicket(ticket)}
                              title="Print ticket"
                            >
                              <Printer size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}
        </div>
      )}

      {viewMode === 'settlements' && (
        <TechnicianSettlementsTab />
      )}
        </>
      )}
    </div>
  );
};

