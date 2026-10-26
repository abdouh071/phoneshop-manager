import './src/i18n';
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Provider as PaperProvider, DefaultTheme } from 'react-native-paper';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuthStore } from './src/store/authStore';
import { useSettingsStore } from './src/store/settingsStore';
import { offlineSyncService } from './src/services/offlineSyncService';
import { OfflineBanner } from './src/components/OfflineBanner';

import { LoginScreen } from './src/screens/LoginScreen';
import { WorkbenchScreen } from './src/screens/WorkbenchScreen';
import { NewTicketScreen } from './src/screens/NewTicketScreen';
import { TicketDetailScreen } from './src/screens/TicketDetailScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ReportsScreen } from './src/screens/ReportsScreen';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { POSScreen } from './src/screens/POSScreen';
import { AdminDashboardScreen } from './src/screens/AdminDashboardScreen';
import { SalesHistoryScreen } from './src/screens/SalesHistoryScreen';
import { InventoryScreen } from './src/screens/InventoryScreen';
import { notificationService } from './src/services/notificationService';

const Stack = createNativeStackNavigator();

const theme = {
  ...DefaultTheme,
  roundness: 12,
  colors: {
    ...DefaultTheme.colors,
    primary: '#4f46e5', // Modern Indigo
    accent: '#14b8a6', // Modern Teal
    background: '#f8fafc', // Slate 50
    surface: '#ffffff',
    text: '#0f172a', // Slate 900
    placeholder: '#94a3b8',
    backdrop: 'rgba(15, 23, 42, 0.4)',
  },
};

export default function App() {
  const { user, isAuthenticated, isInitializing } = useAuthStore();
  const { subscribeToSettings } = useSettingsStore();
  const [ready, setReady] = useState(false);

  // Initialize offline sync runner (periodic check & push to Firestore)
  useEffect(() => {
    const unsubSync = offlineSyncService.init();
    return () => {
      unsubSync();
    };
  }, []);

  useEffect(() => {
    let unsubscribeSettings: (() => void) | undefined;
    if (isAuthenticated) {
      unsubscribeSettings = subscribeToSettings();
    }
    return () => {
      if (unsubscribeSettings) unsubscribeSettings();
    };
  }, [isAuthenticated]);

  useEffect(() => {
    // Wait a brief moment to avoid flashing the login screen while Firebase checks auth state
    if (!isInitializing) {
      setTimeout(() => setReady(true), 100);
    }
  }, [isInitializing]);

  // Register push notifications when user logs in
  useEffect(() => {
    if (isAuthenticated && user?.id) {
      notificationService.registerForPushNotificationsAsync(user.id);
    }
  }, [isAuthenticated, user?.id]);

  if (!ready) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  // Determine initial route based on user role
  const getInitialRouteName = () => {
    if (user?.role === 'admin') return 'AdminDashboard';
    if (user?.role === 'sales_agent') return 'POS';
    return 'Workbench';
  };

  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <View style={styles.appContainer}>
          {/* Universal Offline / Syncing Banner */}
          <OfflineBanner />

          <NavigationContainer>
            <Stack.Navigator
              initialRouteName={!isAuthenticated ? 'Login' : getInitialRouteName()}
              screenOptions={{
                headerStyle: { backgroundColor: '#4f46e5' },
                headerTintColor: '#fff',
                headerTitleStyle: { fontWeight: 'bold' },
              }}
            >
              {!isAuthenticated ? (
                <Stack.Screen 
                  name="Login" 
                  component={LoginScreen} 
                  options={{ headerShown: false }}
                />
              ) : (
                <>
                  {/* Admin Mobile Dashboard - only mounted for admin */}
                  {user?.role === 'admin' && (
                    <Stack.Screen 
                      name="AdminDashboard" 
                      component={AdminDashboardScreen} 
                      options={{ headerShown: false }}
                    />
                  )}

                  {/* Sales POS Screen - strictly excluded for repair_agent */}
                  {user?.role !== 'repair_agent' && (
                    <Stack.Screen 
                      name="POS" 
                      component={POSScreen} 
                      options={{ headerShown: false }}
                    />
                  )}

                  {/* Sales History Screen - strictly excluded for repair_agent */}
                  {user?.role !== 'repair_agent' && (
                    <Stack.Screen 
                      name="SalesHistory" 
                      component={SalesHistoryScreen} 
                      options={{ headerShown: false }}
                    />
                  )}

                  {/* Inventory & Stock Screen - strictly excluded for repair_agent */}
                  {user?.role !== 'repair_agent' && (
                    <Stack.Screen 
                      name="Inventory" 
                      component={InventoryScreen} 
                      options={{ headerShown: false }}
                    />
                  )}

                  {/* Repair Workbench Screen */}
                  <Stack.Screen 
                    name="Workbench" 
                    component={WorkbenchScreen} 
                    options={{ headerShown: false }}
                  />

                  {/* Ticket Management Screens */}
                  <Stack.Screen 
                    name="NewTicket" 
                    component={NewTicketScreen} 
                    options={{ title: 'Add Phone' }}
                  />
                  <Stack.Screen 
                    name="TicketDetail" 
                    component={TicketDetailScreen} 
                    options={{ title: 'Ticket Details' }}
                  />
                  <Stack.Screen 
                    name="Settings" 
                    component={SettingsScreen} 
                    options={{ title: 'Settings' }}
                  />
                  <Stack.Screen 
                    name="Reports" 
                    component={ReportsScreen} 
                    options={{ title: 'Daily Report' }}
                  />
                  <Stack.Screen 
                    name="Scanner" 
                    component={ScannerScreen} 
                    options={{ headerShown: false, presentation: 'modal' }}
                  />
                </>
              )}
            </Stack.Navigator>
          </NavigationContainer>
        </View>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
