import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { Text, Card, Title, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useRepairStore } from '../store/repairStore';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { RoleBottomNav } from '../components/RoleBottomNav';
import { getClaimedRepairRevenue } from '../utils/repairFinancials';
import {
  colors,
  fontSize,
  radius,
  repairStatusColors,
  softTint,
  spacing,
  statusAppearance,
} from '../theme/tokens';

type ViewMode = 'daily' | 'weekly';
/**
 * 'taken' is the cash a phone actually brought in at pickup; 'all_repaired'
 * counts every repair finished, whether the customer came for it or not.
 */
type ProfitMode = 'taken' | 'all_repaired';

const startOfToday = (): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const revenueOf = (ticket: any, profitMode: ProfitMode): number =>
  profitMode === 'taken'
    ? getClaimedRepairRevenue(ticket)
    : (parseFloat(ticket.actualCost ?? ticket.estimatedCost ?? 0) || 0);

const partsCostOf = (ticket: any): number => {
  if (!Array.isArray(ticket.partsUsed)) return 0;
  return ticket.partsUsed.reduce((sum: number, part: any) => {
    const cost = parseFloat(part?.cost) || 0;
    const qty = part?.quantity !== undefined ? (parseFloat(part.quantity) || 1) : 1;
    return sum + cost * qty;
  }, 0);
};

type ReportHeaderProps = {
  viewMode: ViewMode;
  profitMode: ProfitMode;
  onViewMode: (mode: ViewMode) => void;
  onProfitMode: (mode: ProfitMode) => void;
  onPrevPeriod: () => void;
  onNextPeriod: () => void;
  periodLabel: string;
  commission: number;
  takenCount: number;
  shelfCount: number;
  ticketCount: number;
  grossRevenue: number;
  partsCost: number;
  netRevenue: number;
  myProfit: number;
};

/**
 * Module-level, and passed to `ListHeaderComponent` as an element: an inline
 * arrow there is a new component type on every render, which unmounted and
 * remounted the whole header. Same rule as `InventoryScreen`.
 */
