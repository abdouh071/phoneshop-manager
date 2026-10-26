import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuthStore } from '../store/authStore';

interface RoleBottomNavProps {
  currentRoute: 'AdminDashboard' | 'Workbench' | 'POS' | 'Reports' | 'Settings';
  navigation: any;
}

export const RoleBottomNav: React.FC<RoleBottomNavProps> = ({ currentRoute, navigation }) => {
  const { user } = useAuthStore();
  const role = user?.role || 'repair_agent';

  const getNavItems = () => {
    if (role === 'admin') {
      return [
        { route: 'AdminDashboard', label: 'Dashboard', icon: 'view-dashboard-outline', activeIcon: 'view-dashboard' },
        { route: 'Workbench', label: 'Repairs', icon: 'cellphone-cog', activeIcon: 'cellphone-cog' },
        { route: 'POS', label: 'POS', icon: 'cash-register', activeIcon: 'cash-register' },
        { route: 'Reports', label: 'Reports', icon: 'chart-bar', activeIcon: 'chart-bar' },
        { route: 'Settings', label: 'Settings', icon: 'cog-outline', activeIcon: 'cog' },
      ];
    }

    if (role === 'sales_agent') {
      return [
        { route: 'POS', label: 'Quick POS', icon: 'cash-register', activeIcon: 'cash-register' },
        { route: 'Workbench', label: 'Repairs Status', icon: 'cellphone-cog', activeIcon: 'cellphone-cog' },
        { route: 'Settings', label: 'Profile', icon: 'account-outline', activeIcon: 'account' },
      ];
    }

    // repair_agent default
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

  return (
    <View style={styles.navBar}>
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
            <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>
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
    height: 60,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: -3 },
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  navLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
    marginTop: 3,
  },
  navLabelActive: {
    color: '#4f46e5',
    fontWeight: '800',
  },
});
