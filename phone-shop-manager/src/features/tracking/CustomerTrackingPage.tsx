import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { repairService } from '../../services/repairService';
import { settingsService } from '../../services/settingsService';
import type { RepairTicket } from '../../types';
import type { StoreSettings } from '../../services/settingsService';
import { formatCurrency } from '../../utils/formatCurrency';
import styles from './CustomerTracking.module.css';

// ============================================================
// Status Stepper Configuration
// ============================================================

interface StepConfig {
  key: string;
  icon: string;
  label: string;
  description: string;
}

const STEPS: StepConfig[] = [
  { key: 'pending', icon: '⏳', label: 'Intake & Diagnostics', description: 'Device received, initial inspection underway.' },
  { key: 'in_progress', icon: '🔧', label: 'In Progress', description: 'Technician is actively repairing your device.' },
  { key: 'ready', icon: '📦', label: 'Ready for Pickup', description: 'Repair completed, quality checks passed. Your device is waiting at the counter.' },
  { key: 'completed', icon: '✅', label: 'Completed & Picked Up', description: 'Device delivered. Warranty active.' },
];

const STATUS_ORDER: Record<string, number> = {
  pending: 0,
  in_progress: 1,
  ready: 2,
  completed: 3,
};

// ============================================================
// Search Landing Page (when no ticket number is in URL)
// ============================================================

const SearchLanding: React.FC<{
  onSearch: (ticketNumber: string, pin: string) => void;
  isSearching: boolean;
  searchError: string | null;
  shopName: string;
  initialTicketNumber?: string;
}> = ({ onSearch, isSearching, searchError, shopName, initialTicketNumber = '' }) => {
  const [ticketInput, setTicketInput] = useState(initialTicketNumber);
  const [pinInput, setPinInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTicket = ticketInput.trim().toUpperCase();
    const cleanPin = pinInput.trim().toUpperCase();
    if (cleanTicket && cleanPin) onSearch(cleanTicket, cleanPin);
  };

  return (
    <div className={styles.searchLanding}>
      <div className={styles.logoIcon}>🔍</div>
      <div>
        <h1 className={styles.searchTitle}>Track Your Repair</h1>
        <p className={styles.searchSubtitle}>
          Enter your ticket number and PIN to see the live status of your device repair at {shopName || 'our shop'}.
        </p>
      </div>
      <form className={styles.searchBox} onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Ticket Number (e.g. TKT-0042)"
          value={ticketInput}
          onChange={(e) => setTicketInput(e.target.value)}
          autoFocus={!initialTicketNumber}
          autoComplete="off"
          maxLength={20}
        />
        <input
          type="text"
          className={styles.searchInput}
          placeholder="4-Digit PIN (e.g. A8X2)"
          value={pinInput}
          onChange={(e) => setPinInput(e.target.value)}
          autoFocus={!!initialTicketNumber}
          autoComplete="off"
          maxLength={10}
        />
        <button
          type="submit"
          className={styles.searchBtn}
          disabled={!ticketInput.trim() || !pinInput.trim() || isSearching}
        >
          {isSearching ? (
            <>
              <div className={styles.loadingSpinner} style={{ width: 18, height: 18, borderWidth: 2 }} />
              Searching…
            </>
          ) : (
            <>🔎 Look Up Ticket</>
          )}
        </button>
      </form>
      {searchError && <div className={styles.searchError}>{searchError}</div>}
    </div>
  );
};

// ============================================================
// Main Tracking Page
// ============================================================

