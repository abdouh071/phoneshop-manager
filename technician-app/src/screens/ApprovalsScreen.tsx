import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  Alert,
  Vibration,
  TextInput as RNTextInput,
} from 'react-native';
import {
  Appbar,
  Card,
  Text,
  Button,
  useTheme,
  ActivityIndicator,
  Badge,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useApprovalStore } from '../store/approvalStore';
import { useAuthStore } from '../store/authStore';
import type { ApprovalRequest } from '../types';

const formatTimeAgo = (dateStr?: string): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${Math.floor(diffHour / 24)}d ago`;
};

export const ApprovalsScreen = ({ navigation }: any) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const { user } = useAuthStore();
  const {
    pendingRequests,
    recentResolved,
    pendingCount,
    isLoading,
    approveRequest,
    rejectRequest,
    subscribeToPending,
  } = useApprovalStore();

  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [rejectModalReq, setRejectModalReq] = useState<ApprovalRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role !== 'admin') {
      navigation.replace('Workbench');
      return;
    }
    const unsub = subscribeToPending();
    return () => unsub();
  }, [user?.role, subscribeToPending]);

  const handleApprove = (req: ApprovalRequest) => {
    Alert.alert(
      t('approvals.confirmApproveTitle', 'Confirm Approval'),
      t('approvals.confirmApproveBody', 'Are you sure you want to approve "{{action}}"?', { action: req.actionLabel }),
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        {
          text: t('common.confirm', 'Approve'),
          onPress: async () => {
            setActionInProgress(req.id);
            try {
              await approveRequest(req.id, 'remote');
              Vibration.vibrate([0, 50, 100]);
              Alert.alert(
                t('common.success', 'Success'),
                t('approvals.approvedSuccess', 'Approved "{{action}}" for {{name}}.', {
                  action: req.actionLabel,
                  name: req.requestedBy.name,
                })
              );
            } catch (err: any) {
              Alert.alert(t('common.error', 'Error'), err.message || 'Failed to approve request.');
            } finally {
              setActionInProgress(null);
            }
          },
        },
      ]
    );
  };

  const handleConfirmReject = async () => {
    if (!rejectModalReq) return;
    const reqId = rejectModalReq.id;
    setActionInProgress(reqId);
    try {
      await rejectRequest(reqId, rejectReason.trim());
      Vibration.vibrate(50);
      setRejectModalReq(null);
      setRejectReason('');
      Alert.alert(t('common.success', 'Success'), t('approvals.rejectedSuccess', 'The staff member has been notified.'));
    } catch (err: any) {
      Alert.alert(t('common.error', 'Error'), err.message || 'Failed to reject request.');
    } finally {
      setActionInProgress(null);
    }
  };

  const renderPendingItem = ({ item }: { item: ApprovalRequest }) => {
    const isBusy = actionInProgress === item.id;
    return (
      <Card style={styles.requestCard}>
        <Card.Content>
          <View style={styles.cardHeader}>
            <View style={styles.actionHeaderLeft}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.requestedBy.name?.charAt(0).toUpperCase() || 'S'}</Text>
              </View>
              <View>
                <Text style={styles.staffName}>{item.requestedBy.name}</Text>
                <Text style={styles.staffRole}>{item.requestedBy.role?.toUpperCase()} · {formatTimeAgo(item.requestedAt)}</Text>
              </View>
            </View>
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>{t('approvals.pending', 'Pending')}</Text>
            </View>
          </View>

          <View style={styles.actionLabelContainer}>
            <MaterialCommunityIcons name="shield-alert-outline" size={20} color="#f59e0b" style={{ marginRight: 6 }} />
            <Text style={styles.actionLabelText}>{item.actionLabel}</Text>
          </View>

          {item.reason ? (
            <View style={styles.reasonContainer}>
              <Text style={styles.reasonLabel}>{t('approvals.reason', 'Reason')}:</Text>
              <Text style={styles.reasonText}>"{item.reason}"</Text>
            </View>
          ) : null}

          {item.targetId ? (
            <Text style={styles.targetRefText}>{t('approvals.refId', 'Target ID')}: {item.targetId}</Text>
          ) : null}

          <View style={styles.actionBtnRow}>
            <Button
              mode="contained"
              buttonColor="#16a34a"
              icon="check"
              disabled={isBusy}
              loading={isBusy}
              style={styles.actionBtn}
              onPress={() => handleApprove(item)}
            >
              {t('approvals.approve', 'Approve')}
            </Button>
            <Button
              mode="contained"
              buttonColor="#dc2626"
              icon="close"
              disabled={isBusy}
              style={styles.actionBtn}
              onPress={() => {
                setRejectModalReq(item);
                setRejectReason('');
              }}
            >
              {t('approvals.reject', 'Reject')}
            </Button>
          </View>
        </Card.Content>
      </Card>
    );
  };

  const renderHistoryItem = ({ item }: { item: ApprovalRequest }) => {
    const isApproved = item.status === 'approved';
    return (
      <Card style={styles.requestCard}>
        <Card.Content>
          <View style={styles.cardHeader}>
            <View style={styles.actionHeaderLeft}>
              <View style={[styles.avatar, { backgroundColor: isApproved ? '#dcfce7' : '#fee2e2' }]}>
                <MaterialCommunityIcons
                  name={isApproved ? 'check-bold' : 'close-thick'}
                  size={16}
                  color={isApproved ? '#16a34a' : '#dc2626'}
                />
              </View>
              <View>
                <Text style={styles.staffName}>{item.actionLabel}</Text>
                <Text style={styles.staffRole}>
                  {t('approvals.requestedBy', 'Requested by')} {item.requestedBy.name} · {formatTimeAgo(item.requestedAt)}
                </Text>
              </View>
            </View>
            <View style={[styles.statusBadge, isApproved ? styles.approvedBadge : styles.rejectedBadge]}>
              <Text style={[styles.statusBadgeText, isApproved ? styles.approvedBadgeText : styles.rejectedBadgeText]}>
                {isApproved ? t('approvals.approved', 'Approved') : t('approvals.rejected', 'Rejected')}
              </Text>
            </View>
          </View>

          {item.resolvedBy ? (
            <Text style={styles.resolutionMeta}>
              {isApproved ? t('approvals.approvedBy', 'Approved by') : t('approvals.rejectedBy', 'Rejected by')}{' '}
              <Text style={{ fontWeight: 'bold' }}>{item.resolvedBy.name}</Text>
              {item.resolvedAt ? ` (${formatTimeAgo(item.resolvedAt)})` : ''}
            </Text>
          ) : null}

          {!isApproved && item.rejectionReason ? (
            <View style={[styles.reasonContainer, { backgroundColor: '#fef2f2', borderColor: '#fecaca' }]}>
              <Text style={[styles.reasonLabel, { color: '#dc2626' }]}>{t('approvals.rejectionReason', 'Rejection Reason')}:</Text>
              <Text style={[styles.reasonText, { color: '#991b1b' }]}>{item.rejectionReason}</Text>
            </View>
          ) : null}
        </Card.Content>
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      <Appbar.Header style={styles.appbar}>
        <Appbar.BackAction color="#fff" onPress={() => navigation.goBack()} />
        <Appbar.Content
          title={t('approvals.title', 'Staff Approvals')}
          subtitle={t('approvals.subtitle', 'Real-Time Authorization Requests')}
          titleStyle={styles.appbarTitle}
          subtitleStyle={styles.appbarSub}
        />
        {pendingCount > 0 && (
          <Badge style={styles.headerBadge} size={22}>
            {pendingCount}
          </Badge>
        )}
      </Appbar.Header>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'pending' && styles.tabBtnActive]}
          onPress={() => setActiveTab('pending')}
        >
          <View style={styles.tabContentRow}>
            <Text style={[styles.tabText, activeTab === 'pending' && styles.tabTextActive]}>
              {t('approvals.pendingTab', 'Pending Requests')}
            </Text>
            {pendingCount > 0 && (
              <View style={styles.tabCounterBadge}>
                <Text style={styles.tabCounterText}>{pendingCount}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'history' && styles.tabBtnActive]}
          onPress={() => setActiveTab('history')}
        >
          <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>
            {t('approvals.historyTab', 'Resolved History')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {isLoading && (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#4f46e5" />
          <Text style={{ marginTop: 12, color: '#64748b' }}>{t('common.loading', 'Loading...')}</Text>
        </View>
      )}

      {!isLoading && activeTab === 'pending' && (
        <FlatList
          data={pendingRequests}
          keyExtractor={(item) => item.id}
          renderItem={renderPendingItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons name="check-circle-outline" size={64} color="#10b981" />
              <Text style={styles.emptyTitle}>{t('approvals.allClear', 'All Clear!')}</Text>
              <Text style={styles.emptySub}>{t('approvals.noPending', 'No pending approval requests from staff.')}</Text>
            </View>
          }
        />
      )}

      {!isLoading && activeTab === 'history' && (
        <FlatList
          data={recentResolved}
          keyExtractor={(item) => item.id}
          renderItem={renderHistoryItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons name="history" size={56} color="#94a3b8" />
              <Text style={styles.emptyTitle}>{t('approvals.noHistory', 'No History')}</Text>
              <Text style={styles.emptySub}>{t('approvals.noHistorySub', 'No past approval requests recorded yet.')}</Text>
            </View>
          }
        />
      )}

      {/* Reject Modal */}
      <Modal visible={Boolean(rejectModalReq)} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <MaterialCommunityIcons name="close-circle-outline" size={28} color="#dc2626" style={{ marginRight: 8 }} />
              <Text style={styles.modalTitle}>{t('approvals.rejectTitle', 'Reject Approval Request')}</Text>
            </View>

            <Text style={styles.modalSub}>
              {t('approvals.rejectSubtitle', 'Please provide a reason so {{name}} knows why this action was declined:', {
                name: rejectModalReq?.requestedBy?.name || 'the staff member',
              })}
            </Text>

            <RNTextInput
              style={styles.reasonInput}
              placeholder={t('approvals.reasonPlaceholder', 'e.g. Discount too high, manager approval required...')}
              placeholderTextColor="#94a3b8"
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline
              numberOfLines={3}
            />

            <View style={styles.modalBtnRow}>
              <Button
                mode="outlined"
                textColor="#64748b"
                onPress={() => {
                  setRejectModalReq(null);
                  setRejectReason('');
                }}
                style={{ flex: 1, marginRight: 8 }}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                mode="contained"
                buttonColor="#dc2626"
                loading={Boolean(actionInProgress)}
                disabled={Boolean(actionInProgress)}
                onPress={handleConfirmReject}
                style={{ flex: 1, marginLeft: 8 }}
              >
                {t('approvals.confirmReject', 'Confirm Reject')}
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  appbar: {
    backgroundColor: '#4f46e5',
  },
  appbarTitle: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 18,
  },
  appbarSub: {
    color: '#c7d2fe',
    fontSize: 12,
  },
  headerBadge: {
    backgroundColor: '#ef4444',
    color: '#ffffff',
    fontWeight: 'bold',
    marginRight: 16,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabBtnActive: {
    borderBottomColor: '#4f46e5',
  },
  tabContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
  },
  tabTextActive: {
    color: '#4f46e5',
  },
  tabCounterBadge: {
    backgroundColor: '#ef4444',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 6,
  },
  tabCounterText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  requestCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    marginBottom: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  actionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#e0e7ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: {
    color: '#4338ca',
    fontWeight: 'bold',
    fontSize: 16,
  },
  staffName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  staffRole: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 1,
  },
  pendingBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  pendingBadgeText: {
    color: '#b45309',
    fontSize: 11,
    fontWeight: 'bold',
  },
  actionLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    padding: 10,
    borderRadius: 8,
    marginVertical: 6,
  },
  actionLabelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    flex: 1,
  },
  reasonContainer: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fef3c7',
    padding: 10,
    borderRadius: 8,
    marginVertical: 6,
  },
  reasonLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#b45309',
    marginBottom: 2,
  },
  reasonText: {
    fontSize: 13,
    color: '#92400e',
    fontStyle: 'italic',
  },
  targetRefText: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 4,
  },
  actionBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  approvedBadge: {
    backgroundColor: '#dcfce7',
  },
  rejectedBadge: {
    backgroundColor: '#fee2e2',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  approvedBadgeText: {
    color: '#15803d',
  },
  rejectedBadgeText: {
    color: '#b91c1c',
  },
  resolutionMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 64,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1e293b',
    marginTop: 12,
  },
  emptySub: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    elevation: 6,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  modalSub: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 14,
    lineHeight: 18,
  },
  reasonInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#0f172a',
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
