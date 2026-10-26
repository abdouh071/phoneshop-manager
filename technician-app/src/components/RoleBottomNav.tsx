import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/authStore';

export type NavRoute = 'AdminDashboard' | 'Workbench' | 'POS' | 'SalesHistory' | 'Inventory' | 'Reports' | 'Settings';

interface RoleBottomNavProps {
  currentRoute: NavRoute;
  navigation: any;
}

export const RoleBottomNav: React.FC<RoleBottomNavProps> = ({ currentRoute, navigation }) => {
  const { user } = useAuthStore();
  const insets = useSafeAreaInsets();
  const role = user?.role || 'repair_agent';

  const getNavItems = () => {
    if (role === 'admin') {
      return [
        { route: 'AdminDashboard', label: 'Dashboard', icon: 'view-dashboard-outline', activeIcon: 'view-dashboard' },
        { route: 'POS', label: 'POS', icon: 'cash-register', activeIcon: 'cash-register' },
        { route: 'SalesHistory', label: 'Sales', icon: 'receipt-text-outline', activeIcon: 'receipt-text' },
        { route: 'Inventory', label: 'Stock', icon: 'package-variant-closed', activeIcon: 'package-variant' },
        { route: 'Workbench', label: 'Repairs', icon: 'cellphone-cog', activeIcon: 'cellphone-cog' },
        { route: 'Settings', label: 'Settings', icon: 'cog-outline', activeIcon: 'cog' },
      ];
    }

    if (role === 'sales_agent') {
      return [
        { route: 'POS', label: 'POS', icon: 'cash-register', activeIcon: 'cash-register' },
        { route: 'SalesHistory', label: 'History', icon: 'receipt-text-outline', activeIcon: 'receipt-text' },
        { route: 'Inventory', label: 'Inventory', icon: 'package-variant-closed', activeIcon: 'package-variant' },
        { route: 'Workbench', label: 'Repairs', icon: 'cellphone-cog', activeIcon: 'cellphone-cog' },
        { route: 'Settings', label: 'Profile', icon: 'account-outline', activeIcon: 'account' },
      ];
    }

    // repair_agent default: strictly repairs, report, settings
    return [
      { route: 'Workbench', label: 'Workbench', icon: 'cellphone-cog', activeIcon: 'cellphone-cog' },
      { route: 'Reports', label: 'Daily Report', icon: 'chart-bar', activeIcon: 'chart-bar' },
      { route: 'Settings', label: 'Settings', icon: 'cog-outline', activeIcon: 'cog' },
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
              color={isActive ? '#4f46e5' : '#94a3b8'}
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
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -3 },
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 4,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  navLabel: {
    fontSize: 9.5,
    fontWeight: '600',
    color: '#94a3b8',
    marginTop: 2,
    textAlign: 'center',
  },
  navLabelActive: {
    color: '#4f46e5',
    fontWeight: '800',
  },
});
