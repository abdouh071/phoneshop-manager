import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { offlineSyncService } from '../services/offlineSyncService';

export const OfflineBanner: React.FC = () => {
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [showSyncedToast, setShowSyncedToast] = useState<boolean>(false);

  useEffect(() => {
    let lastPending = 0;
    const unsubscribe = offlineSyncService.subscribe((count, syncing) => {
      if (lastPending > 0 && count === 0 && !syncing) {
        setShowSyncedToast(true);
        setTimeout(() => setShowSyncedToast(false), 3500);
      }
      lastPending = count;
      setPendingCount(count);
      setIsSyncing(syncing);
    });

    return () => unsubscribe();
  }, []);

  if (pendingCount === 0 && !showSyncedToast) {
    return null;
  }

  if (showSyncedToast) {
    return (
      <View style={[styles.banner, styles.bannerSuccess]}>
        <MaterialCommunityIcons name="cloud-check" size={16} color="#ffffff" />
        <Text style={styles.bannerText}>
          Connection restored — All offline data synced to database!
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.banner, isSyncing ? styles.bannerSyncing : styles.bannerOffline]}>
      <MaterialCommunityIcons
        name={isSyncing ? 'cloud-sync' : 'cloud-off-outline'}
        size={16}
        color="#ffffff"
      />
      <Text style={styles.bannerText}>
        {isSyncing
          ? `Back online — Syncing ${pendingCount} offline change(s)...`
          : `Offline Mode — ${pendingCount} change(s) will auto-sync when connected.`}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    gap: 8,
    zIndex: 999,
  },
  bannerOffline: {
    backgroundColor: '#dc2626', // Red 600
  },
  bannerSyncing: {
    backgroundColor: '#0284c7', // Sky 600
  },
  bannerSuccess: {
    backgroundColor: '#16a34a', // Green 600
  },
  bannerText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
});
