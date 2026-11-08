import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Package, ShoppingCart, Wrench, Monitor, Clock, User, ArrowUpRight, Search, RefreshCw, Download, Calendar, X, Trash2, Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { useActivityStore } from '../../store/activityStore';
import type { Activity, ActivityCategory, ActivitySeverity } from '../../store/activityStore';
import { useAuthStore } from '../../store/authStore';
import styles from './Activity.module.css';
import { errorMessage } from '../../utils/errorUtils';
import { normalizeArabic } from '../../utils/normalizeText';

// ─── Helpers ─────────────────────────────────────────────────
const getCategoryIcon = (category: ActivityCategory) => {
  switch (category) {
    case 'inventory': return <Package size={18} />;
    case 'sales': return <ShoppingCart size={18} />;
    case 'repairs': return <Wrench size={18} />;
    case 'system': return <Monitor size={18} />;
  }
};

const getCategoryBadgeClass = (category: ActivityCategory) => {
  switch (category) {
    case 'inventory': return styles.badgeInventory;
    case 'sales': return styles.badgeSales;
    case 'repairs': return styles.badgeRepairs;
    case 'system': return styles.badgeSystem;
  }
};

const getSeverityClass = (severity: ActivitySeverity) => {
  switch (severity) {
    case 'danger': return styles.severityDanger;
    case 'warning': return styles.severityWarning;
    case 'success': return styles.severitySuccess;
    case 'info':
    default:
      return styles.severityInfo;
  }
};

const getFeedItemSeverityBorder = (severity: ActivitySeverity) => {
  switch (severity) {
    case 'danger': return styles.feedItemDanger;
    case 'warning': return styles.feedItemWarning;
    case 'success': return styles.feedItemSuccess;
    case 'info':
    default:
      return styles.feedItemInfo;
  }
};

