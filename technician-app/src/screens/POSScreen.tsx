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
  Vibration,
} from 'react-native';
import {
  Appbar,
  Text,
  Searchbar,
  Button,
  ActivityIndicator,
  TextInput,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePosStore } from '../store/posStore';
import { useAuthStore } from '../store/authStore';
import { usePermissions } from '../hooks/usePermissions';
import { RoleBottomNav } from '../components/RoleBottomNav';
import { useTranslation } from 'react-i18next';
import { buildSearch, matchesSearch } from '../utils/search';
import { colors, fontSize, radius, ramp, spacing, stockStatusColors } from '../theme/tokens';
import type { PhoneModel, PaymentMethod, SaleTransaction } from '../types';

/**
 * Module scope so the chip list is not rebuilt on every render, and the labels
 * go through `t()` instead of a hard-coded English string per pill.
 */
const CATEGORIES = [
  { id: 'all', labelKey: 'pos.catAll', fallback: 'All Products', icon: 'apps' },
  { id: 'smartphone', labelKey: 'pos.catPhones', fallback: 'Phones', icon: 'cellphone' },
  { id: 'accessory', labelKey: 'pos.catAccessories', fallback: 'Accessories', icon: 'headphones' },
  { id: 'tablet', labelKey: 'pos.catTablets', fallback: 'Tablets', icon: 'tablet' },
  { id: 'repair_part', labelKey: 'pos.catParts', fallback: 'Parts', icon: 'cog' },
];

