import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Alert, ScrollView, RefreshControl, Linking, Vibration } from 'react-native';
import { Appbar, Card, Text, FAB, useTheme, ActivityIndicator, Searchbar } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRepairStore } from '../store/repairStore';
import { useAuthStore } from '../store/authStore';
import { usePermissions } from '../hooks/usePermissions';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RoleBottomNav } from '../components/RoleBottomNav';
import { buildSearch, matchesSearch } from '../utils/search';
import {
  colors,
  fontSize,
  radius,
  ramp,
  repairStatusColors,
  spacing,
  statusAppearance,
  tintedPill,
} from '../theme/tokens';

const getTimeAgo = (dateStr: string): string => {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks}w ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const statusInk = (status: string) => statusAppearance(repairStatusColors, status).ink;

/** Filters that narrow the list by ownership or date rather than by status. */
const FILTER_SCOPES = ['all', 'today', 'my_repairs', 'others_repairs', 'unassigned'];

const monthYear = (createdAt: string) =>
  new Date(createdAt).toLocaleString('default', { month: 'long', year: 'numeric' });

const FILTER_STATUSES = [
  'all',
  'my_repairs',
  'others_repairs',
  'unassigned',
  'pending',
  'in_progress',
  'ready',
  'completed',
  'returned',
  'cancelled',
];

const chipFill = (status: string, isActive: boolean): { bg: string; text: string } => {
  if (!isActive) return { bg: colors.surface, text: colors.textSecondary };
  switch (status) {
    case 'others_repairs':
      return { bg: colors.violet, text: colors.onBrand };
    case 'unassigned':
      return { bg: ramp.slate500, text: colors.onBrand };
    case 'all':
    case 'my_repairs':
      return { bg: colors.brand, text: colors.onBrand };
    default:
      return { bg: statusInk(status), text: colors.onBrand };
  }
};

const EMPTY_ICONS: Record<string, string> = {
  all: 'clipboard-check-outline',
  my_repairs: 'account-check',
  others_repairs: 'account-group',
  unassigned: 'account-question',
  pending: 'clock-outline',
  in_progress: 'wrench',
  ready: 'check-circle-outline',
};

type WorkbenchHeaderProps = {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  statusFilter: string;
  onFilterChange: (status: string) => void;
  statusCounts: Record<string, number>;
  totalCount: number;
};

/**
 * Module-level, and passed to `ListHeaderComponent` as an element: an inline
 * arrow here would be a new component type on every render, so FlatList tore the
 * header down and rebuilt it — which dropped keyboard focus after one keystroke.
 */
