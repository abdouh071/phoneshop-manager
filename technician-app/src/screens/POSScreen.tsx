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
import { usePosStore } from '../store/posStore';
import { useAuthStore } from '../store/authStore';
import { RoleBottomNav } from '../components/RoleBottomNav';
import type { PhoneModel, PaymentMethod, SaleTransaction, Customer } from '../types';

export const POSScreen = ({ navigation }: any) => {
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

  useEffect(() => {
    fetchProducts();
    fetchCustomers();
  }, []);

  const { subtotal, totalItems } = getCartTotal();

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
        amountPaid: subtotal,
        customer: selectedCustomer,
      });
      setIsCheckoutOpen(false);
      setCompletedTx(tx);
      Vibration.vibrate([0, 50, 50, 100]);
    } catch (err: any) {
      Alert.alert('Checkout Failed', err.message || 'Could not complete sale.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const buildReceiptText = (tx: SaleTransaction): string => {
    const lines = [
      `🧾 *PhoneShop Pro - Sales Receipt*`,
      `Invoice: #${tx.id.slice(-6)}`,
      `Date: ${new Date(tx.date).toLocaleString()}`,
      `Customer: ${tx.customerName || 'Walk-in'}`,
      `─────────────────────────`,
      ...tx.items.map(i => `• ${i.product.name} x${i.quantity} — ${i.product.price * i.quantity} DA`),
      `─────────────────────────`,
      `Total: *${tx.total} DA*`,
      `Payment: ${tx.payments?.[0]?.method.toUpperCase() || 'CASH'}`,
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

  return (
    <View style={styles.container}>
      <Appbar.Header style={styles.header}>
        <Appbar.Content title="Quick POS Sale" subtitle={`Agent: ${user?.name || 'Staff'}`} titleStyle={styles.headerTitle} subtitleStyle={styles.headerSub} />
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
              <TouchableOpacity
                activeOpacity={0.7}
                style={[styles.productCard, isOutOfStock && styles.productCardDisabled]}
                onPress={() => handleProductPress(item)}
              >
                <View style={styles.productInfo}>
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
                </View>
                <View style={styles.productAction}>
                  {inCart ? (
                    <View style={styles.cartQtyBadge}>
                      <Text style={styles.cartQtyText}>x{inCart.quantity}</Text>
                    </View>
                  ) : (
                    <MaterialCommunityIcons name="plus-circle" size={28} color={isOutOfStock ? '#cbd5e1' : '#4f46e5'} />
                  )}
                </View>
              </TouchableOpacity>
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

      {/* Bottom Cart Bar */}
      {cart.length > 0 && (
        <View style={styles.bottomBar}>
          <View>
            <Text style={styles.bottomBarItems}>{totalItems} item{totalItems > 1 ? 's' : ''}</Text>
            <Text style={styles.bottomBarTotal}>{subtotal} DA</Text>
          </View>
          <Button
            mode="contained"
            buttonColor="#16a34a"
            textColor="#ffffff"
            icon="cart-check"
            onPress={() => setIsCheckoutOpen(true)}
            style={styles.checkoutBtn}
          >
            Review & Pay
          </Button>
        </View>
      )}

      {/* Role Navigation Bar */}
      <RoleBottomNav currentRoute="POS" navigation={navigation} />

      {/* Checkout Modal */}
      <Modal visible={isCheckoutOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Checkout Sale</Text>
              <TouchableOpacity onPress={() => setIsCheckoutOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 220 }}>
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
            </ScrollView>

            <View style={styles.divider} />

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

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total Due:</Text>
              <Text style={styles.totalAmount}>{subtotal} DA</Text>
            </View>

            <Button
              mode="contained"
              buttonColor="#16a34a"
              loading={isSubmitting}
              disabled={isSubmitting}
              onPress={handleConfirmCheckout}
              style={{ marginTop: 12, paddingVertical: 4 }}
            >
              Complete Sale ({subtotal} DA)
            </Button>
          </View>
        </View>
      </Modal>

      {/* Receipt & Share Modal */}
      <Modal visible={Boolean(completedTx)} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { alignItems: 'center' }]}>
            <MaterialCommunityIcons name="check-circle" size={56} color="#16a34a" />
            <Text style={styles.successTitle}>Sale Successful!</Text>
            <Text style={styles.successSub}>Invoice #{completedTx?.id.slice(-6)} · {completedTx?.total} DA</Text>

            <View style={styles.shareButtonsRow}>
              <TouchableOpacity style={styles.whatsAppBtn} onPress={handleWhatsAppShare}>
                <MaterialCommunityIcons name="whatsapp" size={20} color="#ffffff" />
                <Text style={styles.shareBtnText}>WhatsApp</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.generalShareBtn} onPress={handleGeneralShare}>
                <MaterialCommunityIcons name="share-variant" size={20} color="#ffffff" />
                <Text style={styles.shareBtnText}>Share / SMS</Text>
              </TouchableOpacity>
            </View>

            <Button
              mode="outlined"
              onPress={() => setCompletedTx(null)}
              style={{ width: '100%', marginTop: 16 }}
            >
              Start New Sale
            </Button>
          </View>
        </View>
      </Modal>

      {/* Customer Picker Modal */}
      <Modal visible={isCustomerPickerOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
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
  cartQtyBadge: {
    backgroundColor: '#4f46e5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  cartQtyText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 8,
  },
  bottomBarItems: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  bottomBarTotal: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  checkoutBtn: {
    borderRadius: 10,
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
});
