import React, { useEffect, useState, useMemo } from 'react';
import { View, StyleSheet, FlatList, Alert, ScrollView, Share, RefreshControl, TouchableOpacity } from 'react-native';
import { Text, Card, Title, Button, useTheme, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRepairStore } from '../store/repairStore';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { RoleBottomNav } from '../components/RoleBottomNav';
import { getClaimedRepairRevenue, isClaimedAndPaidRepair } from '../utils/repairFinancials';

export const ReportsScreen = ({ navigation }: any) => {
  const { fetchMyCompletedTickets } = useRepairStore();
  const { user } = useAuthStore();
  const { profitPercentage, weekStartDay, getTechnicianRate, technicianRates } = useSettingsStore();
  const theme = useTheme();

  // Effective commission percentage for the logged in technician (instant sync with desktop/web)
  const effectiveCommission = useMemo(() => {
    if (getTechnicianRate) {
      return getTechnicianRate(user?.name);
    }
    const parsed = parseFloat(profitPercentage);
    return !isNaN(parsed) ? parsed : 50;
  }, [user?.name, getTechnicianRate, technicianRates, profitPercentage]);

  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<'daily' | 'weekly'>('daily');
  // 'taken' = Real cash profit from completed/claimed phones
  // 'all_repaired' = Revenue/profit of all phones repaired even if not taken yet
  const [profitType, setProfitType] = useState<'taken' | 'all_repaired'>('taken');
  const [refreshing, setRefreshing] = useState(false);
  
  // For daily view
  const [currentDate, setCurrentDate] = useState(() => {
    const d = new Date();
    d.setHours(0,0,0,0);
    return d;
  });

  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const d = new Date();
    d.setHours(0,0,0,0);
    return d; // Will be set properly in useEffect
  });

  useEffect(() => {
    // Reset to the proper start of week whenever settings change
    const d = new Date();
    const day = d.getDay();
    const startDay = weekStartDay ?? 0;
    const diffToStart = (day - startDay + 7) % 7;
    d.setDate(d.getDate() - diffToStart);
    d.setHours(0,0,0,0);
    setCurrentWeekStart(d);
  }, [weekStartDay]);

  useEffect(() => {
    loadTickets();
  }, []);

  const loadTickets = async () => {
    setLoading(true);
    if (user?.name) {
      const myTickets = await fetchMyCompletedTickets(user.name);
      setTickets(myTickets);
    }
    setLoading(false);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    if (user?.name) {
      const myTickets = await fetchMyCompletedTickets(user.name);
      setTickets(myTickets);
    }
    setRefreshing(false);
  };

  const filteredTickets = useMemo(() => {
    let start: Date;
    let end: Date;

    if (viewMode === 'daily') {
      start = new Date(currentDate);
      end = new Date(currentDate);
      end.setHours(23, 59, 59, 999);
    } else {
      start = new Date(currentWeekStart);
      end = new Date(currentWeekStart);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
    }

    return tickets.filter(t => {
      if (profitType === 'taken') {
        // Mode 1: Real Profit on taken phones only (completed handover)
        if (t.status !== 'completed') return false;
        const dateToCheck = t.completedAt || t.repairedAt;
        if (!dateToCheck) return false;
        const tDate = new Date(dateToCheck);
        return tDate >= start && tDate <= end;
      } else {
        // Mode 2: Work/Revenue on all repaired phones (ready or completed)
        if (t.status !== 'ready' && t.status !== 'completed') return false;
        const dateToCheck = t.repairedAt || t.completedAt;
        if (!dateToCheck) return false;
        const tDate = new Date(dateToCheck);
        return tDate >= start && tDate <= end;
      }
    }).sort((a, b) => {
      if (profitType === 'taken') {
        const timeB = new Date(b.completedAt || b.repairedAt || 0).getTime();
        const timeA = new Date(a.completedAt || a.repairedAt || 0).getTime();
        return timeB - timeA;
      } else {
        const timeB = new Date(b.repairedAt || b.completedAt || 0).getTime();
        const timeA = new Date(a.repairedAt || a.completedAt || 0).getTime();
        return timeB - timeA;
      }
    });
  }, [tickets, viewMode, currentDate, currentWeekStart, profitType]);

  // Breakdown of ready vs taken tickets in the current selection
  const { readyCount, completedCount } = useMemo(() => {
    let ready = 0;
    let completed = 0;
    filteredTickets.forEach(t => {
      if (t.status === 'ready') ready++;
      else if (t.status === 'completed') completed++;
    });
    return { readyCount: ready, completedCount: completed };
  }, [filteredTickets]);

  const navPrev = () => {
    if (viewMode === 'daily') {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 1);
      setCurrentDate(d);
    } else {
      const d = new Date(currentWeekStart);
      d.setDate(d.getDate() - 7);
      setCurrentWeekStart(d);
    }
  };

  const navNext = () => {
    if (viewMode === 'daily') {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 1);
      setCurrentDate(d);
    } else {
      const d = new Date(currentWeekStart);
      d.setDate(d.getDate() + 7);
      setCurrentWeekStart(d);
    }
  };

  const periodLabel = useMemo(() => {
    if (viewMode === 'daily') {
      return currentDate.toDateString();
    } else {
      const end = new Date(currentWeekStart);
      end.setDate(end.getDate() + 6);
      return `${currentWeekStart.toLocaleDateString([], {month:'short', day:'numeric'})} - ${end.toLocaleDateString([], {month:'short', day:'numeric'})}`;
    }
  }, [viewMode, currentDate, currentWeekStart]);

  // Calculate profit with full breakdown, accounting for parts cost and quantity
  const { grossRevenue, totalPartsCost, netRevenue, myProfit } = useMemo(() => {
    let gross = 0;
    let parts = 0;
    filteredTickets.forEach(t => {
      const rev = profitType === 'taken'
        ? getClaimedRepairRevenue(t)
        : (parseFloat(t.actualCost ?? t.estimatedCost ?? 0) || 0);
      gross += rev;
      if (t.partsUsed && Array.isArray(t.partsUsed)) {
        t.partsUsed.forEach((p: any) => {
          const cost = parseFloat(p.cost) || 0;
          const qty = p.quantity !== undefined ? (parseFloat(p.quantity) || 1) : 1;
          parts += cost * qty;
        });
      }
    });

    const net = gross - parts;
    const mProfit = net * (effectiveCommission / 100);

    return { grossRevenue: gross, totalPartsCost: parts, netRevenue: net, myProfit: mProfit };
  }, [filteredTickets, effectiveCommission, profitType]);

  const handleShareReport = async () => {
    const modeTitle = profitType === 'taken' 
      ? 'Real Profit Report (Taken Phones Only)' 
      : 'Repaired Production Report (All Work Done)';
    const countDetail = profitType === 'taken'
      ? `Taken Repairs: ${filteredTickets.length}`
      : `Repaired Phones: ${filteredTickets.length} (${completedCount} taken, ${readyCount} on shelf)`;

    const reportText = `${modeTitle} (${periodLabel})\n\nGross: ${grossRevenue} DA\nParts: -${totalPartsCost} DA\nNet: ${netRevenue} DA\n\nMy Cut (${effectiveCommission}%): ${myProfit.toFixed(2)} DA\n\n${countDetail}`;
    
    try {
      await Share.share({
        message: reportText,
        title: `Auto-Manager Report - ${periodLabel}`
      });
    } catch (error) {
      Alert.alert('Error', 'Could not share report.');
    }
  };

  const renderTicket = ({ item }: { item: any }) => {
    const rev = profitType === 'taken'
      ? getClaimedRepairRevenue(item)
      : (parseFloat(item.actualCost ?? item.estimatedCost ?? 0) || 0);
    let partsCost = 0;
    if (item.partsUsed && Array.isArray(item.partsUsed)) {
      item.partsUsed.forEach((p: any) => {
        const cost = parseFloat(p.cost) || 0;
        const qty = p.quantity !== undefined ? (parseFloat(p.quantity) || 1) : 1;
        partsCost += cost * qty;
      });
    }
    const net = rev - partsCost;
    const isReadyOnly = item.status === 'ready';
    
    return (
      <Card style={styles.ticketCard}>
        <View style={[styles.ticketStrip, { backgroundColor: isReadyOnly ? '#10b981' : '#8b5cf6' }]} />
        <Card.Content style={styles.ticketRow}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text style={styles.ticketNum}>{item.ticketNumber}</Text>
              <View style={[styles.statusMiniBadge, { backgroundColor: isReadyOnly ? '#ecfdf5' : '#f5f3ff' }]}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: isReadyOnly ? '#059669' : '#7c3aed' }}>
                  {isReadyOnly ? 'READY (ON SHELF)' : 'CLAIMED / TAKEN'}
                </Text>
              </View>
            </View>
            <Text style={styles.deviceText}>{item.deviceBrand} {item.deviceModel}</Text>
            {item.customerName ? (
              <Text style={styles.customerNameText} numberOfLines={1}>{item.customerName}</Text>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 13, color: '#64748b', fontWeight: '500' }}>{rev} DA</Text>
            {partsCost > 0 && <Text style={styles.partsText}>Parts: -{partsCost} DA</Text>}
            <Text style={[styles.profitText, { color: isReadyOnly ? '#059669' : '#7c3aed' }]}>
              Net: {net} DA
            </Text>
          </View>
        </Card.Content>
      </Card>
    );
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const renderHeader = () => (
    <>
      {/* View Period Tabs: Daily vs Weekly */}
      <View style={styles.modeTabs}>
        <Button
          mode={viewMode === 'daily' ? 'contained' : 'outlined'}
          onPress={() => setViewMode('daily')}
          style={styles.modeBtn}
        >
          Daily
        </Button>
        <Button
          mode={viewMode === 'weekly' ? 'contained' : 'outlined'}
          onPress={() => setViewMode('weekly')}
          style={styles.modeBtn}
        >
          Weekly
        </Button>
      </View>

      {/* Dual Profit Mode Toggle Switcher: Real Profit (Taken) vs All Repaired (Work) */}
      <View style={styles.profitTypeWrapper}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setProfitType('taken')}
          style={[
            styles.profitTypeBtn,
            profitType === 'taken' && styles.profitTypeBtnActiveTaken
          ]}
        >
          <MaterialCommunityIcons 
            name="cash-check" 
            size={18} 
            color={profitType === 'taken' ? '#ffffff' : '#64748b'} 
          />
          <Text style={[
            styles.profitTypeText,
            profitType === 'taken' && styles.profitTypeTextActive
          ]}>
            Real Profit (Taken)
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setProfitType('all_repaired')}
          style={[
            styles.profitTypeBtn,
            profitType === 'all_repaired' && styles.profitTypeBtnActiveAll
          ]}
        >
          <MaterialCommunityIcons 
            name="wrench-check" 
            size={18} 
            color={profitType === 'all_repaired' ? '#ffffff' : '#64748b'} 
          />
          <Text style={[
            styles.profitTypeText,
            profitType === 'all_repaired' && styles.profitTypeTextActive
          ]}>
            All Repaired (Work)
          </Text>
        </TouchableOpacity>
      </View>

      {/* Date Navigation */}
      <View style={styles.navRow}>
        <Button mode="text" onPress={navPrev} compact>
          <MaterialCommunityIcons name="chevron-left" size={24} />
        </Button>
        <Text style={styles.periodText}>{periodLabel}</Text>
        <Button mode="text" onPress={navNext} compact>
          <MaterialCommunityIcons name="chevron-right" size={24} />
        </Button>
      </View>

      {/* Summary Card */}
      <View style={styles.summaryContainer}>
        <Card style={[
          styles.summaryCard, 
          profitType === 'taken' ? styles.summaryCardTaken : styles.summaryCardAll
        ]}>
          <Card.Content>
            {/* Header Badge & Description */}
            <View style={styles.modeBadgeHeader}>
              <View style={[
                styles.modePillBadge,
                profitType === 'taken' ? styles.modePillBadgeTaken : styles.modePillBadgeAll
              ]}>
                <MaterialCommunityIcons 
                  name={profitType === 'taken' ? "check-decagram" : "wrench-clock"} 
                  size={14} 
                  color="#ffffff" 
                />
                <Text style={styles.modeBadgeText}>
                  {profitType === 'taken' ? 'REALIZED CASH (TAKEN ONLY)' : 'TOTAL PRODUCTION (WORK DONE)'}
                </Text>
              </View>
              <Text style={styles.modeSubtitle}>
                {profitType === 'taken' 
                  ? 'Settled upon customer pickup' 
                  : `${completedCount} taken • ${readyCount} on shelf`}
              </Text>
            </View>

            {/* My Cut Box */}
            <View style={styles.myProfitBox}>
              <View>
                <Text style={styles.myProfitLabel}>
                  {profitType === 'taken' ? 'Realized Profit' : 'Work Revenue'} ({effectiveCommission}%)
                </Text>
                <Text style={styles.myProfitValue}>{myProfit.toFixed(2)} DA</Text>
              </View>
              <MaterialCommunityIcons 
                name={profitType === 'taken' ? "cash-check" : "hammer-wrench"} 
                size={46} 
                color="rgba(255,255,255,0.25)" 
              />
            </View>

            <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.15)', marginVertical: 14 }} />
            
            <Title style={styles.summaryTitle}>Breakdown</Title>

            {/* Stat Row: Gross Revenue */}
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Gross Revenue</Text>
              <Text style={styles.statValue}>{grossRevenue} DA</Text>
            </View>

            {/* Stat Row: Total Parts Cost */}
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Parts Cost</Text>
              <Text style={[styles.statValue, { color: '#fca5a5' }]}>-{totalPartsCost} DA</Text>
            </View>

            {/* Stat Row: Net Revenue */}
            <View style={[styles.statRow, { marginTop: 6 }]}>
              <Text style={[styles.statLabel, { fontWeight: '700', color: '#ffffff' }]}>Net Profit</Text>
              <Text style={[styles.statValue, { fontWeight: '800', fontSize: 18 }]}>{netRevenue} DA</Text>
            </View>
          </Card.Content>
        </Card>
      </View>

      <View style={styles.listHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Title style={styles.listTitle}>
            {profitType === 'taken' ? 'Taken Phones' : 'All Repaired Phones'} ({filteredTickets.length})
          </Title>
          {profitType === 'all_repaired' && (
            <Text style={styles.listSubCount}>
              {completedCount} taken • {readyCount} on shelf
            </Text>
          )}
        </View>
      </View>
    </>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredTickets}
        keyExtractor={(item) => item.id}
        renderItem={renderTicket}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[profitType === 'taken' ? '#059669' : '#2563eb']}
            tintColor={profitType === 'taken' ? '#059669' : '#2563eb'}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={[
              styles.emptyIconCircle,
              { backgroundColor: profitType === 'taken' ? '#05966915' : '#2563eb15' }
            ]}>
              <MaterialCommunityIcons 
                name={profitType === 'taken' ? "cash-remove" : "clipboard-check-outline"} 
                size={48} 
                color={profitType === 'taken' ? '#059669' : '#2563eb'} 
              />
            </View>
            <Text style={[
              styles.emptyTitle,
              { color: profitType === 'taken' ? '#059669' : '#2563eb' }
            ]}>
              {profitType === 'taken' ? 'No taken phones yet' : 'All caught up!'}
            </Text>
            <Text style={styles.emptyText}>
              {profitType === 'taken'
                ? 'No phones were picked up and settled in this period.'
                : 'No repairs completed in this period.'}
            </Text>
          </View>
        }
      />

      <RoleBottomNav currentRoute="Reports" navigation={navigation} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  modeTabs: {
    flexDirection: 'row',
    padding: 16,
    justifyContent: 'center',
    gap: 12,
  },
  modeBtn: {
    flex: 1,
    borderRadius: 8,
    borderColor: '#3b82f6',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  periodText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  summaryContainer: {
    padding: 16,
  },
  profitTypeWrapper: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    padding: 3,
    gap: 4,
  },
  profitTypeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 6,
  },
  profitTypeBtnActiveTaken: {
    backgroundColor: '#059669',
  },
  profitTypeBtnActiveAll: {
    backgroundColor: '#2563eb',
  },
  profitTypeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
  },
  profitTypeTextActive: {
    color: '#ffffff',
  },
  summaryCard: {
    borderRadius: 16,
    elevation: 2,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  summaryCardTaken: {
    backgroundColor: '#059669',
  },
  summaryCardAll: {
    backgroundColor: '#2563eb',
  },
  modeBadgeHeader: {
    marginBottom: 12,
  },
  modePillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
    marginBottom: 4,
  },
  modePillBadgeTaken: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  modePillBadgeAll: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  modeBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  modeSubtitle: {
    color: 'rgba(255, 255, 255, 0.88)',
    fontSize: 12,
    fontWeight: '500',
  },
  summaryTitle: {
    color: '#ffffff',
    opacity: 0.85,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  totalProfit: {
    color: '#d1fae5',
    fontSize: 16,
    marginBottom: 12,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  statLabel: {
    color: 'rgba(255, 255, 255, 0.88)',
    fontSize: 14,
    fontWeight: '500',
  },
  statValue: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  myProfitBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  myProfitLabel: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  myProfitValue: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '800',
  },
  listHeader: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  listTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1e293b',
  },
  listSubCount: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  ticketCard: {
    marginBottom: 12,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    elevation: 1,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    overflow: 'hidden',
  },
  ticketStrip: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: '#10b981',
    zIndex: 1,
  },
  ticketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
  },
  ticketNum: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  statusMiniBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 2,
  },
  deviceText: {
    fontSize: 16,
    color: '#0f172a',
    fontWeight: '800',
  },
  customerNameText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
    marginTop: 1,
  },
  profitText: {
    fontSize: 16,
    fontWeight: '800',
  },
  partsText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 40,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  emptyText: {
    marginTop: 6,
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
});