const WorkbenchHeader = ({
  searchQuery,
  onSearchChange,
  statusFilter,
  onFilterChange,
  statusCounts,
  totalCount,
}: WorkbenchHeaderProps) => {
  const { t } = useTranslation();

  const stats = [
    { key: 'pending', count: statusCounts['pending'] || 0 },
    { key: 'in_progress', count: statusCounts['in_progress'] || 0 },
    { key: 'ready', count: statusCounts['ready'] || 0 },
  ];

  return (
    <>
      <View style={styles.statsRow}>
        {stats.map((stat, index) => (
          <React.Fragment key={stat.key}>
            {index > 0 && <View style={styles.statDivider} />}
            <View style={styles.statItem}>
              <View style={[styles.statDot, { backgroundColor: statusInk(stat.key) }]} />
              <Text style={styles.statNumber}>{stat.count}</Text>
              <Text style={styles.statLabel}>{String(t(`status.${stat.key}`, stat.key))}</Text>
            </View>
          </React.Fragment>
        ))}
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <View style={[styles.statDot, { backgroundColor: colors.brand }]} />
          <Text style={styles.statNumber}>{totalCount}</Text>
          <Text style={styles.statLabel}>{t('workbench.totalCount', 'Total')}</Text>
        </View>
      </View>

      <View style={styles.searchContainer}>
        <Searchbar
          placeholder={t('workbench.searchPlaceholder', 'Search tickets...')}
          onChangeText={onSearchChange}
          value={searchQuery}
          style={styles.searchbar}
          elevation={0}
          inputStyle={styles.searchInput}
        />
      </View>

      <View style={styles.filterContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.filterContent}
        >
          {FILTER_STATUSES.map(status => {
            const isActive = statusFilter === status;
            const fill = chipFill(status, isActive);
            return (
              <TouchableOpacity
                key={status}
                activeOpacity={0.7}
                onPress={() => onFilterChange(status)}
                style={[
                  styles.filterChip,
                  { backgroundColor: fill.bg },
                  isActive && styles.filterChipActive,
                  !isActive && styles.filterChipInactive,
                ]}
              >
                <Text style={[styles.filterChipText, { color: fill.text }]}>
                  {status === 'all'
                    ? t('status.all', 'All')
                    : status === 'my_repairs'
                      ? t('status.myRepairs', 'My Repairs')
                      : status === 'others_repairs'
                        ? t('status.othersRepairs', 'Others')
                        : status === 'unassigned'
                          ? t('status.unassigned', 'Unassigned')
                          : String(t(`status.${status}`, status.replace('_', ' ')))}
                </Text>
                <View
                  style={[
                    styles.filterChipBadge,
                    isActive ? styles.filterChipBadgeActive : styles.filterChipBadgeInactive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterChipBadgeText,
                      { color: isActive ? colors.onBrand : colors.textMuted },
                    ]}
                  >
                    {statusCounts[status] || 0}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </>
  );
};

export const WorkbenchScreen = ({ navigation }: any) => {
  const insets = useSafeAreaInsets();
  const { tickets, isLoading, error, subscribeToTickets, updateTicketStatus } = useRepairStore();
  const { user } = useAuthStore();
  // Capabilities, not roles: an admin who revoked `repair_add` from one
  // technician must not leave that technician looking at the same FAB as before.
  const can = usePermissions();
  const theme = useTheme();
  const { t } = useTranslation();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToTickets();
    return () => unsubscribe();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Re-subscribe triggers a fresh fetch
    const unsub = subscribeToTickets();
    setTimeout(() => {
      setRefreshing(false);
      unsub();
    }, 1200);
  }, [subscribeToTickets]);

  // Ticket counts for filter chips — one pass over the list, one `today` per run.
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: tickets.length,
      today: 0,
      my_repairs: 0,
      others_repairs: 0,
      unassigned: 0,
    };
    for (const status of FILTER_STATUSES) {
      if (!FILTER_SCOPES.includes(status)) counts[status] = 0;
    }
    const today = new Date().toDateString();
    for (const ticket of tickets) {
      if (ticket.status in counts) counts[ticket.status] += 1;
      if (ticket.createdAt && new Date(ticket.createdAt).toDateString() === today) counts.today += 1;
      if (!ticket.assignedTechnician) counts.unassigned += 1;
      else if (ticket.assignedTechnician === user?.name) counts.my_repairs += 1;
      else counts.others_repairs += 1;
    }
    return counts;
  }, [tickets, user]);

  /**
   * The haystack per ticket is rebuilt when the list changes rather than on every
   * keystroke, and `buildSearch` tolerates records that arrive with a field
   * missing — which `field.toLowerCase()` did not.
   */
  const searchableTickets = useMemo(
    () =>
      tickets.map((ticket) => ({
        ticket,
        search: buildSearch(
          ticket.ticketNumber,
          ticket.deviceBrand,
          ticket.deviceModel,
          ticket.customerName,
          ticket.issueDescription,
          ticket.assignedTechnician,
          ticket.customerPhone,
          ticket.createdAt ? monthYear(ticket.createdAt) : ''
        ),
      })),
    [tickets]
  );

  const filteredTickets = useMemo(() => {
    const today = new Date().toDateString();
    const isStatusValue = !FILTER_SCOPES.includes(statusFilter);

    return searchableTickets
      .filter(({ ticket, search }) => {
        if (statusFilter === 'today') {
          return Boolean(ticket.createdAt) && new Date(ticket.createdAt).toDateString() === today;
        }
        if (statusFilter === 'my_repairs' && ticket.assignedTechnician !== user?.name) return false;
        if (statusFilter === 'others_repairs' && (!ticket.assignedTechnician || ticket.assignedTechnician === user?.name)) return false;
        if (statusFilter === 'unassigned' && ticket.assignedTechnician) return false;
        if (isStatusValue && ticket.status !== statusFilter) return false;

        return matchesSearch(search, searchQuery);
      })
      .map(({ ticket }) => ticket);
  }, [searchableTickets, searchQuery, statusFilter, user]);

  const openScanner = () => {
    navigation.navigate('Scanner', {
      onScan: (data: string) => {
        const clean = data.trim();
        const found = tickets.find(t => 
          t.ticketNumber?.toLowerCase() === clean.toLowerCase() ||
          t.trackingPin?.toLowerCase() === clean.toLowerCase() ||
          (clean.length >= 8 && t.customerPhone && t.customerPhone.replace(/\D/g, '') === clean.replace(/\D/g, ''))
        );
        if (found) {
          navigation.navigate('TicketDetail', { ticket: found });
        } else {
          Alert.alert(t('error.notFound', 'Not Found'), t('error.noTicketMatch', 'No ticket matches this barcode or PIN.'));
        }
      }
    });
  };

  const getEmptyState = () => {
    const key = EMPTY_ICONS[statusFilter] ? statusFilter : 'other';
    const ink =
      key === 'all' || key === 'unassigned'
        ? colors.success
        : key === 'other'
          ? colors.textFaint
          : statusInk(key);
    const isPositive = key === 'all' || key === 'unassigned';

    return (
      <View style={styles.emptyContainer}>
        <View style={[styles.emptyIconCircle, { backgroundColor: `${ink}14` }]}>
          <MaterialCommunityIcons name={(EMPTY_ICONS[key] ?? 'clipboard-text-outline') as any} size={44} color={ink} />
        </View>
        <Text style={[styles.emptyTitle, isPositive && { color: ink }]}>
          {t(`workbench.empty.${key}.title`, 'No tickets')}
        </Text>
        <Text style={styles.emptySub}>{t(`workbench.empty.${key}.sub`, 'No tickets match this filter.')}</Text>
      </View>
    );
  };

  const renderTicket = ({ item }: { item: any }) => {
    const cost = item.estimatedCost || item.actualCost || 0;
    const isOffline = item.id && item.id.startsWith('offline_');
    const canCycle = item.status === 'pending' || item.status === 'in_progress';
    const nextStatus = item.status === 'pending' ? 'in_progress' : item.status === 'in_progress' ? 'ready' : null;

    const handleCycleStatus = async (e: any) => {
      e?.stopPropagation?.();
      if (!nextStatus) return;
      try {
        Vibration.vibrate(40);
        await updateTicketStatus(item.id, nextStatus, user?.name);
      } catch (err) {
        console.warn('Status cycle error:', err);
      }
    };

    return (
      <TouchableOpacity 
        activeOpacity={0.7}
        onPress={() => navigation.navigate('TicketDetail', { ticket: item })}
      >
        <Card style={styles.card}>
          <View style={[styles.statusStrip, { backgroundColor: statusInk(item.status) }]} />
          <Card.Content style={styles.cardContent}>
            <View style={styles.cardHeader}>
              <View style={styles.ticketNumberRow}>
                <Text style={styles.ticketNumber}>{item.ticketNumber}</Text>
                {isOffline && (
                  <View style={styles.offlineBadge}>
                    <MaterialCommunityIcons name="cloud-off-outline" size={11} color={colors.danger} />
                    <Text style={styles.offlineBadgeText}>{t('common.offline', 'Offline')}</Text>
                  </View>
                )}
              </View>

              <TouchableOpacity
                activeOpacity={canCycle ? 0.6 : 1}
                onPress={canCycle ? handleCycleStatus : undefined}
                style={[styles.statusBadge, { backgroundColor: tintedPill(statusInk(item.status)).backgroundColor }]}
              >
                <Text style={[styles.statusText, { color: statusInk(item.status) }]}>
                  {String(t(`status.${item.status}`, item.status.replace('_', ' ').toUpperCase()))}
                </Text>
                {canCycle && (
                  <MaterialCommunityIcons name="chevron-right" size={14} color={statusInk(item.status)} style={styles.statusBadgeChevron} />
                )}
              </TouchableOpacity>
            </View>
            
            <Text style={styles.deviceTitle}>{item.deviceBrand} {item.deviceModel}</Text>
            
            {/* Customer name + Call button + time ago */}
            <View style={styles.customerRow}>
              <MaterialCommunityIcons name="account" size={14} color={colors.textFaint} />
              <Text style={styles.customerText} numberOfLines={1}>
                {item.customerName}
              </Text>
              
              {item.customerPhone ? (
                <TouchableOpacity
                  style={styles.callChip}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    Linking.openURL(`tel:${item.customerPhone}`);
                  }}
                >
                  <MaterialCommunityIcons name="phone" size={12} color={colors.success} />
                  <Text style={styles.callChipText}>{item.customerPhone}</Text>
                </TouchableOpacity>
              ) : null}

              <Text style={styles.timeAgoText}>
                {getTimeAgo(item.createdAt)}
              </Text>
            </View>
            
            <View style={styles.issueContainer}>
              <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.textMuted} />
              <Text style={styles.issueText} numberOfLines={1}>
                {item.issueDescription}
              </Text>
            </View>
            
            <View style={styles.footerRow}>
              <View style={styles.techContainer}>
                <MaterialCommunityIcons
                  name="account-wrench"
                  size={16}
                  color={item.assignedTechnician ? colors.brand : colors.textFaint}
                />
                <Text style={[styles.techText, !item.assignedTechnician && styles.techTextEmpty]}>
                  {item.assignedTechnician || t('workbench.unassigned', 'Unassigned')}
                </Text>
              </View>
              {cost > 0 && (
                <View style={styles.costBadge}>
                  <Text style={styles.costText}>~{cost} DA</Text>
                </View>
              )}
            </View>
          </Card.Content>
        </Card>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Appbar.Header style={styles.header}>
        <Appbar.Content 
          title={user?.role === 'sales_agent' ? t('workbench.salesDesk', 'Sales Desk') : t('workbench.title', 'Workbench')}
          titleStyle={styles.headerTitle}
          subtitle={t('workbench.welcome', 'Welcome, {{name}}', { name: user?.name?.split(' ')[0] })}
          subtitleStyle={styles.headerSubtitle}
        />
        <Appbar.Action icon="qrcode-scan" onPress={openScanner} color={colors.onBrand} />
        {user?.role !== 'sales_agent' && (
          <Appbar.Action icon="chart-bar" onPress={() => navigation.navigate('Reports')} color={colors.onBrand} />
        )}
        <Appbar.Action icon="cog" onPress={() => navigation.navigate('Settings')} color={colors.onBrand} />
      </Appbar.Header>

      {isLoading && tickets.length === 0 ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.centerContainer}>
          <MaterialCommunityIcons name="alert-outline" size={44} color={colors.danger} />
          <Text style={styles.errorText}>{t('workbench.loadError', 'Failed to load tickets.')}</Text>
        </View>
      ) : (
        <FlatList
          data={filteredTickets}
          keyExtractor={(item) => item.id}
          renderItem={renderTicket}
          ListHeaderComponent={
            <WorkbenchHeader
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              statusFilter={statusFilter}
              onFilterChange={setStatusFilter}
              statusCounts={statusCounts}
              totalCount={tickets.length}
            />
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.brand]}
              tintColor={colors.brand}
            />
          }
          ListEmptyComponent={getEmptyState()}
        />
      )}

      {can.repair_add && (
        <FAB
          style={[styles.fab, { bottom: 68 + Math.max(insets.bottom, 0) }]}
          icon="plus"
          color={colors.onBrand}
          onPress={() => navigation.navigate('NewTicket')}
        />
      )}

      <RoleBottomNav currentRoute="Workbench" navigation={navigation} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.brand,
    elevation: 0,
  },
  headerTitle: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: fontSize.title,
  },
  headerSubtitle: {
    color: colors.brandSoftStrong,
    fontSize: fontSize.body,
  },
  // Inline stats row
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statDot: {
    width: 8,
    height: 8,
    borderRadius: radius.circle,
  },
  statNumber: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    fontWeight: '500',
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 24,
    backgroundColor: colors.border,
  },
  // Search
  searchContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  searchbar: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    height: 46,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  searchInput: {
    fontSize: fontSize.bodyStrong,
  },
  // Filter chips
  filterContainer: {
    backgroundColor: colors.background,
  },
  filterContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    gap: spacing.xs,
  },
  filterChipActive: {},
  filterChipInactive: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  filterChipText: {
    fontSize: fontSize.body,
    fontWeight: '700',
  },
  filterChipBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: radius.circle,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  filterChipBadgeActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.24)',
  },
  filterChipBadgeInactive: {
    backgroundColor: colors.surfaceMuted,
  },
  filterChipBadgeText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  // Ticket card
  listContent: {
    padding: spacing.lg,
    paddingBottom: 80,
  },
  card: {
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  statusStrip: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 4,
    zIndex: 1,
  },
  cardContent: {
    paddingLeft: spacing.xl,
    paddingVertical: 14,
    paddingRight: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  ticketNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  ticketNumber: {
    fontSize: fontSize.label,
    fontWeight: '700',
    color: colors.textFaint,
    letterSpacing: 0.5,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
    borderRadius: radius.md,
  },
  statusBadgeChevron: {
    marginLeft: spacing.xxs,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    borderRadius: radius.sm,
    gap: spacing.xxs,
  },
  offlineBadgeText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.danger,
  },
  callChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.md,
    gap: spacing.xs,
    marginRight: spacing.xs,
  },
  callChipText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.success,
  },
  statusText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  deviceTitle: {
    fontSize: fontSize.subtitle,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  customerText: {
    fontSize: fontSize.body,
    color: colors.textMuted,
    fontWeight: '500',
    flex: 1,
  },
  timeAgoText: {
    fontSize: fontSize.label,
    color: colors.textFaint,
    fontWeight: '600',
  },
  issueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm,
    borderRadius: radius.sm,
    gap: spacing.xs,
  },
  issueText: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: fontSize.bodyStrong,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  techContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  techText: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  techTextEmpty: {
    color: colors.textFaint,
    fontStyle: 'italic',
  },
  costBadge: {
    backgroundColor: colors.successSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  costText: {
    fontSize: fontSize.label,
    fontWeight: '700',
    color: colors.success,
  },
  // FAB
  fab: {
    position: 'absolute',
    margin: spacing.lg,
    right: 0,
    bottom: 72,
    backgroundColor: colors.brand,
    borderRadius: radius.xl,
  },
  // Empty & error
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    marginTop: spacing.md,
    color: colors.danger,
    fontSize: fontSize.subtitle,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  emptyIconCircle: {
    width: 88,
    height: 88,
    borderRadius: radius.circle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  emptySub: {
    fontSize: fontSize.bodyStrong,
    color: colors.textFaint,
    marginTop: spacing.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.xxxl,
  },
});
