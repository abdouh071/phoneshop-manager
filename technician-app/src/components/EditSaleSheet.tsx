/**
 * Correcting a settled invoice, on the phone, in place.
 * ====================================================
 * This sheet replaces the button that used to dump an old sale into the live cart —
 * which left the invoice untouched and sold the goods a second time. Nothing here
 * goes near the cart. The lines you see are the lines on the document, and saving
 * rewrites that one document plus the stock its changes imply.
 *
 * The rules are the counter terminal's `EditTransactionModal`: a quantity stepper
 * that never climbs above what was sold, a unit price field, one "return stock?"
 * choice per SKU, and a summary that names the difference in the same two
 * directions the desktop does.
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
import type { CartItem, SaleTransaction } from '../types';

type LineDraft = { quantity: number; price: string };

/** A runaway tap should not be able to write a hundred-unit invoice. */
const MAX_UNITS = 999;

const wholeUnits = (value: number): number => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * The price the line is worth right now. The desktop prices from the product
 * snapshot and that is what it rewrites, so the snapshot leads; `unitPrice` is the
 * fallback for a row too old to carry one. Reading `unitPrice` first would re-price
 * an invoice the counter has already corrected back to the pre-correction number.
 */
const soldUnitPrice = (item: CartItem): number => {
  const snapshot = Number(item.product?.price);
  if (Number.isFinite(snapshot) && snapshot >= 0) return snapshot;
  const stored = Number(item.unitPrice);
  return Number.isFinite(stored) && stored >= 0 ? stored : 0;
};

interface EditSaleSheetProps {
  visible: boolean;
  transaction: SaleTransaction | null;
  /**
   * What the shelf held for each product when the sheet opened, `null` per product
   * when it has no inventory row and `undefined` altogether while the read is still
   * in flight or failed. It decides how far a line may grow; the save re-checks it,
   * so a count that moved in the meantime cannot be sold twice.
   */
  stockLevels?: Map<string, number | null> | null;
  onClose: () => void;
  onSaved?: (outcome: SaleEditOutcome) => void;
}

const amount = (n: number): string => n.toLocaleString();

