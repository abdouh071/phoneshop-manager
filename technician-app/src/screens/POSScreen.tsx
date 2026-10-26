import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ScrollView,
  Modal,
  Alert,
  Linking,
  Share,
  Vibration,
} from 'react-native';
import {
  Appbar,
  Card,
  Text,
  Searchbar,
  Button,
  useTheme,
  ActivityIndicator,
  RadioButton,
  TextInput,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePosStore } from '../store/posStore';
import { useAuthStore } from '../store/authStore';
import { RoleBottomNav } from '../components/RoleBottomNav';
import type { PhoneModel, PaymentMethod, SaleTransaction, Customer } from '../types';

export const POSScreen = ({ navigation }: any) => {
  const insets = useSafeAreaInsets();
  const {
    products,
    cart,
    customers,
    selectedCustomer,
    isLoading,
    fetchProducts,
    fetchCustomers,
    setSelectedCustomer,
    addCustomer,
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
    getCartTotal,
    checkout,
  } = usePosStore();

  const { user } = useAuthStore();
  const theme = useTheme();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [completedTx, setCompletedTx] = useState<SaleTransaction | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCustomerPickerOpen, setIsCustomerPickerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [isAddingNewCustomer, setIsAddingNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);

  // Discount System State for Sales Agent
  const [discountType, setDiscountType] = useState<'percent' | 'flat'>('percent');
  const [discountValue, setDiscountValue] = useState<string>('');
  const [discountReason, setDiscountReason] = useState<string>('');
  const [showDiscountSection, setShowDiscountSection] = useState(false);

  useEffect(() => {
    if (user?.role === 'repair_agent') {
      navigation.replace('Workbench');
      return;
    }
    fetchProducts();
    fetchCustomers();
  }, [user?.role]);

  const { subtotal, totalItems } = getCartTotal();

  // Calculated discount values
  const parsedDiscount = parseFloat(discountValue) || 0;
  const calculatedDiscount = useMemo(() => {
    if (parsedDiscount <= 0) return 0;
    if (discountType === 'percent') {
      return Math.min(subtotal, Math.round((subtotal * parsedDiscount) / 100));
    }
    return Math.min(subtotal, Math.round(parsedDiscount));
  }, [subtotal, parsedDiscount, discountType]);

  const finalTotalDue = Math.max(0, subtotal - calculatedDiscount);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      if (categoryFilter !== 'all' && p.category !== categoryFilter) {
        return false;
      }
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        p.name?.toLowerCase().includes(q) ||
        p.model?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.barcode?.toLowerCase().includes(q)
      );
    });
  }, [products, categoryFilter, search]);

  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customers.slice(0, 8);
    const q = customerSearch.toLowerCase();
    return customers.filter(c =>
      c.name.toLowerCase().includes(q) || c.phone.includes(q)
    );
  }, [customers, customerSearch]);

  const handleProductPress = (product: PhoneModel) => {
    if (product.stock <= 0) {
      Alert.alert('Out of Stock', `${product.name} has 0 available units.`);
      return;
    }
    Vibration.vibrate(30);
    addToCart(product, 1);
  };

  const handleOpenScanner = () => {
    navigation.navigate('Scanner', {
      onScan: (scannedCode: string) => {
        const clean = scannedCode.trim().toLowerCase();
        const matched = products.find(p =>
          p.sku?.toLowerCase() === clean ||
          p.barcode?.toLowerCase() === clean ||
          p.id.toLowerCase() === clean
        );
        if (matched) {
          Vibration.vibrate(60);
          addToCart(matched, 1);
          Alert.alert('Scanned to Cart', `${matched.name} ${matched.model} added to cart.`);
        } else {
          Alert.alert('Product Not Found', `No product matching SKU/Barcode: ${scannedCode}`);
        }
      },
    });
  };

  const handleCreateCustomer = async () => {
    if (!newCustomerName.trim() || !newCustomerPhone.trim()) {
      Alert.alert('Required Fields', 'Please enter customer name and phone number.');
      return;
    }
    setIsSavingCustomer(true);
    try {
      const created = await addCustomer(newCustomerName.trim(), newCustomerPhone.trim());
      setIsCustomerPickerOpen(false);
      setIsAddingNewCustomer(false);
      setNewCustomerName('');
      setNewCustomerPhone('');
      Vibration.vibrate(40);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create customer.');
    } finally {
      setIsSavingCustomer(false);
    }
  };

  const handleConfirmCheckout = async () => {
    if (cart.length === 0) return;
    setIsSubmitting(true);
    try {
      const tx = await checkout({
        paymentMethod,
        amountPaid: finalTotalDue,
        discountValue: calculatedDiscount > 0 ? parsedDiscount : undefined,
        discountType: calculatedDiscount > 0 ? discountType : undefined,
        customer: selectedCustomer,
        notes: discountReason.trim() ? `Discount Note: ${discountReason.trim()}` : undefined,
      });
      setIsCheckoutOpen(false);
      setCompletedTx(tx);
      // Reset discount inputs
      setDiscountValue('');
      setDiscountReason('');
      setShowDiscountSection(false);
      Vibration.vibrate([0, 50, 50, 100]);
    } catch (err: any) {
      Alert.alert('Checkout Failed', err.message || 'Could not complete sale.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const buildReceiptText = (tx: SaleTransaction): string => {
    const discountAmount = tx.subtotal && tx.total ? Math.max(0, tx.subtotal - tx.total) : 0;
    const lines = [
      `🧾 *PhoneShop Pro - Sales Receipt*`,
      `Invoice: #${tx.invoiceNumber || tx.id.slice(-6)}`,
      `Date: ${new Date(tx.date).toLocaleString()}`,
      `Customer: ${tx.customerName || 'Walk-in'}`,
      `─────────────────────────`,
      ...tx.items.map(i => `• ${i.product.name} ${i.product.model || ''} x${i.quantity} — ${(i.unitPrice || i.product.price) * i.quantity} DA`),
      `─────────────────────────`,
      `Subtotal: ${tx.subtotal} DA`,
      ...(discountAmount > 0 ? [`Discount (${tx.discount?.type === 'percent' ? `${tx.discount.value}%` : `${tx.discount?.value} DA`}): -${discountAmount} DA`] : []),
      `*TOTAL: ${tx.total} DA*`,
      `Payment: ${tx.payments?.[0]?.method.toUpperCase() || 'CASH'}`,
      `Served By: ${user?.name || 'Sales Staff'}`,
      `\nThank you for choosing us!`,
    ];
    return lines.join('\n');
  };

  const handleWhatsAppShare = () => {
    if (!completedTx) return;
    const text = buildReceiptText(completedTx);
    const phone = completedTx.customerPhone ? completedTx.customerPhone.replace(/\D/g, '') : '';
    const url = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
    Linking.openURL(url).catch(() => Alert.alert('Error', 'WhatsApp is not installed.'));
  };

  const handleGeneralShare = () => {
    if (!completedTx) return;
    const text = buildReceiptText(completedTx);
    Share.share({ message: text });
  };

  const CATEGORIES = [
    { id: 'all', label: 'All Products', icon: 'apps' },
    { id: 'smartphone', label: 'Phones', icon: 'cellphone' },
    { id: 'accessory', label: 'Accessories', icon: 'headphones' },
    { id: 'tablet', label: 'Tablets', icon: 'tablet' },
    { id: 'repair_part', label: 'Parts', icon: 'cog' },
  ];

  // Guard: Repair agents cannot access POS
  if (user?.role === 'repair_agent') {
    return (
      <View style={styles.restrictedContainer}>
        <MaterialCommunityIcons name="shield-lock-outline" size={64} color="#ef4444" />
        <Text style={styles.restrictedTitle}>Access Restricted</Text>
        <Text style={styles.restrictedSub}>
          Point of Sale is only accessible to Sales Agents and Administrators. Repair agents do not have access to sales and POS features.
        </Text>
        <Button
          mode="contained"
          buttonColor="#4f46e5"
          style={{ marginTop: 24, borderRadius: 10 }}
          onPress={() => navigation.navigate('Workbench')}
        >
          Return to Workbench
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Appbar.Header style={styles.header}>
        <Appbar.Content title="Quick POS Sale" subtitle={`Agent: ${user?.name || 'Staff'}`} titleStyle={styles.headerTitle} subtitleStyle={styles.headerSub} />
        {/* Cart Quick Access in Header */}
        <TouchableOpacity
          style={styles.headerCartBtn}
          onPress={() => {
            if (cart.length > 0) {
              setIsCheckoutOpen(true);
            } else {
              Alert.alert('Cart is Empty', 'Select products below to add them to your cart.');
            }
          }}
        >
          <MaterialCommunityIcons name="cart" size={24} color="#ffffff" />
          {totalItems > 0 && (
            <View style={styles.headerCartBadge}>
              <Text style={styles.headerCartBadgeText}>{totalItems}</Text>
            </View>
          )}
        </TouchableOpacity>
        <Appbar.Action icon="barcode-scan" color="#ffffff" onPress={handleOpenScanner} />
        <Appbar.Action icon="refresh" color="#ffffff" onPress={() => { fetchProducts(); fetchCustomers(); }} />
      </Appbar.Header>

      {/* Search & Camera Scan Bar */}
      <View style={styles.searchRow}>
        <Searchbar
          placeholder="Search products or SKU..."
          value={search}
          onChangeText={setSearch}
          style={styles.searchbar}
          inputStyle={{ fontSize: 14 }}
          elevation={0}
        />
        <TouchableOpacity style={styles.cameraBtn} onPress={handleOpenScanner}>
          <MaterialCommunityIcons name="camera" size={20} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {/* Category Pills */}
      <View style={styles.categoriesWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryScroll}>
          {CATEGORIES.map(cat => {
            const active = categoryFilter === cat.id;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[styles.categoryChip, active && styles.categoryChipActive]}
                onPress={() => setCategoryFilter(cat.id)}
              >
                <MaterialCommunityIcons name={cat.icon as any} size={15} color={active ? '#ffffff' : '#64748b'} />
                <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Customer Lookup Card */}
      <View style={styles.customerCardWrap}>
        {selectedCustomer ? (
          <View style={styles.attachedCustomerCard}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialCommunityIcons name="account-check" size={16} color="#16a34a" />
                <Text style={styles.attachedName}>{selectedCustomer.name}</Text>
              </View>
              <Text style={styles.attachedPhone}>{selectedCustomer.phone}</Text>
              <View style={styles.debtPillRow}>
                {(selectedCustomer.totalDebt || 0) > 0 ? (
                  <View style={styles.debtBadge}>
                    <Text style={styles.debtBadgeText}>Debt: {selectedCustomer.totalDebt} DA</Text>
                  </View>
                ) : (
                  <View style={styles.cleanCreditBadge}>
                    <Text style={styles.cleanCreditText}>Clean Credit</Text>
                  </View>
                )}
                {selectedCustomer.creditLimit ? (
                  <Text style={styles.creditLimitText}>Limit: {selectedCustomer.creditLimit} DA</Text>
                ) : null}
              </View>
            </View>
            <TouchableOpacity onPress={() => setSelectedCustomer(null)}>
              <MaterialCommunityIcons name="close-circle" size={20} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.selectCustomerBtn} onPress={() => setIsCustomerPickerOpen(true)}>
            <MaterialCommunityIcons name="account-plus-outline" size={16} color="#4f46e5" />
            <Text style={styles.selectCustomerText}>Attach Customer (Optional)</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Product List */}
      {isLoading && products.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4f46e5" />
        </View>
      ) : (
        <FlatList
          data={filteredProducts}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const inCart = cart.find(c => c.product.id === item.id);
            const isOutOfStock = item.stock <= 0;
            return (
              <View style={[styles.productCard, isOutOfStock && styles.productCardDisabled]}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.productInfo}
                  onPress={() => handleProductPress(item)}
                >
                  <Text style={styles.productName}>{item.name}</Text>
                  <Text style={styles.productModel}>{item.model} · SKU: {item.sku}</Text>
                  <View style={styles.productMetaRow}>
                    <Text style={styles.productPrice}>{item.price} DA</Text>
                    <View style={[styles.stockBadge, isOutOfStock ? styles.stockBadgeOut : styles.stockBadgeIn]}>
                      <Text style={[styles.stockBadgeText, isOutOfStock && { color: '#dc2626' }]}>
                        {isOutOfStock ? 'Out of stock' : `${item.stock} in stock`}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
                <View style={styles.productAction}>
                  {inCart ? (
                    <View style={styles.stepperContainer}>
                      <TouchableOpacity
                        style={styles.stepperBtn}
                        onPress={() => updateQuantity(item.id, inCart.quantity - 1)}
                      >
                        <MaterialCommunityIcons name="minus" size={15} color="#ffffff" />
                      </TouchableOpacity>
                      <Text style={styles.stepperQtyText}>{inCart.quantity}</Text>
                      <TouchableOpacity
                        style={styles.stepperBtn}
                        onPress={() => {
                          if (inCart.quantity >= item.stock) {
                            Alert.alert('Max Stock', `Only ${item.stock} unit(s) available.`);
                            return;
                          }
                          updateQuantity(item.id, inCart.quantity + 1);
                        }}
                      >
                        <MaterialCommunityIcons name="plus" size={15} color="#ffffff" />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      disabled={isOutOfStock}
                      style={[styles.addBtn, isOutOfStock && styles.addBtnDisabled]}
                      onPress={() => handleProductPress(item)}
                    >
                      <MaterialCommunityIcons name="plus" size={18} color={isOutOfStock ? '#cbd5e1' : '#4f46e5'} />
                      <Text style={[styles.addBtnText, isOutOfStock && { color: '#cbd5e1' }]}>Add</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="package-variant" size={48} color="#cbd5e1" />
              <Text style={styles.emptyText}>No products found</Text>
            </View>
          }
        />
      )}

      {/* Prominent Checkout Floating / Pinned Action Bar */}
      {cart.length > 0 && (
        <View style={styles.bottomBar}>
          <View style={styles.bottomBarLeft}>
            <View style={styles.cartIconBadge}>
              <MaterialCommunityIcons name="cart" size={18} color="#ffffff" />
              <Text style={styles.cartIconBadgeText}>{totalItems}</Text>
            </View>
            <View>
              <Text style={styles.bottomBarItems}>{totalItems} item{totalItems > 1 ? 's' : ''} in cart</Text>
              <Text style={styles.bottomBarTotal}>{subtotal.toLocaleString()} DA</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.checkoutBtn}
            activeOpacity={0.85}
            onPress={() => setIsCheckoutOpen(true)}
          >
            <Text style={styles.checkoutBtnText}>Checkout</Text>
            <MaterialCommunityIcons name="arrow-right-circle" size={20} color="#ffffff" />
          </TouchableOpacity>
        </View>
      )}

      {/* Role Navigation Bar */}
      <RoleBottomNav currentRoute="POS" navigation={navigation} />

      {/* Checkout Modal */}
      <Modal visible={isCheckoutOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Checkout Sale</Text>
              <TouchableOpacity onPress={() => setIsCheckoutOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
              {cart.map(item => (
                <View key={item.product.id} style={styles.cartRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cartRowName}>{item.product.name} {item.product.model}</Text>
                    <Text style={styles.cartRowPrice}>{item.product.price} DA each</Text>
                  </View>
                  <View style={styles.qtyControlRow}>
                    <TouchableOpacity
                      style={styles.qtyBtn}
                      onPress={() => updateQuantity(item.product.id, item.quantity - 1)}
                    >
                      <MaterialCommunityIcons name="minus" size={16} color="#0f172a" />
                    </TouchableOpacity>
                    <Text style={styles.qtyVal}>{item.quantity}</Text>
                    <TouchableOpacity
                      style={styles.qtyBtn}
                      onPress={() => updateQuantity(item.product.id, item.quantity + 1)}
                    >
                      <MaterialCommunityIcons name="plus" size={16} color="#0f172a" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

            <View style={styles.divider} />

            {/* Discount / Coupon Section for Sales Agent */}
            <TouchableOpacity
              style={styles.discountHeaderBtn}
              activeOpacity={0.8}
              onPress={() => setShowDiscountSection(!showDiscountSection)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                <MaterialCommunityIcons name="tag-outline" size={18} color="#4f46e5" />
                <Text style={styles.discountHeaderLabel}>Apply Discount</Text>
                {calculatedDiscount > 0 && (
                  <View style={styles.appliedDiscountBadge}>
                    <Text style={styles.appliedDiscountBadgeText}>
                      -{calculatedDiscount.toLocaleString()} DA ({discountType === 'percent' ? `${parsedDiscount}%` : 'Flat'})
                    </Text>
                  </View>
                )}
              </View>
              <MaterialCommunityIcons
                name={showDiscountSection ? 'chevron-up' : 'chevron-down'}
                size={22}
                color="#64748b"
              />
            </TouchableOpacity>

            {showDiscountSection && (
              <View style={styles.discountBox}>
                {/* Discount Mode Toggle: Percent (%) vs Flat (DA) */}
                <View style={styles.discountTypeRow}>
                  <TouchableOpacity
                    style={[styles.discountTypeBtn, discountType === 'percent' && styles.discountTypeBtnActive]}
                    onPress={() => setDiscountType('percent')}
                  >
                    <Text style={[styles.discountTypeBtnText, discountType === 'percent' && styles.discountTypeBtnTextActive]}>
                      Percentage (%)
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.discountTypeBtn, discountType === 'flat' && styles.discountTypeBtnActive]}
                    onPress={() => setDiscountType('flat')}
                  >
                    <Text style={[styles.discountTypeBtnText, discountType === 'flat' && styles.discountTypeBtnTextActive]}>
                      Flat (DA)
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Preset Discount Chips */}
                <View style={styles.presetChipsRow}>
                  {(discountType === 'percent' ? [0, 5, 10, 15, 20] : [0, 200, 500, 1000, 2000]).map(val => {
                    const isSelected = parsedDiscount === val;
                    return (
                      <TouchableOpacity
                        key={val}
                        style={[styles.presetChip, isSelected && styles.presetChipActive]}
                        onPress={() => setDiscountValue(val === 0 ? '' : val.toString())}
                      >
                        <Text style={[styles.presetChipText, isSelected && styles.presetChipTextActive]}>
                          {val === 0 ? 'None' : discountType === 'percent' ? `${val}%` : `${val} DA`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Custom Discount Input */}
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <TextInput
                    label={discountType === 'percent' ? 'Discount %' : 'Discount DA'}
                    value={discountValue}
                    onChangeText={setDiscountValue}
                    keyboardType="numeric"
                    mode="outlined"
                    dense
                    style={{ flex: 1, backgroundColor: '#ffffff' }}
                  />
                  {calculatedDiscount > 0 && (
                    <TouchableOpacity
                      onPress={() => {
                        setDiscountValue('');
                        setDiscountReason('');
                      }}
                      style={styles.clearDiscountBtn}
                    >
                      <Text style={styles.clearDiscountBtnText}>Reset</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Optional Discount Note */}
                <TextInput
                  label="Discount Reason / Promo Note (Optional)"
                  placeholder="e.g. Loyalty perk, bundle deal..."
                  value={discountReason}
                  onChangeText={setDiscountReason}
                  mode="outlined"
                  dense
                  style={{ backgroundColor: '#ffffff' }}
                />
              </View>
            )}

            {/* Payment Method Selector */}
            <Text style={styles.sectionHeading}>Payment Method</Text>
            <View style={styles.paymentMethodsRow}>
              {(['cash', 'card', 'debt'] as PaymentMethod[]).map(method => (
                <TouchableOpacity
                  key={method}
                  style={[styles.methodChip, paymentMethod === method && styles.methodChipActive]}
                  onPress={() => setPaymentMethod(method)}
                >
                  <Text style={[styles.methodChipText, paymentMethod === method && styles.methodChipTextActive]}>
                    {method === 'cash' ? '💵 Cash' : method === 'card' ? '💳 Card' : '📋 Debt / Tab'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Live Pricing Summary Rows */}
            <View style={styles.summaryContainer}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Subtotal:</Text>
                <Text style={styles.summaryValue}>{subtotal.toLocaleString()} DA</Text>
              </View>
              {calculatedDiscount > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: '#16a34a', fontWeight: '700' }]}>
                    Discount ({discountType === 'percent' ? `${parsedDiscount}%` : 'Flat'}):
                  </Text>
                  <Text style={[styles.summaryValue, { color: '#16a34a', fontWeight: '800' }]}>
                    -{calculatedDiscount.toLocaleString()} DA
                  </Text>
                </View>
              )}
              <View style={[styles.summaryRow, styles.totalSummaryRow]}>
                <Text style={styles.totalLabel}>Total Due:</Text>
                <Text style={styles.totalAmount}>{finalTotalDue.toLocaleString()} DA</Text>
              </View>
            </View>

              <Button
                mode="contained"
                buttonColor="#16a34a"
                loading={isSubmitting}
                disabled={isSubmitting}
                onPress={handleConfirmCheckout}
                style={{ marginTop: 8, paddingVertical: 4 }}
              >
                Complete Sale ({finalTotalDue.toLocaleString()} DA)
              </Button>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Receipt & Share Modal */}
      <Modal visible={Boolean(completedTx)} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { alignItems: 'center', paddingBottom: Math.max(insets.bottom, 20) }]}>
            <MaterialCommunityIcons name="check-circle" size={56} color="#16a34a" />
            <Text style={styles.successTitle}>Sale Successful!</Text>
            <Text style={styles.successSub}>Invoice #{completedTx?.id.slice(-6)} · {completedTx?.total} DA</Text>

            <View style={{ width: '100%', marginTop: 16 }}>
              <TouchableOpacity style={styles.whatsAppBtn} onPress={handleWhatsAppShare}>
                <MaterialCommunityIcons name="whatsapp" size={20} color="#ffffff" />
                <Text style={styles.shareBtnText}>Share via WhatsApp</Text>
              </TouchableOpacity>
            </View>

            <Button
              mode="outlined"
              onPress={() => setCompletedTx(null)}
              style={{ width: '100%', marginTop: 14 }}
            >
              Start New Sale
            </Button>
          </View>
        </View>
      </Modal>

      {/* Customer Picker Modal */}
      <Modal visible={isCustomerPickerOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {isAddingNewCustomer ? 'New Customer' : 'Select Customer'}
              </Text>
              <TouchableOpacity onPress={() => {
                setIsCustomerPickerOpen(false);
                setIsAddingNewCustomer(false);
              }}>
                <MaterialCommunityIcons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            {isAddingNewCustomer ? (
              <View style={styles.newCustForm}>
                <TextInput
                  label="Customer Name *"
                  value={newCustomerName}
                  onChangeText={setNewCustomerName}
                  style={{ marginBottom: 12, backgroundColor: '#ffffff' }}
                  mode="outlined"
                />
                <TextInput
                  label="Phone Number *"
                  value={newCustomerPhone}
                  onChangeText={setNewCustomerPhone}
                  keyboardType="phone-pad"
                  style={{ marginBottom: 16, backgroundColor: '#ffffff' }}
                  mode="outlined"
                />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button
                    mode="outlined"
                    onPress={() => setIsAddingNewCustomer(false)}
                    style={{ flex: 1 }}
                  >
                    Back to List
                  </Button>
                  <Button
                    mode="contained"
                    buttonColor="#4f46e5"
                    textColor="#ffffff"
                    loading={isSavingCustomer}
                    disabled={isSavingCustomer}
                    onPress={handleCreateCustomer}
                    style={{ flex: 1 }}
                  >
                    Save & Attach
                  </Button>
                </View>
              </View>
            ) : (
              <>
                <Searchbar
                  placeholder="Search by name or phone..."
                  value={customerSearch}
                  onChangeText={setCustomerSearch}
                  style={{ marginBottom: 10 }}
                />

                <TouchableOpacity
                  style={styles.quickAddCustomerRow}
                  onPress={() => {
                    setNewCustomerName(customerSearch.trim());
                    setNewCustomerPhone('');
                    setIsAddingNewCustomer(true);
                  }}
                >
                  <MaterialCommunityIcons name="account-plus" size={18} color="#4f46e5" />
                  <Text style={styles.quickAddCustomerText}>
                    + Create new customer {customerSearch ? `"${customerSearch}"` : ''}
                  </Text>
                </TouchableOpacity>

                <FlatList
                  data={filteredCustomers}
                  keyExtractor={item => item.id}
                  style={{ maxHeight: 260 }}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.customerOption}
                      onPress={() => {
                        setSelectedCustomer(item);
                        setIsCustomerPickerOpen(false);
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.custOptName}>{item.name}</Text>
                        <Text style={styles.custOptPhone}>{item.phone}</Text>
                      </View>
                      {(item.totalDebt || 0) > 0 ? (
                        <View style={styles.custDebtBadge}>
                          <Text style={styles.custDebtBadgeText}>{item.totalDebt} DA Debt</Text>
                        </View>
                      ) : (
                        <Text style={{ color: '#16a34a', fontSize: 11, fontWeight: '700' }}>Clean</Text>
                      )}
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <View style={{ padding: 20, alignItems: 'center' }}>
                      <Text style={{ color: '#94a3b8', fontSize: 13 }}>No customers match your search.</Text>
                    </View>
                  }
                />
              </>
            )}
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 8,
  },
  searchbar: {
    flex: 1,
    height: 44,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cameraBtn: {
    width: 44,
    height: 44,
    backgroundColor: '#4f46e5',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoriesWrap: {
    paddingVertical: 8,
  },
  categoryScroll: {
    paddingHorizontal: 12,
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    gap: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  categoryChipActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  categoryChipTextActive: {
    color: '#ffffff',
  },
  customerCardWrap: {
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  selectCustomerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eef2ff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  selectCustomerText: {
    fontSize: 13,
    color: '#4f46e5',
    fontWeight: '600',
  },
  attachedCustomerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  attachedName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  attachedPhone: {
    fontSize: 12,
    color: '#64748b',
  },
  debtPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 3,
  },
  debtBadge: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  debtBadgeText: {
    color: '#dc2626',
    fontSize: 10,
    fontWeight: '700',
  },
  cleanCreditBadge: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  cleanCreditText: {
    color: '#16a34a',
    fontSize: 10,
    fontWeight: '700',
  },
  creditLimitText: {
    fontSize: 11,
    color: '#64748b',
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 90,
  },
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  productCardDisabled: {
    opacity: 0.5,
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  productModel: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  productMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
  },
  productPrice: {
    fontSize: 15,
    fontWeight: '800',
    color: '#4f46e5',
  },
  stockBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  stockBadgeIn: {
    backgroundColor: '#dcfce7',
  },
  stockBadgeOut: {
    backgroundColor: '#fee2e2',
  },
  stockBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#16a34a',
  },
  productAction: {
    marginLeft: 8,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4f46e5',
    borderRadius: 8,
    overflow: 'hidden',
  },
  stepperBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperQtyText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    minWidth: 20,
    textAlign: 'center',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  addBtnDisabled: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  addBtnText: {
    color: '#4f46e5',
    fontSize: 12,
    fontWeight: '700',
  },
  headerCartBtn: {
    position: 'relative',
    padding: 8,
    marginRight: 4,
  },
  headerCartBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  headerCartBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  bottomBar: {
    backgroundColor: '#0f172a',
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: -3 },
  },
  bottomBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cartIconBadge: {
    backgroundColor: '#4f46e5',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
  },
  cartIconBadgeText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  bottomBarItems: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
  },
  bottomBarTotal: {
    fontSize: 18,
    fontWeight: '800',
    color: '#22c55e',
  },
  checkoutBtn: {
    backgroundColor: '#16a34a',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    elevation: 3,
  },
  checkoutBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  emptyText: {
    color: '#94a3b8',
    marginTop: 8,
    fontSize: 14,
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
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  cartRowName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  cartRowPrice: {
    fontSize: 12,
    color: '#64748b',
  },
  qtyControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  qtyBtn: {
    width: 28,
    height: 28,
    backgroundColor: '#f1f5f9',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyVal: {
    fontSize: 14,
    fontWeight: '700',
    minWidth: 20,
    textAlign: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 12,
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 8,
  },
  paymentMethodsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  methodChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  methodChipActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  methodChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  methodChipTextActive: {
    color: '#ffffff',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 8,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#475569',
  },
  totalAmount: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  successTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 8,
  },
  successSub: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 2,
    marginBottom: 16,
  },
  shareButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginVertical: 8,
  },
  whatsAppBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#25D366',
    paddingVertical: 12,
    borderRadius: 8,
    gap: 6,
  },
  generalShareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0284c7',
    paddingVertical: 12,
    borderRadius: 8,
    gap: 6,
  },
  shareBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  customerOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  custOptName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  custOptPhone: {
    fontSize: 12,
    color: '#64748b',
  },
  newCustForm: {
    paddingVertical: 8,
  },
  quickAddCustomerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eef2ff',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 8,
    marginBottom: 10,
  },
  quickAddCustomerText: {
    fontSize: 13,
    color: '#4f46e5',
    fontWeight: '700',
  },
  custDebtBadge: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  custDebtBadgeText: {
    color: '#dc2626',
    fontSize: 11,
    fontWeight: '700',
  },
  discountHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 10,
  },
  discountHeaderLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
  },
  appliedDiscountBadge: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
  },
  appliedDiscountBadgeText: {
    color: '#16a34a',
    fontSize: 11,
    fontWeight: '800',
  },
  discountBox: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  discountTypeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  discountTypeBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: '#e2e8f0',
  },
  discountTypeBtnActive: {
    backgroundColor: '#4f46e5',
  },
  discountTypeBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  discountTypeBtnTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  presetChipsRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  presetChip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#ffffff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  presetChipActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  presetChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  presetChipTextActive: {
    color: '#ffffff',
  },
  clearDiscountBtn: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#fee2e2',
    borderRadius: 6,
  },
  clearDiscountBtnText: {
    color: '#dc2626',
    fontSize: 11,
    fontWeight: '700',
  },
  summaryContainer: {
    backgroundColor: '#f8fafc',
    padding: 10,
    borderRadius: 8,
    marginTop: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  summaryLabel: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
  },
  summaryValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  totalSummaryRow: {
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 8,
    marginTop: 4,
  },
});