export const CustomerTrackingPage: React.FC = () => {
  const { ticketNumber } = useParams<{ ticketNumber?: string }>();
  const [searchParams] = useSearchParams();
  const pin = searchParams.get('pin') || '';
  const navigate = useNavigate();

  const [ticket, setTicket] = useState<RepairTicket | null>(null);
  const [isLoading, setIsLoading] = useState(!!(ticketNumber && pin));
  const [notFound, setNotFound] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Shop settings (loaded independently — no auth required)
  const [shopSettings, setShopSettings] = useState<Partial<StoreSettings>>({
    storeName: '',
    currency: 'DZD',
    storePhone: '',
    storeAddress: '',
  });

  // Load shop settings (one-time, read-only)
  useEffect(() => {
    settingsService.getSettings().then((s) => {
      if (s) {
        setShopSettings({
          storeName: s.storeName || '',
          currency: s.currency || 'DZD',
          storePhone: s.storePhone || '',
          storeAddress: s.storeAddress || '',
        });
      }
    }).catch(() => {/* ignore - use defaults */});
  }, []);

  // Subscribe to real-time ticket updates when we have a ticket number AND a pin
  useEffect(() => {
    if (!ticketNumber || !pin) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setNotFound(false);

    const unsubscribe = repairService.subscribeToTicketByNumber(
      ticketNumber,
      pin,
      (t) => {
        setIsLoading(false);
        if (t) {
          setTicket(t);
          setNotFound(false);
        } else {
          setTicket(null);
          setNotFound(true);
        }
      }
    );

    return () => unsubscribe();
  }, [ticketNumber, pin]);

  // Handle manual search
  const handleSearch = useCallback(async (queryTicket: string, queryPin: string) => {
    setSearchError(null);
    setIsSearching(true);

    // Normalize: add TKT- prefix if user just typed a number
    let cleanQuery = queryTicket.trim().toUpperCase();
    if (/^\d+$/.test(cleanQuery)) {
      cleanQuery = `TKT-${cleanQuery.padStart(4, '0')}`;
    }
    if (!cleanQuery.startsWith('TKT-')) {
      cleanQuery = `TKT-${cleanQuery.replace(/^TKT-?/i, '')}`;
    }

    try {
      const found = await repairService.getTicketByNumber(cleanQuery, queryPin);
      setIsSearching(false);
      if (found) {
        navigate(`/track/${found.ticketNumber}?pin=${queryPin.trim().toUpperCase()}`, { replace: true });
      } else {
        setSearchError(`Invalid Ticket Number or PIN. Please double-check your receipt.`);
      }
    } catch {
      setIsSearching(false);
      setSearchError('Unable to look up the ticket. Please check your connection and try again.');
    }
  }, [navigate]);

  // ---- Format helpers ----
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });

  const formatDateTime = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  // ---- Render: No ticket number or no PIN in URL → Search page ----
  if (!ticketNumber || !pin) {
    return (
      <div className={styles.trackingPage}>
        <SearchLanding
          onSearch={handleSearch}
          isSearching={isSearching}
          searchError={searchError}
          shopName={shopSettings.storeName || ''}
          initialTicketNumber={ticketNumber || ''}
        />
      </div>
    );
  }

  // ---- Render: Loading ----
  if (isLoading) {
    return (
      <div className={styles.trackingPage}>
        <div className={styles.loadingState}>
          <div className={styles.loadingSpinner} />
          <span className={styles.loadingText}>Fetching your repair status…</span>
        </div>
      </div>
    );
  }

  // ---- Render: Not Found ----
  if (notFound || !ticket) {
    return (
      <div className={styles.trackingPage}>
        <div className={styles.notFound}>
          <div className={styles.notFoundIcon}>🔍</div>
          <h2 className={styles.notFoundTitle}>Ticket Not Found</h2>
          <p className={styles.notFoundDesc}>
            We couldn't find a matching repair ticket for <strong>{ticketNumber}</strong> with that PIN. Please verify the details on your intake slip.
          </p>
          <a className={styles.backLink} href="/track">
            ← Search again
          </a>
        </div>
      </div>
    );
  }

  // ---- Compute active step index ----
  const activeStepIndex = STATUS_ORDER[ticket.status] ?? -1;
  const isReturned = ticket.status === 'returned';
  const isCancelled = ticket.status === 'cancelled';

  // Financial calculations
  const totalCost = ticket.actualCost ?? ticket.estimatedCost ?? 0;
  const deposit = ticket.depositAmount || 0;
  const balanceDue = Math.max(0, totalCost - deposit);
  const isPaid = balanceDue <= 0 && totalCost > 0;

  // Phone number for contact
  const shopPhone = shopSettings.storePhone || '';
  const cleanPhone = shopPhone.replace(/[^0-9+]/g, '');
  const whatsappMsg = encodeURIComponent(
    `Hello! I am inquiring about my repair ticket #${ticket.ticketNumber}. Could you please provide an update?`
  );

  // Find timestamp for each status from history
  const getStatusTimestamp = (status: string): string | null => {
    if (!ticket.statusHistory) return null;
    const entry = ticket.statusHistory.find(h => h.status === status);
    return entry ? entry.at : null;
  };

  return (
    <div className={styles.trackingPage}>
      <div className={styles.trackingCard}>

        {/* ---- Header ---- */}
        <div className={styles.cardHeader}>
          <p className={styles.shopName}>{shopSettings.storeName || 'Phone Repair Shop'}</p>
          <h1 className={styles.ticketNumber}>{ticket.ticketNumber}</h1>
          <p className={styles.deviceName}>{ticket.deviceBrand} {ticket.deviceModel}</p>
          <div className={styles.liveIndicator}>
            <span className={styles.liveDot} />
            Live Updates
          </div>
        </div>

        {/* ---- Status Stepper ---- */}
        <div className={styles.stepperSection}>
          <h2 className={styles.stepperTitle}>Repair Progress</h2>
          <div className={styles.stepper}>
            {STEPS.map((step, index) => {
              let state: 'completed' | 'active' | 'future' = 'future';
              if (isCancelled || isReturned) {
                // Show all steps as a dimmed state
                state = index <= activeStepIndex ? 'completed' : 'future';
              } else if (index < activeStepIndex) {
                state = 'completed';
              } else if (index === activeStepIndex) {
                state = 'active';
              }

              const timestamp = getStatusTimestamp(step.key);

              return (
                <div
                  key={step.key}
                  className={[
                    styles.step,
                    state === 'completed' && styles.stepCompleted,
                    state === 'active' && styles.stepActive,
                    state === 'future' && styles.stepFuture,
                  ].filter(Boolean).join(' ')}
                >
                  <div
                    className={[
                      styles.stepDot,
                      state === 'completed' && styles.dotCompleted,
                      state === 'active' && styles.dotActive,
                      state === 'future' && styles.dotPending,
                    ].filter(Boolean).join(' ')}
                  >
                    {state === 'completed' ? '✓' : step.icon}
                  </div>
                  <div className={styles.stepContent}>
                    <p className={styles.stepLabel}>{step.label}</p>
                    <p className={styles.stepDesc}>{step.description}</p>
                    {timestamp && (
                      <span className={styles.stepTimestamp}>{formatDateTime(timestamp)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Special statuses */}
          {isReturned && (
            <div className={styles.returnedBadge}>
              ⚠️ Device returned for warranty inspection
              {ticket.returnReason && <span> — {ticket.returnReason}</span>}
            </div>
          )}
          {isCancelled && (
            <div className={styles.cancelledBadge}>
              ✕ This repair has been cancelled
            </div>
          )}
        </div>

        {/* ---- Device & Issue Info ---- */}
        <div className={styles.infoSection}>
          <h2 className={styles.infoTitle}>Device Details</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Device</span>
              <span className={styles.infoValue}>{ticket.deviceBrand} {ticket.deviceModel}</span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Drop-off Date</span>
              <span className={styles.infoValue}>{formatDate(ticket.createdAt)}</span>
            </div>
            {ticket.estimatedCompletionDate && (
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Est. Completion</span>
                <span className={styles.infoValue}>{formatDate(ticket.estimatedCompletionDate)}</span>
              </div>
            )}
            <div className={styles.infoItem} style={{ gridColumn: '1 / -1' }}>
              <span className={styles.infoLabel}>Reported Issue</span>
              <span className={`${styles.infoValue} ${styles.issueDesc}`}>
                {ticket.issueDescription || 'Diagnostic required'}
              </span>
            </div>
            {ticket.remark && (
              <div className={styles.remarkBox}>
                <div className={styles.remarkHeader}>
                  <span className={styles.remarkIcon}>🔍</span>
                  <span className={styles.remarkTitle}>Technician Remark & Workshop Findings</span>
                </div>
                <p className={styles.remarkText}>{ticket.remark}</p>
              </div>
            )}
          </div>
        </div>

        {/* ---- Financial Summary ---- */}
        <div className={styles.infoSection}>
          <h2 className={styles.infoTitle}>Financial Summary</h2>
          <div>
            <div className={styles.financeRow}>
              <span className={styles.financeLabel}>
                {ticket.actualCost ? 'Final Cost' : 'Estimated Cost'}
              </span>
              <span className={styles.financeValue}>
                {formatCurrency(totalCost, false)}
              </span>
            </div>
            {deposit > 0 && (
              <div className={styles.financeRow}>
                <span className={styles.financeLabel}>Deposit Paid</span>
                <span className={styles.financeValue} style={{ color: '#4ade80' }}>
                  −{formatCurrency(deposit, false)}
                </span>
              </div>
            )}
            <div className={styles.financeRow}>
              <span className={styles.financeLabel}>Balance Due</span>
              {isPaid ? (
                <span className={styles.paidBadge}>✓ PAID IN FULL</span>
              ) : (
                <span className={styles.balanceBadge}>
                  {formatCurrency(balanceDue, false)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ---- Contact Bar ---- */}
        {cleanPhone && (
          <div className={styles.contactBar}>
            <a
              href={`tel:${cleanPhone}`}
              className={`${styles.contactBtn} ${styles.callBtn}`}
            >
              📞 Call Shop
            </a>
            <a
              href={`https://wa.me/${cleanPhone.replace(/^\+/, '')}?text=${whatsappMsg}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.contactBtn} ${styles.whatsappBtn}`}
            >
              💬 WhatsApp
            </a>
          </div>
        )}

        {/* ---- Store Info Footer ---- */}
        {shopSettings.storeAddress && (
          <div className={styles.infoSection} style={{ textAlign: 'center', fontSize: '13px', color: '#94a3b8' }}>
            <p style={{ margin: 0 }}>📍 {shopSettings.storeAddress}</p>
          </div>
        )}

        {/* ---- Footer ---- */}
        <div className={styles.trackingFooter}>
          <p>This page updates automatically in real-time.</p>
          <p>Powered by {shopSettings.storeName || 'Phone Repair Manager'}</p>
        </div>
      </div>
    </div>
  );
};
