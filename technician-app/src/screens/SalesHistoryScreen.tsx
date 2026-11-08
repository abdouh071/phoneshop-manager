import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  Alert,
  Linking,
  ScrollView,
  Vibration,
} from 'react-native';
import {
  Appbar,
  Card,
  Text,
  Searchbar,
  Button,
  TextInput,
  ActivityIndicator,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  doc,
  updateDoc,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuthStore } from '../store/authStore';
import { useApprovalStore } from '../store/approvalStore';
import { readStockLevels } from '../services/stockService';
import { voidSale } from '../services/saleVoidService';
import { EditSaleSheet } from '../components/EditSaleSheet';
import { RoleBottomNav } from '../components/RoleBottomNav';
import { usePermissions } from '../hooks/usePermissions';
import { useTranslation } from 'react-i18next';
import { buildSearch, matchesSearch } from '../utils/search';
import { phoneDigits } from '../utils/phone';
import { discountsGivenOf } from '../utils/discountPolicy';
import { lineDisplayOf, netUnitsSold } from '../utils/saleEditLines';
import { docToSale } from '../utils/saleDocument';
import {
  colors,
  fontSize,
  radius,
  ramp,
  saleStatusColors,
  spacing,
  statusAppearance,
} from '../theme/tokens';
import type { SaleTransaction } from '../types';

/**
 * Driven from a table so the row can scroll horizontally instead of clipping the
 * fourth tab — and so Arabic, where every label is longer, fits the same screen.
 */
const FILTER_TABS = [
  { id: 'today', labelKey: 'salesHistory.tabToday', fallback: "Today's Sales", icon: 'calendar-today' },
  { id: 'past', labelKey: 'salesHistory.tabPast', fallback: 'Past Days (Locked)', icon: 'history' },
  { id: 'all', labelKey: 'salesHistory.tabAll', fallback: 'All', icon: 'format-list-bulleted' },
  { id: 'pending', labelKey: 'salesHistory.tabPending', fallback: 'Approvals', icon: 'clock-outline' },
] as const;

/**
 * One page of the till's history. This screen used to listen to every retail sale
 * ever written, so the read bill grew with the shop's age and the phone held years
 * of receipts to draw one day. Older invoices are still reachable — asking for
 * them is an explicit act, and the window keeps every row it holds live.
 */
const HISTORY_PAGE = 200;

