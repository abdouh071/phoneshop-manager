import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { offlineSyncService } from '../services/offlineSyncService';
import type { DeadLetterEntry, QueueKind } from '../services/offlineQueuePolicy';

const KIND_ICONS: Record<QueueKind, string> = {
  ticket: 'cellphone-cog',
  sale: 'cart-minus',
  status: 'chart-timeline-variant',
  debt: 'book-alert-outline',
  remark: 'text-box-edit-outline',
  parts: 'cog-transfer',
  stock: 'warehouse',
};

export const OfflineBanner: React.FC = () => {
  const { t } = useTranslation();
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [dropped, setDropped] = useState<DeadLetterEntry[]>([]);
  const [reviewOpen, setReviewOpen] = useState<boolean>(false);
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

  // The listener carries only a count; the parked rows are read when the queue moves
  // and on a slow poll, so a dead letter is never invisible until the next write.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const rows = await offlineSyncService.getDroppedActions().catch(() => [] as DeadLetterEntry[]);
      if (alive) setDropped(rows);
    };
    void load();
    const timer = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // Reload as soon as the queue moves, instead of waiting for the next poll.
  useEffect(() => {
    void offlineSyncService
      .getDroppedActions()
      .then((rows) => setDropped(rows))
      .catch(() => undefined);
  }, [pendingCount, isSyncing]);

  if (pendingCount === 0 && dropped.length === 0 && !showSyncedToast) {
    return null;
  }

  const retryAll = async () => {
    for (const entry of dropped) {
      await offlineSyncService.retryDroppedAction(entry.id).catch(() => undefined);
    }
    setDropped(await offlineSyncService.getDroppedActions().catch(() => []));
  };

  return (
    <>
      {showSyncedToast ? (
        <View style={[styles.banner, styles.bannerSuccess]}>
          <MaterialCommunityIcons name="cloud-check" size={16} color="#ffffff" />
          <Text style={styles.bannerText}>{t('offline.syncedToast')}</Text>
        </View>
      ) : dropped.length > 0 ? (
        <Pressable
          style={[styles.banner, styles.bannerDropped]}
          onPress={() => setReviewOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t('offline.droppedAria', { n: dropped.length })}
        >
          <MaterialCommunityIcons name="cloud-alert" size={16} color="#ffffff" />
          <Text style={styles.bannerText}>
            {t('offline.dropped', { n: dropped.length })}
          </Text>
          <Text style={styles.bannerAction}>{t('offline.review')}</Text>
        </Pressable>
      ) : (
        <View style={[styles.banner, isSyncing ? styles.bannerSyncing : styles.bannerOffline]}>
          <MaterialCommunityIcons
            name={isSyncing ? 'cloud-sync' : 'cloud-off-outline'}
            size={16}
            color="#ffffff"
          />
          <Text style={styles.bannerText}>
            {isSyncing
              ? t('offline.syncing', { n: pendingCount })
              : t('offline.pending', { n: pendingCount })}
          </Text>
        </View>
      )}

      <Modal visible={reviewOpen} transparent animationType="slide" onRequestClose={() => setReviewOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('offline.droppedTitle')}</Text>
            <Text style={styles.modalSubtitle}>{t('offline.droppedSubtitle')}</Text>
            <ScrollView style={styles.modalList}>
              {dropped.map((entry) => (
                <View key={entry.id} style={styles.row}>
                  <MaterialCommunityIcons
                    name={KIND_ICONS[entry.kind] as never}
                    size={20}
                    color="#b45309"
                  />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowKind}>{t(`offline.kind.${entry.kind}`)}</Text>
                    <Text style={styles.rowError} numberOfLines={2}>{entry.lastError}</Text>
                    <Text style={styles.rowMeta}>
                      {t('offline.attempts', { n: entry.attempts })} · {new Date(entry.movedAt).toLocaleString()}
                    </Text>
                  </View>
                  <Pressable
                    style={styles.rowButton}
                    onPress={async () => {
                      await offlineSyncService.retryDroppedAction(entry.id).catch(() => undefined);
                      setDropped(await offlineSyncService.getDroppedActions().catch(() => []));
                    }}
                  >
                    <Text style={styles.rowButtonText}>{t('offline.retry')}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.rowButtonGhost}
                    onPress={async () => {
                      await offlineSyncService.dismissDroppedAction(entry.id).catch(() => undefined);
                      setDropped(await offlineSyncService.getDroppedActions().catch(() => []));
                    }}
                  >
                    <Text style={styles.rowButtonGhostText}>{t('common.delete')}</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable style={styles.primaryButton} onPress={retryAll}>
                <Text style={styles.primaryButtonText}>{t('offline.retryAll')}</Text>
              </Pressable>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  void offlineSyncService.clearDroppedActions();
                  setReviewOpen(false);
                }}
              >
                <Text style={styles.secondaryButtonText}>{t('offline.clearAll')}</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => setReviewOpen(false)}>
                <Text style={styles.secondaryButtonText}>{t('common.close')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
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
  bannerDropped: {
    backgroundColor: '#b45309', // Amber 700
  },
  bannerText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  bannerAction: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: '75%',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
    marginBottom: 10,
  },
  modalList: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  rowBody: {
    flex: 1,
  },
  rowKind: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  rowError: {
    fontSize: 12,
    color: '#b45309',
    marginTop: 2,
  },
  rowMeta: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  rowButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#4f46e5',
  },
  rowButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  rowButtonGhost: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  rowButtonGhostText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '600',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#4f46e5',
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontWeight: '600',
    fontSize: 13,
  },
});