export const EditSaleSheet = ({
  visible,
  transaction,
  stockLevels,
  onClose,
  onSaved,
}: EditSaleSheetProps) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);

  /**
   * Keyed by product id, as the desktop keys `editedQuantities` / `editedPrices` /
   * `returnToStock` — so one SKU on two rows of the same invoice is one control.
   *
   * Seeded once, on mount, from the document as it stood when the sheet opened. The
   * caller keys this component on the invoice, so a new sale means a new mount, and
   * the live history listener handing over a fresh object every few seconds cannot
   * wipe what the cashier is typing.
   */
  const [draft, setDraft] = useState<Record<string, LineDraft>>(() => {
    const out: Record<string, LineDraft> = {};
    (transaction?.items ?? []).forEach(item => {
      const id = item.product?.id;
      if (!id) return;
      out[id] = { quantity: wholeUnits(item.quantity), price: String(soldUnitPrice(item)) };
    });
    return out;
  });
  const [restock, setRestock] = useState<SaleRestockChoices>(() => {
    const out: SaleRestockChoices = {};
    (transaction?.items ?? []).forEach(item => {
      if (item.product?.id) out[item.product.id] = true;
    });
    return out;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isAsking, setIsAsking] = useState(false);

  const edits: SaleLineEdits = useMemo(() => {
    const out: SaleLineEdits = {};
    transaction?.items.forEach(item => {
      const id = item.product?.id;
      if (!id) return;
      const entered = draft[id];
      if (!entered) return;
      const parsed = Number(String(entered.price).replace(',', '.'));
      out[id] = {
        quantity: entered.quantity,
        // A half-typed number keeps the price the line already had. Reading it as
        // 0 DA would let someone refund a phone by typing into the wrong field.
        unitPrice: Number.isFinite(parsed) && parsed >= 0 ? parsed : soldUnitPrice(item),
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

  const setQuantity = (id: string, quantity: number, maxQty: number) => {
    if (!id) return;
    setDraft(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        quantity: Math.max(0, Math.min(Math.max(0, maxQty), Math.trunc(Number(quantity) || 0))),
      },
    }));
  };

  const setPrice = (id: string, price: string) => {
    if (!id) return;
    setDraft(prev => ({ ...prev, [id]: { ...prev[id], price } }));
  };

  const commit = async () => {
    if (!transaction || !plan || !plan.hasChanges || isSaving) return;
    setIsSaving(true);
    try {
      // The shelf may have emptied since the sheet opened — another till sold the
      // last unit, or this phone is looking at a cached count. Asking it for units
      // it does not hold would write a sale the shop cannot cover, so the live
      // count is read once more and an oversold line stops the save.
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
      const difference =
        plan.refundDue > 0
          ? t('salesHistory.editSavedRefund', ' Refund due: {{amount}} DA', { amount: amount(plan.refundDue) })
          : plan.additionalDue > 0
            ? t('salesHistory.editSavedExtra', ' Extra collected: {{amount}} DA', { amount: amount(plan.additionalDue) })
            : '';
      Alert.alert(
        t('salesHistory.editSavedTitle', 'Receipt Updated'),
        (outcome.stockFailures.length > 0
          ? t('salesHistory.editSavedQueued', 'Transaction {{id}} has been modified. {{count}} stock change could not be written and is queued for the next sync.', {
              id: transaction.id,
              count: outcome.stockFailures.length,
            })
          : t('salesHistory.editSavedBody', 'Transaction {{id}} has been modified.', { id: transaction.id })) +
          difference
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
      ? t('salesHistory.editRefundBtn', 'Refund Difference ({{amount}} DA)', { amount: amount(plan.refundDue) })
      : plan.additionalDue > 0
        ? t('salesHistory.editCollectBtn', 'Collect Difference ({{amount}} DA)', { amount: amount(plan.additionalDue) })
        : t('salesHistory.editSaveBtn', 'Save Changes');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.header}>
            <MaterialCommunityIcons name="file-document-edit-outline" size={24} color={colors.brand} />
            <View style={styles.headerText}>
              <Text style={styles.title}>{t('salesHistory.editTitle', 'Edit Receipt & Prices')}</Text>
              <Text style={styles.subtitle}>
                {t('salesHistory.editSubtitle', 'Order #{{invoice}} • {{date}}', {
                  invoice: invoiceLabel,
                  date: new Date(transaction.date).toLocaleDateString(),
                })}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel={t('common.close', 'Close')}>
              <MaterialCommunityIcons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.bodyContent}>
            <Text style={styles.hint}>
              {t('salesHistory.editHint', 'Adjust item unit prices, quantities, or remove returned items. Inventory and transaction totals will recalculate automatically.')}
            </Text>

            {transaction.items.map((item, index) => {
              const pid = item.product?.id || '';
              const originalQty = wholeUnits(item.quantity);
              const originalUnit = soldUnitPrice(item);
              const quantity = draft[pid]?.quantity ?? originalQty;
              const unitPrice = edits[pid]?.unitPrice ?? originalUnit;
              const returnedQty = originalQty - quantity;
              const willRestock = !pid || restock[pid] !== false;
              const name = item.product?.name || item.product?.model || t('salesHistory.unknownItem', 'Item');
              // Sold units are already committed; anything new has to come off the
              // counter. No count yet (read in flight or failed) means no ceiling,
              // and the save re-checks the shelf before it writes. `null` is a real
              // answer — the product has no inventory row, so nothing can come off.
              const onShelf: number | null | undefined =
                pid && stockLevels?.has(pid) ? (stockLevels.get(pid) ?? null) : undefined;
              const maxQty =
                onShelf === undefined
                  ? MAX_UNITS
                  : Math.min(MAX_UNITS, originalQty + Math.max(0, onShelf ?? 0));
              const atCeiling = quantity >= maxQty;

              return (
                <View key={pid || `row-${index}`} style={styles.line}>
                  <View style={styles.lineHead}>
                    <View style={styles.lineHeadText}>
                      <Text style={styles.lineName} numberOfLines={1}>
                        {name}
                      </Text>
                      <Text style={styles.lineSub} numberOfLines={1}>
                        {onShelf === undefined
                          ? t('salesHistory.editLineSold', 'Sold {{qty}} at {{price}} DA', {
                              qty: originalQty,
                              price: amount(originalUnit),
                            })
                          : onShelf === null
                            ? t('salesHistory.editLineNoRow', 'Sold {{qty}} · {{name}} has no stock row', {
                                qty: originalQty,
                                name,
                              })
                            : t('salesHistory.editLineShelf', 'Sold {{qty}} · {{count}} on the shelf', {
                                qty: originalQty,
                                count: onShelf,
                              })}
                      </Text>
                    </View>
                    <Text style={styles.lineTotal}>{amount(unitPrice * quantity)} DA</Text>
                  </View>

                  {!pid && (
                    <Text style={styles.lockedNote}>
                      {t('salesHistory.editLockedLine', 'This row has no inventory link, so it stays as it was sold.')}
                    </Text>
                  )}

                  {pid ? (
                    <View style={styles.controls}>
                      <TextInput
                        label={t('salesHistory.unitPriceLabel', 'Unit price (DA)')}
                        value={draft[pid]?.price ?? String(originalUnit)}
                        onChangeText={next => setPrice(pid, next)}
                        mode="outlined"
                        dense
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        style={styles.priceInput}
                        accessibilityLabel={t('salesHistory.unitPriceLabel', 'Unit price (DA)')}
                      />

                      <View style={styles.stepper}>
                        <TouchableOpacity
                          style={[styles.stepBtn, quantity <= 0 && styles.stepBtnOff]}
                          onPress={() => setQuantity(pid, quantity - 1, maxQty)}
                          disabled={quantity <= 0}
                          accessibilityLabel={t('salesHistory.decrease', 'Decrease quantity')}
                        >
                          <MaterialCommunityIcons name="minus" size={18} color={quantity <= 0 ? colors.textFaint : colors.brand} />
                        </TouchableOpacity>
                        <Text style={styles.stepValue}>
                          {quantity} / {originalQty}
                        </Text>
                        <TouchableOpacity
                          style={[styles.stepBtn, atCeiling && styles.stepBtnOff]}
                          onPress={() => setQuantity(pid, quantity + 1, maxQty)}
                          disabled={atCeiling}
                          accessibilityLabel={t('salesHistory.increase', 'Increase quantity')}
                        >
                          <MaterialCommunityIcons name="plus" size={18} color={atCeiling ? colors.textFaint : colors.brand} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : null}

                  {pid && atCeiling && onShelf !== undefined && returnedQty >= 0 ? (
                    <Text style={styles.ceilingNote}>
                      {onShelf === null
                        ? t('salesHistory.editCeilingNoRow', 'There is no stock row for this item, so only what was already sold stays on the invoice.')
                        : onShelf <= 0
                          ? t('salesHistory.editCeilingEmpty', 'The shelf is empty — this line cannot grow.')
                          : t('salesHistory.editCeilingShelf', 'The shelf holds {{count}}, so this line stops at {{max}}.', {
                              count: onShelf,
                              max: maxQty,
                            })}
                    </Text>
                  ) : null}

                  {pid && returnedQty > 0 ? (
                    <TouchableOpacity
                      style={styles.restockRow}
                      onPress={() => setRestock(prev => ({ ...prev, [pid]: !willRestock }))}
                    >
                      <MaterialCommunityIcons
                        name={willRestock ? 'check-circle' : 'circle-outline'}
                        size={20}
                        color={willRestock ? colors.success : colors.textMuted}
                      />
                      <Text style={[styles.restockText, willRestock ? styles.restockYes : styles.restockNo]}>
                        {willRestock
                          ? t('salesHistory.restockYes', '+{{count}} Stock', { count: returnedQty })
                          : t('salesHistory.restockNo', 'Do not restock')}
                      </Text>
                    </TouchableOpacity>
                  ) : null}

                  {pid && returnedQty < 0 ? (
                    <Text style={styles.addedNote}>
                      {t('salesHistory.unitsAdded', '+{{count}} unit(s) come off the shelf when you save', {
                        count: -returnedQty,
                      })}
                    </Text>
                  ) : null}
                </View>
              );
            })}

            <View style={styles.summary}>
              <SummaryRow
                label={t('salesHistory.editOriginalTotal', 'Original Total')}
                value={`${amount(transaction.total)} DA`}
              />
              <SummaryRow
                label={t('salesHistory.editNewSubtotal', 'New Subtotal')}
                value={`${amount(plan.subtotal)} DA`}
              />
              {plan.discountAmount > 0 && (
                <SummaryRow
                  label={t('salesHistory.editDiscount', 'Discount Applied')}
                  value={`-${amount(plan.discountAmount)} DA`}
                  tone="danger"
                />
              )}
              <SummaryRow
                label={t('salesHistory.editNewTotal', 'New Total')}
                value={`${amount(plan.total)} DA`}
                strong
              />
              {plan.refundDue > 0 && (
                <SummaryRow
                  label={t('salesHistory.editRefundDue', 'Refund Due to Client')}
                  value={`${amount(plan.refundDue)} DA`}
                  tone="danger"
                  strong
                />
              )}
              {plan.additionalDue > 0 && (
                <SummaryRow
                  label={t('salesHistory.editAdditionalDue', 'Additional Payment Due')}
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
                  {t('salesHistory.editWarning', 'Saving will adjust the transaction prices, totals, and modify inventory stock as selected above.')}
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
  lineHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  lineHeadText: { flex: 1, gap: 1 },
  lineName: { fontSize: fontSize.bodyStrong, fontWeight: '700', color: colors.textPrimary },
  lineSub: { fontSize: fontSize.caption, color: colors.textMuted },
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
  stepValue: { minWidth: 42, textAlign: 'center', fontSize: fontSize.bodyStrong, fontWeight: '700', color: colors.textPrimary },
  priceInput: { flex: 1, minHeight: 44 },
  restockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  restockText: { flex: 1, fontSize: fontSize.label },
  restockYes: { color: colors.success, fontWeight: '700' },
  restockNo: { color: colors.dangerText, fontWeight: '600' },
  addedNote: { fontSize: fontSize.caption, color: colors.dangerText, fontWeight: '600' },
  ceilingNote: { fontSize: fontSize.caption, color: colors.textMuted, fontStyle: 'italic' },
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