export const SalesHistoryScreen = ({ navigation }: any) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const can = usePermissions();

  const [transactions, setTransactions] = useState<SaleTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [windowSize, setWindowSize] = useState(HISTORY_PAGE);
  const [hasMore, setHasMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'today' | 'past' | 'pending'>('today');

  // Editing a settled invoice, in place.
  const [editTx, setEditTx] = useState<SaleTransaction | null>(null);
  // What the counter held when the editor was opened: a line may only grow as far
  // as the shop actually has. `null` while the read is in flight or after it
  // failed, which leaves the ceiling off — the save still asks the shelf again.
  const [editStock, setEditStock] = useState<Map<string, number | null> | null>(null);

  // Admin Approval Request Modal State
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [targetTxForApproval, setTargetTxForApproval] = useState<SaleTransaction | null>(null);
  const [requestReason, setRequestReason] = useState('');
  const [requestDetails, setRequestDetails] = useState('');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);

  useEffect(() => {
    if (!can.pos) {
      navigation.replace('Workbench');
      return;
    }

    // Newest first, one page deep. Both keys ride the (saleType, date) composite
    // index already deployed for the desktop's history reads.
    const q = query(
      collection(db, 'transactions'),
      where('saleType', '==', 'retail'),
      orderBy('date', 'desc'),
      limit(windowSize)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setTransactions(snapshot.docs.map((d) => docToSale(d.id, d.data())));
        // A full page means the window stopped somewhere, not that the shop did.
        setHasMore(snapshot.docs.length === windowSize);
        setIsLoading(false);
      },
      (err) => {
        console.warn('[SalesHistoryScreen] Fetch error:', err);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [can.pos, windowSize]);

  // Check if a sale date is Today
  const isSaleToday = (dateStr: string): boolean => {
    if (!dateStr) return false;
    const saleDate = new Date(dateStr);
    const today = new Date();
    return (
      saleDate.getDate() === today.getDate() &&
      saleDate.getMonth() === today.getMonth() &&
      saleDate.getFullYear() === today.getFullYear()
    );
  };

  // One haystack per invoice, rebuilt only when the snapshot changes. The old
  // filter ran `i.product.name.toLowerCase()` on every keystroke and threw when
  // a line was stored without a name — buildSearch tolerates the missing field.
  const txIndex = useMemo(
    () =>
      transactions.map((tx) => ({
        tx,
        doc: buildSearch(
          tx.invoiceNumber,
          tx.id,
          tx.customerName,
          tx.customerPhone,
          (tx.items || []).map((i) => i?.product?.name).join(' ')
        ),
      })),
    [transactions]
  );

  // Filtered list
  const filteredList = useMemo(() => {
    let result = txIndex;

    if (filterTab === 'today') {
      result = result.filter(({ tx }) => isSaleToday(tx.date));
    } else if (filterTab === 'past') {
      result = result.filter(({ tx }) => !isSaleToday(tx.date));
    } else if (filterTab === 'pending') {
      result = result.filter(({ tx }) => tx.status === 'pending_approval');
    }

    return result.filter(({ doc }) => matchesSearch(doc, searchQuery)).map(({ tx }) => tx);
  }, [txIndex, filterTab, searchQuery]);

  // The window is newest-first, so if its oldest row is still today and the page
  // is full, the day continues past what was read. Revenue summed from that page
  // would be a figure the shop never reported.
  const todayTruncated =
    hasMore &&
    transactions.length > 0 &&
    isSaleToday(transactions[transactions.length - 1].date);

  // Today's verified financial stats (strictly excluding voided/refunded)
  const { todayValidTotal, todayValidCount, todayVoidedCount } = useMemo(() => {
    let validTotal = 0;
    let validCount = 0;
    let voidedCount = 0;
    transactions.forEach((tx) => {
      if (!isSaleToday(tx.date)) return;
      if (tx.status === 'voided' || tx.status === 'refunded' || tx.status === 'pending_approval') {
        voidedCount++;
      } else {
        validTotal += (tx.total || 0);
        validCount++;
      }
    });
    return { todayValidTotal: validTotal, todayValidCount: validCount, todayVoidedCount: voidedCount };
  }, [transactions]);

  // Opening the invoice editor. The shelf is read once here, per SKU on the
  // document, so the editor can cap a line at what the shop actually holds —
  // typically 1-3 documents' worth of reads, only when a human asks to edit.
  const openEditor = (tx: SaleTransaction) => {
    setEditTx(tx);
    setEditStock(null);
    const ids = tx.items
      .map(row => row.product?.id)
      .filter((id): id is string => Boolean(id));
    if (ids.length === 0) return;
    readStockLevels(ids)
      .then(levels => setEditStock(levels))
      .catch(() => setEditStock(null));
  };

  // TODAY: Direct Void / Refund handler
  const handleDirectVoidToday = (tx: SaleTransaction) => {
    Alert.alert(
      t('salesHistory.voidTitle', "Void Today's Sale"),
      t('salesHistory.voidBody', 'Are you sure you want to void and refund Invoice #{{invoice}} ({{total}} DA)? All items will be returned to inventory.', {
        invoice: tx.invoiceNumber || tx.id.slice(-6),
        total: (tx.total || 0).toLocaleString(),
      }),
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        {
          text: t('salesHistory.confirmVoid', 'Confirm Void'),
          style: 'destructive',
          onPress: async () => {
            try {
              const outcome = await voidSale(tx, `Voided at the till by ${user?.name || 'Staff'}`);
              Vibration.vibrate(50);

              // A second press on an invoice the shop already closed must not put the
              // same goods on the shelf twice, so it does nothing — and says so.
              if (!outcome.voided) {
                Alert.alert(
                  t('salesHistory.saleVoided', 'Sale Voided'),
                  t('salesHistory.voidAlreadyClosed', 'This invoice was already voided. Nothing was taken back and nothing was refunded again.')
                );
                return;
              }

              Alert.alert(
                t('salesHistory.saleVoided', 'Sale Voided'),
                (outcome.stockFailures.length > 0
                  ? t('salesHistory.voidSavedQueued', 'Transaction marked as voided. {{count}} stock change could not be written and is queued for the next sync.', {
                      count: outcome.stockFailures.length,
                    })
                  : t('salesHistory.saleVoidedBody', 'Stock restored and transaction marked as voided.')) +
                  // The sale is closed but his account still carries the balance. Only a
                  // person can close that, and silence here would report a finished job.
                  (outcome.accountUnreconciled > 0
                    ? t('salesHistory.voidSavedUnreconciled', ' Its {{amount}} DA balance is still open on the customer account — clear it from the Customers tab.', {
                        amount: outcome.accountUnreconciled.toLocaleString(),
                      })
                    : '')
              );
            } catch (err: any) {
              Alert.alert(t('salesHistory.voidFailedTitle', 'Void Failed'), err.message || t('salesHistory.voidFailed', 'Could not void sale.'));
            }
          },
        },
      ]
    );
  };

  // A void an agent cannot perform themselves, asked of an admin over the rail.
  const handleSubmitApprovalRequest = async () => {
    if (!targetTxForApproval) return;
    if (!requestReason.trim()) {
      Alert.alert(t('salesHistory.reasonRequired', 'Reason Required'), t('salesHistory.reasonRequiredBody', 'Please enter a clear reason for requesting this change.'));
      return;
    }

    setIsSubmittingRequest(true);
    try {
      const invNum = targetTxForApproval.invoiceNumber || targetTxForApproval.id.slice(-6);

      const reqId = await useApprovalStore.getState().submitRequest({
        actionType: 'void_sale',
        actionLabel: `Request Void / Refund Sale #${invNum}`,
        actionData: {
          saleId: targetTxForApproval.id,
          invoiceNumber: invNum,
          originalTotal: targetTxForApproval.total || 0,
          originalDate: targetTxForApproval.date,
          customerName: targetTxForApproval.customerName || 'Walk-in',
          items: targetTxForApproval.items.map((i) => ({
            name: i.product?.name ?? '',
            qty: i.quantity,
            price: i.product?.price ?? 0,
          })),
          details: requestDetails.trim() || undefined,
        },
        targetId: targetTxForApproval.id,
        reason: requestReason.trim(),
      });

      // Update the transaction status to show pending approval
      await updateDoc(doc(db, 'transactions', targetTxForApproval.id), {
        status: 'pending_approval',
        approvalRequestId: reqId,
      });

      Vibration.vibrate([0, 50, 50, 80]);
      setIsRequestModalOpen(false);
      setRequestReason('');
      setRequestDetails('');
      setTargetTxForApproval(null);

      Alert.alert(
        t('salesHistory.requestSubmitted', 'Approval Request Submitted'),
        t('salesHistory.requestSubmittedBody', 'Your request has been sent to the store administrator for review and approval.')
      );
    } catch (err: any) {
      Alert.alert(t('salesHistory.requestFailed', 'Request Failed'), err.message || t('salesHistory.requestFailedBody', 'Could not submit approval request.'));
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const handleWhatsAppCustomer = (tx: SaleTransaction) => {
    const phone = phoneDigits(tx.customerPhone);
    if (!phone) {
      Alert.alert(t('salesHistory.noPhone', 'No Phone'), t('salesHistory.noPhoneBody', 'No customer phone number attached to this transaction.'));
      return;
    }
    const lines = [
      t('salesHistory.receiptMessage', 'Hello {{name}}, here is your receipt #{{invoice}} from PhoneShop Pro: Total: {{total}} DA. Thank you!', {
        name: tx.customerName || t('salesHistory.valuedCustomer', 'valued customer'),
        invoice: tx.invoiceNumber || tx.id.slice(-6),
        total: (tx.total || 0).toLocaleString(),
      }),
    ];
    Linking.openURL(`https://wa.me/${phone}?text=${encodeURIComponent(lines.join('\n'))}`).catch(
      () => Alert.alert(t('common.error', 'Error'), t('common.whatsappMissing', 'WhatsApp is not installed.'))
    );
  };

  // The till's history follows the till: whoever may sell may review what was
  // sold, and neither is decided by a job title.
  if (!can.pos) {
    return (
      <View style={styles.restrictedContainer}>
        <MaterialCommunityIcons name="shield-lock-outline" size={64} color={colors.danger} />
        <Text style={styles.restrictedTitle}>{t('common.accessRestricted', 'Access Restricted')}</Text>
        <Text style={styles.restrictedSub}>
          {t(
            'salesHistory.restrictedBody',
            'Sales history needs the selling permission. Ask an administrator to grant it to your profile.'
          )}
        </Text>
        <Button
          mode="contained"
          buttonColor={colors.brand}
          textColor={colors.onBrand}
          style={styles.restrictedButton}
          onPress={() => navigation.navigate('Workbench')}
        >
          {t('salesHistory.returnToWorkbench', 'Return to Workbench')}
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <Appbar.Header style={styles.header}>
        <Appbar.Content
          title={t('salesHistory.title', 'Sales History')}
          subtitle={t('pos.agent', 'Agent: {{name}}', { name: user?.name || t('common.staff', 'Staff') })}
          titleStyle={styles.headerTitle}
          subtitleStyle={styles.headerSub}
        />
        <Appbar.Action
          icon="plus-circle"
          color={colors.onBrand}
          onPress={() => navigation.navigate('POS')}
        />
      </Appbar.Header>

      {/* Search Bar */}
      <View style={styles.searchWrap}>
        <Searchbar
          placeholder={t('salesHistory.searchPlaceholder', 'Search invoice #, customer, item...')}
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={styles.searchbar}
        />
      </View>

      {/* Filter Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.filterTabsRow}
      >
        {FILTER_TABS.map((tab) => {
          const active = filterTab === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.filterTab, active && styles.filterTabActive]}
              onPress={() => setFilterTab(tab.id)}
            >
              <MaterialCommunityIcons
                name={tab.icon}
                size={14}
                color={active ? colors.onBrand : colors.textSecondary}
              />
              <Text style={[styles.filterTabText, active && styles.filterTabTextActive]}>
                {t(tab.labelKey, tab.fallback)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Today Notice Banner & Financial Summary */}
      {filterTab === 'today' && (
        <>
          <View style={styles.todaySummaryBar}>
            <View style={styles.todaySummaryItem}>
              <Text style={styles.todaySummaryLabel}>{t('salesHistory.todayRevenue', "Today's Revenue")}</Text>
              <Text style={styles.todaySummaryAmount}>{todayValidTotal.toLocaleString()} DA</Text>
            </View>
            <View style={styles.todaySummaryDivider} />
            <View style={styles.todaySummaryItem}>
              <Text style={styles.todaySummaryLabel}>{t('salesHistory.validSales', 'Valid Sales')}</Text>
              <Text style={styles.todaySummaryCount}>
                {t('salesHistory.completedCount', '{{n}} completed', { n: todayValidCount })}
              </Text>
            </View>
            {todayVoidedCount > 0 && (
              <>
                <View style={styles.todaySummaryDivider} />
                <View style={styles.todaySummaryItem}>
                  <Text style={styles.todaySummaryLabel}>{t('salesHistory.voidedExcluded', 'Voided / Excluded')}</Text>
                  <Text style={[styles.todaySummaryCount, { color: colors.danger }]}>
                    {t('salesHistory.voidedCount', '{{n}} voided', { n: todayVoidedCount })}
                  </Text>
                </View>
              </>
            )}
          </View>

          <View style={[styles.infoBanner, styles.infoBannerNotice]}>
            <MaterialCommunityIcons name="information-outline" size={18} color={colors.infoText} />
            <Text style={[styles.infoBannerText, { color: colors.infoText }]}>
              {t(
                'salesHistory.todayNotice',
                'You have full authorization to modify or void carts completed today.'
              )}
            </Text>
          </View>

          {todayTruncated && (
            <View style={[styles.infoBanner, styles.infoBannerWarning]}>
              <MaterialCommunityIcons name="alert-outline" size={18} color={colors.warningText} />
              <Text style={[styles.infoBannerText, { color: colors.warningInk }]}>
                {t(
                  'salesHistory.todayTruncated',
                  'Today alone fills this page, so the totals above are missing sales. Load older invoices until the day is complete.'
                )}
              </Text>
            </View>
          )}
        </>
      )}

      {/* Past Notice Banner */}
      {filterTab === 'past' && (
        <View style={[styles.infoBanner, styles.infoBannerWarning]}>
          <MaterialCommunityIcons name="lock-outline" size={18} color={colors.warningText} />
          <Text style={[styles.infoBannerText, { color: colors.warningInk }]}>
            {t(
              'salesHistory.pastNotice',
              'Past sales require Admin Approval before modifications or refunds can be processed.'
            )}
          </Text>
        </View>
      )}

      {/* Transaction List */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
          <Text style={styles.loadingText}>{t('salesHistory.loading', 'Loading sales history...')}</Text>
        </View>
      ) : (
        <FlatList
          data={filteredList}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListFooterComponent={
            hasMore ? (
              <View style={styles.historyFooter}>
                <Text style={styles.historyFooterNote}>
                  {t('salesHistory.windowNote', 'The {{n}} most recent invoices are loaded. Search covers these only.', { n: transactions.length })}
                </Text>
                <Button
                  mode="outlined"
                  textColor={colors.brand}
                  style={styles.loadOlderBtn}
                  onPress={() => setWindowSize((n) => n + HISTORY_PAGE)}
                >
                  {t('salesHistory.loadOlder', 'Load {{n}} older invoices', { n: HISTORY_PAGE })}
                </Button>
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const isToday = isSaleToday(item.date);
            const isVoided = item.status === 'voided' || item.status === 'refunded';
            const isPendingApproval = item.status === 'pending_approval';
            const items = item.items || [];
            // The units the customer left with, not the rows the document prints: a
            // correction's credit line is a unit that did not go out.
            const totalQty = netUnitsSold(items);
            const status = statusAppearance(saleStatusColors, item.status);

            return (
              <Card style={[styles.txCard, isVoided && styles.txCardVoided]}>
                <Card.Content>
                  {/* Top Row: Invoice & Badges */}
                  <View style={styles.cardHeaderRow}>
                    <View style={styles.rowCenter}>
                      <MaterialCommunityIcons
                        name="receipt"
                        size={20}
                        color={isVoided ? colors.textFaint : colors.brand}
                      />
                      <Text style={styles.invoiceNum}>
                        #{item.invoiceNumber || item.id.slice(-6)}
                      </Text>
                    </View>

                    <View style={styles.rowCenter}>
                      {isToday && (
                        <View style={styles.todayPill}>
                          <Text style={styles.todayPillText}>{t('salesHistory.todayTag', 'TODAY')}</Text>
                        </View>
                      )}
                      {/* One pill style, the status table for the colour: the four
                          hand-copied pills used to disagree with the desktop about
                          what a refunded sale looks like. */}
                      <View style={[styles.statusPill, { backgroundColor: status.tint }]}>
                        {isPendingApproval && (
                          <MaterialCommunityIcons name="clock-outline" size={12} color={status.ink} />
                        )}
                        <Text style={[styles.statusPillText, { color: status.ink }]}>
                          {isPendingApproval
                            ? t('salesHistory.statusPending', 'Approval Pending')
                            : item.status === 'voided'
                            ? t('salesHistory.statusVoided', 'VOIDED')
                            : item.status === 'refunded'
                            ? t('salesHistory.statusRefunded', 'REFUNDED')
                            : item.status === 'partially_refunded'
                            ? t('salesHistory.statusEdited', 'CORRECTED')
                            : t('salesHistory.statusCompleted', 'COMPLETED')}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Customer & Timestamp */}
                  <View style={styles.metaRow}>
                    <View style={styles.rowCenter}>
                      <MaterialCommunityIcons name="account" size={16} color={colors.textMuted} />
                      <Text style={styles.custName}>
                        {item.customerName || t('salesHistory.walkIn', 'Walk-in Customer')}
                      </Text>
                      {Boolean(item.customerPhone) && (
                        <TouchableOpacity onPress={() => handleWhatsAppCustomer(item)}>
                          <MaterialCommunityIcons name="whatsapp" size={16} color={colors.whatsapp} />
                        </TouchableOpacity>
                      )}
                    </View>
                    <Text style={styles.timestamp}>
                      {new Date(item.date).toLocaleDateString()} ·{' '}
                      {new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>

                  {/* Items Preview */}
                  <View style={styles.itemsBox}>
                    {items.slice(0, 3).map((cartItem, idx) => {
                      // A unit the correction handed back is its own line and draws
                      // with its own minus, so the card reads the receipt rather than
                      // claiming `2x Phone, 1x Phone` sold the same product twice.
                      const line = lineDisplayOf(cartItem);
                      return (
                        <View key={idx} style={styles.itemRow}>
                          <Text style={styles.itemName} numberOfLines={1}>
                            • {cartItem.product?.name} {cartItem.product?.model || ''}
                          </Text>
                          <Text style={[styles.itemQtyPrice, line.returned && styles.itemQtyReturned]}>
                            x{line.returned ? '−' : ''}
                            {line.units} ({line.returned ? '−' : ''}
                            {line.money} DA)
                          </Text>
                        </View>
                      );
                    })}
                    {items.length > 3 && (
                      <Text style={styles.moreItemsText}>
                        {t('salesHistory.moreItems', '+{{n}} more items ({{total}} total)', {
                          n: items.length - 3,
                          total: totalQty,
                        })}
                      </Text>
                    )}
                  </View>

                  {/* Financial Summary */}
                  <View style={styles.financeRow}>
                    <View>
                      <Text style={styles.subtotalLabel}>
                        {t('pos.subtotal', 'Subtotal')}: {(item.subtotal || 0).toLocaleString()} DA
                      </Text>
                      {discountsGivenOf(item) > 0 && (
                        <Text style={styles.discountLabel}>
                          {t('salesHistory.discountLabel', 'Discount:')} -{discountsGivenOf(item).toLocaleString()} DA
                        </Text>
                      )}
                    </View>

                    <View style={styles.columnEnd}>
                      <Text style={[styles.totalAmount, isVoided && styles.totalAmountVoided]}>
                        {(item.total || 0).toLocaleString()} DA
                      </Text>
                      <View style={styles.methodBadge}>
                        <Text style={styles.methodBadgeText}>
                          {item.payments?.[0]?.method?.toUpperCase() || t('salesHistory.cashTag', 'CASH')}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Action Bar */}
                  <View style={styles.cardActionsRow}>
                    {/* Correcting a settled invoice is the same act whatever its date:
                        the document is rewritten and the stock follows it. */}
                    {!isVoided && (
                      <TouchableOpacity
                        style={[
                          styles.actionBtn,
                          styles.editBtn,
                          isPendingApproval && styles.actionBtnDisabled,
                        ]}
                        disabled={isPendingApproval}
                        onPress={() => openEditor(item)}
                      >
                        <MaterialCommunityIcons
                          name={isPendingApproval ? 'clock-check-outline' : 'file-document-edit-outline'}
                          size={16}
                          color={isPendingApproval ? colors.warningText : colors.brand}
                        />
                        <Text
                          style={[
                            styles.actionBtnText,
                            { color: isPendingApproval ? colors.warningText : colors.brand },
                          ]}
                        >
                          {isPendingApproval
                            ? t('salesHistory.requestPending', 'Request Pending')
                            : t('salesHistory.editInvoice', 'Edit Invoice')}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {/* TODAY: the agent may void their own day without asking */}
                    {isToday && !isVoided && (
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.voidBtn]}
                        onPress={() => handleDirectVoidToday(item)}
                      >
                        <MaterialCommunityIcons name="close-circle-outline" size={16} color={colors.danger} />
                        <Text style={[styles.actionBtnText, { color: colors.danger }]}>
                          {t('salesHistory.voidRefund', 'Void / Refund')}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {/* PAST DAYS: a void is an admin's call */}
                    {!isToday && !isVoided && !isPendingApproval && (
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.requestBtn]}
                        onPress={() => {
                          setTargetTxForApproval(item);
                          setIsRequestModalOpen(true);
                        }}
                      >
                        <MaterialCommunityIcons name="shield-account" size={16} color={colors.warningText} />
                        <Text style={[styles.actionBtnText, { color: colors.warningText }]}>
                          {t('salesHistory.requestAdminVoid', 'Request Admin Void')}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </Card.Content>
              </Card>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons name="receipt-text-outline" size={56} color={colors.borderStrong} />
              <Text style={styles.emptyTitle}>{t('salesHistory.noSales', 'No Sales Found')}</Text>
              <Text style={styles.emptySub}>
                {searchQuery
                  ? t('salesHistory.noSalesSearch', 'No loaded invoice matched your search. Load older invoices to look further back.')
                  : filterTab === 'today'
                  ? t('salesHistory.noSalesToday', 'No sales completed today yet. Start one from Quick POS!')
                  : t('salesHistory.noSalesPast', 'No past transactions found.')}
              </Text>
              <Button
                mode="contained"
                buttonColor={colors.brand}
                textColor={colors.onBrand}
                style={styles.emptyCta}
                onPress={() => navigation.navigate('POS')}
              >
                {t('salesHistory.goToPos', 'Go to Quick POS')}
              </Button>
            </View>
          }
        />
      )}

      {/* Role Navigation Bar with Insets */}
      <RoleBottomNav currentRoute="SalesHistory" navigation={navigation} />

      {/* PAST SALES: Request Admin Approval Modal */}
      <Modal visible={isRequestModalOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalSheet,
              { paddingBottom: Math.max(insets.bottom, spacing.xl) },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={styles.flexOne}>
                <Text style={styles.modalTitle}>{t('salesHistory.requestVoidTitle', 'Request Admin Void')}</Text>
                <Text style={styles.modalSub}>
                  {t(
                    'salesHistory.requestSub',
                    'Invoice #{{invoice}} · {{total}} DA',
                    {
                      invoice: targetTxForApproval?.invoiceNumber || targetTxForApproval?.id.slice(-6) || '',
                      total: (targetTxForApproval?.total || 0).toLocaleString(),
                    }
                  )}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setIsRequestModalOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.requestScroll} keyboardShouldPersistTaps="handled">
              <TextInput
                label={t('salesHistory.reasonLabel', 'Reason for Admin (Required) *')}
                placeholder={t(
                  'salesHistory.reasonPlaceholder',
                  'e.g. Customer returned phone case, wrong quantity charged...'
                )}
                value={requestReason}
                onChangeText={setRequestReason}
                mode="outlined"
                multiline
                numberOfLines={3}
                style={styles.requestInput}
              />

              <TextInput
                label={t('salesHistory.detailsLabel', 'Requested Changes / Specifics')}
                placeholder={t('salesHistory.detailsPlaceholder', 'e.g. Refund 1,500 DA, remove item 2, change to cash...')}
                value={requestDetails}
                onChangeText={setRequestDetails}
                mode="outlined"
                multiline
                numberOfLines={2}
                style={styles.requestInputWide}
              />

              <View style={styles.warningBox}>
                <MaterialCommunityIcons name="shield-alert-outline" size={20} color={colors.warningText} />
                <Text style={styles.warningBoxText}>
                  {t(
                    'salesHistory.requestWarning',
                    'This submission will alert the desktop manager in real-time. Once approved, the adjustments will be automatically processed.'
                  )}
                </Text>
              </View>
            </ScrollView>

            <Button
              mode="contained"
              buttonColor={colors.warningSolid}
              textColor={colors.onBrand}
              loading={isSubmittingRequest}
              disabled={isSubmittingRequest}
              onPress={handleSubmitApprovalRequest}
              style={styles.submitRequestBtn}
            >
              {t('salesHistory.submitRequest', 'Submit Approval Request')}
            </Button>
          </View>
        </View>
      </Modal>

      <EditSaleSheet
        key={editTx?.id ?? 'closed'}
        visible={Boolean(editTx)}
        transaction={editTx}
        stockLevels={editStock}
        onClose={() => setEditTx(null)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flexOne: {
    flex: 1,
  },
  rowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  columnEnd: {
    alignItems: 'flex-end',
  },
  header: {
    backgroundColor: colors.brand,
  },
  headerTitle: {
    color: colors.onBrand,
    fontWeight: '700',
    fontSize: fontSize.title,
  },
  headerSub: {
    color: colors.brandBorder,
    fontSize: fontSize.label,
  },
  searchWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 2,
  },
  searchbar: {
    height: 44,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  filterTabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  filterTabActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  filterTabText: {
    fontSize: fontSize.label,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterTabTextActive: {
    color: colors.onBrand,
    fontWeight: '700',
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  infoBannerNotice: {
    backgroundColor: colors.infoSoft,
    borderColor: colors.infoBorder,
  },
  infoBannerWarning: {
    backgroundColor: colors.warningSoft,
    borderColor: colors.warningBorder,
  },
  infoBannerText: {
    fontSize: fontSize.label,
    fontWeight: '600',
    flex: 1,
    lineHeight: 16,
  },
  loadingText: {
    marginTop: spacing.md,
    color: colors.textMuted,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
  },
  txCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.sm + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  txCardVoided: {
    opacity: 0.65,
    backgroundColor: colors.surfaceMuted,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs + 2,
  },
  invoiceNum: {
    fontSize: fontSize.bodyStrong,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  todayPill: {
    backgroundColor: colors.brandSoft,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: spacing.xxs,
    borderRadius: radius.xs / 1.5,
  },
  todayPillText: {
    color: colors.brand,
    fontSize: 10,
    fontWeight: '800',
  },
  /* One pill shape; `saleStatusColors` supplies the tint and the ink. */
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs / 2,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: spacing.xxs,
    borderRadius: radius.xs / 1.5,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  custName: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: ramp.slate700,
  },
  timestamp: {
    fontSize: fontSize.caption,
    color: colors.textFaint,
  },
  itemsBox: {
    backgroundColor: colors.background,
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surfaceMuted,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xxs,
  },
  itemName: {
    fontSize: fontSize.label,
    color: ramp.slate800,
    flex: 1,
  },
  itemQtyPrice: {
    fontSize: fontSize.label,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  itemQtyReturned: {
    color: colors.dangerText,
    fontWeight: '700',
  },
  moreItemsText: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: spacing.xxs,
  },
  financeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.surfaceMuted,
    marginBottom: spacing.sm + 2,
  },
  subtotalLabel: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
  },
  discountLabel: {
    fontSize: fontSize.caption,
    color: colors.success,
    fontWeight: '600',
  },
  totalAmount: {
    fontSize: fontSize.bodyStrong,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  totalAmountVoided: {
    textDecorationLine: 'line-through',
    color: colors.textFaint,
  },
  todaySummaryBar: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  todaySummaryItem: {
    alignItems: 'center',
    flex: 1,
  },
  todaySummaryDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: colors.border,
  },
  todaySummaryLabel: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  todaySummaryAmount: {
    fontSize: fontSize.bodyStrong,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: spacing.xxs,
  },
  todaySummaryCount: {
    fontSize: fontSize.label,
    fontWeight: '700',
    color: colors.success,
    marginTop: spacing.xxs,
  },
  methodBadge: {
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: spacing.xxs,
    borderRadius: radius.xs / 1.5,
    marginTop: spacing.xxs,
  },
  methodBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.xs + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.surfaceMuted,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.xs,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionBtnText: {
    fontSize: fontSize.label,
    fontWeight: '700',
  },
  actionBtnDisabled: {
    opacity: 0.6,
  },
  editBtn: {
    backgroundColor: colors.brandSoft,
    borderColor: colors.brandBorder,
  },
  voidBtn: {
    backgroundColor: colors.dangerSoft,
    borderColor: ramp.red200,
  },
  requestBtn: {
    backgroundColor: colors.warningSoft,
    borderColor: colors.warningBorder,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    paddingHorizontal: spacing.xxl,
  },
  emptyTitle: {
    fontSize: fontSize.subtitle,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: spacing.md,
  },
  emptySub: {
    fontSize: fontSize.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs + 2,
    lineHeight: 18,
  },
  emptyCta: {
    marginTop: spacing.lg,
  },
  historyFooter: {
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  historyFooterNote: {
    fontSize: fontSize.label,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  loadOlderBtn: {
    borderColor: colors.brand,
    borderRadius: radius.md,
  },
  restrictedContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  restrictedTitle: {
    fontSize: fontSize.title,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: spacing.lg,
  },
  restrictedSub: {
    fontSize: fontSize.bodyStrong,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  restrictedButton: {
    marginTop: spacing.xl,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl + 2,
    borderTopRightRadius: radius.xl + 2,
    padding: spacing.lg - 2,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md - 2,
  },
  modalTitle: {
    fontSize: fontSize.subtitle,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  modalSub: {
    fontSize: fontSize.label,
    color: colors.textMuted,
    marginTop: spacing.xxs,
  },
  requestScroll: {
    maxHeight: 380,
  },
  requestInput: {
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  requestInputWide: {
    backgroundColor: colors.surface,
    marginBottom: spacing.lg,
  },
  submitRequestBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
  },
  warningBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    padding: spacing.sm + 2,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warningBorder,
  },
  warningBoxText: {
    fontSize: fontSize.caption,
    color: colors.warningInk,
    flex: 1,
    lineHeight: 16,
  },
});
