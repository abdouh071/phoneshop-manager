import './src/i18n';
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Provider as PaperProvider, DefaultTheme } from 'react-native-paper';
import { ActivityIndicator, View } from 'react-native';

import { useAuthStore } from './src/store/authStore';
import { useSettingsStore } from './src/store/settingsStore';
import { LoginScreen } from './src/screens/LoginScreen';
import { WorkbenchScreen } from './src/screens/WorkbenchScreen';
import { NewTicketScreen } from './src/screens/NewTicketScreen';
import { TicketDetailScreen } from './src/screens/TicketDetailScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ReportsScreen } from './src/screens/ReportsScreen';
import { ScannerScreen } from './src/screens/ScannerScreen';

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
  const { isAuthenticated, isInitializing } = useAuthStore();
  const { subscribeToSettings } = useSettingsStore();
  const [ready, setReady] = useState(false);

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

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  return (
    <PaperProvider theme={theme}>
      <NavigationContainer>
        <Stack.Navigator
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
              <Stack.Screen 
                name="Workbench" 
                component={WorkbenchScreen} 
                options={{ headerShown: false }}
              />
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
    </PaperProvider>
  );
}
