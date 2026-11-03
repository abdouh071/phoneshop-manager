/**
 * Correcting a settled invoice, on the phone, in place.
 * ====================================================
 * This sheet replaces the button that used to dump an old sale into the live cart —
 * which left the invoice untouched and sold the goods a second time. Nothing here
 * goes near the cart. The lines you see are the lines on the document, and saving
 * rewrites that one document plus the stock its changes imply.
 *
 * Who may save is the till's own rule: an admin at the counter types a PIN and acts;
 * a phone cannot hold a PIN (see `AdminApprovalSheet`), so a technician's save is
 * sent to the admins as a request carrying exactly the diff they are approving, and
 * the write happens the moment one of them answers.
 */
import React, { useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, TouchableOpacity, Vibration, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import { applySaleEdit, findOversoldLines, type SaleEditOutcome } from '../services/saleEditService';
import { diffSaleEdit, planSaleEdit, type SaleLineEdits, type SaleRestockChoices } from '../utils/saleEdit';
import { AdminApprovalSheet, type ApprovalPayload } from './AdminApprovalSheet';
import { colors, fontSize, radius, spacing } from '../theme/tokens';
import type { SaleTransaction } from '../types';

type LineDraft = { quantity: number; price: string };

/**
 * Seed from the document as it stands when the sheet opens. The caller keys this
 * component on the invoice, so a new sale means a new mount — and the live
 * history listener handing over a fresh object every few seconds cannot wipe
 * what the cashier is typing.
 */
const seedDrafts = (items: SaleTransaction['items']): Record<string, LineDraft> => {
  const out: Record<string, LineDraft> = {};
  items.forEach((item, index) => {
    out[String(index)] = {
      quantity: Math.max(0, Math.trunc(Number(item.quantity) || 0)),
      price: String(item.unitPrice ?? item.product?.price ?? 0),
    };
  });
  return out;
};

interface EditSaleSheetProps {
  visible: boolean;
  transaction: SaleTransaction | null;
  onClose: () => void;
  onSaved?: (outcome: SaleEditOutcome) => void;
}

const amount = (n: number): string => n.toLocaleString();

export const EditSaleSheet = ({ visible, transaction, onClose, onSaved }: EditSaleSheetProps) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);

  const [draft, setDraft] = useState<Record<string, LineDraft>>(() => seedDrafts(transaction?.items ?? []));
  const [restock, setRestock] = useState<SaleRestockChoices>(() =>
    (transaction?.items ?? []).reduce<SaleRestockChoices>((acc, _item, index) => {
      acc[String(index)] = true;
      return acc;
    }, {})
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isAsking, setIsAsking] = useState(false);

  const edits: SaleLineEdits = useMemo(() => {
    const out: SaleLineEdits = {};
    transaction?.items.forEach((item, index) => {
      const key = String(index);
      const entered = draft[key];
      if (!entered) return;
      const parsed = Number(String(entered.price).replace(',', '.'));
      out[key] = {
        quantity: entered.quantity,
        // A half-typed number keeps the price the line already had. Reading it as
        // 0 DA would let someone refund a phone by typing into the wrong field.
        unitPrice:
          Number.isFinite(parsed) && parsed >= 0
            ? parsed
            : (item.unitPrice ?? item.product?.price ?? 0),
      };
    });
    return out;
  }, [draft, transaction]);

  const plan = useMemo(
    () => (transaction ? planSaleEdit(transaction, edits, restock) : null),
    [transaction, edits, restock]
  );

  const invoiceLabel = transaction?.invoiceNumber || transaction?.id.slice(-6) || '';

  /** The badge wording the history list uses — a snake_case Firestore token
      would land untranslated in the French and Arabic sentences. */
  const statusLabel = (status: SaleTransaction['status']): string =>
    status === 'refunded'
      ? t('salesHistory.statusRefunded', 'REFUNDED')
      : status === 'partially_refunded'
        ? t('salesHistory.statusEdited', 'CORRECTED')
        : status === 'voided'
          ? t('salesHistory.statusVoided', 'VOIDED')
          : t('salesHistory.statusCompleted', 'COMPLETED');

  const setQuantity = (key: string, quantity: number) =>
    setDraft(prev => ({ ...prev, [key]: { ...prev[key], quantity: Math.max(0, quantity) } }));

  const setPrice = (key: string, price: string) =>
    setDraft(prev => ({ ...prev, [key]: { ...prev[key], price } }));

  const commit = async () => {
    if (!transaction || !plan || !plan.hasChanges || isSaving) return;
    setIsSaving(true);
    try {
      const oversold = await findOversoldLines(plan);
      if (oversold.length > 0) {
        Alert.alert(
          t('salesHistory.editBlockedTitle', 'Those units are not in the shop'),
          oversold
            .map(row =>
              row.available === null
                ? t('salesHistory.editBlockedMissing', '{{name}} has no inventory row left.', { name: row.name })
                : t('salesHistory.editBlockedShort', '{{name}}: {{available}} in stock, this edit sells {{wanted}}.', {
                    name: row.name,
                    available: row.available,
                    wanted: row.wanted,
                  })
            )
            .join('\n')
        );
        return;
      }

      const outcome = await applySaleEdit(transaction, plan);
      Vibration.vibrate([0, 50, 50, 80]);
      Alert.alert(
        t('salesHistory.editSavedTitle', 'Invoice Updated'),
        outcome.stockFailures.length > 0
          ? t('salesHistory.editSavedQueued', 'Invoice #{{invoice}} now reads {{total}} DA. {{count}} stock change could not be written and is queued for the next sync.', {
              invoice: invoiceLabel,
              total: amount(outcome.total),
              count: outcome.stockFailures.length,
            })
          : t('salesHistory.editSavedBody', 'Invoice #{{invoice}} now reads {{total}} DA, and the stock has been corrected.', {
              invoice: invoiceLabel,
              total: amount(outcome.total),
            })
      );
      onSaved?.(outcome);
      onClose();
    } catch (err) {
      Alert.alert(
        t('salesHistory.editFailedTitle', 'Edit Failed'),
        err instanceof Error ? err.message : String(err ?? t('common.unknownError', 'Unknown error'))
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = () => {
    if (!plan?.hasChanges || isSaving) return;
    if (user?.role === 'admin') {
      void commit();
      return;
    }
    setIsAsking(true);
  };

  const changes = useMemo(
    () => (transaction ? diffSaleEdit(transaction, edits) : []),
    [transaction, edits]
  );

  const approvalPayload: ApprovalPayload = {
    actionType: 'pos_edit_receipt',
    actionLabel: t(
      'salesHistory.editApprovalLabel',
      'Edit receipt #{{invoice}} from {{from}} DA to {{to}} DA',
      { invoice: invoiceLabel, from: amount(transaction?.total || 0), to: amount(plan?.total || 0) }
    ),
    targetId: transaction?.id,
    actionData: {
      itemType: 'sale_edit',
      saleId: transaction?.id,
      invoiceNumber: invoiceLabel,
      originalTotal: transaction?.total || 0,
      newTotal: plan?.total || 0,
      newSubtotal: plan?.subtotal || 0,
      resultingStatus: plan?.status,
      customerName: transaction?.customerName || t('pos.walkInCustomer', 'Walk-in Customer'),
      changes,
      unitsBackOnShelf: plan?.restock.reduce((sum, l) => sum + l.quantity, 0) || 0,
      unitsTakenFromShelf: plan?.deduct.reduce((sum, l) => sum + l.quantity, 0) || 0,
    },
  };

  if (!transaction || !plan) return null;

  const saveLabel =
    plan.refundDue > 0
      ? t('salesHistory.editRefundBtn', 'Refund the difference ({{amount}} DA)', { amount: amount(plan.refundDue) })
      : plan.additionalDue > 0
        ? t('salesHistory.editCollectBtn', 'Collect the difference ({{amount}} DA)', { amount: amount(plan.additionalDue) })
        : t('salesHistory.editSaveBtn', 'Save Changes');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.header}>
            <MaterialCommunityIcons name="file-document-edit-outline" size={24} color={colors.brand} />
            <View style={styles.headerText}>
              <Text style={styles.title}>{t('salesHistory.editTitle', 'Edit Invoice')}</Text>
              <Text style={styles.subtitle}>
                {t('salesHistory.editSubtitle', '#{{invoice}} · {{total}} DA', {
                  invoice: invoiceLabel,
                  total: amount(transaction.total),
                })}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel={t('common.close', 'Close')}>
              <MaterialCommunityIcons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.bodyContent}>
            <Text style={styles.hint}>
              {t('salesHistory.editHint', 'Change a price, reduce a quantity, or add units back onto the sale. The invoice itself is rewritten and the stock follows.')}
            </Text>

            {transaction.items.map((item, index) => {
              const key = String(index);
              const entered = draft[key];
              const originalQty = Math.max(0, Math.trunc(Number(item.quantity) || 0));
              const originalUnit = Number(item.unitPrice ?? item.product?.price ?? 0);
              const quantity = entered?.quantity ?? originalQty;
              const unitPrice = edits[key]?.unitPrice ?? originalUnit;
              const returnedQty = originalQty - quantity;
              const editable = Boolean(item.product?.id);
              const willRestock = restock[key] !== false;

              return (
                <View key={`${item.product?.id || 'row'}-${key}`} style={styles.line}>
                  <View style={styles.lineHead}>
                    <Text style={styles.lineName} numberOfLines={1}>
                      {item.product?.name || item.product?.model || t('salesHistory.unknownItem', 'Item')}
                    </Text>
                    <Text style={styles.lineTotal}>{amount(unitPrice * quantity)} DA</Text>
                  </View>

                  {!editable && (
                    <Text style={styles.lockedNote}>
                      {t('salesHistory.editLockedLine', 'This row has no inventory link, so it stays as it was sold.')}
                    </Text>
                  )}

                  {editable && (
                    <View style={styles.controls}>
                      <View style={styles.stepper}>
                        <TouchableOpacity
                          style={[styles.stepBtn, quantity <= 0 && styles.stepBtnOff]}
                          onPress={() => setQuantity(key, quantity - 1)}
                          disabled={quantity <= 0}
                          accessibilityLabel={t('salesHistory.decrease', 'Decrease quantity')}
                        >
                          <MaterialCommunityIcons name="minus" size={18} color={quantity <= 0 ? colors.textFaint : colors.brand} />
                        </TouchableOpacity>
                        <Text style={styles.stepValue}>{quantity}</Text>
                        <TouchableOpacity
                          style={styles.stepBtn}
                          onPress={() => setQuantity(key, quantity + 1)}
                          accessibilityLabel={t('salesHistory.increase', 'Increase quantity')}
                        >
                          <MaterialCommunityIcons name="plus" size={18} color={colors.brand} />
                        </TouchableOpacity>
                      </View>

                      <TextInput
                        label={t('salesHistory.unitPriceLabel', 'Unit price (DA)')}
                        value={entered?.price ?? String(originalUnit)}
                        onChangeText={next => setPrice(key, next)}
                        mode="outlined"
                        dense
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        style={styles.priceInput}
                        accessibilityLabel={t('salesHistory.unitPriceLabel', 'Unit price (DA)')}
                      />
                    </View>
                  )}

                  {editable && returnedQty > 0 && (
                    <TouchableOpacity
                      style={styles.restockRow}
                      onPress={() => setRestock(prev => ({ ...prev, [key]: !willRestock }))}
                    >
                      <MaterialCommunityIcons
                        name={willRestock ? 'check-circle' : 'circle-outline'}
                        size={20}
                        color={willRestock ? colors.success : colors.textMuted}
                      />
                      <Text style={styles.restockText}>
                        {willRestock
                          ? t('salesHistory.restockYes', '{{count}} unit(s) go back on the shelf', { count: returnedQty })
                          : t('salesHistory.restockNo', '{{count}} unit(s) stay sold — not returning them', { count: returnedQty })}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {editable && returnedQty < 0 && (
                    <Text style={styles.addedNote}>
                      {t('salesHistory.unitsAdded', '{{count}} more unit(s) taken from stock', { count: -returnedQty })}
                    </Text>
                  )}

                  {editable && quantity === 0 && (
                    <Text style={styles.removedNote}>
                      {t('salesHistory.lineRemoved', 'The line comes off the invoice when you save.')}
                    </Text>
                  )}
                </View>
              );
            })}

            <View style={styles.summary}>
              <SummaryRow
                label={t('salesHistory.editOriginalTotal', 'Original total')}
                value={`${amount(transaction.total)} DA`}
              />
              <SummaryRow
                label={t('salesHistory.editNewSubtotal', 'New subtotal')}
                value={`${amount(plan.subtotal)} DA`}
              />
              {plan.discountAmount > 0 && (
                <SummaryRow
                  label={t('salesHistory.editDiscount', 'Discount')}
                  value={`-${amount(plan.discountAmount)} DA`}
                  tone="danger"
                />
              )}
              <SummaryRow
                label={t('salesHistory.editNewTotal', 'New total')}
                value={`${amount(plan.total)} DA`}
                strong
              />
              {plan.refundDue > 0 && (
                <SummaryRow
                  label={t('salesHistory.editRefundDue', 'Refund due to the customer')}
                  value={`${amount(plan.refundDue)} DA`}
                  tone="danger"
                  strong
                />
              )}
              {plan.additionalDue > 0 && (
                <SummaryRow
                  label={t('salesHistory.editAdditionalDue', 'Still to collect')}
                  value={`+${amount(plan.additionalDue)} DA`}
                  tone="success"
                  strong
                />
              )}
              {plan.status !== 'completed' && plan.status !== transaction.status && (
                <Text style={styles.statusNote}>
                  {t('salesHistory.editStatusNote', 'The sale will be marked {{status}}.', {
                    status: statusLabel(plan.status),
                  })}
                </Text>
              )}
            </View>

            {plan.hasChanges && (
              <View style={styles.warning}>
                <MaterialCommunityIcons name="alert-outline" size={16} color={colors.warningInk} />
                <Text style={styles.warningText}>
                  {t('salesHistory.editWarning', 'Saving corrects the totals, the payment lines and the stock counts together.')}
                </Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Button mode="outlined" onPress={onClose} disabled={isSaving} style={styles.footerBtn}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              mode="contained"
              onPress={handleSave}
              disabled={!plan.hasChanges || isSaving}
              loading={isSaving}
              style={styles.footerBtn}
            >
              {user?.role === 'admin'
                ? saveLabel
                : t('salesHistory.editAskAdmin', 'Ask an admin to approve')}
            </Button>
          </View>
        </View>
      </View>

      <AdminApprovalSheet
        visible={isAsking}
        payload={approvalPayload}
        lines={[
          t('salesHistory.editApprovalLineTotal', 'Invoice #{{invoice}}: {{from}} DA becomes {{to}} DA', {
            invoice: invoiceLabel,
            from: amount(transaction.total),
            to: amount(plan.total),
          }),
          ...changes.slice(0, 4).map(change =>
            change.kind === 'quantity'
              ? t('salesHistory.editApprovalLineQty', '{{name}}: {{from}} → {{to}} units', {
                  name: change.name,
                  from: change.from,
                  to: change.to,
                })
              : t('salesHistory.editApprovalLinePrice', '{{name}}: {{from}} DA → {{to}} DA', {
                  name: change.name,
                  from: amount(change.from),
                  to: amount(change.to),
                })
          ),
          t('salesHistory.editApprovalLineStock', 'Stock: {{back}} unit(s) back, {{out}} unit(s) out', {
            back: plan.restock.reduce((sum, l) => sum + l.quantity, 0),
            out: plan.deduct.reduce((sum, l) => sum + l.quantity, 0),
          }),
        ]}
        onApproved={() => void commit()}
        onDismiss={() => setIsAsking(false)}
      />
    </Modal>
  );
};

const SummaryRow = ({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'danger' | 'success';
}) => (
  <View style={styles.summaryRow}>
    <Text style={[styles.summaryLabel, strong && styles.summaryStrong]}>{label}</Text>
    <Text
      style={[
        styles.summaryValue,
        strong && styles.summaryStrong,
        tone === 'danger' && styles.summaryDanger,
        tone === 'success' && styles.summarySuccess,
      ]}
    >
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
  backdropTouch: { flex: 1 },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  headerText: { flex: 1 },
  title: { fontSize: fontSize.subtitle, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: fontSize.caption, color: colors.textSecondary, marginTop: spacing.xxs },
  closeBtn: { padding: spacing.xs },
  body: { maxHeight: 520 },
  bodyContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  hint: { fontSize: fontSize.body, color: colors.textSecondary },
  line: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  lineHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  lineName: { flex: 1, fontSize: fontSize.bodyStrong, fontWeight: '700', color: colors.textPrimary },
  lineTotal: { fontSize: fontSize.bodyStrong, fontWeight: '700', color: colors.textPrimary },
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  stepBtn: { padding: spacing.xs },
  stepBtnOff: { opacity: 0.4 },
  stepValue: { minWidth: 26, textAlign: 'center', fontSize: fontSize.bodyStrong, fontWeight: '700', color: colors.textPrimary },
  priceInput: { flex: 1, minHeight: 44 },
  restockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  restockText: { flex: 1, fontSize: fontSize.label, color: colors.textSecondary },
  addedNote: { fontSize: fontSize.caption, color: colors.dangerText },
  removedNote: { fontSize: fontSize.caption, color: colors.warningText },
  lockedNote: { fontSize: fontSize.caption, color: colors.textMuted },
  summary: { backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: fontSize.body, color: colors.textSecondary },
  summaryValue: { fontSize: fontSize.body, color: colors.textPrimary },
  summaryStrong: { fontWeight: '700', fontSize: fontSize.bodyStrong },
  summaryDanger: { color: colors.danger },
  summarySuccess: { color: colors.success },
  statusNote: { fontSize: fontSize.caption, color: colors.warningText, marginTop: spacing.xxs },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  warningText: { flex: 1, fontSize: fontSize.caption, color: colors.warningInk },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  footerBtn: { flex: 1 },
});
