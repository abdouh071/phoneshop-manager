import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import { colors, elevation, spacing } from '../theme/tokens';

export type NavRoute = 'AdminDashboard' | 'Workbench' | 'POS' | 'SalesHistory' | 'Inventory' | 'Reports' | 'Settings';

interface RoleBottomNavProps {
  currentRoute: NavRoute;
  navigation: any;
}

export const RoleBottomNav: React.FC<RoleBottomNavProps> = ({ currentRoute, navigation }) => {
  const { user } = useAuthStore();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const role = user?.role || 'repair_agent';

  const getNavItems = () => {
    if (role === 'admin') {
      return [
        { route: 'AdminDashboard', label: t('nav.dashboard', 'Dashboard'), icon: 'view-dashboard-outline', activeIcon: 'view-dashboard' },
        { route: 'POS', label: t('nav.pos', 'POS'), icon: 'cash-register', activeIcon: 'cash-register' },
        { route: 'SalesHistory', label: t('nav.sales', 'Sales'), icon: 'receipt-text-outline', activeIcon: 'receipt-text' },
        { route: 'Inventory', label: t('nav.stock', 'Stock'), icon: 'package-variant-closed', activeIcon: 'package-variant' },
        { route: 'Workbench', label: t('nav.repairs', 'Repairs'), icon: 'cellphone-cog', activeIcon: 'cellphone-cog' },
        { route: 'Settings', label: t('nav.settings', 'Settings'), icon: 'cog-outline', activeIcon: 'cog' },
      ];
    }

    if (role === 'sales_agent') {
      return [
        { route: 'POS', label: t('nav.pos', 'POS'), icon: 'cash-register', activeIcon: 'cash-register' },
        { route: 'SalesHistory', label: t('nav.history', 'History'), icon: 'receipt-text-outline', activeIcon: 'receipt-text' },
        { route: 'Inventory', label: t('nav.inventory', 'Inventory'), icon: 'package-variant-closed', activeIcon: 'package-variant' },
        { route: 'Workbench', label: t('nav.repairs', 'Repairs'), icon: 'cellphone-cog', activeIcon: 'cellphone-cog' },
        { route: 'Settings', label: t('nav.profile', 'Profile'), icon: 'account-outline', activeIcon: 'account' },
      ];
    }

    // repair_agent default: strictly repairs, report, settings
    return [
      { route: 'Workbench', label: t('nav.workbench', 'Workbench'), icon: 'cellphone-cog', activeIcon: 'cellphone-cog' },
      { route: 'Reports', label: t('nav.dailyReport', 'Daily Report'), icon: 'chart-bar', activeIcon: 'chart-bar' },
      { route: 'Settings', label: t('nav.settings', 'Settings'), icon: 'cog-outline', activeIcon: 'cog' },
    ];
  };

  const items = getNavItems();

  const handlePress = (targetRoute: string) => {
    if (currentRoute === targetRoute) return;
    navigation.navigate(targetRoute);
  };

  const bottomPadding = Math.max(insets.bottom, 6);
  const totalHeight = 58 + Math.max(insets.bottom, 0);

  return (
    <View style={[styles.navBar, { height: totalHeight, paddingBottom: bottomPadding }]}>
      {items.map(item => {
        const isActive = currentRoute === item.route;
        return (
          <TouchableOpacity
            key={item.route}
            style={styles.navItem}
            activeOpacity={0.7}
            onPress={() => handlePress(item.route)}
          >
            <MaterialCommunityIcons
              name={(isActive ? item.activeIcon : item.icon) as any}
              size={22}
              color={isActive ? colors.brand : colors.textFaint}
            />
            <Text
              numberOfLines={1}
              style={[styles.navLabel, isActive && styles.navLabelActive]}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  navBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.xs,
    ...elevation.overlay,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  navLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textFaint,
    marginTop: spacing.xxs,
    textAlign: 'center',
  },
  navLabelActive: {
    color: colors.brand,
    fontWeight: '700',
  },
});
