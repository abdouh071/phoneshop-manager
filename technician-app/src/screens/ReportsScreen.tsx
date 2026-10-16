import React, { useEffect, useState, useMemo } from 'react';
import { View, StyleSheet, FlatList, Alert, ScrollView, Share, RefreshControl } from 'react-native';
import { Text, Card, Title, Button, useTheme, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRepairStore } from '../store/repairStore';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';

export const ReportsScreen = () => {
  const { fetchMyCompletedTickets } = useRepairStore();
  const { user } = useAuthStore();
  const { profitPercentage, weekStartDay } = useSettingsStore();
  const theme = useTheme();

  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<'daily' | 'weekly'>('daily');
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
      if (!t.completedAt) return false;
      const tDate = new Date(t.completedAt);
      return tDate >= start && tDate <= end;
    }).sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  }, [tickets, viewMode, currentDate, currentWeekStart]);

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

  // Calculate profit with full breakdown
  const { grossRevenue, totalPartsCost, netRevenue, myProfit } = useMemo(() => {
    let gross = 0;
    let parts = 0;
    filteredTickets.forEach(t => {
      const rev = parseFloat(t.actualCost ?? t.estimatedCost ?? 0) || 0;
      gross += rev;
      if (t.partsUsed && Array.isArray(t.partsUsed)) {
        t.partsUsed.forEach((p: any) => { parts += (parseFloat(p.cost) || 0); });
      }
    });

    const net = gross - parts;
    const percentage = parseFloat(profitPercentage) || 0;
    const mProfit = net * (percentage / 100);

    return { grossRevenue: gross, totalPartsCost: parts, netRevenue: net, myProfit: mProfit };
  }, [filteredTickets, profitPercentage]);

  const handleShareReport = async () => {
    const reportText = `Report (${periodLabel})\n\nGross: ${grossRevenue} DA\nParts: -${totalPartsCost} DA\nNet: ${netRevenue} DA\n\nMy Cut (${profitPercentage}%): ${myProfit.toFixed(2)} DA\n\nCompleted Repairs: ${filteredTickets.length}`;
    
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
    const rev = parseFloat(item.actualCost ?? item.estimatedCost ?? 0) || 0;
    let partsCost = 0;
    if (item.partsUsed) {
      item.partsUsed.forEach((p: any) => { partsCost += (parseFloat(p.cost) || 0); });
    }
    const net = rev - partsCost;
    
    return (
      <Card style={styles.ticketCard}>
        <View style={styles.ticketStrip} />
        <Card.Content style={styles.ticketRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.ticketNum}>{item.ticketNumber}</Text>
            <Text style={styles.deviceText}>{item.deviceBrand} {item.deviceModel}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 13, color: '#64748b', fontWeight: '500' }}>{rev} DA</Text>
            {partsCost > 0 && <Text style={styles.partsText}>Parts: -{partsCost} DA</Text>}
            <Text style={styles.profitText}>Net: {net} DA</Text>
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

  return (
    <View style={styles.container}>
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

      <View style={styles.navRow}>
        <Button mode="text" onPress={navPrev} compact>
          <MaterialCommunityIcons name="chevron-left" size={24} />
        </Button>
        <Text style={styles.periodText}>{periodLabel}</Text>
        <Button mode="text" onPress={navNext} compact>
          <MaterialCommunityIcons name="chevron-right" size={24} />
        </Button>
      </View>

      <View style={styles.summaryContainer}>
        <Card style={styles.summaryCard}>
          <Card.Content>
            {/* My Cut (Moved to Top) */}
            <View style={styles.myProfitBox}>
              <View>
                <Text style={styles.myProfitLabel}>My Cut ({profitPercentage}%)</Text>
                <Text style={styles.myProfitValue}>{myProfit.toFixed(2)} DA</Text>
              </View>
              <MaterialCommunityIcons name="cash-check" size={48} color="rgba(255,255,255,0.2)" />
            </View>

            <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 16 }} />
            
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
            <View style={[styles.statRow, { marginTop: 8 }]}>
              <Text style={[styles.statLabel, { fontWeight: '700', color: '#ffffff' }]}>Net Profit</Text>
              <Text style={[styles.statValue, { fontWeight: '800', fontSize: 18 }]}>{netRevenue} DA</Text>
            </View>
          </Card.Content>
        </Card>
      </View>

      <View style={styles.listHeader}>
        <Title style={styles.listTitle}>Completed Repairs ({filteredTickets.length})</Title>
      </View>

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
            colors={['#10b981']}
            tintColor="#10b981"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconCircle}>
              <MaterialCommunityIcons name="clipboard-check-outline" size={48} color="#10b981" />
            </View>
            <Text style={styles.emptyTitle}>All caught up!</Text>
            <Text style={styles.emptyText}>No repairs completed in this period.</Text>
          </View>
        }
      />

      <View style={styles.actionContainer}>
        <Button mode="contained" onPress={handleShareReport} style={[styles.actionButton, { backgroundColor: '#4f46e5' }]} icon="share-variant">
          Share Report
        </Button>
      </View>
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
  summaryCard: {
    backgroundColor: '#10b981',
    borderRadius: 12,
  },
  summaryTitle: {
    color: '#a7f3d0',
    fontSize: 14,
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
    color: '#d1fae5',
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
    color: '#d1fae5',
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
    fontSize: 18,
    color: '#1e293b',
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
  deviceText: {
    fontSize: 16,
    color: '#0f172a',
    fontWeight: '800',
  },
  profitText: {
    fontSize: 16,
    color: '#10b981',
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
    backgroundColor: '#10b98115',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#10b981',
  },
  emptyText: {
    marginTop: 6,
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '500',
  },
  actionContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    padding: 16,
    paddingBottom: 32,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  actionButton: {
    flex: 1,
    marginHorizontal: 8,
    borderRadius: 8,
  }
});
