import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  Alert,
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
  FAB,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  collection,
  query,
  onSnapshot,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuthStore } from '../store/authStore';
import { usePosStore } from '../store/posStore';
import { activityLogService } from '../services/activityLogService';
import { RoleBottomNav } from '../components/RoleBottomNav';
import type { PhoneModel, ProductCategory, StockStatus } from '../types';

export const InventoryScreen = ({ navigation }: any) => {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { addToCart } = usePosStore();

  const [products, setProducts] = useState<PhoneModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Stock Adjustment Modal
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [targetProduct, setTargetProduct] = useState<PhoneModel | null>(null);
  const [stockDelta, setStockDelta] = useState<number>(0);
  const [exactStockInput, setExactStockInput] = useState<string>('');
  const [adjustReason, setAdjustReason] = useState<string>('Restock / Shipment Arrival');
  const [isUpdatingStock, setIsUpdatingStock] = useState(false);

  // Add Product Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newProdName, setNewProdName] = useState('');
  const [newProdModel, setNewProdModel] = useState('');
  const [newProdCategory, setNewProdCategory] = useState<ProductCategory>('accessory');
  const [newProdPrice, setNewProdPrice] = useState('');
  const [newProdCostPrice, setNewProdCostPrice] = useState('');
  const [newProdStock, setNewProdStock] = useState('1');
  const [newProdThreshold, setNewProdThreshold] = useState('2');
  const [newProdSku, setNewProdSku] = useState('');
  const [newProdBarcode, setNewProdBarcode] = useState('');
  const [isSavingNewProduct, setIsSavingNewProduct] = useState(false);

  // Quick Edit Price / Details Modal
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<PhoneModel | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editCostPrice, setEditCostPrice] = useState('');
  const [editThreshold, setEditThreshold] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  useEffect(() => {
    if (user?.role === 'repair_agent') {
      navigation.replace('Workbench');
      return;
    }

    // Subscribe to Firestore 'inventory' collection in real-time
    const q = query(collection(db, 'inventory'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: PhoneModel[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as PhoneModel);
        });

        // Sort alphabetically by name
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setProducts(list);
        setIsLoading(false);
      },
      (err) => {
        console.warn('[InventoryScreen] Fetch error:', err);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.role]);

  // Inventory KPI metrics
  const metrics = useMemo(() => {
    let totalItems = 0;
    let inStockCount = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let totalValuation = 0;

    products.forEach((p) => {
      const stock = p.stock || 0;
      totalItems += stock;
      totalValuation += stock * (p.price || 0);

      const threshold = p.lowStockThreshold ?? 1;
      if (stock === 0) {
        outOfStockCount++;
      } else if (stock <= threshold) {
        lowStockCount++;
      } else {
        inStockCount++;
      }
    });

    return {
      totalProducts: products.length,
      totalItems,
      inStockCount,
      lowStockCount,
      outOfStockCount,
      totalValuation,
    };
  }, [products]);

  // Filtered products list
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (selectedCategory === 'low_stock_only') {
        const threshold = p.lowStockThreshold ?? 1;
        if (p.stock > threshold) return false;
      } else if (selectedCategory !== 'all' && p.category !== selectedCategory) {
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
  }, [products, selectedCategory, search]);

  // Barcode scanner integration
  const handleOpenScanner = () => {
    navigation.navigate('Scanner', {
      onScan: (scannedCode: string) => {
        const clean = scannedCode.trim().toLowerCase();
        setSearch(scannedCode.trim());
        const matched = products.find(
          (p) =>
            p.sku?.toLowerCase() === clean ||
            p.barcode?.toLowerCase() === clean ||
            p.id.toLowerCase() === clean
        );
        if (matched) {
          Vibration.vibrate(50);
          setTargetProduct(matched);
          setStockDelta(0);
          setExactStockInput(matched.stock.toString());
          setIsAdjustModalOpen(true);
        } else {
          Alert.alert('Scanned', `Barcode "${scannedCode}" filtered in inventory.`);
        }
      },
    });
  };

  // Open Quick Stock Adjust Modal
  const openStockAdjustModal = (product: PhoneModel) => {
    setTargetProduct(product);
    setStockDelta(0);
    setExactStockInput(product.stock.toString());
    setAdjustReason('Restock / Shipment Arrival');
    setIsAdjustModalOpen(true);
  };

  // Submit Stock Adjustment
  const handleConfirmStockAdjust = async () => {
    if (!targetProduct) return;
    setIsUpdatingStock(true);
    try {
      let newStock = targetProduct.stock + stockDelta;
      if (exactStockInput.trim() !== '') {
        const parsed = parseInt(exactStockInput, 10);
        if (!isNaN(parsed) && parsed >= 0) {
          newStock = parsed;
        }
      }
      newStock = Math.max(0, newStock);

      const threshold = targetProduct.lowStockThreshold ?? 1;
      const stockStatus: StockStatus =
        newStock === 0
          ? 'out_of_stock'
          : newStock <= threshold
          ? 'low_stock'
          : 'in_stock';

      await updateDoc(doc(db, 'inventory', targetProduct.id), {
        stock: newStock,
        stockStatus,
        updatedAt: new Date().toISOString(),
      });

      // Log activity
      await activityLogService.log(
        'inventory',
        `Adjusted stock for ${targetProduct.name} (${targetProduct.stock} -> ${newStock}): ${adjustReason}`,
        {
          entityId: targetProduct.id,
          entityType: 'product',
          userName: user?.name || 'Staff',
          userId: user?.id,
        }
      );

      Vibration.vibrate(40);
      setIsAdjustModalOpen(false);
      setTargetProduct(null);
    } catch (err: any) {
      Alert.alert('Adjustment Failed', err.message || 'Could not update stock.');
    } finally {
      setIsUpdatingStock(false);
    }
  };

  // Quick Add Product to POS Cart
  const handleAddToCart = (product: PhoneModel) => {
    if (product.stock <= 0) {
      Alert.alert('Out of Stock', 'This product has 0 units available.');
      return;
    }
    addToCart(product, 1);
    Vibration.vibrate(30);
    Alert.alert(
      'Added to Cart',
      `${product.name} added to cart. Tap POS to complete the sale.`,
      [
        { text: 'Keep Browsing' },
        { text: 'Go to POS', onPress: () => navigation.navigate('POS') },
      ]
    );
  };

  // Save New Product
  const handleSaveNewProduct = async () => {
    if (!newProdName.trim() || !newProdPrice.trim()) {
      Alert.alert('Missing Info', 'Please enter at least a product name and selling price.');
      return;
    }

    setIsSavingNewProduct(true);
    try {
      const price = parseFloat(newProdPrice) || 0;
      const costPrice = parseFloat(newProdCostPrice) || 0;
      const stock = parseInt(newProdStock, 10) || 0;
      const threshold = parseInt(newProdThreshold, 10) || 1;
      const stockStatus: StockStatus =
        stock === 0 ? 'out_of_stock' : stock <= threshold ? 'low_stock' : 'in_stock';

      const sku = newProdSku.trim() || `SKU-${Date.now().toString().slice(-6)}`;

      const newProductData = {
        name: newProdName.trim(),
        model: newProdModel.trim() || '',
        category: newProdCategory,
        price,
        costPrice,
        stock,
        lowStockThreshold: threshold,
        stockStatus,
        sku,
        barcode: newProdBarcode.trim() || sku,
        createdAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, 'inventory'), newProductData);

      await activityLogService.log(
        'inventory',
        `Added new inventory product: ${newProductData.name} (${stock} units @ ${price} DA)`,
        {
          entityId: docRef.id,
          entityType: 'product',
          userName: user?.name,
          userId: user?.id,
        }
      );

      Vibration.vibrate([0, 40, 40, 80]);
      setIsAddModalOpen(false);
      // Reset form
      setNewProdName('');
      setNewProdModel('');
      setNewProdPrice('');
      setNewProdCostPrice('');
      setNewProdStock('1');
      setNewProdThreshold('2');
      setNewProdSku('');
      setNewProdBarcode('');

      Alert.alert('Product Created', `${newProductData.name} added to inventory.`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not save product.');
    } finally {
      setIsSavingNewProduct(false);
    }
  };

  // Quick Edit Price / Threshold
  const handleOpenEditModal = (product: PhoneModel) => {
    setEditProduct(product);
    setEditPrice(product.price.toString());
    setEditCostPrice((product.costPrice || 0).toString());
    setEditThreshold((product.lowStockThreshold || 1).toString());
    setIsEditModalOpen(true);
  };

  const handleSaveEditProduct = async () => {
    if (!editProduct) return;
    setIsSavingEdit(true);
    try {
      const price = parseFloat(editPrice) || editProduct.price;
      const costPrice = parseFloat(editCostPrice) || 0;
      const threshold = parseInt(editThreshold, 10) || 1;
      const stockStatus: StockStatus =
        editProduct.stock === 0
          ? 'out_of_stock'
          : editProduct.stock <= threshold
          ? 'low_stock'
          : 'in_stock';

      await updateDoc(doc(db, 'inventory', editProduct.id), {
        price,
        costPrice,
        lowStockThreshold: threshold,
        stockStatus,
        updatedAt: new Date().toISOString(),
      });

      Vibration.vibrate(30);
      setIsEditModalOpen(false);
      setEditProduct(null);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update details.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const CATEGORY_TABS = [
    { id: 'all', label: 'All', icon: 'apps' },
    { id: 'low_stock_only', label: '⚠️ Low Stock', icon: 'alert' },
    { id: 'smartphone', label: 'Phones', icon: 'cellphone' },
    { id: 'accessory', label: 'Accessories', icon: 'headphones' },
    { id: 'tablet', label: 'Tablets', icon: 'tablet' },
    { id: 'repair_part', label: 'Parts', icon: 'cog' },
  ];

  const ADJUST_REASONS = [
    'Restock / Shipment Arrival',
    'Customer Return / Exchange',
    'Inventory Count Correction',
    'Damaged / Defective Stock',
    'Lost / Shrinkage',
  ];

  if (user?.role === 'repair_agent') {
    return (
      <View style={styles.restrictedContainer}>
        <MaterialCommunityIcons name="shield-lock-outline" size={64} color="#ef4444" />
        <Text style={styles.restrictedTitle}>Access Restricted</Text>
        <Text style={styles.restrictedSub}>
          Inventory management is restricted to Sales Agents and Administrators.
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
          title="Inventory & Stock"
          subtitle={`${metrics.totalProducts} products · ${metrics.totalItems} units`}
          titleStyle={styles.headerTitle}
          subtitleStyle={styles.headerSub}
        />
        <Appbar.Action icon="barcode-scan" color="#ffffff" onPress={handleOpenScanner} />
        <Appbar.Action icon="plus-box" color="#ffffff" onPress={() => setIsAddModalOpen(true)} />
      </Appbar.Header>

      {/* KPI Cards Horizontal Scroll */}
      <View style={styles.kpiContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kpiScroll}>
          <View style={[styles.kpiCard, { borderColor: '#4f46e5' }]}>
            <Text style={styles.kpiLabel}>Total Units</Text>
            <Text style={[styles.kpiValue, { color: '#4f46e5' }]}>{metrics.totalItems}</Text>
          </View>
          <View style={[styles.kpiCard, { borderColor: '#16a34a' }]}>
            <Text style={styles.kpiLabel}>In Stock</Text>
            <Text style={[styles.kpiValue, { color: '#16a34a' }]}>{metrics.inStockCount}</Text>
          </View>
          <TouchableOpacity
            style={[styles.kpiCard, { borderColor: '#f59e0b' }]}
            onPress={() => setSelectedCategory('low_stock_only')}
          >
            <Text style={styles.kpiLabel}>Low Stock</Text>
            <Text style={[styles.kpiValue, { color: '#d97706' }]}>{metrics.lowStockCount}</Text>
          </TouchableOpacity>
          <View style={[styles.kpiCard, { borderColor: '#ef4444' }]}>
            <Text style={styles.kpiLabel}>Out of Stock</Text>
            <Text style={[styles.kpiValue, { color: '#dc2626' }]}>{metrics.outOfStockCount}</Text>
          </View>
          <View style={[styles.kpiCard, { borderColor: '#0284c7' }]}>
            <Text style={styles.kpiLabel}>Valuation</Text>
            <Text style={[styles.kpiValue, { color: '#0284c7', fontSize: 13 }]}>
              {metrics.totalValuation.toLocaleString()} DA
            </Text>
          </View>
        </ScrollView>
      </View>

      {/* Search Bar */}
      <View style={styles.searchRow}>
        <Searchbar
          placeholder="Search name, model, barcode..."
          value={search}
          onChangeText={setSearch}
          style={styles.searchbar}
        />
      </View>

      {/* Category Pills */}
      <View style={styles.categoriesRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 6 }}>
          {CATEGORY_TABS.map((tab) => {
            const isActive = selectedCategory === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.catChip, isActive && styles.catChipActive]}
                onPress={() => setSelectedCategory(tab.id)}
              >
                <Text style={[styles.catChipText, isActive && styles.catChipTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Product List */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4f46e5" />
          <Text style={{ marginTop: 12, color: '#64748b' }}>Loading inventory...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredProducts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const threshold = item.lowStockThreshold ?? 1;
            const isOut = item.stock <= 0;
            const isLow = !isOut && item.stock <= threshold;

            return (
              <Card style={styles.productCard}>
                <Card.Content>
                  <View style={styles.productCardHeader}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={styles.productName}>{item.name}</Text>
                      {Boolean(item.model) && <Text style={styles.productModel}>{item.model}</Text>}
                      <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                        <Text style={styles.skuText}>SKU: {item.sku || 'N/A'}</Text>
                        {Boolean(item.barcode) && <Text style={styles.skuText}>· {item.barcode}</Text>}
                      </View>
                    </View>

                    {/* Stock Badge */}
                    <View
                      style={[
                        styles.stockBadge,
                        isOut ? styles.stockBadgeOut : isLow ? styles.stockBadgeLow : styles.stockBadgeIn,
                      ]}
                    >
                      <Text
                        style={[
                          styles.stockBadgeText,
                          isOut ? { color: '#dc2626' } : isLow ? { color: '#d97706' } : { color: '#16a34a' },
                        ]}
                      >
                        {isOut ? 'OUT OF STOCK' : isLow ? `${item.stock} left (Low)` : `${item.stock} in stock`}
                      </Text>
                    </View>
                  </View>

                  {/* Pricing Row */}
                  <View style={styles.productPricingRow}>
                    <View>
                      <Text style={styles.priceLabel}>Selling Price</Text>
                      <Text style={styles.priceValue}>{item.price.toLocaleString()} DA</Text>
                    </View>
                    {Boolean(item.costPrice) && (
                      <View>
                        <Text style={styles.costPriceLabel}>Cost: {item.costPrice.toLocaleString()} DA</Text>
                      </View>
                    )}
                  </View>

                  {/* Quick Action Buttons */}
                  <View style={styles.cardActionsRow}>
                    <TouchableOpacity
                      style={styles.actionChip}
                      onPress={() => handleOpenEditModal(item)}
                    >
                      <MaterialCommunityIcons name="pencil-outline" size={16} color="#475569" />
                      <Text style={styles.actionChipText}>Edit Price</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.actionChip, styles.stockAdjustBtn]}
                      onPress={() => openStockAdjustModal(item)}
                    >
                      <MaterialCommunityIcons name="swap-vertical" size={16} color="#4f46e5" />
                      <Text style={[styles.actionChipText, { color: '#4f46e5', fontWeight: '700' }]}>
                        Adjust Stock
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      disabled={isOut}
                      style={[styles.actionChip, styles.posAddBtn, isOut && { opacity: 0.5 }]}
                      onPress={() => handleAddToCart(item)}
                    >
                      <MaterialCommunityIcons name="cart-plus" size={16} color="#ffffff" />
                      <Text style={[styles.actionChipText, { color: '#ffffff', fontWeight: '700' }]}>
                        Sell in POS
                      </Text>
                    </TouchableOpacity>
                  </View>
                </Card.Content>
              </Card>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons name="package-variant" size={56} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>No Products Found</Text>
              <Text style={styles.emptySub}>
                {search ? 'No products matched your search.' : 'Add your first inventory product below.'}
              </Text>
              <Button
                mode="contained"
                buttonColor="#4f46e5"
                style={{ marginTop: 14 }}
                onPress={() => setIsAddModalOpen(true)}
              >
                + Add Product
              </Button>
            </View>
          }
        />
      )}

      {/* Role Navigation Bar with Insets */}
      <RoleBottomNav currentRoute="Inventory" navigation={navigation} />

      {/* STOCK ADJUSTMENT MODAL */}
      <Modal visible={isAdjustModalOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Adjust Stock Quantity</Text>
                <Text style={styles.modalSub}>
                  {targetProduct?.name} ({targetProduct?.model || ''})
                </Text>
              </View>
              <TouchableOpacity onPress={() => setIsAdjustModalOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <View style={styles.currentStockPill}>
              <Text style={styles.currentStockLabel}>Current Stock:</Text>
              <Text style={styles.currentStockVal}>{targetProduct?.stock ?? 0} units</Text>
            </View>

            {/* Quick Delta Steppers */}
            <Text style={styles.adjustSectionLabel}>Quick Adjust Quantity (+ / -):</Text>
            <View style={styles.quickDeltasRow}>
              {[-10, -5, -1, 1, 5, 10, 25].map((delta) => (
                <TouchableOpacity
                  key={delta}
                  style={[styles.deltaBtn, delta > 0 ? styles.deltaBtnPlus : styles.deltaBtnMinus]}
                  onPress={() => {
                    const current = parseInt(exactStockInput, 10) || targetProduct?.stock || 0;
                    const next = Math.max(0, current + delta);
                    setExactStockInput(next.toString());
                  }}
                >
                  <Text style={[styles.deltaBtnText, delta > 0 ? { color: '#16a34a' } : { color: '#dc2626' }]}>
                    {delta > 0 ? `+${delta}` : delta}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Exact New Stock Input */}
            <TextInput
              label="New Exact Stock Count"
              value={exactStockInput}
              onChangeText={setExactStockInput}
              keyboardType="numeric"
              mode="outlined"
              style={{ backgroundColor: '#ffffff', marginBottom: 12 }}
            />

            {/* Adjustment Reason */}
            <Text style={styles.adjustSectionLabel}>Adjustment Reason:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: 16 }}>
              {ADJUST_REASONS.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[styles.reasonChip, adjustReason === r && styles.reasonChipActive]}
                  onPress={() => setAdjustReason(r)}
                >
                  <Text style={[styles.reasonChipText, adjustReason === r && styles.reasonChipTextActive]}>
                    {r}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Button
              mode="contained"
              buttonColor="#4f46e5"
              loading={isUpdatingStock}
              disabled={isUpdatingStock}
              onPress={handleConfirmStockAdjust}
              style={{ paddingVertical: 4 }}
            >
              Update Stock ({exactStockInput || targetProduct?.stock || 0} units)
            </Button>
          </View>
        </View>
      </Modal>

      {/* ADD NEW PRODUCT MODAL */}
      <Modal visible={isAddModalOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add New Product</Text>
              <TouchableOpacity onPress={() => setIsAddModalOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 380 }}>
              <TextInput
                label="Product Name *"
                placeholder="e.g. iPhone 15 Silicone Case"
                value={newProdName}
                onChangeText={setNewProdName}
                mode="outlined"
                style={{ backgroundColor: '#ffffff', marginBottom: 10 }}
              />

              <TextInput
                label="Model / Variant"
                placeholder="e.g. Midnight Blue / MagSafe"
                value={newProdModel}
                onChangeText={setNewProdModel}
                mode="outlined"
                style={{ backgroundColor: '#ffffff', marginBottom: 10 }}
              />

              {/* Category Picker */}
              <Text style={styles.adjustSectionLabel}>Category:</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {(['accessory', 'smartphone', 'tablet', 'repair_part', 'wearable'] as ProductCategory[]).map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.catPickChip, newProdCategory === cat && styles.catPickChipActive]}
                    onPress={() => setNewProdCategory(cat)}
                  >
                    <Text style={[styles.catPickChipText, newProdCategory === cat && styles.catPickChipTextActive]}>
                      {cat.replace('_', ' ').toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                <TextInput
                  label="Selling Price (DA) *"
                  value={newProdPrice}
                  onChangeText={setNewProdPrice}
                  keyboardType="numeric"
                  mode="outlined"
                  style={{ flex: 1, backgroundColor: '#ffffff' }}
                />
                <TextInput
                  label="Cost Price (DA)"
                  value={newProdCostPrice}
                  onChangeText={setNewProdCostPrice}
                  keyboardType="numeric"
                  mode="outlined"
                  style={{ flex: 1, backgroundColor: '#ffffff' }}
                />
              </View>

              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                <TextInput
                  label="Initial Stock *"
                  value={newProdStock}
                  onChangeText={setNewProdStock}
                  keyboardType="numeric"
                  mode="outlined"
                  style={{ flex: 1, backgroundColor: '#ffffff' }}
                />
                <TextInput
                  label="Low Stock Alert"
                  value={newProdThreshold}
                  onChangeText={setNewProdThreshold}
                  keyboardType="numeric"
                  mode="outlined"
                  style={{ flex: 1, backgroundColor: '#ffffff' }}
                />
              </View>

              <TextInput
                label="Barcode / SKU (Optional)"
                placeholder="Auto-generated if blank"
                value={newProdBarcode}
                onChangeText={setNewProdBarcode}
                mode="outlined"
                style={{ backgroundColor: '#ffffff', marginBottom: 14 }}
              />
            </ScrollView>

            <Button
              mode="contained"
              buttonColor="#16a34a"
              loading={isSavingNewProduct}
              disabled={isSavingNewProduct}
              onPress={handleSaveNewProduct}
              style={{ marginTop: 10, paddingVertical: 4 }}
            >
              Save Product to Stock
            </Button>
          </View>
        </View>
      </Modal>

      {/* QUICK EDIT PRICE MODAL */}
      <Modal visible={isEditModalOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Edit Product Pricing</Text>
                <Text style={styles.modalSub}>{editProduct?.name}</Text>
              </View>
              <TouchableOpacity onPress={() => setIsEditModalOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <TextInput
              label="Selling Price (DA) *"
              value={editPrice}
              onChangeText={setEditPrice}
              keyboardType="numeric"
              mode="outlined"
              style={{ backgroundColor: '#ffffff', marginBottom: 12 }}
            />

            <TextInput
              label="Cost Price (DA)"
              value={editCostPrice}
              onChangeText={setEditCostPrice}
              keyboardType="numeric"
              mode="outlined"
              style={{ backgroundColor: '#ffffff', marginBottom: 12 }}
            />

            <TextInput
              label="Low Stock Alert Threshold"
              value={editThreshold}
              onChangeText={setEditThreshold}
              keyboardType="numeric"
              mode="outlined"
              style={{ backgroundColor: '#ffffff', marginBottom: 16 }}
            />

            <Button
              mode="contained"
              buttonColor="#4f46e5"
              loading={isSavingEdit}
              disabled={isSavingEdit}
              onPress={handleSaveEditProduct}
              style={{ paddingVertical: 4 }}
            >
              Save Changes
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
  kpiContainer: {
    backgroundColor: '#ffffff',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  kpiScroll: {
    paddingHorizontal: 12,
    gap: 8,
  },
  kpiCard: {
    backgroundColor: '#f8fafc',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
    minWidth: 90,
  },
  kpiLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  kpiValue: {
    fontSize: 16,
    fontWeight: '900',
    marginTop: 2,
  },
  searchRow: {
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
  categoriesRow: {
    paddingVertical: 10,
  },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  catChipActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  catChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  catChipTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  productCard: {
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
  productCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
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
  skuText: {
    fontSize: 11,
    color: '#94a3b8',
  },
  stockBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  stockBadgeIn: {
    backgroundColor: '#dcfce7',
  },
  stockBadgeLow: {
    backgroundColor: '#fef3c7',
  },
  stockBadgeOut: {
    backgroundColor: '#fee2e2',
  },
  stockBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  productPricingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    marginBottom: 8,
  },
  priceLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  priceValue: {
    fontSize: 16,
    fontWeight: '900',
    color: '#4f46e5',
  },
  costPriceLabel: {
    fontSize: 11,
    color: '#94a3b8',
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
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
  },
  actionChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  stockAdjustBtn: {
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  posAddBtn: {
    backgroundColor: '#16a34a',
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
    marginBottom: 12,
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
  currentStockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#eef2ff',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  currentStockLabel: {
    fontSize: 13,
    color: '#4f46e5',
    fontWeight: '600',
  },
  currentStockVal: {
    fontSize: 15,
    color: '#4f46e5',
    fontWeight: '800',
  },
  adjustSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  quickDeltasRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  deltaBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
  },
  deltaBtnPlus: {
    backgroundColor: '#dcfce7',
    borderColor: '#bbf7d0',
  },
  deltaBtnMinus: {
    backgroundColor: '#fee2e2',
    borderColor: '#fecaca',
  },
  deltaBtnText: {
    fontSize: 12,
    fontWeight: '800',
  },
  reasonChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  reasonChipActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  reasonChipText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
  },
  reasonChipTextActive: {
    color: '#ffffff',
  },
  catPickChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  catPickChipActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  catPickChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  catPickChipTextActive: {
    color: '#ffffff',
  },
});