const ReportHeader = ({
  viewMode,
  profitMode,
  onViewMode,
  onProfitMode,
  onPrevPeriod,
  onNextPeriod,
  periodLabel,
  commission,
  takenCount,
  shelfCount,
  ticketCount,
  grossRevenue,
  partsCost,
  netRevenue,
  myProfit,
}: ReportHeaderProps) => {
  const { t } = useTranslation();
  const isTaken = profitMode === 'taken';
  const takenVsShelf = t('reports.takenVsShelf', '{{taken}} taken • {{ready}} on shelf', {
    taken: takenCount,
    ready: shelfCount,
  });

  return (
    <>
      {/* View Period Tabs: Daily vs Weekly */}
      <View style={styles.modeTabs}>
        <Button
          mode={viewMode === 'daily' ? 'contained' : 'outlined'}
          onPress={() => onViewMode('daily')}
          style={styles.modeBtn}
        >
          {t('reports.viewDaily', 'Daily')}
        </Button>
        <Button
          mode={viewMode === 'weekly' ? 'contained' : 'outlined'}
          onPress={() => onViewMode('weekly')}
          style={styles.modeBtn}
        >
          {t('reports.viewWeekly', 'Weekly')}
        </Button>
      </View>

      {/* Real Profit (Taken) vs All Repaired (Work) */}
      <View style={styles.profitTypeWrapper}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => onProfitMode('taken')}
          style={[styles.profitTypeBtn, isTaken && styles.profitTypeBtnTaken]}
        >
          <MaterialCommunityIcons
            name="cash-check"
            size={18}
            color={isTaken ? colors.onBrand : colors.textMuted}
          />
          <Text style={[styles.profitTypeText, isTaken && styles.profitTypeTextActive]}>
            {t('reports.modeBtnTaken', 'Real Profit (Taken)')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => onProfitMode('all_repaired')}
          style={[styles.profitTypeBtn, !isTaken && styles.profitTypeBtnWork]}
        >
          <MaterialCommunityIcons
            name="wrench-check"
            size={18}
            color={!isTaken ? colors.onBrand : colors.textMuted}
          />
          <Text style={[styles.profitTypeText, !isTaken && styles.profitTypeTextActive]}>
            {t('reports.modeBtnWork', 'All Repaired (Work)')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Date Navigation */}
      <View style={styles.navRow}>
        <Button mode="text" onPress={onPrevPeriod} compact>
          <MaterialCommunityIcons name="chevron-left" size={24} />
        </Button>
        <Text style={styles.periodText}>{periodLabel}</Text>
        <Button mode="text" onPress={onNextPeriod} compact>
          <MaterialCommunityIcons name="chevron-right" size={24} />
        </Button>
      </View>

      {/* Summary Card */}
      <View style={styles.summaryContainer}>
        <Card style={[styles.summaryCard, isTaken ? styles.summaryCardTaken : styles.summaryCardWork]}>
          <Card.Content>
            <View style={styles.modeBadgeHeader}>
              <View style={styles.modePillBadge}>
                <MaterialCommunityIcons
                  name={isTaken ? 'check-decagram' : 'wrench-clock'}
                  size={14}
                  color={colors.onBrand}
                />
                <Text style={styles.modeBadgeText}>
                  {isTaken
                    ? t('reports.badgeTaken', 'REALIZED CASH (TAKEN ONLY)')
                    : t('reports.badgeWork', 'TOTAL PRODUCTION (WORK DONE)')}
                </Text>
              </View>
              <Text style={styles.modeSubtitle}>
                {isTaken ? t('reports.subtSettled', 'Settled upon customer pickup') : takenVsShelf}
              </Text>
            </View>

            {/* My Cut Box */}
            <View style={styles.myProfitBox}>
              <View>
                <Text style={styles.myProfitLabel}>
                  {isTaken
                    ? t('reports.cutTaken', 'Realized Profit ({{pct}}%)', { pct: commission })
                    : t('reports.cutWork', 'Work Revenue ({{pct}}%)', { pct: commission })}
                </Text>
                <Text style={styles.myProfitValue}>{myProfit.toFixed(2)} DA</Text>
              </View>
              <MaterialCommunityIcons
                name={isTaken ? 'cash-check' : 'hammer-wrench'}
                size={46}
                color={colors.onBrandFaint}
              />
            </View>

            <View style={styles.summaryDivider} />

            <Title style={styles.summaryTitle}>{t('reports.breakdown', 'Breakdown')}</Title>

            <View style={styles.statRow}>
              <Text style={styles.statLabel}>{t('reports.grossRevenue', 'Gross Revenue')}</Text>
              <Text style={styles.statValue}>{grossRevenue} DA</Text>
            </View>

            <View style={styles.statRow}>
              <Text style={styles.statLabel}>{t('reports.partsCost', 'Parts Cost')}</Text>
              <Text style={[styles.statValue, styles.statValueLoss]}>-{partsCost} DA</Text>
            </View>

            <View style={[styles.statRow, styles.statRowNet]}>
              <Text style={[styles.statLabel, styles.statLabelNet]}>
                {t('reports.netProfit', 'Net Profit')}
              </Text>
              <Text style={styles.statValueNet}>{netRevenue} DA</Text>
            </View>
          </Card.Content>
        </Card>
      </View>

      <View style={styles.listHeader}>
        <View style={styles.listHeaderRow}>
          <Title style={styles.listTitle}>
            {isTaken
              ? t('reports.listTaken', 'Taken Phones ({{n}})', { n: ticketCount })
              : t('reports.listWork', 'All Repaired Phones ({{n}})', { n: ticketCount })}
          </Title>
          {!isTaken && <Text style={styles.listSubCount}>{takenVsShelf}</Text>}
        </View>
      </View>
    </>
  );
};