/** Deterministic Deep Link Resolver */
export const resolveActivityLink = (activity: Activity): { path: string; label: string } => {
  const msg = activity.message || '';
  const detail = activity.detail || '';
  const entityId = activity.entityId;
  const entityType = activity.entityType;

  // 1. Direct entityType + entityId resolution (100% reliable)
  if (entityId) {
    if (entityType === 'repair' || activity.category === 'repairs') {
      return {
        path: `/repairs?search=${encodeURIComponent(entityId)}&focusId=${encodeURIComponent(entityId)}`,
        label: `Ticket #${entityId}`,
      };
    }
    if (entityType === 'sale' || (activity.category === 'sales' && !msg.startsWith('Customer:'))) {
      return {
        path: `/pos?tab=history&search=${encodeURIComponent(entityId)}&focusId=${encodeURIComponent(entityId)}`,
        label: `Order #${entityId}`,
      };
    }
    if (entityType === 'customer' || (activity.category === 'sales' && msg.startsWith('Customer:'))) {
      return {
        path: `/customers?focusId=${encodeURIComponent(entityId)}`,
        label: 'View Customer',
      };
    }
    if (entityType === 'part') {
      return {
        path: `/parts?focusId=${encodeURIComponent(entityId)}`,
        label: 'Open in Parts',
      };
    }
    if (entityType === 'product') {
      return {
        path: `/inventory?focusId=${encodeURIComponent(entityId)}`,
        label: 'Open in Inventory',
      };
    }
    if (entityType === 'po') {
      return {
        path: `/purchasing?tab=orders&po=${encodeURIComponent(entityId)}`,
        label: `View PO ${entityId}`,
      };
    }
    if (entityType === 'supplier') {
      return {
        path: `/purchasing?tab=suppliers&search=${encodeURIComponent(entityId)}`,
        label: 'View Supplier',
      };
    }
  }

  // 2. Safe Regex Fallback for legacy items
  if (activity.category === 'sales' && msg.startsWith('Customer:')) {
    return { path: '/customers', label: 'View Customers' };
  }

  if (activity.category === 'sales') {
    const txMatch = msg.match(/transaction\s*#?([a-zA-Z0-9_-]+)/i);
    if (txMatch?.[1]) {
      return {
        path: `/pos?tab=history&search=${encodeURIComponent(txMatch[1])}&focusId=${encodeURIComponent(txMatch[1])}`,
        label: `Order #${txMatch[1]}`,
      };
    }
    return { path: '/pos?tab=history', label: 'View Sales' };
  }

  if (activity.category === 'repairs') {
    const ticketMatch = msg.match(/(REP-[0-9]+)/i) || msg.match(/ticket\s*#?([a-zA-Z0-9_-]+)/i);
    if (ticketMatch?.[1]) {
      return {
        path: `/repairs?search=${encodeURIComponent(ticketMatch[1])}&focusId=${encodeURIComponent(ticketMatch[1])}`,
        label: `Ticket ${ticketMatch[1]}`,
      };
    }
    return { path: '/repairs', label: 'View Repairs' };
  }

  if (activity.category === 'inventory') {
    if (msg.toLowerCase().includes('po:') || msg.toLowerCase().includes('purchase order')) {
      const poMatch = msg.match(/PO:?\s*([a-zA-Z0-9_-]+)/i);
      return {
        path: `/purchasing?tab=orders${poMatch ? `&po=${encodeURIComponent(poMatch[1])}` : ''}`,
        label: poMatch ? `View PO ${poMatch[1]}` : 'Purchasing',
      };
    }
    if (msg.toLowerCase().includes('supplier:')) {
      const supMatch = msg.match(/supplier[:\s]+([^,]+)/i);
      return {
        path: `/purchasing?tab=suppliers${supMatch ? `&search=${encodeURIComponent(supMatch[1].trim())}` : ''}`,
        label: 'Suppliers',
      };
    }
    if (msg.toLowerCase().includes('part') || detail.toLowerCase().includes('repair_part')) {
      return { path: '/parts', label: 'Open in Parts' };
    }
    return { path: '/inventory', label: 'View Inventory' };
  }

  if (activity.category === 'system') {
    if (msg.toLowerCase().includes('staff') || msg.toLowerCase().includes('user') || msg.toLowerCase().includes('member')) {
      return { path: '/settings?tab=users', label: 'View Staff' };
    }
    return { path: '/settings', label: 'View Settings' };
  }

  return { path: '/', label: 'View' };
};

// ─── Component ───────────────────────────────────────────────
export const ActivityPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { user, staff, fetchStaff } = useAuthStore();
  const {
    activities,
    isLoading,
    isLive,
    lastUpdated,
    fetchActivities,
    subscribeActivities,
    limitCount,
    setLimitCount,
    purgeOldLogs,
  } = useActivityStore();

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<ActivityCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [staffFilter, setStaffFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday' | 'this_week' | 'this_month'>('all');
  const [severityFilter, setSeverityFilter] = useState<ActivitySeverity | 'all'>('all');

  // Purge modal state
  const [isPurging, setIsPurging] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Initialize staff & subscribe to real-time feed
  useEffect(() => {
    fetchStaff();
    const unsubscribe = subscribeActivities();
    return () => unsubscribe();
  }, [fetchStaff, subscribeActivities]);

  // Relative formatted time
  const formatTime = (isoString: string) => {
    const d = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return t('common.justNow', 'Just now');
    if (diffMins < 60) return `${diffMins}m ${t('common.ago', 'ago')}`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ${t('common.ago', 'ago')}`;

    return d.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
  };

  // Manual refresh handler
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchActivities();
    setIsRefreshing(false);
    toast.success(t('common.refreshed', 'Refreshed'), t('activity.refreshedMsg', 'Activity feed updated to latest events.'));
  };

  // Date boundaries for filtering
  const dateBoundaries = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;
    const weekStart = todayStart - (now.getDay() * 86400000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return { todayStart, yesterdayStart, weekStart, monthStart };
  }, []);

  // Filtered Activities
  const filtered = useMemo(() => {
    return activities.filter(a => {
      // 1. Category Filter
      if (categoryFilter !== 'all' && a.category !== categoryFilter) return false;

      // 2. Staff Filter
      if (staffFilter !== 'all') {
        const matchesStaff = a.userId === staffFilter || a.userName?.toLowerCase() === staffFilter.toLowerCase();
        if (!matchesStaff) return false;
      }

      // 3. Severity Filter
      if (severityFilter !== 'all' && a.severity !== severityFilter) return false;

      // 4. Date Filter
      if (dateFilter !== 'all') {
        const time = new Date(a.timestamp).getTime();
        if (dateFilter === 'today' && time < dateBoundaries.todayStart) return false;
        if (dateFilter === 'yesterday' && (time < dateBoundaries.yesterdayStart || time >= dateBoundaries.todayStart)) return false;
        if (dateFilter === 'this_week' && time < dateBoundaries.weekStart) return false;
        if (dateFilter === 'this_month' && time < dateBoundaries.monthStart) return false;
      }

      // 5. Search Query
      if (searchQuery.trim()) {
        const query = normalizeArabic(searchQuery);
        const inMsg = normalizeArabic(a.message).includes(query);
        const inDetail = normalizeArabic(a.detail).includes(query);
        const inId = normalizeArabic(a.entityId).includes(query);
        const inUser = normalizeArabic(a.userName).includes(query);
        if (!inMsg && !inDetail && !inId && !inUser) return false;
      }

      return true;
    });
  }, [activities, categoryFilter, staffFilter, severityFilter, dateFilter, searchQuery, dateBoundaries]);

  // Grouping by Date (Today, Yesterday, Earlier Date)
  const grouped = useMemo(() => {
    const groups: { title: string; items: Activity[] }[] = [];
    const groupMap = new Map<string, Activity[]>();

    filtered.forEach(item => {
      const d = new Date(item.timestamp);
      const itemTime = d.getTime();
      let key = '';

      if (itemTime >= dateBoundaries.todayStart) {
        key = t('common.today', 'Today');
      } else if (itemTime >= dateBoundaries.yesterdayStart) {
        key = t('common.yesterday', 'Yesterday');
      } else {
        key = d.toLocaleDateString(i18n.language, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
        });
      }

      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key)!.push(item);
    });

    groupMap.forEach((items, title) => {
      groups.push({ title, items });
    });

    return groups;
  }, [filtered, dateBoundaries, i18n.language, t]);

  // Export filtered activities
  const handleExport = (format: 'csv' | 'json') => {
    const timestampStr = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `activity_audit_log_${timestampStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      const headers = ['Timestamp', 'Category', 'Severity', 'Message', 'Detail', 'Staff Member', 'Entity ID'];
      const rows = filtered.map(a => [
        `"${a.timestamp}"`,
        `"${a.category}"`,
        `"${a.severity}"`,
        `"${(a.message || '').replace(/"/g, '""')}"`,
        `"${(a.detail || '').replace(/"/g, '""')}"`,
        `"${(a.userName || '').replace(/"/g, '""')}"`,
        `"${a.entityId || ''}"`,
      ]);
      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `activity_audit_log_${timestampStr}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    toast.success(t('common.exported', 'Export Complete'), `Exported ${filtered.length} audit logs as ${format.toUpperCase()}`);
  };

  // Admin Old Log Purge
  const handlePurgeLogs = async () => {
    if (!window.confirm('Are you sure you want to delete activity logs older than 90 days? We recommend exporting a backup first. This action cannot be undone.')) {
      return;
    }
    setIsPurging(true);
    try {
      const deletedCount = await purgeOldLogs(90);
      toast.success(t('settings.purged', 'Logs Cleaned'), `Successfully deleted ${deletedCount} archived logs older than 90 days.`);
    } catch (err: unknown) {
      toast.error('Cleanup Failed', errorMessage(err) || 'Could not purge logs.');
    } finally {
      setIsPurging(false);
    }
  };

  // Category counts
  const counts = useMemo(() => {
    const res = { all: activities.length, sales: 0, repairs: 0, inventory: 0, system: 0 };
    activities.forEach(a => {
      if (res[a.category] !== undefined) res[a.category]++;
    });
    return res;
  }, [activities]);

  return (
    <div className={styles.page}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div className={styles.titleSection}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{t('activity.title', 'Activity Journal')}</h1>
            {isLive && (
              <span className={styles.liveBadge} title="Connected to real-time store updates">
                <span className={styles.pulseDot} />
                Live Feed
              </span>
            )}
          </div>
          <p className={styles.subtitle}>
            {t('activity.subtitle', 'Track live sales, ticket diagnostics, inventory shifts, and staff access in your shop.')}
          </p>
        </div>

        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            leftIcon={isRefreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          >
            {isRefreshing ? t('common.loading', 'Loading…') : t('common.refresh', 'Refresh')}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleExport('csv')}
            disabled={filtered.length === 0}
            leftIcon={<Download size={14} />}
          >
            {t('common.export', 'Export CSV')}
          </Button>

          {user?.role === 'admin' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handlePurgeLogs}
              disabled={isPurging}
              leftIcon={isPurging ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              title="Clean logs older than 90 days to free Firestore storage"
            >
              {isPurging ? 'Cleaning…' : 'Purge > 90d'}
            </Button>
          )}
        </div>
      </div>

      {/* ── Search & Filter Controls Strip ── */}
      <div className={styles.controlsStrip}>
        <div className={styles.filterRow}>
          {/* Universal Search */}
          <div className={styles.searchBox}>
            <Search size={15} className={styles.searchIcon} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('activity.searchPlaceholder', 'Search ticket #, order #, device, customer, staff…')}
              className={styles.searchInput}
            />
            {searchQuery && (
              <button className={styles.clearSearchBtn} onClick={() => setSearchQuery('')}>
                <X size={14} />
              </button>
            )}
          </div>

          {/* Date Range Dropdown */}
          <select
            className={styles.selectDropdown}
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value as typeof dateFilter)}
          >
            <option value="all">📅 {t('common.allTime', 'All Dates')}</option>
            <option value="today">📅 {t('common.today', 'Today')}</option>
            <option value="yesterday">📅 {t('common.yesterday', 'Yesterday')}</option>
            <option value="this_week">📅 {t('common.thisWeek', 'This Week')}</option>
            <option value="this_month">📅 {t('common.thisMonth', 'This Month')}</option>
          </select>

          {/* Staff Member Dropdown */}
          <select
            className={styles.selectDropdown}
            value={staffFilter}
            onChange={e => setStaffFilter(e.target.value)}
          >
            <option value="all">👤 {t('common.allStaff', 'All Staff')}</option>
            {staff.map(s => (
              <option key={s.id} value={s.id}>
                👤 {s.name} ({s.role})
              </option>
            ))}
          </select>

          {/* Severity Dropdown */}
          <select
            className={styles.selectDropdown}
            value={severityFilter}
            onChange={e => setSeverityFilter(e.target.value as typeof severityFilter)}
          >
            <option value="all">⚡ All Severities</option>
            <option value="danger">🔴 Critical / Destructive</option>
            <option value="warning">🟡 Warnings & Unlocks</option>
            <option value="success">🟢 Completed Actions</option>
            <option value="info">🔵 General Info</option>
          </select>
        </div>

        {/* Category Filter Pills */}
        <div className={styles.categories}>
          <button
            className={[styles.catBtn, categoryFilter === 'all' && styles.catBtnActive].filter(Boolean).join(' ')}
            onClick={() => setCategoryFilter('all')}
          >
            <span>{t('activity.allEvents', 'All Activity')}</span>
            <span className={styles.catCount}>{counts.all}</span>
          </button>
          <button
            className={[styles.catBtn, categoryFilter === 'sales' && styles.catBtnActive].filter(Boolean).join(' ')}
            onClick={() => setCategoryFilter('sales')}
          >
            <ShoppingCart size={13} />
            <span>{t('activity.sales', 'Sales')}</span>
            <span className={styles.catCount}>{counts.sales}</span>
          </button>
          <button
            className={[styles.catBtn, categoryFilter === 'repairs' && styles.catBtnActive].filter(Boolean).join(' ')}
            onClick={() => setCategoryFilter('repairs')}
          >
            <Wrench size={13} />
            <span>{t('activity.repairs', 'Repairs')}</span>
            <span className={styles.catCount}>{counts.repairs}</span>
          </button>
          <button
            className={[styles.catBtn, categoryFilter === 'inventory' && styles.catBtnActive].filter(Boolean).join(' ')}
            onClick={() => setCategoryFilter('inventory')}
          >
            <Package size={13} />
            <span>{t('activity.inventory', 'Inventory & Parts')}</span>
            <span className={styles.catCount}>{counts.inventory}</span>
          </button>
          <button
            className={[styles.catBtn, categoryFilter === 'system' && styles.catBtnActive].filter(Boolean).join(' ')}
            onClick={() => setCategoryFilter('system')}
          >
            <Monitor size={13} />
            <span>{t('common.system', 'System & Users')}</span>
            <span className={styles.catCount}>{counts.system}</span>
          </button>
        </div>
      </div>

      {/* ── Feed List ── */}
      {isLoading && activities.length === 0 ? (
        <div className={styles.emptyState}>
          <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px', color: 'var(--color-primary)' }} />
          <p className={styles.emptyStateText}>{t('activity.loading', 'Streaming activity journal…')}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <Calendar size={32} style={{ margin: '0 auto 8px', color: 'var(--color-on-surface-variant)', opacity: 0.5 }} />
          <h3 className={styles.emptyStateTitle}>{t('activity.noActivity', 'No activity found for this filter')}</h3>
          <p className={styles.emptyStateText}>
            {searchQuery || staffFilter !== 'all' || dateFilter !== 'all'
              ? 'Try adjusting your search query, staff filter, or date range.'
              : 'As actions are performed in the shop, they will appear here in real time.'}
          </p>
        </div>
      ) : (
        <div className={styles.feed}>
          {grouped.map(group => (
            <div key={group.title}>
              {/* Sticky Date Group Header */}
              <div className={styles.dateGroupHeader}>
                <span className={styles.dateGroupTitle}>{group.title}</span>
                <div className={styles.dateGroupLine} />
                <span className={styles.dateGroupCount}>{group.items.length} events</span>
              </div>

              {/* Items in Day Group */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {group.items.map(activity => {
                  const target = resolveActivityLink(activity);
                  const isDestructive = activity.severity === 'danger';
                  const isWarning = activity.severity === 'warning';

                  return (
                    <div
                      key={activity.id}
                      className={[styles.feedItem, getFeedItemSeverityBorder(activity.severity)].join(' ')}
                      onClick={() => navigate(target.path)}
                      title={`Click to open: ${target.label}`}
                    >
                      <div className={styles.feedIconWrapper}>
                        <div className={styles.feedIcon} style={{
                          color: isDestructive ? '#ef4444' : isWarning ? '#f59e0b' : undefined,
                          background: isDestructive ? 'rgba(239, 68, 68, 0.1)' : isWarning ? 'rgba(245, 158, 11, 0.1)' : undefined,
                        }}>
                          {getCategoryIcon(activity.category)}
                        </div>
                      </div>

                      <div className={styles.feedContent}>
                        <p className={styles.feedMessage}>{activity.message}</p>
                        {activity.detail && (
                          <div className={styles.feedDetail}>
                            {activity.detail}
                          </div>
                        )}
                        <div className={styles.feedMeta}>
                          {/* Severity Badge for Warning or Danger */}
                          {activity.severity !== 'info' && activity.severity !== 'success' && (
                            <span className={[styles.severityBadge, getSeverityClass(activity.severity)].join(' ')}>
                              {activity.severity === 'danger' ? 'Critical' : 'Alert'}
                            </span>
                          )}

                          {/* Category Badge */}
                          <span className={[styles.feedBadge, getCategoryBadgeClass(activity.category)].join(' ')}>
                            {activity.category}
                          </span>

                          {/* Relative / Local Time */}
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Clock size={12} />
                            {formatTime(activity.timestamp)}
                          </span>

                          {/* Actor */}
                          {activity.userName && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 500 }}>
                              <User size={12} /> {activity.userName}
                            </span>
                          )}

                          {/* Action Button */}
                          <span className={styles.feedActionBtn}>
                            {target.label} <ArrowUpRight size={13} />
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Footer Pagination & Range Control ── */}
      <div className={styles.paginationBar}>
        <div>
          Showing <strong>{filtered.length}</strong> of <strong>{activities.length}</strong> loaded events
          {lastUpdated && (
            <span style={{ opacity: 0.7, marginLeft: '8px' }}>
              • Synced at {new Date(lastUpdated).toLocaleTimeString(i18n.language)}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>Buffer Limit:</span>
          <select
            className={styles.selectDropdown}
            style={{ padding: '4px 8px', fontSize: '12px' }}
            value={limitCount}
            onChange={e => setLimitCount(Number(e.target.value))}
          >
            <option value="100">100 records</option>
            <option value="200">200 records</option>
            <option value="350">350 records</option>
            <option value="500">500 records</option>
          </select>
        </div>
      </div>
    </div>
  );
};
