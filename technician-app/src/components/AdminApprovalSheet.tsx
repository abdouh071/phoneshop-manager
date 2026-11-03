/**
 * Asking an admin for permission, from a phone.
 *
 * The counter terminal has a PIN tab for this; a technician phone deliberately
 * does not. An approval PIN is PBKDF2 at 210 000 rounds and verifying one on this
 * device would mean carrying the hash of the manager's PIN onto the phone of the
 * person it is meant to restrain. So the phone uses the rail that already exists:
 * a request goes into `approvalRequests`, every admin is pushed, and whoever
 * answers unlocks this screen through the live listener.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { Modal, StyleSheet, TouchableOpacity, Vibration, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useApprovalStore } from '../store/approvalStore';
import { colors, fontSize, radius, spacing } from '../theme/tokens';
import type { ApprovalRequest } from '../types';

export interface ApprovalPayload {
  actionType: string;
  actionLabel: string;
  actionData?: Record<string, unknown>;
  targetId?: string;
  reason?: string;
}

interface AdminApprovalSheetProps {
  visible: boolean;
  /** What the technician is about to do, in their language, one line per fact. */
  lines: string[];
  payload: ApprovalPayload;
  onApproved: (approved: ApprovalRequest) => void;
  onDismiss: () => void;
}

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err ?? 'Unknown error');

export const AdminApprovalSheet = ({
  visible,
  lines,
  payload,
  onApproved,
  onDismiss,
}: AdminApprovalSheetProps) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const submitRequest = useApprovalStore((s) => s.submitRequest);
  const cancelRequest = useApprovalStore((s) => s.cancelRequest);
  const subscribeToSingleRequest = useApprovalStore((s) => s.subscribeToSingleRequest);

  const [requestId, setRequestId] = useState<string | null>(null);
  const [status, setStatus] = useState<'submitting' | 'waiting' | 'approved' | 'rejected' | 'failed'>('submitting');
  const [detail, setDetail] = useState<string | null>(null);
  const [resolvedBy, setResolvedBy] = useState<string | null>(null);

  const sentFor = useRef<string | null>(null);
  const pending = useRef<string | null>(null);
  const approvedRef = useRef(onApproved);
  useEffect(() => {
    approvedRef.current = onApproved;
  }, [onApproved]);
  const payloadKey = useMemo(() => JSON.stringify(payload), [payload]);
  const [attempt, setAttempt] = useState(0);

  // One request per thing being approved, even if the parent re-renders the sheet
  // while the technician waits.
  useEffect(() => {
    if (!visible) return;
    if (sentFor.current === payloadKey) return;
    sentFor.current = payloadKey;
    setStatus('submitting');
    setDetail(null);
    submitRequest(payload)
      .then((id) => {
        pending.current = id;
        setRequestId(id);
        setStatus('waiting');
      })
      .catch((err) => {
        sentFor.current = null;
        setDetail(message(err));
        setStatus('failed');
      });
  }, [visible, payloadKey, payload, submitRequest, attempt]);

  useEffect(() => {
    if (!requestId) return undefined;
    return subscribeToSingleRequest(requestId, (req) => {
      if (req.status === 'approved') {
        pending.current = null;
        Vibration.vibrate([0, 140, 60, 140]);
        setResolvedBy(req.resolvedBy?.name ?? null);
        setStatus('approved');
        approvedRef.current(req);
        return;
      }
      if (req.status === 'rejected') {
        pending.current = null;
        setResolvedBy(req.resolvedBy?.name ?? null);
        setDetail(req.rejectionReason ?? null);
        setStatus('rejected');
      }
      if (req.status === 'cancelled') {
        pending.current = null;
        setStatus('rejected');
      }
    });
  }, [requestId, subscribeToSingleRequest]);

  // A request left pending because the technician closed the sheet or navigated away
  // would sit on every admin's list forever, so it dies with this screen.
  useEffect(() => {
    if (visible) return;
    const orphan = pending.current;
    if (!orphan) return;
    pending.current = null;
    void cancelRequest(orphan).catch(() => undefined);
  }, [visible, cancelRequest]);

  useEffect(
    () => () => {
      const orphan = pending.current;
      if (orphan) void cancelRequest(orphan).catch(() => undefined);
    },
    [cancelRequest]
  );

  const retry = useCallback(() => {
    sentFor.current = null;
    setRequestId(null);
    setStatus('submitting');
    setAttempt((n) => n + 1);
  }, []);

  const waiting = status === 'submitting' || status === 'waiting';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={onDismiss} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.header}>
            <MaterialCommunityIcons
              name={
                status === 'approved'
                  ? 'shield-check'
                  : status === 'rejected'
                    ? 'shield-off-outline'
                    : 'account-key-outline'
              }
              size={26}
              color={status === 'approved' ? colors.success : status === 'rejected' ? colors.danger : colors.brand}
            />
            <Text style={styles.title}>
              {status === 'approved'
                ? t('approvals.approved', 'Approved')
                : status === 'rejected'
                  ? t('approvals.rejected', 'Rejected')
                  : t('sensitive.waitingTitle', 'Waiting for an admin')}
            </Text>
          </View>

          {resolvedBy && (
            <Text style={styles.resolvedBy}>
              {status === 'approved'
                ? t('sensitive.approvedBy', 'Approved by {{name}}', { name: resolvedBy })
                : t('sensitive.rejectedBy', 'Rejected by {{name}}', { name: resolvedBy })}
            </Text>
          )}

          <View style={styles.lines}>
            {lines.map((line) => (
              <Text key={line} style={styles.line}>
                {line}
              </Text>
            ))}
          </View>

          {waiting && (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={colors.brand} />
              <Text style={styles.statusCopy}>
                {status === 'submitting'
                  ? t('sensitive.sending', 'Sending the request…')
                  : t('sensitive.waitingBody', 'Sent to every admin. This screen unlocks itself the moment one answers.')}
              </Text>
            </View>
          )}

          {status === 'failed' && (
            <Text style={styles.error}>{detail ?? t('sensitive.failed', 'Could not send the request.')}</Text>
          )}
          {status === 'rejected' && detail && <Text style={styles.error}>{detail}</Text>}

          <View style={styles.actions}>
            {status === 'failed' ? (
              <Button mode="outlined" onPress={retry} style={styles.action}>
                {t('sensitive.tryAgain', 'Try again')}
              </Button>
            ) : (
              <Button mode={status === 'approved' ? 'contained' : 'outlined'} onPress={onDismiss} style={styles.action}>
                {status === 'approved'
                  ? t('sensitive.continue', 'Continue')
                  : t('sensitive.cancelRequest', 'Cancel request')}
              </Button>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
  backdropTouch: { flex: 1 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: fontSize.subtitle, fontWeight: '700', color: colors.textPrimary },
  resolvedBy: { marginTop: spacing.xs, fontSize: fontSize.body, color: colors.textSecondary },
  lines: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  line: { fontSize: fontSize.body, color: colors.textPrimary },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  statusCopy: { flex: 1, fontSize: fontSize.body, color: colors.textSecondary },
  error: { marginTop: spacing.md, fontSize: fontSize.body, color: colors.danger },
  actions: { marginTop: spacing.lg },
  action: { marginBottom: spacing.xs },
});