export const ReportsScreen = ({ navigation }: any) => {
  const { t, i18n } = useTranslation();
  const { fetchMyCompletedTickets } = useRepairStore();
  const { user } = useAuthStore();
  const { weekStartDay, getTechnicianRate } = useSettingsStore();

  // Read straight from the store: it reads its own state, so a rate changed on
  // the desktop shows up on the next render without a memo to invalidate.
  const effectiveCommission = getTechnicianRate(user?.name);

  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [profitType, setProfitType] = useState<ProfitMode>('taken');
  const [refreshing, setRefreshing] = useState(false);

  const [currentDate, setCurrentDate] = useState(startOfToday);
  // Overwritten by the weekStartDay effect on mount
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfToday);

  useEffect(() => {
    // Reset to the proper start of week whenever settings change
    const d = new Date();
    const day = d.getDay();
    const startDay = weekStartDay ?? 0;
    const diffToStart = (day - startDay + 7) % 7;
    d.setDate(d.getDate() - diffToStart);
    d.setHours(0, 0, 0, 0);
    setCurrentWeekStart(d);
  }, [weekStartDay]);

  const loadTickets = async () => {
    setLoading(true);
    if (user?.name) {
      const myTickets = await fetchMyCompletedTickets(user.name);
      setTickets(myTickets);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadTickets();
  }, []);

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

    // 'taken' dates from the handover, 'all_repaired' from the work finishing
    const dateOf = (ticket: any) =>
      profitType === 'taken'
        ? (ticket.completedAt || ticket.repairedAt)
        : (ticket.repairedAt || ticket.completedAt);

    return tickets.filter(ticket => {
      if (profitType === 'taken' && ticket.status !== 'completed') return false;
      if (profitType === 'all_repaired' && ticket.status !== 'ready' && ticket.status !== 'completed') return false;
      const dateToCheck = dateOf(ticket);
      if (!dateToCheck) return false;
      const tDate = new Date(dateToCheck);
      return tDate >= start && tDate <= end;
    }).sort((a, b) => new Date(dateOf(b) || 0).getTime() - new Date(dateOf(a) || 0).getTime());
  }, [tickets, viewMode, currentDate, currentWeekStart, profitType]);

  // Breakdown of ready vs taken tickets in the current selection
  const { readyCount, completedCount } = useMemo(() => {
    let ready = 0;
    let completed = 0;
    filteredTickets.forEach(ticket => {
      if (ticket.status === 'ready') ready++;
      else if (ticket.status === 'completed') completed++;
    });
    return { readyCount: ready, completedCount: completed };
  }, [filteredTickets]);

  const shiftPeriod = (direction: number) => {
    const d = new Date(viewMode === 'daily' ? currentDate : currentWeekStart);
    d.setDate(d.getDate() + direction * (viewMode === 'daily' ? 1 : 7));
    if (viewMode === 'daily') setCurrentDate(d);
    else setCurrentWeekStart(d);
  };

  const periodLabel = useMemo(() => {
    if (viewMode === 'daily') {
      return currentDate.toLocaleDateString(i18n.language, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    }
    const end = new Date(currentWeekStart);
    end.setDate(end.getDate() + 6);
    const short = (d: Date) =>
      d.toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' });
    return `${short(currentWeekStart)} - ${short(end)}`;
  }, [viewMode, currentDate, currentWeekStart, i18n.language]);

  // Gross minus the parts that went into the work, then the technician's share
  const { grossRevenue, totalPartsCost, netRevenue, myProfit } = useMemo(() => {
    let gross = 0;
    let parts = 0;
    filteredTickets.forEach(ticket => {
      gross += revenueOf(ticket, profitType);
      parts += partsCostOf(ticket);
    });

    const net = gross - parts;
    return {
      grossRevenue: gross,
      totalPartsCost: parts,
      netRevenue: net,
      myProfit: net * (effectiveCommission / 100),
    };
  }, [filteredTickets, effectiveCommission, profitType]);

  // This screen only ever shows the signed-in technician's own tickets
  // (`fetchMyCompletedTickets`), so it is deliberately not behind the `reports`
  // capability, which gates the shop-wide reports an admin sees on desktop.
  const modeInk = profitType === 'taken' ? colors.modeTaken : colors.modeWork;

  const renderTicket = ({ item }: { item: any }) => {
    const revenue = revenueOf(item, profitType);
    const parts = partsCostOf(item);
    const net = revenue - parts;
    const isReadyOnly = item.status === 'ready';
    const appearance = statusAppearance(repairStatusColors, item.status);

    return (
      <Card style={styles.ticketCard}>
        <View style={[styles.ticketStrip, { backgroundColor: appearance.ink }]} />
        <Card.Content style={styles.ticketRow}>
          <View style={styles.ticketMain}>
            <View style={styles.ticketHeadRow}>
              <Text style={styles.ticketNum}>{item.ticketNumber}</Text>
              <View style={[styles.statusMiniBadge, { backgroundColor: appearance.tint }]}>
                <Text style={[styles.statusMiniText, { color: appearance.ink }]}>
                  {isReadyOnly
                    ? t('reports.statusReady', 'READY (ON SHELF)')
                    : t('reports.statusClaimed', 'CLAIMED / TAKEN')}
                </Text>
              </View>
            </View>
            <Text style={styles.deviceText}>{item.deviceBrand} {item.deviceModel}</Text>
            {item.customerName ? (
              <Text style={styles.customerNameText} numberOfLines={1}>{item.customerName}</Text>
            ) : null}
          </View>
          <View style={styles.ticketFigures}>
            <Text style={styles.revenueText}>{revenue} DA</Text>
            {parts > 0 && (
              <Text style={styles.partsText}>
                {t('reports.partsMinus', 'Parts: -{{n}} DA', { n: parts })}
              </Text>
            )}
            <Text style={[styles.profitText, { color: appearance.ink }]}>
              {t('reports.netLabel', 'Net: {{n}} DA', { n: net })}
            </Text>
          </View>
        </Card.Content>
      </Card>
    );
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredTickets}
        keyExtractor={(item) => item.id}
        renderItem={renderTicket}
        ListHeaderComponent={
          <ReportHeader
            viewMode={viewMode}
            profitMode={profitType}
            onViewMode={setViewMode}
            onProfitMode={setProfitType}
            onPrevPeriod={() => shiftPeriod(-1)}
            onNextPeriod={() => shiftPeriod(1)}
            periodLabel={periodLabel}
            commission={effectiveCommission}
            takenCount={completedCount}
            shelfCount={readyCount}
            ticketCount={filteredTickets.length}
            grossRevenue={grossRevenue}
            partsCost={totalPartsCost}
            netRevenue={netRevenue}
            myProfit={myProfit}
          />
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[modeInk]}
            tintColor={modeInk}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={[styles.emptyIconCircle, { backgroundColor: softTint(modeInk) }]}>
              <MaterialCommunityIcons
                name={profitType === 'taken' ? 'cash-remove' : 'clipboard-check-outline'}
                size={48}
                color={modeInk}
              />
            </View>
            <Text style={[styles.emptyTitle, { color: modeInk }]}>
              {profitType === 'taken'
                ? t('reports.emptyTakenTitle', 'No taken phones yet')
                : t('reports.emptyWorkTitle', 'All caught up!')}
            </Text>
            <Text style={styles.emptyText}>
              {profitType === 'taken'
                ? t('reports.emptyTakenBody', 'No phones were picked up and settled in this period.')
                : t('reports.emptyWorkBody', 'No repairs completed in this period.')}
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
    backgroundColor: colors.background,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  modeTabs: {
    flexDirection: 'row',
    padding: spacing.lg,
    justifyContent: 'center',
    gap: spacing.md,
  },
  modeBtn: {
    flex: 1,
    borderRadius: radius.sm,
    borderColor: colors.brand,
  },
  profitTypeWrapper: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.xxs,
    gap: spacing.xxs,
  },
  profitTypeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    gap: spacing.xs,
  },
  profitTypeBtnTaken: {
    backgroundColor: colors.modeTaken,
  },
  profitTypeBtnWork: {
    backgroundColor: colors.modeWork,
  },
  profitTypeText: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.textMuted,
  },
  profitTypeTextActive: {
    color: colors.onBrand,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  periodText: {
    fontSize: fontSize.subtitle,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  summaryContainer: {
    padding: spacing.lg,
  },
  summaryCard: {
    borderRadius: radius.xl,
  },
  summaryCardTaken: {
    backgroundColor: colors.modeTaken,
  },
  summaryCardWork: {
    backgroundColor: colors.modeWork,
  },
  modeBadgeHeader: {
    marginBottom: spacing.md,
  },
  modePillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.xs,
    gap: spacing.xs,
    marginBottom: spacing.xxs,
    backgroundColor: colors.onBrandScrim,
  },
  modeBadgeText: {
    color: colors.onBrand,
    fontSize: fontSize.micro,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  modeSubtitle: {
    color: colors.onBrandSoft,
    fontSize: fontSize.label,
    fontWeight: '500',
  },
  myProfitBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  myProfitLabel: {
    color: colors.onBrandSoft,
    fontSize: fontSize.bodyStrong,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xxs,
  },
  myProfitValue: {
    color: colors.onBrand,
    fontSize: fontSize.display,
    fontWeight: '800',
  },
  summaryDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.onBrandHairline,
    marginVertical: spacing.md,
  },
  summaryTitle: {
    color: colors.onBrandSoft,
    fontSize: fontSize.bodyStrong,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  statRowNet: {
    marginTop: spacing.xs,
  },
  statLabel: {
    color: colors.onBrandSoft,
    fontSize: fontSize.bodyStrong,
    fontWeight: '500',
  },
  statLabelNet: {
    color: colors.onBrand,
    fontWeight: '700',
  },
  statValue: {
    color: colors.onBrand,
    fontSize: fontSize.subtitle,
    fontWeight: '700',
  },
  statValueLoss: {
    color: colors.lossOnBrand,
  },
  statValueNet: {
    color: colors.onBrand,
    fontSize: fontSize.title,
    fontWeight: '800',
  },
  listHeader: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listTitle: {
    fontSize: fontSize.subtitle,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  listSubCount: {
    fontSize: fontSize.label,
    color: colors.textMuted,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 100,
  },
  ticketCard: {
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  ticketStrip: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    zIndex: 1,
  },
  ticketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.lg,
  },
  ticketMain: {
    flex: 1,
  },
  ticketHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  ticketNum: {
    fontSize: fontSize.body,
    color: colors.textFaint,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: spacing.xxs,
  },
  statusMiniBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    borderRadius: radius.xs,
    marginBottom: spacing.xxs,
  },
  statusMiniText: {
    fontSize: fontSize.micro,
    fontWeight: '800',
  },
  deviceText: {
    fontSize: fontSize.subtitle,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  customerNameText: {
    fontSize: fontSize.label,
    color: colors.textMuted,
    fontWeight: '500',
    marginTop: spacing.xxs,
  },
  ticketFigures: {
    alignItems: 'flex-end',
  },
  revenueText: {
    fontSize: fontSize.body,
    color: colors.textMuted,
    fontWeight: '500',
  },
  partsText: {
    fontSize: fontSize.label,
    color: colors.textFaint,
  },
  profitText: {
    fontSize: fontSize.subtitle,
    fontWeight: '800',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 40,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: radius.circle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: fontSize.subtitle,
    fontWeight: '800',
  },
  emptyText: {
    marginTop: spacing.xs,
    color: colors.textFaint,
    fontSize: fontSize.body,
    fontWeight: '500',
    textAlign: 'center',
  },
});
