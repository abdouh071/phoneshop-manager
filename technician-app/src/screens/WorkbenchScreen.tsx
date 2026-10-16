import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Alert, ScrollView, RefreshControl } from 'react-native';
import { Appbar, Card, Title, Text, FAB, useTheme, ActivityIndicator, Searchbar, Chip } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRepairStore } from '../store/repairStore';
import { useAuthStore } from '../store/authStore';
import { useTranslation } from 'react-i18next';

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

export const WorkbenchScreen = ({ navigation }: any) => {
  const { tickets, isLoading, error, subscribeToTickets } = useRepairStore();
  const { user, logout } = useAuthStore();
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return '#f59e0b';
      case 'in_progress': return '#3b82f6';
      case 'ready': return '#10b981';
      case 'returned': return '#ef4444';
      case 'completed': return '#8b5cf6';
      case 'cancelled': return '#94a3b8';
      default: return '#64748b';
    }
  };

  // Ticket counts for filter chips
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: tickets.length };
    const statuses = ['pending', 'in_progress', 'ready', 'completed', 'returned', 'cancelled'];
    statuses.forEach(s => { counts[s] = tickets.filter(t => t.status === s).length; });
    counts['my_repairs'] = tickets.filter(t => t.assignedTechnician === user?.name).length;
    counts['others_repairs'] = tickets.filter(t => t.assignedTechnician && t.assignedTechnician !== user?.name).length;
    counts['unassigned'] = tickets.filter(t => !t.assignedTechnician).length;
    return counts;
  }, [tickets, user]);

  const filteredTickets = useMemo(() => {
    return tickets.filter(t => {
      // 1. Status/Assignment filter
      if (statusFilter === 'my_repairs' && t.assignedTechnician !== user?.name) return false;
      if (statusFilter === 'others_repairs' && (!t.assignedTechnician || t.assignedTechnician === user?.name)) return false;
      if (statusFilter === 'unassigned' && t.assignedTechnician) return false;
      
      const isStatusString = !['all', 'my_repairs', 'others_repairs', 'unassigned'].includes(statusFilter);
      if (isStatusString && t.status !== statusFilter) return false;

      // 2. Search query filter
      if (!searchQuery) return true;
      const lowerQ = searchQuery.toLowerCase();
      
      const dateStr = t.createdAt ? new Date(t.createdAt).toLocaleString('default', { month: 'long', year: 'numeric' }).toLowerCase() : '';
      
      return (
        t.ticketNumber?.toLowerCase().includes(lowerQ) ||
        t.deviceBrand?.toLowerCase().includes(lowerQ) ||
        t.deviceModel?.toLowerCase().includes(lowerQ) ||
        t.customerName?.toLowerCase().includes(lowerQ) ||
        t.issueDescription?.toLowerCase().includes(lowerQ) ||
        (t.assignedTechnician && t.assignedTechnician.toLowerCase().includes(lowerQ)) ||
        dateStr.includes(lowerQ)
      );
    });
  }, [tickets, searchQuery, statusFilter, user]);

  const openScanner = () => {
    navigation.navigate('Scanner', {
      onScan: (data: string) => {
        const found = tickets.find(t => t.ticketNumber === data);
        if (found) {
          navigation.navigate('TicketDetail', { ticket: found });
        } else {
          Alert.alert(t('error.notFound', 'Not Found'), t('error.noTicketMatch', 'No assigned ticket matches this barcode.'));
        }
      }
    });
  };

  const getChipColor = (status: string): { bg: string; text: string } => {
    if (statusFilter !== status) return { bg: '#ffffff', text: '#475569' };
    switch (status) {
      case 'all': return { bg: '#4f46e5', text: '#ffffff' };
      case 'my_repairs': return { bg: '#4f46e5', text: '#ffffff' };
      case 'others_repairs': return { bg: '#7c3aed', text: '#ffffff' };
      case 'unassigned': return { bg: '#64748b', text: '#ffffff' };
      case 'pending': return { bg: '#f59e0b', text: '#ffffff' };
      case 'in_progress': return { bg: '#3b82f6', text: '#ffffff' };
      case 'ready': return { bg: '#10b981', text: '#ffffff' };
      case 'completed': return { bg: '#8b5cf6', text: '#ffffff' };
      case 'returned': return { bg: '#ef4444', text: '#ffffff' };
      case 'cancelled': return { bg: '#94a3b8', text: '#ffffff' };
      default: return { bg: '#4f46e5', text: '#ffffff' };
    }
  };

  const getEmptyState = () => {
    const iconMap: Record<string, { icon: string; title: string; sub: string; color: string }> = {
      'all': { icon: 'clipboard-check-outline', title: 'All caught up!', sub: 'No repair tickets yet.', color: '#10b981' },
      'my_repairs': { icon: 'account-check', title: 'Nothing assigned', sub: 'No tickets are assigned to you right now.', color: '#4f46e5' },
      'others_repairs': { icon: 'account-group', title: 'No other repairs', sub: 'No tickets assigned to other technicians.', color: '#7c3aed' },
      'unassigned': { icon: 'account-question', title: 'All assigned!', sub: 'Every ticket has a technician.', color: '#10b981' },
      'pending': { icon: 'clock-outline', title: 'No pending tickets', sub: 'All tickets have been picked up.', color: '#f59e0b' },
      'in_progress': { icon: 'wrench', title: 'Nothing in progress', sub: 'No active repairs right now.', color: '#3b82f6' },
      'ready': { icon: 'check-circle-outline', title: 'No ready tickets', sub: 'Nothing waiting for customer pickup.', color: '#10b981' },
    };
    const state = iconMap[statusFilter] || { icon: 'clipboard-text-outline', title: 'No tickets', sub: 'No tickets match this filter.', color: '#94a3b8' };
    const isPositive = statusFilter === 'all' || statusFilter === 'unassigned';
    
    return (
      <View style={styles.emptyContainer}>
        <View style={[styles.emptyIconCircle, { backgroundColor: state.color + '15' }]}>
          <MaterialCommunityIcons name={state.icon as any} size={48} color={state.color} />
        </View>
        <Text style={[styles.emptyTitle, isPositive && { color: state.color }]}>{state.title}</Text>
        <Text style={styles.emptySub}>{state.sub}</Text>
      </View>
    );
  };

  const renderTicket = ({ item }: { item: any }) => {
    const cost = item.estimatedCost || item.actualCost || 0;
    return (
      <TouchableOpacity 
        activeOpacity={0.7}
        onPress={() => navigation.navigate('TicketDetail', { ticket: item })}
      >
        <Card style={styles.card}>
          <View style={[styles.statusStrip, { backgroundColor: getStatusColor(item.status) }]} />
          <Card.Content style={styles.cardContent}>
            <View style={styles.cardHeader}>
              <Text style={styles.ticketNumber}>{item.ticketNumber}</Text>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '1A' }]}>
                <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
                  {String(t(`status.${item.status}`, item.status.replace('_', ' ').toUpperCase()))}
                </Text>
              </View>
            </View>
            
            <Text style={styles.deviceTitle}>{item.deviceBrand} {item.deviceModel}</Text>
            
            {/* Customer name + time ago */}
            <View style={styles.customerRow}>
              <MaterialCommunityIcons name="account" size={14} color="#94a3b8" />
              <Text style={styles.customerText} numberOfLines={1}>
                {item.customerName}
              </Text>
              <Text style={styles.timeAgoText}>
                {getTimeAgo(item.createdAt)}
              </Text>
            </View>
            
            <View style={styles.issueContainer}>
              <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#64748b" />
              <Text style={styles.issueText} numberOfLines={1}>
                {item.issueDescription}
              </Text>
            </View>
            
            <View style={styles.footerRow}>
              <View style={styles.techContainer}>
                <MaterialCommunityIcons name="account-wrench" size={16} color={item.assignedTechnician ? '#4f46e5' : '#94a3b8'} />
                <Text style={[styles.techText, !item.assignedTechnician && { color: '#94a3b8', fontStyle: 'italic' }]}>
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

  // Inline stats
  const pendingCount = statusCounts['pending'] || 0;
  const inProgressCount = statusCounts['in_progress'] || 0;
  const readyCount = statusCounts['ready'] || 0;

  return (
    <View style={styles.container}>
      <Appbar.Header style={styles.header}>
        <Appbar.Content 
          title={user?.role === 'sales_agent' ? t('workbench.salesDesk', 'Sales Desk') : t('workbench.title', 'Workbench')}
          titleStyle={styles.headerTitle}
          subtitle={t('workbench.welcome', 'Welcome, {{name}}', { name: user?.name?.split(' ')[0] })}
          subtitleStyle={styles.headerSubtitle}
        />
        <Appbar.Action icon="qrcode-scan" onPress={openScanner} color="#fff" />
        {user?.role !== 'sales_agent' && (
          <Appbar.Action icon="chart-bar" onPress={() => navigation.navigate('Reports')} color="#fff" />
        )}
        <Appbar.Action icon="cog" onPress={() => navigation.navigate('Settings')} color="#fff" />
      </Appbar.Header>

      {/* Inline Stats Row — visible to all roles */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <View style={[styles.statDot, { backgroundColor: '#f59e0b' }]} />
          <Text style={styles.statNumber}>{pendingCount}</Text>
          <Text style={styles.statLabel}>{t('status.pending', 'Pending')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <View style={[styles.statDot, { backgroundColor: '#3b82f6' }]} />
          <Text style={styles.statNumber}>{inProgressCount}</Text>
          <Text style={styles.statLabel}>{t('status.in_progress', 'In Progress')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <View style={[styles.statDot, { backgroundColor: '#10b981' }]} />
          <Text style={styles.statNumber}>{readyCount}</Text>
          <Text style={styles.statLabel}>{t('status.ready', 'Ready')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <View style={[styles.statDot, { backgroundColor: '#4f46e5' }]} />
          <Text style={styles.statNumber}>{tickets.length}</Text>
          <Text style={styles.statLabel}>{t('status.all', 'Total')}</Text>
        </View>
      </View>

      <View style={styles.searchContainer}>
        <Searchbar
          placeholder={t('workbench.searchPlaceholder', 'Search tickets...')}
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchbar}
          elevation={0}
          inputStyle={{ fontSize: 15 }}
        />
      </View>

      <View style={styles.filterContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterContent}>
          {['all', 'my_repairs', 'others_repairs', 'unassigned', 'pending', 'in_progress', 'ready', 'completed', 'returned', 'cancelled'].map(status => {
            const chipColors = getChipColor(status);
            const count = statusCounts[status] || 0;
            const isActive = statusFilter === status;
            return (
              <TouchableOpacity
                key={status}
                activeOpacity={0.7}
                onPress={() => setStatusFilter(status)}
                style={[
                  styles.filterChip,
                  { backgroundColor: chipColors.bg },
                  isActive && styles.filterChipActive,
                  !isActive && styles.filterChipInactive,
                ]}
              >
                <Text style={[styles.filterChipText, { color: chipColors.text }]}>
                  {status === 'all' ? t('status.all', 'All') 
                    : status === 'my_repairs' ? t('status.myRepairs', 'My Repairs')
                    : status === 'others_repairs' ? t('status.othersRepairs', 'Others')
                    : status === 'unassigned' ? t('status.unassigned', 'Unassigned')
                    : String(t(`status.${status}`, status.replace('_', ' ')))}
                </Text>
                <View style={[styles.filterChipBadge, isActive ? { backgroundColor: 'rgba(255,255,255,0.3)' } : { backgroundColor: '#f1f5f9' }]}>
                  <Text style={[styles.filterChipBadgeText, { color: isActive ? '#ffffff' : '#64748b' }]}>
                    {count}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {isLoading && tickets.length === 0 ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.centerContainer}>
          <MaterialCommunityIcons name="alert" size={48} color="#ef4444" />
          <Text style={styles.errorText}>Failed to load tickets.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredTickets}
          keyExtractor={(item) => item.id}
          renderItem={renderTicket}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={['#4f46e5']}
              tintColor="#4f46e5"
            />
          }
          ListEmptyComponent={getEmptyState()}
        />
      )}

      {(user?.role === 'admin' || user?.permissions?.repair_add) && (
        <FAB
          style={styles.fab}
          icon="plus"
          color="#fff"
          onPress={() => navigation.navigate('NewTicket')}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  header: {
    backgroundColor: '#4f46e5',
    elevation: 0,
  },
  headerTitle: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 22,
  },
  headerSubtitle: {
    color: '#e0e7ff',
    fontSize: 14,
  },
  // Inline Stats Row
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#ffffff',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  statLabel: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#f1f5f9',
  },
  // Search
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#f8fafc',
  },
  searchbar: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    height: 46,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  // Filter Chips
  filterContainer: {
    backgroundColor: '#f8fafc',
  },
  filterContent: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  filterChipActive: {
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  filterChipInactive: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  filterChipBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  filterChipBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  // Card
  listContent: {
    padding: 16,
    paddingBottom: 80,
  },
  card: {
    marginBottom: 12,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 1,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
  },
  statusStrip: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 5,
    zIndex: 1,
  },
  cardContent: {
    paddingLeft: 18,
    paddingVertical: 14,
    paddingRight: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  ticketNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.5,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  deviceTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 4,
  },
  customerText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
    flex: 1,
  },
  timeAgoText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  issueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    backgroundColor: '#f8fafc',
    padding: 8,
    borderRadius: 8,
  },
  issueText: {
    marginLeft: 6,
    color: '#475569',
    flex: 1,
    fontSize: 14,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 10,
  },
  techContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  techText: {
    marginLeft: 6,
    fontSize: 13,
    fontWeight: '600',
    color: '#1e293b',
  },
  costBadge: {
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  costText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#16a34a',
  },
  // FAB
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
    backgroundColor: '#4f46e5',
    borderRadius: 28,
  },
  // Empty & Error
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    marginTop: 12,
    color: '#ef4444',
    fontSize: 16,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  emptyIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#475569',
  },
  emptySub: {
    fontSize: 15,
    color: '#94a3b8',
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});
