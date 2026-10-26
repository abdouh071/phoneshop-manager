import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  Alert,
  Share,
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
  RadioButton,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuthStore } from '../store/authStore';
import { usePosStore } from '../store/posStore';
import { useApprovalStore } from '../store/approvalStore';
import { activityLogService } from '../services/activityLogService';
import { notificationService } from '../services/notificationService';
import { RoleBottomNav } from '../components/RoleBottomNav';
import type { SaleTransaction, StockStatus } from '../types';

export const SalesHistoryScreen = ({ navigation }: any) => {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { addToCart, clearCart } = usePosStore();

  const [transactions, setTransactions] = useState<SaleTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'today' | 'past' | 'pending'>('today');

  // Selected Tx for Details / Actions
  const [selectedTx, setSelectedTx] = useState<SaleTransaction | null>(null);

  // Admin Approval Request Modal State
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [targetTxForApproval, setTargetTxForApproval] = useState<SaleTransaction | null>(null);
  const [requestType, setRequestType] = useState<'void' | 'modify'>('void');
  const [requestReason, setRequestReason] = useState('');
  const [requestDetails, setRequestDetails] = useState('');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);

  // Direct Void / Refund State for Today
  const [isVoiding, setIsVoiding] = useState(false);

  useEffect(() => {
    if (user?.role === 'repair_agent') {
      navigation.replace('Workbench');
      return;
    }

    // Subscribe to transactions in real-time
    const q = query(
      collection(db, 'transactions'),
      where('saleType', '==', 'retail')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: SaleTransaction[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as SaleTransaction);
        });

        // Sort descending by date
        list.sort(
          (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
        );

        setTransactions(list);
        setIsLoading(false);
      },
      (err) => {
        console.warn('[SalesHistoryScreen] Fetch error:', err);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.role]);

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

  // Filtered list
  const filteredList = useMemo(() => {
    let result = transactions;

    if (filterTab === 'today') {
      result = result.filter((tx) => isSaleToday(tx.date));
    } else if (filterTab === 'past') {
      result = result.filter((tx) => !isSaleToday(tx.date));
    } else if (filterTab === 'pending') {
      result = result.filter((tx) => tx.status === 'pending_approval');
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (tx) =>
          tx.id.toLowerCase().includes(q) ||
          (tx.invoiceNumber || '').toLowerCase().includes(q) ||
          (tx.customerName || '').toLowerCase().includes(q) ||
          (tx.customerPhone || '').includes(q) ||
          tx.items.some((i) => i.product.name.toLowerCase().includes(q))
      );
    }

    return result;
  }, [transactions, filterTab, searchQuery]);

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

  // TODAY: Direct Void / Refund handler
  const handleDirectVoidToday = (tx: SaleTransaction) => {
    Alert.alert(
      'Void Today’s Sale',
      `Are you sure you want to void and refund Invoice #${tx.invoiceNumber || tx.id.slice(-6)} (${tx.total.toLocaleString()} DA)? All items will be returned to inventory.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm Void',
          style: 'destructive',
          onPress: async () => {
            setIsVoiding(true);
            try {
              // 1. Restore inventory stock
              for (const item of tx.items) {
                try {
                  const invRef = doc(db, 'inventory', item.product.id);
                  const invSnap = await getDoc(invRef);
                  if (invSnap.exists()) {
                    const data = invSnap.data();
                    const currentStock = data.stock ?? 0;
                    const newStock = currentStock + item.quantity;
                    const threshold = data.lowStockThreshold ?? 1;
                    const stockStatus: StockStatus =
                      newStock === 0
                        ? 'out_of_stock'
                        : newStock <= threshold
                        ? 'low_stock'
                        : 'in_stock';
                    await updateDoc(invRef, { stock: newStock, stockStatus });
                  } else {
                    const prodRef = doc(db, 'products', item.product.id);
                    const prodSnap = await getDoc(prodRef);
                    if (prodSnap.exists()) {
                      const data = prodSnap.data();
                      const currentStock = data.stock ?? 0;
                      const newStock = currentStock + item.quantity;
                      const threshold = data.lowStockThreshold ?? 1;
                      const stockStatus: StockStatus =
                        newStock === 0
                          ? 'out_of_stock'
                          : newStock <= threshold
                          ? 'low_stock'
                          : 'in_stock';
                      await updateDoc(prodRef, { stock: newStock, stockStatus });
                    }
                  }
                } catch (e) {
                  console.warn('Failed to restore item stock:', e);
                }
              }

              // 2. Mark transaction as voided
              await updateDoc(doc(db, 'transactions', tx.id), {
                status: 'voided',
                voidedAt: new Date().toISOString(),
                voidedBy: user ? { uid: user.id, name: user.name } : null,
              });

              // 3. Log activity
              await activityLogService.log(
                'sales',
                `Voided Today's Sale: #${tx.invoiceNumber || tx.id.slice(-6)} (${tx.total} DA)`,
                {
                  entityId: tx.id,
                  entityType: 'sale',
                  userName: user?.name || 'Sales Agent',
                  userId: user?.id,
                }
              );

              Vibration.vibrate(50);
              Alert.alert('Sale Voided', 'Stock restored and transaction marked as voided.');
            } catch (err: any) {
              Alert.alert('Void Failed', err.message || 'Could not void sale.');
            } finally {
              setIsVoiding(false);
            }
          },
        },
      ]
    );
  };

  // TODAY: Re-open Cart / Edit Sale
  const handleEditCartToday = (tx: SaleTransaction) => {
    Alert.alert(
      'Edit Today’s Cart',
      `Would you like to load the items from Invoice #${tx.invoiceNumber || tx.id.slice(-6)} back into your active cart to make changes?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Load into Cart',
          onPress: () => {
            clearCart();
            tx.items.forEach((item) => {
              addToCart(item.product, item.quantity);
            });
            Vibration.vibrate(30);
            navigation.navigate('POS');
          },
        },
      ]
    );
  };

  // PAST: Submit Admin Approval Request
  const handleSubmitApprovalRequest = async () => {
    if (!targetTxForApproval) return;
    if (!requestReason.trim()) {
      Alert.alert('Reason Required', 'Please enter a clear reason for requesting this change.');
      return;
    }

    setIsSubmittingRequest(true);
    try {
      const invNum = targetTxForApproval.invoiceNumber || targetTxForApproval.id.slice(-6);
      const actionLabel =
        requestType === 'void'
          ? `Request Void / Refund Sale #${invNum}`
          : `Request Edit Items / Price for #${invNum}`;

      const reqId = await useApprovalStore.getState().submitRequest({
        actionType: requestType === 'void' ? 'void_sale' : 'modify_sale',
        actionLabel,
        actionData: {
          saleId: targetTxForApproval.id,
          invoiceNumber: invNum,
          originalTotal: targetTxForApproval.total,
          originalDate: targetTxForApproval.date,
          customerName: targetTxForApproval.customerName || 'Walk-in',
          items: targetTxForApproval.items.map((i) => ({
            name: i.product.name,
            qty: i.quantity,
            price: i.product.price,
          })),
          requestType,
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
        'Approval Request Submitted',
        'Your request has been sent to the store administrator for review and approval.'
      );
    } catch (err: any) {
      Alert.alert('Request Failed', err.message || 'Could not submit approval request.');
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  // Receipt Share
  const handleShareReceipt = (tx: SaleTransaction) => {
    const discountAmount = tx.subtotal && tx.total ? Math.max(0, tx.subtotal - tx.total) : 0;
    const lines = [
      `🧾 *PhoneShop Pro - Sales Receipt*`,
      `Invoice: #${tx.invoiceNumber || tx.id.slice(-6)}`,
      `Date: ${new Date(tx.date).toLocaleString()}`,
      `Customer: ${tx.customerName || 'Walk-in'}`,
      `─────────────────────────`,
      ...tx.items.map(
        (i) =>
          `• ${i.product.name} ${i.product.model || ''} x${i.quantity} — ${(i.unitPrice || i.product.price) * i.quantity} DA`
      ),
      `─────────────────────────`,
      `Subtotal: ${tx.subtotal} DA`,
      ...(discountAmount > 0
        ? [
            `Discount (${tx.discount?.type === 'percent' ? `${tx.discount.value}%` : `${tx.discount?.value} DA`}): -${discountAmount} DA`,
          ]
        : []),
      `*TOTAL: ${tx.total} DA*`,
      `Payment: ${tx.payments?.[0]?.method.toUpperCase() || 'CASH'}`,
      `Served By: ${tx.processedByName || 'Staff'}`,
      `\nThank you for choosing us!`,
    ];
    Share.share({ message: lines.join('\n') });
  };

  const handleWhatsAppCustomer = (tx: SaleTransaction) => {
    const phone = (tx.customerPhone || '').replace(/\D/g, '');
    if (!phone) {
      Alert.alert('No Phone', 'No customer phone number attached to this transaction.');
      return;
    }
    const lines = [
      `Hello ${tx.customerName || 'valued customer'}, here is your receipt #${tx.invoiceNumber || tx.id.slice(-6)} from PhoneShop Pro: Total: ${tx.total.toLocaleString()} DA. Thank you!`,
    ];
    Linking.openURL(`https://wa.me/${phone}?text=${encodeURIComponent(lines.join('\n'))}`).catch(
      () => Alert.alert('Error', 'WhatsApp is not installed.')
    );
  };

  if (user?.role === 'repair_agent') {
    return (
      <View style={styles.restrictedContainer}>
        <MaterialCommunityIcons name="shield-lock-outline" size={64} color="#ef4444" />
        <Text style={styles.restrictedTitle}>Access Restricted</Text>
        <Text style={styles.restrictedSub}>
          Sales History is only accessible to Sales Agents and Administrators.
        </Text>
        <Button
          mode="contained"
          buttonColor="#4f46e5"
          style={{ marginTop: 20 }}
          onPress={() => navigation.navigate('Workbench')}
        >
          Return to Workbench
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <Appbar.Header style={styles.header}>
        <Appbar.Content
          title="Sales History"
          subtitle={`Agent: ${user?.name || 'Staff'}`}
          titleStyle={styles.headerTitle}
          subtitleStyle={styles.headerSub}
        />
        <Appbar.Action
          icon="plus-circle"
          color="#ffffff"
          onPress={() => navigation.navigate('POS')}
        />
      </Appbar.Header>

      {/* Search Bar */}
      <View style={styles.searchWrap}>
        <Searchbar
          placeholder="Search Invoice #, customer, item..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={styles.searchbar}
        />
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterTabsRow}>
        <TouchableOpacity
          style={[styles.filterTab, filterTab === 'today' && styles.filterTabActive]}
          onPress={() => setFilterTab('today')}
        >
          <Text style={[styles.filterTabText, filterTab === 'today' && styles.filterTabTextActive]}>
            📅 Today's Sales
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filterTab === 'past' && styles.filterTabActive]}
          onPress={() => setFilterTab('past')}
        >
          <Text style={[styles.filterTabText, filterTab === 'past' && styles.filterTabTextActive]}>
            📜 Past Days (Locked)
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filterTab === 'all' && styles.filterTabActive]}
          onPress={() => setFilterTab('all')}
        >
          <Text style={[styles.filterTabText, filterTab === 'all' && styles.filterTabTextActive]}>
            All
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filterTab === 'pending' && styles.filterTabActive]}
          onPress={() => setFilterTab('pending')}
        >
          <Text style={[styles.filterTabText, filterTab === 'pending' && styles.filterTabTextActive]}>
            ⏳ Approvals
          </Text>
        </TouchableOpacity>
      </View>

      {/* Today Notice Banner & Financial Summary */}
      {filterTab === 'today' && (
        <>
          <View style={styles.todaySummaryBar}>
            <View style={styles.todaySummaryItem}>
              <Text style={styles.todaySummaryLabel}>Today's Revenue</Text>
              <Text style={styles.todaySummaryAmount}>{todayValidTotal.toLocaleString()} DA</Text>
            </View>
            <View style={styles.todaySummaryDivider} />
            <View style={styles.todaySummaryItem}>
              <Text style={styles.todaySummaryLabel}>Valid Sales</Text>
              <Text style={styles.todaySummaryCount}>{todayValidCount} completed</Text>
            </View>
            {todayVoidedCount > 0 && (
              <>
                <View style={styles.todaySummaryDivider} />
                <View style={styles.todaySummaryItem}>
                  <Text style={styles.todaySummaryLabel}>Voided / Excluded</Text>
                  <Text style={[styles.todaySummaryCount, { color: '#dc2626' }]}>{todayVoidedCount} voided</Text>
                </View>
              </>
            )}
          </View>

          <View style={styles.infoBanner}>
            <MaterialCommunityIcons name="information-outline" size={18} color="#0369a1" />
            <Text style={styles.infoBannerText}>
              You have full authorization to modify or void carts completed today.
            </Text>
          </View>
        </>
      )}

      {/* Past Notice Banner */}
      {filterTab === 'past' && (
        <View style={[styles.infoBanner, { backgroundColor: '#fef3c7', borderColor: '#fde68a' }]}>
          <MaterialCommunityIcons name="lock-outline" size={18} color="#b45309" />
          <Text style={[styles.infoBannerText, { color: '#92400e' }]}>
            Past sales require Admin Approval before modifications or refunds can be processed.
          </Text>
        </View>
      )}

      {/* Transaction List */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4f46e5" />
          <Text style={{ marginTop: 12, color: '#64748b' }}>Loading sales history...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredList}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const isToday = isSaleToday(item.date);
            const isVoided = item.status === 'voided' || item.status === 'refunded';
            const isPendingApproval = item.status === 'pending_approval';
            const totalQty = item.items.reduce((s, i) => s + i.quantity, 0);

            return (
              <Card style={[styles.txCard, isVoided && styles.txCardVoided]}>
                <Card.Content>
                  {/* Top Row: Invoice & Badges */}
                  <View style={styles.cardHeaderRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <MaterialCommunityIcons
                        name="receipt"
                        size={20}
                        color={isVoided ? '#94a3b8' : '#4f46e5'}
                      />
                      <Text style={styles.invoiceNum}>
                        #{item.invoiceNumber || item.id.slice(-6)}
                      </Text>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                      {isToday && (
                        <View style={styles.todayPill}>
                          <Text style={styles.todayPillText}>TODAY</Text>
                        </View>
                      )}

                      {isPendingApproval ? (
                        <View style={styles.pendingPill}>
                          <MaterialCommunityIcons name="clock-outline" size={12} color="#b45309" />
                          <Text style={styles.pendingPillText}>Approval Pending</Text>
                        </View>
                      ) : isVoided ? (
                        <View style={styles.voidedPill}>
                          <Text style={styles.voidedPillText}>VOIDED</Text>
                        </View>
                      ) : (
                        <View style={styles.completedPill}>
                          <Text style={styles.completedPillText}>COMPLETED</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Customer & Timestamp */}
                  <View style={styles.metaRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <MaterialCommunityIcons name="account" size={16} color="#64748b" />
                      <Text style={styles.custName}>
                        {item.customerName || 'Walk-in Customer'}
                      </Text>
                      {Boolean(item.customerPhone) && (
                        <TouchableOpacity onPress={() => handleWhatsAppCustomer(item)}>
                          <MaterialCommunityIcons name="whatsapp" size={16} color="#22c55e" />
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
                    {item.items.slice(0, 3).map((cartItem, idx) => (
                      <View key={idx} style={styles.itemRow}>
                        <Text style={styles.itemName} numberOfLines={1}>
                          • {cartItem.product.name} {cartItem.product.model || ''}
                        </Text>
                        <Text style={styles.itemQtyPrice}>
                          x{cartItem.quantity} ({(cartItem.unitPrice || cartItem.product.price) * cartItem.quantity} DA)
                        </Text>
                      </View>
                    ))}
                    {item.items.length > 3 && (
                      <Text style={styles.moreItemsText}>
                        +{item.items.length - 3} more items ({totalQty} total)
                      </Text>
                    )}
                  </View>

                  {/* Financial Summary */}
                  <View style={styles.financeRow}>
                    <View>
                      <Text style={styles.subtotalLabel}>
                        Subtotal: {item.subtotal.toLocaleString()} DA
                      </Text>
                      {Boolean(item.discount) && (
                        <Text style={styles.discountLabel}>
                          Discount:{' '}
                          {item.discount?.type === 'percent'
                            ? `-${item.discount.value}%`
                            : `-${item.discount?.value} DA`}
                        </Text>
                      )}
                    </View>

                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[styles.totalAmount, isVoided && styles.totalAmountVoided]}>
                        {item.total.toLocaleString()} DA
                      </Text>
                      <View style={styles.methodBadge}>
                        <Text style={styles.methodBadgeText}>
                          {item.payments?.[0]?.method.toUpperCase() || 'CASH'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Action Bar */}
                  <View style={styles.cardActionsRow}>
                    {/* TODAY'S SALES: Direct Edit / Void Actions */}
                    {isToday && !isVoided && (
                      <>
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.editBtn]}
                          onPress={() => handleEditCartToday(item)}
                        >
                          <MaterialCommunityIcons name="cart-arrow-down" size={16} color="#4f46e5" />
                          <Text style={[styles.actionBtnText, { color: '#4f46e5' }]}>
                            Edit Cart
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.actionBtn, styles.voidBtn]}
                          onPress={() => handleDirectVoidToday(item)}
                        >
                          <MaterialCommunityIcons name="close-circle-outline" size={16} color="#dc2626" />
                          <Text style={[styles.actionBtnText, { color: '#dc2626' }]}>
                            Void / Refund
                          </Text>
                        </TouchableOpacity>
                      </>
                    )}

                    {/* PAST DAYS' SALES: Request Admin Change Action */}
                    {!isToday && !isVoided && (
                      <TouchableOpacity
                        style={[
                          styles.actionBtn,
                          styles.requestBtn,
                          isPendingApproval && { opacity: 0.6 },
                        ]}
                        disabled={isPendingApproval}
                        onPress={() => {
                          setTargetTxForApproval(item);
                          setIsRequestModalOpen(true);
                        }}
                      >
                        <MaterialCommunityIcons
                          name={isPendingApproval ? 'clock-check-outline' : 'shield-account'}
                          size={16}
                          color="#b45309"
                        />
                        <Text style={[styles.actionBtnText, { color: '#b45309' }]}>
                          {isPendingApproval ? 'Request Pending' : 'Request Admin Change'}
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
              <MaterialCommunityIcons name="receipt-text-outline" size={56} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>No Sales Found</Text>
              <Text style={styles.emptySub}>
                {searchQuery
                  ? 'No transactions matched your search criteria.'
                  : filterTab === 'today'
                  ? 'No sales completed today yet. Start one from Quick POS!'
                  : 'No past transactions found.'}
              </Text>
              <Button
                mode="contained"
                buttonColor="#4f46e5"
                style={{ marginTop: 16 }}
                onPress={() => navigation.navigate('POS')}
              >
                Go to Quick POS
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
              { paddingBottom: Math.max(insets.bottom, 20) },
            ]}
          >
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Request Admin Approval</Text>
                <Text style={styles.modalSub}>
                  Invoice #{targetTxForApproval?.invoiceNumber || targetTxForApproval?.id.slice(-6)} ·{' '}
                  {targetTxForApproval?.total.toLocaleString()} DA
                </Text>
              </View>
              <TouchableOpacity onPress={() => setIsRequestModalOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 380 }}>
              <Text style={styles.requestSectionTitle}>Request Action</Text>
              <View style={styles.requestTypeRow}>
                <TouchableOpacity
                  style={[
                    styles.requestTypeChip,
                    requestType === 'void' && styles.requestTypeChipActive,
                  ]}
                  onPress={() => setRequestType('void')}
                >
                  <MaterialCommunityIcons
                    name="undo-variant"
                    size={18}
                    color={requestType === 'void' ? '#ffffff' : '#475569'}
                  />
                  <Text
                    style={[
                      styles.requestTypeChipText,
                      requestType === 'void' && styles.requestTypeChipTextActive,
                    ]}
                  >
                    Void & Refund Sale
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.requestTypeChip,
                    requestType === 'modify' && styles.requestTypeChipActive,
                  ]}
                  onPress={() => setRequestType('modify')}
                >
                  <MaterialCommunityIcons
                    name="playlist-edit"
                    size={18}
                    color={requestType === 'modify' ? '#ffffff' : '#475569'}
                  />
                  <Text
                    style={[
                      styles.requestTypeChipText,
                      requestType === 'modify' && styles.requestTypeChipTextActive,
                    ]}
                  >
                    Modify Items / Price
                  </Text>
                </TouchableOpacity>
              </View>

              <TextInput
                label="Reason for Admin (Required) *"
                placeholder="e.g. Customer returned phone case, wrong quantity charged..."
                value={requestReason}
                onChangeText={setRequestReason}
                mode="outlined"
                multiline
                numberOfLines={3}
                style={{ backgroundColor: '#ffffff', marginBottom: 12 }}
              />

              <TextInput
                label="Requested Changes / Specifics"
                placeholder="e.g. Refund 1,500 DA, remove item 2, change to cash..."
                value={requestDetails}
                onChangeText={setRequestDetails}
                mode="outlined"
                multiline
                numberOfLines={2}
                style={{ backgroundColor: '#ffffff', marginBottom: 16 }}
              />

              <View style={styles.warningBox}>
                <MaterialCommunityIcons name="shield-alert-outline" size={20} color="#b45309" />
                <Text style={styles.warningBoxText}>
                  This submission will alert the desktop manager in real-time. Once approved, the adjustments will be automatically processed.
                </Text>
              </View>
            </ScrollView>

            <Button
              mode="contained"
              buttonColor="#d97706"
              loading={isSubmittingRequest}
              disabled={isSubmittingRequest}
              onPress={handleSubmitApprovalRequest}
              style={{ marginTop: 12, paddingVertical: 4 }}
            >
              Submit Approval Request
            </Button>
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
  header: {
    backgroundColor: '#4f46e5',
  },
  headerTitle: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 20,
  },
  headerSub: {
    color: '#c7d2fe',
    fontSize: 12,
  },
  searchWrap: {
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  searchbar: {
    height: 44,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  filterTabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  filterTab: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  filterTabActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  filterTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  filterTabTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#e0f2fe',
    borderWidth: 1,
    borderColor: '#bae6fd',
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  infoBannerText: {
    fontSize: 12,
    color: '#0369a1',
    fontWeight: '600',
    flex: 1,
    lineHeight: 16,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  txCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
  },
  txCardVoided: {
    opacity: 0.65,
    backgroundColor: '#f1f5f9',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  invoiceNum: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  todayPill: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  todayPillText: {
    color: '#1d4ed8',
    fontSize: 10,
    fontWeight: '800',
  },
  completedPill: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  completedPillText: {
    color: '#16a34a',
    fontSize: 10,
    fontWeight: '700',
  },
  voidedPill: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  voidedPillText: {
    color: '#dc2626',
    fontSize: 10,
    fontWeight: '700',
  },
  pendingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#fef3c7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pendingPillText: {
    color: '#b45309',
    fontSize: 10,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  custName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  timestamp: {
    fontSize: 11,
    color: '#94a3b8',
  },
  itemsBox: {
    backgroundColor: '#f8fafc',
    padding: 8,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  itemName: {
    fontSize: 12,
    color: '#1e293b',
    flex: 1,
  },
  itemQtyPrice: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  moreItemsText: {
    fontSize: 11,
    color: '#64748b',
    fontStyle: 'italic',
    marginTop: 2,
  },
  financeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    marginBottom: 10,
  },
  subtotalLabel: {
    fontSize: 11,
    color: '#64748b',
  },
  discountLabel: {
    fontSize: 11,
    color: '#16a34a',
    fontWeight: '600',
  },
  totalAmount: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
  },
  totalAmountVoided: {
    textDecorationLine: 'line-through',
    color: '#94a3b8',
  },
  todaySummaryBar: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    elevation: 2,
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  todaySummaryItem: {
    alignItems: 'center',
    flex: 1,
  },
  todaySummaryDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#e2e8f0',
  },
  todaySummaryLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  todaySummaryAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 2,
  },
  todaySummaryCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#16a34a',
    marginTop: 2,
  },
  methodBadge: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2,
  },
  methodBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  actionIconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
  },
  actionBtnLabel: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  editBtn: {
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  voidBtn: {
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  requestBtn: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
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
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 12,
  },
  emptySub: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  restrictedContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  restrictedTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 16,
  },
  restrictedSub: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 18,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  modalSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  requestSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  requestTypeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  requestTypeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  requestTypeChipActive: {
    backgroundColor: '#d97706',
    borderColor: '#d97706',
  },
  requestTypeChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  requestTypeChipTextActive: {
    color: '#ffffff',
  },
  warningBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#fef3c7',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  warningBoxText: {
    fontSize: 11,
    color: '#92400e',
    flex: 1,
    lineHeight: 16,
  },
});
