import './src/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Provider as PaperProvider } from 'react-native-paper';
import { ActivityIndicator, AppState, View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { paperTheme } from './src/theme/paperTheme';
import { colors } from './src/theme/tokens';

import { useAuthStore } from './src/store/authStore';
import { useSettingsStore } from './src/store/settingsStore';
import { useRepairStore } from './src/store/repairStore';
import { useLockStore } from './src/store/lockStore';
import { offlineSyncService } from './src/services/offlineSyncService';
import { OfflineBanner } from './src/components/OfflineBanner';
import { AppLockOverlay } from './src/components/AppLockOverlay';

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
import { ApprovalsScreen } from './src/screens/ApprovalsScreen';
import { notificationService } from './src/services/notificationService';

const Stack = createNativeStackNavigator();

export default function App() {
  const { user, isAuthenticated, isInitializing } = useAuthStore();
  const { subscribeToSettings } = useSettingsStore();
  const { subscribeToTickets } = useRepairStore();
  const hydrateLock = useLockStore((state) => state.hydrate);
  const markLeft = useLockStore((state) => state.markLeft);
  const markReturned = useLockStore((state) => state.markReturned);
  const clearLock = useLockStore((state) => state.clearLock);
  // Nothing is drawn until the phone knows whether the lock applies to it, so a
  // saved session cannot show the workbench for a frame before the lock covers it.
  const [lockKnown, setLockKnown] = useState(false);
  const lockHydrated = useRef(false);

  // Initialize offline sync runner (periodic check & push to Firestore)
  useEffect(() => {
    const unsubSync = offlineSyncService.init();
    return () => {
      unsubSync();
    };
  }, []);

  // Once Firebase says whether a session came back, the device decides whether it
  // has to ask who is holding it now. The watchdog exists because this gate holds
  // up the whole app: a silent native call should delay a launch, not cause one.
  useEffect(() => {
    if (isInitializing || lockHydrated.current) return;
    lockHydrated.current = true;
    const watchdog = setTimeout(() => setLockKnown(true), 2000);
    hydrateLock(isAuthenticated)
      .catch((err) => console.warn('[App] Lock hydrate failed:', err))
      .finally(() => {
        clearTimeout(watchdog);
        setLockKnown(true);
      });
  }, [isInitializing, isAuthenticated, hydrateLock]);

  // The 5-minute question is "how long was this phone away?", so the answer is
  // written when it leaves and read when it comes back.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') void markLeft();
      if (next === 'active') void markReturned();
    });
    return () => subscription.remove();
  }, [markLeft, markReturned]);

  // A signed-out phone has no session to protect, however the sign-out happened.
  useEffect(() => {
    if (!isAuthenticated) clearLock();
  }, [isAuthenticated, clearLock]);

  useEffect(() => {
    let unsubscribeSettings: (() => void) | undefined;
    if (isAuthenticated) {
      unsubscribeSettings = subscribeToSettings();
    }
    return () => {
      if (unsubscribeSettings) unsubscribeSettings();
    };
  }, [isAuthenticated]);

  // Repairs are held open for the whole session, not per screen. A technician
  // reading stock or ringing up a sale still gets another device's new ticket
  // pushed to them, and the list is warm the moment they open the workbench.
  // The store refcounts, so a screen that asks for tickets later shares this pair
  // of listeners instead of opening a second one, and logout drops it.
  useEffect(() => {
    if (!isAuthenticated) return;
    return subscribeToTickets();
  }, [isAuthenticated, subscribeToTickets]);

  // Register push notifications when user logs in
  useEffect(() => {
    if (isAuthenticated && user?.id) {
      notificationService
        .registerForPushNotificationsAsync(user.id)
        .catch(err => console.warn('[App] Push registration failed:', err));
      // On the Spark plan there is no Cloud Function to push when the desktop app
      // creates a ticket, so this device listens for those writes itself.
      notificationService
        .startRepairAlertWatcher(user.id)
        .catch(err => console.warn('[App] Repair alert watcher failed to start:', err));
    } else {
      notificationService.stopRepairAlertWatcher();
    }
  }, [isAuthenticated, user?.id]);

  // isInitializing stays true until the Firebase auth callback has resolved, so this splash
  // cannot flash the login screen — and a restored session no longer waits on a fixed delay.
  if (isInitializing || !lockKnown) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.brand} />
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
      <PaperProvider theme={paperTheme}>
        <View style={styles.appContainer}>
          {/* Universal Offline / Syncing Banner */}
          <OfflineBanner />

          <NavigationContainer>
            <Stack.Navigator
              initialRouteName={!isAuthenticated ? 'Login' : getInitialRouteName()}
              screenOptions={{
                headerStyle: { backgroundColor: colors.brand },
                headerTintColor: colors.textInverse,
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
                    <>
                      <Stack.Screen 
                        name="AdminDashboard" 
                        component={AdminDashboardScreen} 
                        options={{ headerShown: false }}
                      />
                      <Stack.Screen 
                        name="Approvals" 
                        component={ApprovalsScreen} 
                        options={{ headerShown: false }}
                      />
                    </>
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

          {/* Last child: everything below is still mounted and resumes in place. */}
          <AppLockOverlay />
        </View>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
