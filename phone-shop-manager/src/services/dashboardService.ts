import type { DashboardStats, RevenueDataPoint, SaleTransaction } from '../types';
import { useInventoryStore } from '../store/inventoryStore';
import { useCartStore } from '../store/cartStore';
import { useRepairStore } from '../store/repairStore';

export const dashboardService = {
  getStats: async (): Promise<DashboardStats> => {
    const { products } = useInventoryStore.getState();
    const { transactions } = useCartStore.getState();
    const { tickets } = useRepairStore.getState();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const isSameDay = (dateStr: string, day: Date) => {
      const d = new Date(dateStr);
      d.setHours(0, 0, 0, 0);
      return d.getTime() === day.getTime();
    };

    const isEffectiveTx = (t: SaleTransaction) =>
      t.status !== 'refunded' && t.status !== 'voided' && t.status !== 'cancelled' && t.status !== 'pending_approval';

    const todayTx = transactions.filter(t => isEffectiveTx(t) && isSameDay(t.date, today));
    const yesterdayTx = transactions.filter(t => isEffectiveTx(t) && isSameDay(t.date, yesterday));

    const dailyRevenue = todayTx.reduce((s, t) => s + t.total, 0);
    const yesterdayRevenue = yesterdayTx.reduce((s, t) => s + t.total, 0);

    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    const weeklyTx = transactions.filter(t => isEffectiveTx(t) && new Date(t.date) >= startOfWeek);
    const weeklyRevenue = weeklyTx.reduce((s, t) => s + t.total, 0);

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthlyTx = transactions.filter(t => isEffectiveTx(t) && new Date(t.date) >= startOfMonth);
    const monthlyRevenue = monthlyTx.reduce((s, t) => s + t.total, 0);

    const unitsSoldToday = todayTx.reduce((s, t) => s + t.items.reduce((a, i) => a + i.quantity, 0), 0);
    const unitsYesterday = yesterdayTx.reduce((s, t) => s + t.items.reduce((a, i) => a + i.quantity, 0), 0);

    const revenueChange = yesterdayRevenue === 0
      ? (dailyRevenue > 0 ? 100 : 0)
      : ((dailyRevenue - yesterdayRevenue) / yesterdayRevenue) * 100;

    const unitsSoldChange = unitsYesterday === 0
      ? (unitsSoldToday > 0 ? 100 : 0)
      : ((unitsSoldToday - unitsYesterday) / unitsYesterday) * 100;

    return {
      dailyRevenue,
      weeklyRevenue,
      monthlyRevenue,
      unitsSoldToday,
      activeRepairs: tickets.filter(t => t.status === 'pending' || t.status === 'in_progress').length,
      lowStockCount: products.filter(p => p.stockStatus === 'low_stock' || p.stockStatus === 'out_of_stock').length,
      revenueChange,
      unitsSoldChange,
    };
  },

  getWeeklyRevenue: async (): Promise<RevenueDataPoint[]> => {
    const { transactions } = useCartStore.getState();
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(today);
      day.setDate(today.getDate() - (6 - i));
      const dayEnd = new Date(day);
      dayEnd.setHours(23, 59, 59, 999);
      const revenue = transactions
        .filter(t => t.status !== 'refunded' && t.status !== 'voided' && t.status !== 'cancelled' && t.status !== 'pending_approval')
        .filter(t => {
          const d = new Date(t.date);
          return d >= day && d <= dayEnd;
        })
        .reduce((s, t) => s + t.total, 0);
      return { label: days[day.getDay()], revenue };
    });
  },

  getRecentTransactions: async (): Promise<SaleTransaction[]> => {
    const { transactions } = useCartStore.getState();
    return transactions
      .filter(t => t.status !== 'refunded' && t.status !== 'voided' && t.status !== 'cancelled' && t.status !== 'pending_approval')
      .slice(0, 8);
  },
};
