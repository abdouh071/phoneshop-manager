import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import {
  Appbar,
  Card,
  Text,
  useTheme,
  ActivityIndicator,
  Chip,
  Button,
  Badge,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { collection, query, getDocs, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuthStore } from '../store/authStore';
import { useRepairStore } from '../store/repairStore';
import { useApprovalStore } from '../store/approvalStore';
import { RoleBottomNav } from '../components/RoleBottomNav';
import type { ActivityLog, SaleTransaction, PhoneModel, RepairTicket } from '../types';
import {
  isClaimedAndPaidRepair,
  getClaimedRepairRevenue,
  getClaimedRepairHandoverCash,
  getClaimedRepairPartsCost,
} from '../utils/repairFinancials';

const { width } = Dimensions.get('window');

const getTimeAgo = (dateStrOrTimestamp: any): string => {
  if (!dateStrOrTimestamp) return 'just now';
  let date: Date;
  if (typeof dateStrOrTimestamp === 'string') {
    date = new Date(dateStrOrTimestamp);
  } else if (dateStrOrTimestamp.toDate) {
    date = dateStrOrTimestamp.toDate();
  } else if (dateStrOrTimestamp.seconds) {
    date = new Date(dateStrOrTimestamp.seconds * 1000);
  } else {
    date = new Date(dateStrOrTimestamp);
  }

  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'yesterday';
  return `${diffDays}d ago`;
};

export const AdminDashboardScreen = ({ navigation }: any) => {
  const { user } = useAuthStore();
  const { tickets } = useRepairStore();
  const { pendingCount, subscribeToPending } = useApprovalStore();
  const theme = useTheme();

  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [transactions, setTransactions] = useState<SaleTransaction[]>([]);
  const [products, setProducts] = useState<PhoneModel[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityLog[]>([]);

  // Load transactions and inventory products
  const loadDashboardData = useCallback(async () => {
    try {
      // 1. Fetch transactions (last 100)
      const qTx = query(collection(db, 'transactions'), orderBy('date', 'desc'), limit(100));
      const snapTx = await getDocs(qTx);
      const txList: SaleTransaction[] = [];
      snapTx.forEach(docSnap => {
        txList.push({ id: docSnap.id, ...docSnap.data() } as SaleTransaction);
      });
      setTransactions(txList);

      // 2. Fetch products for stock KPIs (query 'inventory' first, fallback to 'products')
      let snapProd = await getDocs(query(collection(db, 'inventory')));
      if (snapProd.empty) {
        snapProd = await getDocs(query(collection(db, 'products')));
      }
      const prodList: PhoneModel[] = [];
      snapProd.forEach(docSnap => {
        prodList.push({ id: docSnap.id, ...docSnap.data() } as PhoneModel);
      });
      setProducts(prodList);
    } catch (err) {
      console.warn('[AdminDashboard] Data fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role !== 'admin') {
      navigation.replace(user?.role === 'sales_agent' ? 'POS' : 'Workbench');
      return;
    }
    loadDashboardData();
    // Tickets come from the session-wide listeners App opens; this screen only
    // adds the two bounded streams it needs for its own feed and badge.
    const unsubApprovals = subscribeToPending();

    // 3. Real-time activity feed listener
    const qLogs = query(collection(db, 'activityLogs'), orderBy('timestamp', 'desc'), limit(15));
    const unsubLogs = onSnapshot(qLogs, snap => {
      const logs: ActivityLog[] = [];
      snap.forEach(d => {
        logs.push({ id: d.id, ...d.data() } as ActivityLog);
      });
      setActivityFeed(logs);
    }, err => {
      console.warn('[AdminDashboard] Activity logs listener fallback:', err);
    });

    return () => {
      unsubApprovals();
      unsubLogs();
    };
  }, [user?.role, loadDashboardData, subscribeToPending]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  }, [loadDashboardData]);

  // Compute Revenue Snapshots
  const revenueStats = useMemo(() => {
    const now = new Date();

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfToday = startOfToday + 86400000;

    const startOfYesterday = startOfToday - 86400000;
    const endOfYesterday = startOfToday;

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    // Helper: calculate total sales from transactions in range (strictly excluding refunded, voided, pending_approval)
    const getSalesInRange = (start: number, end: number) => {
      return transactions
        .filter(t => {
          if (t.status === 'refunded' || t.status === 'voided' || t.status === 'pending_approval') return false;
          const tTime = new Date(t.date).getTime();
          return tTime >= start && tTime < end;
        })
        .reduce((sum, t) => sum + (t.total || 0), 0);
    };

    // Helper: calculate recognized repair income in range (claimed & paid repairs)
    const getRepairsInRange = (start: number, end: number) => {
      return tickets
        .filter(t => {
          if (!isClaimedAndPaidRepair(t)) return false;
          const completionDate = t.completedAt || t.updatedAt;
          const cTime = new Date(completionDate || 0).getTime();
          return cTime >= start && cTime < end;
        })
        .reduce((sum, t) => sum + getClaimedRepairRevenue(t), 0);
    };

    const todaySales = getSalesInRange(startOfToday, endOfToday);
    const todayRepairs = getRepairsInRange(startOfToday, endOfToday);
    const todayTotal = todaySales + todayRepairs;

    const yesterdaySales = getSalesInRange(startOfYesterday, endOfYesterday);
    const yesterdayRepairs = getRepairsInRange(startOfYesterday, endOfYesterday);
    const yesterdayTotal = yesterdaySales + yesterdayRepairs;

    const monthSales = getSalesInRange(startOfMonth, endOfToday);
    const monthRepairs = getRepairsInRange(startOfMonth, endOfToday);
    const monthTotal = monthSales + monthRepairs;

    // Growth percentage calculation
    const growthPercent = yesterdayTotal > 0
      ? Math.round(((todayTotal - yesterdayTotal) / yesterdayTotal) * 100)
      : todayTotal > 0 ? 100 : 0;

    // Today sales count (strictly excluding voided and refunded)
    const todayTxCount = transactions.filter(t => {
      if (t.status === 'refunded' || t.status === 'voided' || t.status === 'pending_approval') return false;
      const tTime = new Date(t.date).getTime();
      return tTime >= startOfToday && tTime < endOfToday;
    }).length;

    // Physical Cash Drawer Calculation for Today
    let todayCashSales = 0;
    transactions
      .filter(t => {
        if (t.status === 'refunded' || t.status === 'voided' || t.status === 'pending_approval') return false;
        const tTime = new Date(t.date).getTime();
        return tTime >= startOfToday && tTime < endOfToday;
      })
      .forEach(t => {
        (t.payments || []).forEach(p => {
          if (p.method === 'cash') todayCashSales += (Number(p.amount) || 0);
        });
      });

    const todayRepairCash = tickets
      .filter(t => {
        if (!isClaimedAndPaidRepair(t)) return false;
        const cTime = new Date(t.completedAt || t.updatedAt || 0).getTime();
        return cTime >= startOfToday && cTime < endOfToday;
      })
      .reduce((sum, t) => sum + getClaimedRepairHandoverCash(t), 0);

    const todayIntakeDeposits = tickets
      .filter(t => {
        const crTime = new Date(t.createdAt || 0).getTime();
        return crTime >= startOfToday && crTime < endOfToday;
      })
      .reduce((sum, t) => sum + (t.depositAmount || 0), 0);

    const todayCashDrawerTotal = todayCashSales + todayRepairCash + todayIntakeDeposits;

    // Today's Net Profit (Sales revenue - COGS + Repair revenue - Repair parts cost)
    const todaySalesCOGS = transactions
      .filter(t => {
        if (t.status === 'refunded' || t.status === 'voided' || t.status === 'pending_approval') return false;
        const tTime = new Date(t.date).getTime();
        return tTime >= startOfToday && tTime < endOfToday;
      })
      .reduce((sum, t) => sum + (t.items || []).reduce((s, i) => s + (i.product?.costPrice || 0) * (i.quantity || 1), 0), 0);

    const todayRepairsPartsCost = tickets
      .filter(t => {
        if (!isClaimedAndPaidRepair(t)) return false;
        const cTime = new Date(t.completedAt || t.updatedAt || 0).getTime();
        return cTime >= startOfToday && cTime < endOfToday;
      })
      .reduce((sum, t) => sum + getClaimedRepairPartsCost(t), 0);

    const todayNetProfit = todayTotal - (todaySalesCOGS + todayRepairsPartsCost);

    // Shelf Uncollected Pending Revenue (Ready phones waiting on shelf for pickup)
    const shelfPendingRepairs = tickets.filter(t => t.status === 'ready');
    const shelfPendingValue = shelfPendingRepairs.reduce(
      (sum, t) => sum + Math.max(0, (t.actualCost ?? t.estimatedCost ?? 0) - (t.depositAmount || 0)),
      0
    );

    return {
      todayTotal,
      todaySales,
      todayRepairs,
      yesterdayTotal,
      monthTotal,
      growthPercent,
      todayTxCount,
      todayCashDrawerTotal,
      todayNetProfit,
      shelfPendingValue,
      shelfPendingCount: shelfPendingRepairs.length,
    };
  }, [transactions, tickets]);

  // Compute Operational KPIs
  const operationalKPIs = useMemo(() => {
    const activeRepairs = tickets.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
    const readyPickups = tickets.filter(t => t.status === 'ready').length;
    const unassignedTickets = tickets.filter(
      t => !t.assignedTechnician && t.status !== 'completed' && t.status !== 'cancelled'
    ).length;

    const lowStockCount = products.filter(
      p => p.stock > 0 && p.stock <= (p.lowStockThreshold || 3)
    ).length;
    const outOfStockCount = products.filter(p => p.stock <= 0).length;

    return {
      activeRepairs,
      readyPickups,
      unassignedTickets,
      lowStockCount,
      outOfStockCount,
    };
  }, [tickets, products]);

  const getSeverityBadgeColor = (severity?: string) => {
    switch (severity) {
      case 'danger': return '#dc2626';
      case 'warning': return '#f59e0b';
      case 'success': return '#16a34a';
      default: return '#3b82f6';
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'sales': return 'cash-register';
      case 'repairs': return 'wrench';
      case 'inventory': return 'package-variant-closed';
      default: return 'bell-ring-outline';
    }
  };

  if (user?.role !== 'admin') {
    return (
      <View style={styles.restrictedContainer}>
        <MaterialCommunityIcons name="shield-lock-outline" size={64} color="#ef4444" />
        <Text style={styles.restrictedTitle}>Access Restricted</Text>
        <Text style={styles.restrictedSub}>
          The Executive Dashboard is strictly limited to Administrators only.
        </Text>
        <Button
          mode="contained"
          buttonColor="#4f46e5"
          style={{ marginTop: 24, borderRadius: 10 }}
          onPress={() => navigation.navigate(user?.role === 'sales_agent' ? 'POS' : 'Workbench')}
        >
          Return to {user?.role === 'sales_agent' ? 'POS' : 'Workbench'}
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Appbar.Header style={styles.header}>
        <Appbar.Content
          title="Admin Dashboard"
          subtitle={`Admin: ${user?.name || 'Administrator'}`}
          titleStyle={styles.headerTitle}
          subtitleStyle={styles.headerSub}
        />
        {/* Approvals Bell with Live Pending Badge */}
        <TouchableOpacity
          style={styles.headerApprovalsBtn}
          onPress={() => navigation.navigate('Approvals')}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="shield-check" size={24} color="#ffffff" />
          {pendingCount > 0 && (
            <Badge style={styles.headerBadge} size={18}>
              {pendingCount}
            </Badge>
          )}
        </TouchableOpacity>
        <Appbar.Action icon="refresh" color="#ffffff" onPress={onRefresh} />
        <Appbar.Action icon="cog-outline" color="#ffffff" onPress={() => navigation.navigate('Settings')} />
      </Appbar.Header>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#4f46e5']} />}
      >
        {isLoading && !refreshing ? (
          <View style={styles.centerLoading}>
            <ActivityIndicator size="large" color="#4f46e5" />
            <Text style={styles.loadingText}>Loading shop snapshot...</Text>
          </View>
        ) : (
          <>
            {/* ─── Real-Time Urgent Approvals Alert Banner ─────────────────────── */}
            {pendingCount > 0 && (
              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.approvalsBanner}
                onPress={() => navigation.navigate('Approvals')}
              >
                <View style={styles.approvalsBannerLeft}>
                  <View style={styles.approvalsBannerIcon}>
                    <MaterialCommunityIcons name="shield-alert" size={24} color="#b45309" />
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.approvalsBannerTitle}>
                      {pendingCount} Pending Approval Request{pendingCount > 1 ? 's' : ''}
                    </Text>
                    <Text style={styles.approvalsBannerSub}>
                      Staff waiting for authorization (discounts/voids)
                    </Text>
                  </View>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={24} color="#b45309" />
              </TouchableOpacity>
            )}

            {/* ─── 1. Revenue Snapshot Hero Card ───────────────────────────── */}
            <Card style={styles.heroCard}>
              <View style={styles.heroHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.heroSubLabel}>TODAY&#39;S REVENUE</Text>
                  <Text style={styles.heroMainAmount}>{revenueStats.todayTotal.toLocaleString()} DA</Text>
                </View>
                <View style={[styles.growthChip, revenueStats.growthPercent >= 0 ? styles.growthPositive : styles.growthNegative]}>
                  <MaterialCommunityIcons
                    name={revenueStats.growthPercent >= 0 ? 'trending-up' : 'trending-down'}
                    size={16}
                    color={revenueStats.growthPercent >= 0 ? '#16a34a' : '#dc2626'}
                  />
                  <Text style={[styles.growthText, { color: revenueStats.growthPercent >= 0 ? '#16a34a' : '#dc2626' }]}>
                    {revenueStats.growthPercent >= 0 ? `+${revenueStats.growthPercent}%` : `${revenueStats.growthPercent}%`} vs yday
                  </Text>
                </View>
              </View>

              <View style={styles.heroDivider} />

              <View style={styles.heroStatsRow}>
                <View style={styles.heroStatItem}>
                  <Text style={styles.heroStatLabel}>Yesterday</Text>
                  <Text style={styles.heroStatVal}>{revenueStats.yesterdayTotal.toLocaleString()} DA</Text>
                </View>
                <View style={styles.verticalDivider} />
                <View style={styles.heroStatItem}>
                  <Text style={styles.heroStatLabel}>This Month</Text>
                  <Text style={styles.heroStatVal}>{revenueStats.monthTotal.toLocaleString()} DA</Text>
                </View>
                <View style={styles.verticalDivider} />
                <View style={styles.heroStatItem}>
                  <Text style={styles.heroStatLabel}>POS / Repairs</Text>
                  <Text style={styles.heroStatValSmall}>
                    {revenueStats.todaySales.toLocaleString()} / {revenueStats.todayRepairs.toLocaleString()}
                  </Text>
                </View>
              </View>

              <View style={[styles.heroDivider, { marginVertical: 10 }]} />

              <View style={styles.heroStatsRow}>
                <View style={styles.heroStatItem}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, justifyContent: 'center' }}>
                    <MaterialCommunityIcons name="cash-multiple" size={13} color="#16a34a" />
                    <Text style={styles.heroStatLabel}>Cash Drawer</Text>
                  </View>
                  <Text style={[styles.heroStatVal, { color: '#16a34a' }]}>
                    {revenueStats.todayCashDrawerTotal.toLocaleString()} DA
                  </Text>
                </View>
                <View style={styles.verticalDivider} />
                <View style={styles.heroStatItem}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, justifyContent: 'center' }}>
                    <MaterialCommunityIcons name="chart-line" size={13} color="#6366f1" />
                    <Text style={styles.heroStatLabel}>Net Profit</Text>
                  </View>
                  <Text style={[styles.heroStatVal, { color: revenueStats.todayNetProfit >= 0 ? '#6366f1' : '#dc2626' }]}>
                    {revenueStats.todayNetProfit.toLocaleString()} DA
                  </Text>
                </View>
                <View style={styles.verticalDivider} />
                <View style={styles.heroStatItem}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, justifyContent: 'center' }}>
                    <MaterialCommunityIcons name="clock-outline" size={13} color="#d97706" />
                    <Text style={styles.heroStatLabel}>Shelf Pending</Text>
                  </View>
                  <Text style={[styles.heroStatValSmall, { color: '#d97706' }]}>
                    {revenueStats.shelfPendingValue.toLocaleString()} DA ({revenueStats.shelfPendingCount})
                  </Text>
                </View>
              </View>
            </Card>

            {/* ─── 2. Quick Action Shortcuts ───────────────────────────────── */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Quick Management</Text>
            </View>

            <View style={styles.quickActionsGrid}>
              <TouchableOpacity
                style={[styles.quickActionBtn, { backgroundColor: '#eef2ff' }]}
                onPress={() => navigation.navigate('Workbench')}
                activeOpacity={0.8}
              >
                <View style={[styles.quickActionIconCircle, { backgroundColor: '#6366f1' }]}>
                  <MaterialCommunityIcons name="cellphone-cog" size={22} color="#ffffff" />
                </View>
                <Text style={styles.quickActionText}>Repairs</Text>
                <Text style={styles.quickActionSub}>{operationalKPIs.activeRepairs} Active</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.quickActionBtn, { backgroundColor: '#f0fdf4' }]}
                onPress={() => navigation.navigate('POS')}
                activeOpacity={0.8}
              >
                <View style={[styles.quickActionIconCircle, { backgroundColor: '#22c55e' }]}>
                  <MaterialCommunityIcons name="cash-register" size={22} color="#ffffff" />
                </View>
                <Text style={styles.quickActionText}>POS Sale</Text>
                <Text style={styles.quickActionSub}>{revenueStats.todayTxCount} Today</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.quickActionBtn, { backgroundColor: '#fef3c7' }]}
                onPress={() => navigation.navigate('Reports')}
                activeOpacity={0.8}
              >
                <View style={[styles.quickActionIconCircle, { backgroundColor: '#f59e0b' }]}>
                  <MaterialCommunityIcons name="chart-bar" size={22} color="#ffffff" />
                </View>
                <Text style={styles.quickActionText}>Daily Report</Text>
                <Text style={styles.quickActionSub}>Financials</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.quickActionBtn, { backgroundColor: '#f8fafc' }]}
                onPress={() => navigation.navigate('Settings')}
                activeOpacity={0.8}
              >
                <View style={[styles.quickActionIconCircle, { backgroundColor: '#64748b' }]}>
                  <MaterialCommunityIcons name="tune" size={22} color="#ffffff" />
                </View>
                <Text style={styles.quickActionText}>Settings</Text>
                <Text style={styles.quickActionSub}>Commission</Text>
              </TouchableOpacity>
            </View>

            {/* ─── 3. Operations & Alert KPIs ──────────────────────────────── */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Operational Health</Text>
            </View>

            <View style={styles.kpiGrid}>
              <Card style={styles.kpiCard}>
                <View style={styles.kpiInner}>
                  <View style={[styles.kpiBadgeIcon, { backgroundColor: '#dbeafe' }]}>
                    <MaterialCommunityIcons name="wrench-clock" size={20} color="#2563eb" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.kpiNumber}>{operationalKPIs.activeRepairs}</Text>
                    <Text style={styles.kpiLabel}>Under Repair</Text>
                  </View>
                </View>
              </Card>

              <Card style={styles.kpiCard}>
                <View style={styles.kpiInner}>
                  <View style={[styles.kpiBadgeIcon, { backgroundColor: '#dcfce7' }]}>
                    <MaterialCommunityIcons name="check-circle-outline" size={20} color="#16a34a" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.kpiNumber}>{operationalKPIs.readyPickups}</Text>
                    <Text style={styles.kpiLabel}>Ready Pickups</Text>
                  </View>
                </View>
              </Card>

              <Card style={styles.kpiCard}>
                <View style={styles.kpiInner}>
                  <View style={[styles.kpiBadgeIcon, { backgroundColor: '#fee2e2' }]}>
                    <MaterialCommunityIcons name="package-variant-remove" size={20} color="#dc2626" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.kpiNumber}>{operationalKPIs.lowStockCount + operationalKPIs.outOfStockCount}</Text>
                    <Text style={styles.kpiLabel}>Stock Alerts</Text>
                  </View>
                </View>
              </Card>

              <Card style={styles.kpiCard}>
                <View style={styles.kpiInner}>
                  <View style={[styles.kpiBadgeIcon, { backgroundColor: '#ede9fe' }]}>
                    <MaterialCommunityIcons name="account-alert-outline" size={20} color="#7c3aed" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.kpiNumber}>{operationalKPIs.unassignedTickets}</Text>
                    <Text style={styles.kpiLabel}>Unassigned</Text>
                  </View>
                </View>
              </Card>
            </View>

            {/* ─── 4. Staff Activity Feed ─────────────────────────────────── */}
            <View style={styles.sectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialCommunityIcons name="broadcast" size={18} color="#4f46e5" />
                <Text style={styles.sectionTitle}>Staff Activity Feed</Text>
              </View>
              <Text style={styles.feedLiveBadge}>● LIVE</Text>
            </View>

            <Card style={styles.activityFeedCard}>
              {activityFeed.length === 0 ? (
                <View style={styles.emptyFeed}>
                  <MaterialCommunityIcons name="history" size={32} color="#cbd5e1" />
                  <Text style={styles.emptyFeedText}>No recent activity logged yet.</Text>
                </View>
              ) : (
                activityFeed.map((act, index) => {
                  const severityColor = getSeverityBadgeColor(act.severity);
                  const isLast = index === activityFeed.length - 1;
                  return (
                    <View key={act.id || index} style={[styles.activityRow, !isLast && styles.activityRowBorder]}>
                      <View style={[styles.activityIconCircle, { backgroundColor: `${severityColor}18` }]}>
                        <MaterialCommunityIcons
                          name={getCategoryIcon(act.category) as any}
                          size={18}
                          color={severityColor}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={styles.activityMetaRow}>
                          <Text style={styles.activityUserName}>{act.userName || 'Staff Member'}</Text>
                          <Text style={styles.activityTime}>{getTimeAgo(act.timestamp)}</Text>
                        </View>
                        <Text style={styles.activityMessage} numberOfLines={2}>
                          {act.message}
                        </Text>
                        {act.detail ? (
                          <Text style={styles.activityDetail} numberOfLines={1}>
                            {act.detail}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })
              )}
            </Card>
          </>
        )}
      </ScrollView>

      <RoleBottomNav currentRoute="AdminDashboard" navigation={navigation} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    backgroundColor: '#4f46e5',
  },
  headerTitle: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 18,
  },
  headerSub: {
    color: '#c7d2fe',
    fontSize: 12,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  centerLoading: {
    paddingTop: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },
  // Hero Card
  heroCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
  },
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  heroSubLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.8,
  },
  heroMainAmount: {
    fontSize: 28,
    fontWeight: '900',
    color: '#0f172a',
    marginTop: 4,
  },
  growthChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
  },
  growthPositive: {
    backgroundColor: '#dcfce7',
  },
  growthNegative: {
    backgroundColor: '#fee2e2',
  },
  growthText: {
    fontSize: 12,
    fontWeight: '700',
  },
  heroDivider: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginVertical: 14,
  },
  heroStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroStatItem: {
    flex: 1,
    alignItems: 'center',
  },
  verticalDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#e2e8f0',
  },
  heroStatLabel: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
    marginBottom: 2,
  },
  heroStatVal: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1e293b',
  },
  heroStatValSmall: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  // Section Headers
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1e293b',
  },
  feedLiveBadge: {
    fontSize: 11,
    fontWeight: '800',
    color: '#16a34a',
  },
  // Quick Actions Grid
  quickActionsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  quickActionBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  quickActionText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1e293b',
  },
  quickActionSub: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
    fontWeight: '600',
  },
  // KPI Cards Grid
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  kpiCard: {
    width: (width - 42) / 2,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
  },
  kpiInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  kpiBadgeIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiNumber: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  kpiLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  // Activity Feed
  activityFeedCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 8,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 8,
    gap: 12,
  },
  activityRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  activityIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  activityMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  activityUserName: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1e293b',
  },
  activityTime: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '500',
  },
  activityMessage: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 16,
    fontWeight: '600',
  },
  activityDetail: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  emptyFeed: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyFeedText: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '500',
  },
  restrictedContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  restrictedTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 16,
  },
  restrictedSub: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  headerApprovalsBtn: {
    padding: 6,
    position: 'relative',
    marginRight: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#ef4444',
    color: '#ffffff',
    fontWeight: 'bold',
  },
  approvalsBanner: {
    backgroundColor: '#fffbeb',
    borderColor: '#fef3c7',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  approvalsBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  approvalsBannerIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#fde68a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  approvalsBannerTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#92400e',
  },
  approvalsBannerSub: {
    fontSize: 12,
    color: '#b45309',
    marginTop: 2,
  },
});