export const POSScreen = ({ navigation }: any) => {
  const { t } = useTranslation();
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
    updateQuantity,
    getCartTotal,
    checkout,
  } = usePosStore();

  const { user } = useAuthStore();
  const can = usePermissions();

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
    if (!can.pos) {
      navigation.replace('Workbench');
      return;
    }
    fetchProducts();
    fetchCustomers();
  }, [can.pos]);

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

  /**
   * One normalized haystack per row, rebuilt only when the list changes. Typing
   * used to re-lowercase every field of every row on every keystroke, and
   * `c.name.toLowerCase()` threw on a customer stored without a name.
   */
  const productIndex = useMemo(
    () => products.map((p) => ({ product: p, doc: buildSearch(p.name, p.model, p.sku, p.barcode) })),
    [products]
  );

  const filteredProducts = useMemo(
    () =>
      productIndex
        .filter(
          ({ product, doc }) =>
            (categoryFilter === 'all' || product.category === categoryFilter) &&
            matchesSearch(doc, search)
        )
        .map(({ product }) => product),
    [productIndex, categoryFilter, search]
  );

  const customerIndex = useMemo(
    () => customers.map((c) => ({ customer: c, doc: buildSearch(c.name, c.phone) })),
    [customers]
  );

  // An empty picker still needs something to tap, so it shows the first eight;
  // a typed query shows every match.
  const filteredCustomers = useMemo(
    () =>
      customerIndex
        .filter(({ doc }) => matchesSearch(doc, customerSearch))
        .slice(0, customerSearch.trim() ? undefined : 8)
        .map(({ customer }) => customer),
    [customerIndex, customerSearch]
  );

  const handleProductPress = (product: PhoneModel) => {
    if (product.stock <= 0) {
      Alert.alert(t('common.outOfStock', 'Out of Stock'), t('pos.outOfStockBody', '{{name}} has 0 available units.', { name: product.name }));
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
          Alert.alert(t('pos.scannedToCart', 'Scanned to Cart'), t('pos.scannedToCardBody', '{{name}} {{model}} added to cart.', { name: matched.name, model: matched.model }));
        } else {
          Alert.alert(t('pos.productNotFound', 'Product Not Found'), t('pos.productNotFoundBody', 'No product matching SKU/Barcode: {{code}}', { code: scannedCode }));
        }
      },
    });
  };

  const handleCreateCustomer = async () => {
    if (!newCustomerName.trim() || !newCustomerPhone.trim()) {
      Alert.alert(t('pos.requiredFields', 'Required Fields'), t('pos.requiredFieldsBody', 'Please enter customer name and phone number.'));
      return;
    }
    setIsSavingCustomer(true);
    try {
      await addCustomer(newCustomerName.trim(), newCustomerPhone.trim());
      setIsCustomerPickerOpen(false);
      setIsAddingNewCustomer(false);
      setNewCustomerName('');
      setNewCustomerPhone('');
      Vibration.vibrate(40);
    } catch (err: any) {
      Alert.alert(t('common.error', 'Error'), err.message || t('pos.createCustomerFailed', 'Failed to create customer.'));
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
      Alert.alert(t('pos.checkoutFailedTitle', 'Checkout Failed'), err.message || t('pos.checkoutFailed', 'Could not complete sale.'));
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
    Linking.openURL(url).catch(() => Alert.alert(t('common.error', 'Error'), t('common.whatsappMissing', 'WhatsApp is not installed.')));
  };

  // Guard: the counter is a capability, not a job title. An admin who takes
  // `pos` away from one sales agent should not leave the till on their screen.
  if (!can.pos) {
    return (
      <View style={styles.restrictedContainer}>
        <MaterialCommunityIcons name="shield-lock-outline" size={64} color={colors.danger} />
        <Text style={styles.restrictedTitle}>{t('common.accessRestricted', 'Access Restricted')}</Text>
        <Text style={styles.restrictedSub}>
          {t(
            'pos.restrictedBody',
            'Point of Sale needs the selling permission. Ask an administrator to grant it to your profile.'
          )}
        </Text>
        <Button
          mode="contained"
          buttonColor={colors.brand}
          textColor={colors.onBrand}
          style={styles.restrictedButton}
          onPress={() => navigation.navigate('Workbench')}
        >
          {t('pos.returnToWorkbench', 'Return to Workbench')}
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Appbar.Header style={styles.header}>
        <Appbar.Content
          title={t('pos.title', 'Quick POS Sale')}
          subtitle={t('pos.agent', 'Agent: {{name}}', { name: user?.name || t('common.staff', 'Staff') })}
          titleStyle={styles.headerTitle}
          subtitleStyle={styles.headerSub}
        />
        {/* Cart Quick Access in Header */}
        <TouchableOpacity
          style={styles.headerCartBtn}
          onPress={() => {
            if (cart.length > 0) {
              setIsCheckoutOpen(true);
            } else {
              Alert.alert(t('pos.cartEmptyTitle', 'Cart is Empty'), t('pos.cartEmptyBody', 'Select products below to add them to your cart.'));
            }
          }}
        >
          <MaterialCommunityIcons name="cart" size={24} color={colors.onBrand} />
          {totalItems > 0 && (
            <View style={styles.headerCartBadge}>
              <Text style={styles.headerCartBadgeText}>{totalItems}</Text>
            </View>
          )}
        </TouchableOpacity>
        <Appbar.Action icon="barcode-scan" color={colors.onBrand} onPress={handleOpenScanner} />
        <Appbar.Action icon="refresh" color={colors.onBrand} onPress={() => { fetchProducts(); fetchCustomers(); }} />
      </Appbar.Header>

      {/* Search & Camera Scan Bar */}
      <View style={styles.searchRow}>
        <Searchbar
          placeholder={t('pos.searchPlaceholder', 'Search products or SKU...')}
          value={search}
          onChangeText={setSearch}
          style={styles.searchbar}
          inputStyle={styles.searchInput}
          elevation={0}
        />
        <TouchableOpacity style={styles.cameraBtn} onPress={handleOpenScanner}>
          <MaterialCommunityIcons name="camera" size={20} color={colors.onBrand} />
        </TouchableOpacity>
      </View>

      {/* Category Pills */}
      <View style={styles.categoriesWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.categoryScroll}
        >
          {CATEGORIES.map(cat => {
            const active = categoryFilter === cat.id;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[styles.categoryChip, active && styles.categoryChipActive]}
                onPress={() => setCategoryFilter(cat.id)}
              >
                <MaterialCommunityIcons
                  name={cat.icon as any}
                  size={15}
                  color={active ? colors.onBrand : colors.textSecondary}
                />
                <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                  {t(cat.labelKey, cat.fallback)}
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
            <View style={styles.flexOne}>
              <View style={styles.attachedNameRow}>
                <MaterialCommunityIcons name="account-check" size={16} color={colors.success} />
                <Text style={styles.attachedName}>{selectedCustomer.name}</Text>
              </View>
              <Text style={styles.attachedPhone}>{selectedCustomer.phone}</Text>
              <View style={styles.debtPillRow}>
                {(selectedCustomer.totalDebt || 0) > 0 ? (
                  <View style={styles.debtBadge}>
                    <Text style={styles.debtBadgeText}>
                      {t('pos.debtBadge', 'Debt: {{amount}} DA', { amount: selectedCustomer.totalDebt })}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.cleanCreditBadge}>
                    <Text style={styles.cleanCreditText}>{t('pos.cleanCredit', 'Clean Credit')}</Text>
                  </View>
                )}
                {selectedCustomer.creditLimit ? (
                  <Text style={styles.creditLimitText}>
                    {t('pos.creditLimit', 'Limit: {{amount}} DA', { amount: selectedCustomer.creditLimit })}
                  </Text>
                ) : null}
              </View>
            </View>
            <TouchableOpacity onPress={() => setSelectedCustomer(null)}>
              <MaterialCommunityIcons name="close-circle" size={20} color={colors.textFaint} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.selectCustomerBtn} onPress={() => setIsCustomerPickerOpen(true)}>
            <MaterialCommunityIcons name="account-plus-outline" size={16} color={colors.brand} />
            <Text style={styles.selectCustomerText}>{t('pos.attachCustomer', 'Attach Customer (Optional)')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Product List */}
      {isLoading && products.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      ) : (
        <FlatList
          data={filteredProducts}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const inCart = cart.find(c => c.product.id === item.id);
            const isOutOfStock = item.stock <= 0;
            const stock = isOutOfStock ? stockStatusColors.out_of_stock : stockStatusColors.in_stock;
            return (
              <View style={[styles.productCard, isOutOfStock && styles.productCardDisabled]}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.productInfo}
                  onPress={() => handleProductPress(item)}
                >
                  <Text style={styles.productName}>{item.name}</Text>
                  <Text style={styles.productModel} numberOfLines={1}>
                    {item.model} · {t('pos.sku', 'SKU: {{sku}}', { sku: item.sku || '—' })}
                  </Text>
                  <View style={styles.productMetaRow}>
                    <Text style={styles.productPrice}>{item.price} DA</Text>
                    <View style={[styles.stockBadge, { backgroundColor: stock.tint }]}>
                      <Text style={[styles.stockBadgeText, { color: stock.ink }]}>
                        {isOutOfStock
                          ? t('common.outOfStock', 'Out of stock')
                          : t('pos.inStockCount', '{{n}} in stock', { n: item.stock })}
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
                        <MaterialCommunityIcons name="minus" size={15} color={colors.onBrand} />
                      </TouchableOpacity>
                      <Text style={styles.stepperQtyText}>{inCart.quantity}</Text>
                      <TouchableOpacity
                        style={styles.stepperBtn}
                        onPress={() => {
                          if (inCart.quantity >= item.stock) {
                            Alert.alert(t('pos.maxStockTitle', 'Max Stock'), t('pos.maxStockBody', 'Only {{n}} unit(s) available.', { n: item.stock }));
                            return;
                          }
                          updateQuantity(item.id, inCart.quantity + 1);
                        }}
                      >
                        <MaterialCommunityIcons name="plus" size={15} color={colors.onBrand} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      disabled={isOutOfStock}
                      style={[styles.addBtn, isOutOfStock && styles.addBtnDisabled]}
                      onPress={() => handleProductPress(item)}
                    >
                      <MaterialCommunityIcons
                        name="plus"
                        size={18}
                        color={isOutOfStock ? colors.borderStrong : colors.brand}
                      />
                      <Text style={[styles.addBtnText, isOutOfStock && styles.addBtnTextDisabled]}>
                        {t('common.add', 'Add')}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="package-variant" size={48} color={colors.borderStrong} />
              <Text style={styles.emptyText}>{t('pos.noProducts', 'No products found')}</Text>
            </View>
          }
        />
      )}

      {/* Prominent Checkout Floating / Pinned Action Bar */}
      {cart.length > 0 && (
        <View style={styles.bottomBar}>
          <View style={styles.bottomBarLeft}>
            <View style={styles.cartIconBadge}>
              <MaterialCommunityIcons name="cart" size={18} color={colors.onBrand} />
              <Text style={styles.cartIconBadgeText}>{totalItems}</Text>
            </View>
            <View>
              <Text style={styles.bottomBarItems}>
                {totalItems > 1
                  ? t('pos.itemsInCart', '{{n}} items in cart', { n: totalItems })
                  : t('pos.itemInCart', '{{n}} item in cart', { n: totalItems })}
              </Text>
              <Text style={styles.bottomBarTotal}>{subtotal.toLocaleString()} DA</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.checkoutBtn}
            activeOpacity={0.85}
            onPress={() => setIsCheckoutOpen(true)}
          >
            <Text style={styles.checkoutBtnText}>{t('pos.checkout', 'Checkout')}</Text>
            <MaterialCommunityIcons name="arrow-right-circle" size={20} color={colors.onBrand} />
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
              <Text style={styles.modalTitle}>{t('pos.checkoutTitle', 'Checkout Sale')}</Text>
              <TouchableOpacity onPress={() => setIsCheckoutOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.checkoutScroll}
            >
              {cart.map(item => (
                <View key={item.product.id} style={styles.cartRow}>
                  <View style={styles.flexOne}>
                    <Text style={styles.cartRowName}>{item.product.name} {item.product.model}</Text>
                    <Text style={styles.cartRowPrice}>
                      {t('pos.priceEach', '{{price}} DA each', { price: item.product.price })}
                    </Text>
                  </View>
                  <View style={styles.qtyControlRow}>
                    <TouchableOpacity
                      style={styles.qtyBtn}
                      onPress={() => updateQuantity(item.product.id, item.quantity - 1)}
                    >
                      <MaterialCommunityIcons name="minus" size={16} color={colors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.qtyVal}>{item.quantity}</Text>
                    <TouchableOpacity
                      style={styles.qtyBtn}
                      onPress={() => updateQuantity(item.product.id, item.quantity + 1)}
                    >
                      <MaterialCommunityIcons name="plus" size={16} color={colors.textPrimary} />
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
              <View style={styles.discountHeaderLeft}>
                <MaterialCommunityIcons name="tag-outline" size={18} color={colors.brand} />
                <Text style={styles.discountHeaderLabel}>{t('pos.applyDiscount', 'Apply Discount')}</Text>
                {calculatedDiscount > 0 && (
                  <View style={styles.appliedDiscountBadge}>
                    <Text style={styles.appliedDiscountBadgeText}>
                      {t(
                        'pos.discountApplied',
                        '-{{amount}} DA ({{mode}})',
                        {
                          amount: calculatedDiscount.toLocaleString(),
                          mode: discountType === 'percent' ? `${parsedDiscount}%` : t('pos.flatShort', 'Flat'),
                        }
                      )}
                    </Text>
                  </View>
                )}
              </View>
              <MaterialCommunityIcons
                name={showDiscountSection ? 'chevron-up' : 'chevron-down'}
                size={22}
                color={colors.textMuted}
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
                      {t('pos.percentMode', 'Percentage (%)')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.discountTypeBtn, discountType === 'flat' && styles.discountTypeBtnActive]}
                    onPress={() => setDiscountType('flat')}
                  >
                    <Text style={[styles.discountTypeBtnText, discountType === 'flat' && styles.discountTypeBtnTextActive]}>
                      {t('pos.flatMode', 'Flat (DA)')}
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
                          {val === 0
                            ? t('common.none', 'None')
                            : discountType === 'percent'
                              ? `${val}%`
                              : `${val} DA`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Custom Discount Input */}
                <View style={styles.discountInputRow}>
                  <TextInput
                    label={discountType === 'percent' ? t('pos.discountPercent', 'Discount %') : t('pos.discountFlat', 'Discount DA')}
                    value={discountValue}
                    onChangeText={setDiscountValue}
                    keyboardType="numeric"
                    mode="outlined"
                    dense
                    style={styles.discountInput}
                  />
                  {calculatedDiscount > 0 && (
                    <TouchableOpacity
                      onPress={() => {
                        setDiscountValue('');
                        setDiscountReason('');
                      }}
                      style={styles.clearDiscountBtn}
                    >
                      <Text style={styles.clearDiscountBtnText}>{t('common.reset', 'Reset')}</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Optional Discount Note */}
                <TextInput
                  label={t('pos.discountReason', 'Discount Reason / Promo Note (Optional)')}
                  placeholder={t('pos.discountReasonPlaceholder', 'e.g. Loyalty perk, bundle deal...')}
                  value={discountReason}
                  onChangeText={setDiscountReason}
                  mode="outlined"
                  dense
                  style={styles.discountInput}
                />
              </View>
            )}

            {/* Payment Method Selector */}
            <Text style={styles.sectionHeading}>{t('pos.paymentMethod', 'Payment Method')}</Text>
            <View style={styles.paymentMethodsRow}>
              {(['cash', 'card', 'debt'] as PaymentMethod[]).map(method => {
                const active = paymentMethod === method;
                return (
                  <TouchableOpacity
                    key={method}
                    style={[styles.methodChip, active && styles.methodChipActive]}
                    onPress={() => setPaymentMethod(method)}
                  >
                    <MaterialCommunityIcons
                      name={method === 'cash' ? 'cash' : method === 'card' ? 'credit-card-outline' : 'book-open-outline'}
                      size={16}
                      color={active ? colors.onBrand : colors.textSecondary}
                    />
                    <Text style={[styles.methodChipText, active && styles.methodChipTextActive]}>
                      {method === 'cash'
                        ? t('pos.methodCash', 'Cash')
                        : method === 'card'
                          ? t('pos.methodCard', 'Card')
                          : t('pos.methodDebt', 'Debt / Tab')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Live Pricing Summary Rows */}
            <View style={styles.summaryContainer}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>{t('pos.subtotal', 'Subtotal')}</Text>
                <Text style={styles.summaryValue}>{subtotal.toLocaleString()} DA</Text>
              </View>
              {calculatedDiscount > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabelDiscount}>
                    {t('pos.discountRow', 'Discount ({{mode}})', {
                      mode: discountType === 'percent' ? `${parsedDiscount}%` : t('pos.flatShort', 'Flat'),
                    })}
                  </Text>
                  <Text style={styles.summaryValueDiscount}>-{calculatedDiscount.toLocaleString()} DA</Text>
                </View>
              )}
              <View style={[styles.summaryRow, styles.totalSummaryRow]}>
                <Text style={styles.totalLabel}>{t('pos.totalDue', 'Total Due')}</Text>
                <Text style={styles.totalAmount}>{finalTotalDue.toLocaleString()} DA</Text>
              </View>
            </View>

              <Button
                mode="contained"
                buttonColor={colors.success}
                textColor={colors.onBrand}
                loading={isSubmitting}
                disabled={isSubmitting}
                onPress={handleConfirmCheckout}
                style={styles.completeSaleBtn}
              >
                {t('pos.completeSale', 'Complete Sale ({{amount}} DA)', { amount: finalTotalDue.toLocaleString() })}
              </Button>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Receipt & Share Modal */}
      <Modal visible={Boolean(completedTx)} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, styles.successSheet]}>
            <MaterialCommunityIcons name="check-circle" size={56} color={colors.success} />
            <Text style={styles.successTitle}>{t('pos.saleSuccess', 'Sale Successful!')}</Text>
            <Text style={styles.successSub}>
              {t(
                'pos.invoiceLine',
                'Invoice #{{id}} · {{total}} DA',
                { id: completedTx?.id.slice(-6) ?? '', total: completedTx?.total ?? 0 }
              )}
            </Text>

            <View style={styles.fullWidth}>
              <TouchableOpacity style={styles.whatsAppBtn} onPress={handleWhatsAppShare}>
                <MaterialCommunityIcons name="whatsapp" size={20} color={colors.onBrand} />
                <Text style={styles.shareBtnText}>{t('pos.shareWhatsapp', 'Share via WhatsApp')}</Text>
              </TouchableOpacity>
            </View>

            <Button
              mode="outlined"
              onPress={() => setCompletedTx(null)}
              style={styles.fullWidth}
            >
              {t('pos.startNewSale', 'Start New Sale')}
            </Button>
          </View>
        </View>
      </Modal>

      {/* Customer Picker Modal */}
      <Modal visible={isCustomerPickerOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {isAddingNewCustomer
                  ? t('pos.newCustomer', 'New Customer')
                  : t('pos.selectCustomer', 'Select Customer')}
              </Text>
              <TouchableOpacity onPress={() => {
                setIsCustomerPickerOpen(false);
                setIsAddingNewCustomer(false);
              }}>
                <MaterialCommunityIcons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {isAddingNewCustomer ? (
              <View style={styles.newCustForm}>
                <TextInput
                  label={t('pos.customerNameLabel', 'Customer Name *')}
                  value={newCustomerName}
                  onChangeText={setNewCustomerName}
                  style={styles.fieldName}
                  mode="outlined"
                />
                <TextInput
                  label={t('pos.customerPhoneLabel', 'Phone Number *')}
                  value={newCustomerPhone}
                  onChangeText={setNewCustomerPhone}
                  keyboardType="phone-pad"
                  style={styles.fieldPhone}
                  mode="outlined"
                />
                <View style={styles.formActionsRow}>
                  <Button
                    mode="outlined"
                    onPress={() => setIsAddingNewCustomer(false)}
                    style={styles.formAction}
                  >
                    {t('pos.backToList', 'Back to List')}
                  </Button>
                  <Button
                    mode="contained"
                    buttonColor={colors.brand}
                    textColor={colors.onBrand}
                    loading={isSavingCustomer}
                    disabled={isSavingCustomer}
                    onPress={handleCreateCustomer}
                    style={styles.formAction}
                  >
                    {t('pos.saveAndAttach', 'Save & Attach')}
                  </Button>
                </View>
              </View>
            ) : (
              <>
                <Searchbar
                  placeholder={t('pos.searchCustomer', 'Search by name or phone...')}
                  value={customerSearch}
                  onChangeText={setCustomerSearch}
                  style={styles.pickerSearch}
                  elevation={0}
                />

                <TouchableOpacity
                  style={styles.quickAddCustomerRow}
                  onPress={() => {
                    setNewCustomerName(customerSearch.trim());
                    setNewCustomerPhone('');
                    setIsAddingNewCustomer(true);
                  }}
                >
                  <MaterialCommunityIcons name="account-plus" size={18} color={colors.brand} />
                  <Text style={styles.quickAddCustomerText}>
                    {customerSearch.trim()
                      ? t('pos.createNamedCustomer', 'Create new customer “{{name}}”', { name: customerSearch.trim() })
                      : t('pos.createCustomer', 'Create new customer')}
                  </Text>
                </TouchableOpacity>

                <FlatList
                  data={filteredCustomers}
                  keyExtractor={item => item.id}
                  style={styles.pickerList}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.customerOption}
                      onPress={() => {
                        setSelectedCustomer(item);
                        setIsCustomerPickerOpen(false);
                      }}
                    >
                      <View style={styles.flexOne}>
                        <Text style={styles.custOptName}>{item.name}</Text>
                        <Text style={styles.custOptPhone}>{item.phone}</Text>
                      </View>
                      {(item.totalDebt || 0) > 0 ? (
                        <View style={styles.custDebtBadge}>
                          <Text style={styles.custDebtBadgeText}>
                            {t('pos.debtBadge', 'Debt: {{amount}} DA', { amount: item.totalDebt })}
                          </Text>
                        </View>
                      ) : (
                        <Text style={styles.custCleanText}>{t('pos.clean', 'Clean')}</Text>
                      )}
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <View style={styles.pickerEmpty}>
                      <Text style={styles.pickerEmptyText}>{t('pos.noCustomersMatch', 'No customers match your search.')}</Text>
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
    backgroundColor: colors.background,
  },
  flexOne: {
    flex: 1,
  },
  fullWidth: {
    width: '100%',
    marginTop: spacing.lg,
  },
  header: {
    backgroundColor: colors.brand,
  },
  headerTitle: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: fontSize.title,
  },
  headerSub: {
    color: ramp.indigo200,
    fontSize: fontSize.label,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  searchbar: {
    flex: 1,
    height: 44,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  searchInput: {
    fontSize: fontSize.bodyStrong,
  },
  cameraBtn: {
    width: 44,
    height: 44,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoriesWrap: {
    paddingVertical: spacing.sm,
  },
  categoryScroll: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  categoryChipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  categoryChipText: {
    fontSize: fontSize.label,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  categoryChipTextActive: {
    color: colors.textInverse,
  },
  customerCardWrap: {
    paddingHorizontal: spacing.md,
    marginBottom: 6,
  },
  selectCustomerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brandSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    gap: 6,
  },
  selectCustomerText: {
    fontSize: fontSize.body,
    color: colors.brand,
    fontWeight: '600',
  },
  attachedCustomerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.successSoft,
  },
  attachedNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  attachedName: {
    fontSize: fontSize.bodyStrong,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  attachedPhone: {
    fontSize: fontSize.label,
    color: colors.textMuted,
  },
  debtPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 3,
  },
  debtBadge: {
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.xs,
  },
  debtBadgeText: {
    color: colors.danger,
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  cleanCreditBadge: {
    backgroundColor: colors.successSoft,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.xs,
  },
  cleanCreditText: {
    color: colors.success,
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  creditLimitText: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: 90,
  },
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  productCardDisabled: {
    opacity: 0.5,
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: fontSize.bodyStrong,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  productModel: {
    fontSize: fontSize.label,
    color: colors.textMuted,
    marginTop: spacing.xxs,
  },
  productMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: spacing.xs,
  },
  productPrice: {
    fontSize: fontSize.bodyStrong,
    fontWeight: '800',
    color: colors.brand,
  },
  stockBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.xs,
  },
  stockBadgeText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  productAction: {
    marginStart: spacing.sm,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  stepperBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperQtyText: {
    color: colors.textInverse,
    fontSize: fontSize.body,
    fontWeight: '800',
    minWidth: 20,
    textAlign: 'center',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.brandBorder,
  },
  addBtnDisabled: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
  },
  addBtnText: {
    color: colors.brand,
    fontSize: fontSize.label,
    fontWeight: '700',
  },
  addBtnTextDisabled: {
    color: colors.borderStrong,
  },
  headerCartBtn: {
    padding: spacing.sm,
    marginEnd: spacing.xs,
  },
  headerCartBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: ramp.red500,
    borderRadius: radius.lg,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  headerCartBadgeText: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: '800',
  },
  bottomBar: {
    backgroundColor: colors.textPrimary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  bottomBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cartIconBadge: {
    backgroundColor: colors.brand,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
  },
  cartIconBadgeText: {
    color: colors.textInverse,
    fontSize: fontSize.body,
    fontWeight: '800',
  },
  bottomBarItems: {
    fontSize: fontSize.caption,
    color: ramp.slate400,
    fontWeight: '600',
  },
  bottomBarTotal: {
    fontSize: fontSize.subtitle,
    fontWeight: '800',
    color: ramp.green500,
  },
  checkoutBtn: {
    backgroundColor: colors.success,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
  checkoutBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyStrong,
    fontWeight: '800',
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
    marginTop: spacing.xxl,
    borderRadius: radius.md,
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
    color: colors.textFaint,
    marginTop: spacing.sm,
    fontSize: fontSize.bodyStrong,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
  },
  successSheet: {
    alignItems: 'center',
    paddingBottom: spacing.xl,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  modalTitle: {
    fontSize: fontSize.subtitle,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  checkoutScroll: {
    paddingBottom: spacing.xxl,
  },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceMuted,
  },
  cartRowName: {
    fontSize: fontSize.bodyStrong,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  cartRowPrice: {
    fontSize: fontSize.label,
    color: colors.textMuted,
  },
  qtyControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  qtyBtn: {
    width: 28,
    height: 28,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyVal: {
    fontSize: fontSize.bodyStrong,
    fontWeight: '700',
    minWidth: 20,
    textAlign: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  sectionHeading: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  paymentMethodsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  methodChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  methodChipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  methodChipText: {
    fontSize: fontSize.label,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  methodChipTextActive: {
    color: colors.textInverse,
  },
  totalLabel: {
    fontSize: fontSize.subtitle,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  totalAmount: {
    fontSize: fontSize.title,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  successTitle: {
    fontSize: fontSize.title,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  successSub: {
    fontSize: fontSize.bodyStrong,
    color: colors.textMuted,
    marginTop: spacing.xxs,
    marginBottom: spacing.lg,
  },
  whatsAppBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.whatsapp,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    gap: spacing.sm,
  },
  shareBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyStrong,
    fontWeight: '700',
  },
  customerOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceMuted,
    gap: spacing.sm,
  },
  custOptName: {
    fontSize: fontSize.bodyStrong,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  custOptPhone: {
    fontSize: fontSize.label,
    color: colors.textMuted,
  },
  newCustForm: {
    paddingVertical: spacing.sm,
  },
  fieldName: {
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
  },
  fieldPhone: {
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
  },
  formActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  formAction: {
    flex: 1,
  },
  pickerSearch: {
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pickerList: {
    maxHeight: 260,
  },
  pickerEmpty: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  pickerEmptyText: {
    color: colors.textFaint,
    fontSize: fontSize.body,
  },
  quickAddCustomerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brandSoft,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  quickAddCustomerText: {
    fontSize: fontSize.body,
    color: colors.brand,
    fontWeight: '700',
    flex: 1,
  },
  custDebtBadge: {
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.xs,
  },
  custDebtBadgeText: {
    color: colors.danger,
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  custCleanText: {
    color: colors.success,
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  discountHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  },
  discountHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  discountHeaderLabel: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: ramp.slate800,
  },
  appliedDiscountBadge: {
    backgroundColor: colors.successSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.xs,
    marginStart: 6,
  },
  appliedDiscountBadgeText: {
    color: colors.success,
    fontSize: fontSize.caption,
    fontWeight: '800',
  },
  discountBox: {
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  discountTypeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  discountTypeBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.xs,
    backgroundColor: colors.border,
  },
  discountTypeBtnActive: {
    backgroundColor: colors.brand,
  },
  discountTypeBtnText: {
    fontSize: fontSize.label,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  discountTypeBtnTextActive: {
    color: colors.textInverse,
    fontWeight: '700',
  },
  presetChipsRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: spacing.md,
  },
  presetChip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  presetChipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  presetChipText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  presetChipTextActive: {
    color: colors.textInverse,
  },
  discountInputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  discountInput: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  clearDiscountBtn: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.xs,
  },
  clearDiscountBtnText: {
    color: colors.danger,
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  summaryContainer: {
    backgroundColor: colors.background,
    padding: 10,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
    marginBottom: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surfaceMuted,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
    gap: spacing.sm,
  },
  summaryLabel: {
    fontSize: fontSize.body,
    color: colors.textMuted,
    fontWeight: '600',
  },
  summaryValue: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  summaryLabelDiscount: {
    fontSize: fontSize.body,
    color: colors.success,
    fontWeight: '700',
  },
  summaryValueDiscount: {
    fontSize: fontSize.body,
    color: colors.success,
    fontWeight: '800',
  },
  totalSummaryRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
  },
  completeSaleBtn: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
  },
});
