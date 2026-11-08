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
import { commitStockDelta } from '../services/stockService';
import { useAuthStore } from '../store/authStore';
import { usePosStore } from '../store/posStore';
import { activityLogService } from '../services/activityLogService';
import { RoleBottomNav } from '../components/RoleBottomNav';
import { usePermissions } from '../hooks/usePermissions';
import { useTranslation } from 'react-i18next';
import type { PhoneModel, ProductCategory, StockStatus } from '../types';
import { buildSearch, matchesSearch } from '../utils/search';
import { alertCartStockRefusal } from '../utils/cartStockPrompt';
import { findCodeCollisions, resolveProductByCode, codesToShow } from '../utils/productCode';
import { askWhichProduct } from '../utils/productCodePrompt';
import { AdminApprovalSheet, type ApprovalPayload } from '../components/AdminApprovalSheet';
import { colors, fontSize, radius, ramp, spacing, stockStatusColors } from '../theme/tokens';

type InventoryMetrics = {
  totalProducts: number;
  totalItems: number;
  inStockCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalValuation: number;
};

const CATEGORY_TABS = [
  { id: 'all', labelKey: 'common.all', fallback: 'All' },
  { id: 'low_stock_only', labelKey: 'inventory.catLowStock', fallback: 'Low Stock' },
  { id: 'smartphone', labelKey: 'inventory.catPhones', fallback: 'Phones' },
  { id: 'accessory', labelKey: 'inventory.catAccessories', fallback: 'Accessories' },
  { id: 'tablet', labelKey: 'inventory.catTablets', fallback: 'Tablets' },
  { id: 'repair_part', labelKey: 'inventory.catParts', fallback: 'Parts' },
];

/**
 * `label` is the string that lands in the activity log, which the shop reads in
 * one language whatever the phone is set to; only the chip text is translated.
 */
const ADJUST_REASONS = [
  { id: 'restock', label: 'Restock / Shipment Arrival' },
  { id: 'return', label: 'Customer Return / Exchange' },
  { id: 'count', label: 'Inventory Count Correction' },
  { id: 'damaged', label: 'Damaged / Defective Stock' },
  { id: 'shrinkage', label: 'Lost / Shrinkage' },
];

const ADDABLE_CATEGORIES: ProductCategory[] = ['accessory', 'smartphone', 'tablet', 'repair_part', 'wearable'];

const DEFAULT_ADJUST_REASON = ADJUST_REASONS[0].label;

const QUICK_DELTAS = [-10, -5, -1, 1, 5, 10, 25];

type InventoryHeaderProps = {
  metrics: InventoryMetrics;
  search: string;
  onSearchChange: (value: string) => void;
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
};

/**
 * Module-level, and passed to `ListHeaderComponent` as an element. See the note in
 * WorkbenchScreen: an inline arrow here was a new component type on every render,
 * so the search bar remounted and closed the keyboard after one character.
 */
const InventoryHeader = ({
  metrics,
  search,
  onSearchChange,
  selectedCategory,
  onSelectCategory,
}: InventoryHeaderProps) => {
  const { t } = useTranslation();

  const kpis = [
    { key: 'total', label: t('inventory.kpiTotalUnits', 'Total Units'), value: String(metrics.totalItems), ink: colors.brand },
    { key: 'in', label: t('inventory.kpiInStock', 'In Stock'), value: String(metrics.inStockCount), ink: colors.success },
    { key: 'low', label: t('inventory.kpiLowStock', 'Low Stock'), value: String(metrics.lowStockCount), ink: ramp.amber700, onPress: () => onSelectCategory('low_stock_only') },
    { key: 'out', label: t('inventory.kpiOutStock', 'Out of Stock'), value: String(metrics.outOfStockCount), ink: colors.danger },
    { key: 'value', label: t('inventory.kpiValuation', 'Valuation'), value: `${metrics.totalValuation.toLocaleString()} DA`, ink: colors.info },
  ];

  return (
    <>
      <View style={styles.kpiContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.kpiScroll}
        >
          {kpis.map((kpi) => {
            const card = (
              <>
                <Text style={styles.kpiLabel}>{kpi.label}</Text>
                <Text style={[styles.kpiValue, { color: kpi.ink }]} numberOfLines={1}>
                  {kpi.value}
                </Text>
              </>
            );
            return kpi.onPress ? (
              <TouchableOpacity
                key={kpi.key}
                style={[styles.kpiCard, styles.kpiCardAction]}
                activeOpacity={0.7}
                onPress={kpi.onPress}
              >
                {card}
              </TouchableOpacity>
            ) : (
              <View key={kpi.key} style={styles.kpiCard}>
                {card}
              </View>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.searchRow}>
        <Searchbar
          placeholder={t('inventory.searchPlaceholder', 'Search name, model, barcode...')}
          value={search}
          onChangeText={onSearchChange}
          style={styles.searchbar}
          inputStyle={styles.searchInput}
        />
      </View>

      <View style={styles.categoriesRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.categoriesScroll}
        >
          {CATEGORY_TABS.map((tab) => {
            const isActive = selectedCategory === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.catChip, isActive && styles.catChipActive]}
                activeOpacity={0.7}
                onPress={() => onSelectCategory(tab.id)}
              >
                <Text style={[styles.catChipText, isActive && styles.catChipTextActive]}>
                  {t(tab.labelKey, tab.fallback)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </>
  );
};

export const InventoryScreen = ({ navigation }: any) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const can = usePermissions();
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
  const [adjustReason, setAdjustReason] = useState<string>(DEFAULT_ADJUST_REASON);
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
  const [editReason, setEditReason] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isAskingPriceApproval, setIsAskingPriceApproval] = useState(false);
  const [priceGrant, setPriceGrant] = useState<string | null>(null);

  useEffect(() => {
    if (!can.inventory_products) {
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
  }, [can.inventory_products]);

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

  // Filtered products list. The haystack per product is built when the list
  // changes, not on every keystroke.
  const searchableProducts = useMemo(
    () =>
      products.map((product) => ({
        product,
        search: buildSearch(product.name, product.model, product.sku, product.barcode),
      })),
    [products]
  );

  const filteredProducts = useMemo(
    () =>
      searchableProducts
        .filter(({ product, search: haystack }) => {
          if (selectedCategory === 'low_stock_only') {
            const threshold = product.lowStockThreshold ?? 1;
            if (product.stock > threshold) return false;
          } else if (selectedCategory !== 'all' && product.category !== selectedCategory) {
            return false;
          }
          return matchesSearch(haystack, search);
        })
        .map(({ product }) => product),
    [searchableProducts, selectedCategory, search]
  );

  // Barcode scanner integration
  const adjustFromScan = (product: PhoneModel) => {
    Vibration.vibrate(50);
    openStockAdjustModal(product);
  };

  const handleOpenScanner = () => {
    navigation.navigate('Scanner', {
      onScan: (scannedCode: string) => {
        setSearch(scannedCode.trim());
        const result = resolveProductByCode(products, scannedCode);
        if (result.kind === 'unique') {
          adjustFromScan(result.product);
          return;
        }
        if (result.kind === 'ambiguous') {
          askWhichProduct(scannedCode, result.candidates, adjustFromScan);
          return;
        }
        Alert.alert(
          t('inventory.scannedTitle', 'Scanned'),
          t('inventory.scannedBody', 'Barcode "{{code}}" filtered in inventory.', { code: scannedCode })
        );
      },
    });
  };

  // Open Quick Stock Adjust Modal
  const openStockAdjustModal = (product: PhoneModel) => {
    setTargetProduct(product);
    setStockDelta(0);
    setExactStockInput(product.stock.toString());
    setAdjustReason(DEFAULT_ADJUST_REASON);
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

      // Use an atomic delta so a concurrent sale or desktop edit is composed, not
      // overwritten. commitStockDelta reads the server value inside a transaction and
      // applies the signed delta — the same primitive the POS uses at checkout.
      const delta = newStock - targetProduct.stock;
      if (delta !== 0) {
        await commitStockDelta(targetProduct.id, delta);
      }
      // Stamp the timestamp (stockStatus is handled by commitStockDelta).
      await updateDoc(doc(db, 'inventory', targetProduct.id), {
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
      Alert.alert(t('inventory.adjustFailedTitle', 'Adjustment Failed'), err.message || t('inventory.adjustFailed', 'Could not update stock.'));
    } finally {
      setIsUpdatingStock(false);
    }
  };

  // Quick Add Product to POS Cart
  const handleAddToCart = (product: PhoneModel) => {
    const result = addToCart(product, 1);
    if (!result.success) {
      alertCartStockRefusal(result, product.name);
      return;
    }
    Vibration.vibrate(30);
    Alert.alert(
      t('inventory.addedToCart', 'Added to Cart'),
      t('inventory.addedToCartBody', '{{name}} added to cart. Tap POS to complete the sale.', { name: product.name }),
      [
        { text: t('inventory.keepBrowsing', 'Keep Browsing') },
        { text: t('inventory.goToPos', 'Go to POS'), onPress: () => navigation.navigate('POS') },
      ]
    );
  };

  // Save New Product
  const handleSaveNewProduct = async () => {
    if (!newProdName.trim() || !newProdPrice.trim()) {
      Alert.alert(t('inventory.missingInfo', 'Missing Info'), t('inventory.missingInfoBody', 'Please enter at least a product name and selling price.'));
      return;
    }

    // A code on two rows is how one scan ends up adding the wrong product, and this
    // form used to accept it silently — including the barcode defaulting to the sku.
    const sku = newProdSku.trim() || `SKU-${Date.now().toString().slice(-6)}`;
    const barcode = newProdBarcode.trim() || sku;
    const collisions = findCodeCollisions(products, { sku, barcode });
    if (collisions.length > 0) {
      Alert.alert(
        t('inventory.duplicateCodeTitle', 'Code already in use'),
        `${t('inventory.duplicateCodeBody', 'Another product already answers to this code:')} ${collisions.join(' · ')}`
      );
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
        barcode,
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

      Alert.alert(t('inventory.productCreated', 'Product Created'), t('inventory.productCreatedBody', '{{name}} added to inventory.', { name: newProductData.name }));
    } catch (err: any) {
      Alert.alert(t('common.error', 'Error'), err.message || t('inventory.saveProductFailed', 'Could not save product.'));
    } finally {
      setIsSavingNewProduct(false);
    }
  };

  // Quick Edit Price / Threshold
  const isAdmin = user?.role === 'admin';

  const handleOpenEditModal = (product: PhoneModel) => {
    setEditProduct(product);
    setEditPrice(product.price.toString());
    setEditCostPrice((product.costPrice || 0).toString());
    setEditThreshold((product.lowStockThreshold || 1).toString());
    setEditReason('');
    setPriceGrant(null);
    setIsEditModalOpen(true);
  };

  const proposedPrice = editProduct ? parseFloat(editPrice) || editProduct.price : 0;
  const proposedCostPrice = editProduct ? parseFloat(editCostPrice) || 0 : 0;
  const proposedThreshold = editProduct ? parseInt(editThreshold, 10) || 1 : 1;

  // An answer covers the exact numbers it was given for: change one of them after
  // an approval and the technician has to ask again.
  const priceGrantKey = editProduct
    ? `${editProduct.id}|${proposedPrice}|${proposedCostPrice}|${proposedThreshold}`
    : '';
  const priceApproved = priceGrant === priceGrantKey;

  const priceChanges = editProduct
    ? [
        proposedPrice !== editProduct.price &&
          t('inventory.priceDelta', 'price {{from}} → {{to}} DA', { from: editProduct.price, to: proposedPrice }),
        proposedCostPrice !== (editProduct.costPrice || 0) &&
          t('inventory.costDelta', 'cost {{from}} → {{to}} DA', {
            from: editProduct.costPrice || 0,
            to: proposedCostPrice,
          }),
        proposedThreshold !== (editProduct.lowStockThreshold || 1) &&
          t('inventory.thresholdDelta', 'low-stock alert {{from}} → {{to}}', {
            from: editProduct.lowStockThreshold || 1,
            to: proposedThreshold,
          }),
      ].filter((line): line is string => Boolean(line))
    : [];

  /**
   * The shape the counter terminal already renders for `inventory_edit_product`,
   * with the old price kept alongside the new one so an admin can see the move
   * rather than only the destination.
   */
  const priceApprovalPayload: ApprovalPayload = {
    actionType: 'inventory_edit_product',
    actionLabel: t('inventory.priceApprovalLabel', '{{name}} {{model}}: {{oldPrice}} DA → {{newPrice}} DA', {
      name: editProduct?.name ?? '',
      model: editProduct?.model ?? '',
      oldPrice: editProduct?.price ?? 0,
      newPrice: proposedPrice,
    }),
    targetId: editProduct?.id,
    actionData: {
      itemType: 'product',
      productName: editProduct?.name ?? '',
      model: editProduct?.model ?? '',
      sku: editProduct?.sku ?? '',
      category: editProduct?.category ?? '',
      price: proposedPrice,
      costPrice: proposedCostPrice,
      currentStock: editProduct?.stock ?? 0,
      previousPrice: editProduct?.price ?? 0,
      lowStockThreshold: proposedThreshold,
    },
    reason: editReason.trim() || priceChanges.join(' · ') || undefined,
  };

  const applyPriceEdit = async () => {
    if (!editProduct) return;
    setIsSavingEdit(true);
    try {
      const stockStatus: StockStatus =
        editProduct.stock === 0
          ? 'out_of_stock'
          : editProduct.stock <= proposedThreshold
          ? 'low_stock'
          : 'in_stock';

      await updateDoc(doc(db, 'inventory', editProduct.id), {
        price: proposedPrice,
        costPrice: proposedCostPrice,
        lowStockThreshold: proposedThreshold,
        stockStatus,
        updatedAt: new Date().toISOString(),
      });

      Vibration.vibrate(30);
      setIsEditModalOpen(false);
      setEditProduct(null);
      setPriceGrant(null);
    } catch (err: any) {
      Alert.alert(t('common.error', 'Error'), err.message || t('inventory.updateDetailsFailed', 'Failed to update details.'));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleSaveEditProduct = () => {
    if (!editProduct) return;
    // A price list is where money leaves the shop, so a technician's edit is a
    // request until an admin answers it.
    if (isAdmin || priceApproved) {
      void applyPriceEdit();
      return;
    }
    // An admin is asked to answer a change, not a screenful of unchanged numbers.
    if (priceChanges.length === 0) {
      Alert.alert(t('inventory.nothingChanged', 'Nothing to change'), t('inventory.nothingChangedBody', 'The price, cost and alert threshold are already set to these values.'));
      return;
    }
    setIsAskingPriceApproval(true);
  };

  if (!can.inventory_products) {
    return (
      <View style={styles.restrictedContainer}>
        <MaterialCommunityIcons name="shield-lock-outline" size={64} color={colors.danger} />
        <Text style={styles.restrictedTitle}>{t('common.accessRestricted', 'Access Restricted')}</Text>
        <Text style={styles.restrictedSub}>
          {t(
            'inventory.restrictedBody',
            'Stock management needs the inventory permission. Ask an administrator to grant it to your profile.'
          )}
        </Text>
        <Button
          mode="contained"
          buttonColor={colors.brand}
          textColor={colors.onBrand}
          style={styles.restrictedButton}
          onPress={() => navigation.navigate('Workbench')}
        >
          {t('inventory.returnToWorkbench', 'Return to Workbench')}
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <Appbar.Header style={styles.header}>
        <Appbar.Content
          title={t('inventory.title', 'Inventory & Stock')}
          subtitle={t('inventory.subtitle', '{{products}} products · {{units}} units', {
            products: metrics.totalProducts,
            units: metrics.totalItems,
          })}
          titleStyle={styles.headerTitle}
          subtitleStyle={styles.headerSub}
        />
        <Appbar.Action icon="barcode-scan" color={colors.onBrand} onPress={handleOpenScanner} />
        {can.inventory_edit && (
          <Appbar.Action icon="plus-box" color={colors.onBrand} onPress={() => setIsAddModalOpen(true)} />
        )}
      </Appbar.Header>

      {/* Product List */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
          <Text style={styles.loadingText}>{t('inventory.loading', 'Loading inventory...')}</Text>
        </View>
      ) : (
        <FlatList
          data={filteredProducts}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <InventoryHeader
              metrics={metrics}
              search={search}
              onSearchChange={setSearch}
              selectedCategory={selectedCategory}
              onSelectCategory={setSelectedCategory}
            />
          }
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const threshold = item.lowStockThreshold ?? 1;
            const isOut = item.stock <= 0;
            const isLow = !isOut && item.stock <= threshold;
            const stockAppearance = isOut
              ? stockStatusColors.out_of_stock
              : isLow
                ? stockStatusColors.low_stock
                : stockStatusColors.in_stock;
            const codes = codesToShow(item);

            return (
              <Card style={styles.productCard}>
                <Card.Content>
                  <View style={styles.productCardHeader}>
                    <View style={styles.productTitleBlock}>
                      <Text style={styles.productName}>{item.name}</Text>
                      {Boolean(item.model) && <Text style={styles.productModel}>{item.model}</Text>}
                      {codes.length > 0 && (
                        <Text style={styles.skuText} numberOfLines={1}>
                          {codes.map((code) => `${t(`productCode.${code.kind}Label`, { defaultValue: code.kind === 'sku' ? 'SKU' : 'Barcode' })} ${code.value}`).join(' · ')}
                        </Text>
                      )}
                    </View>

                    {/* Stock Badge */}
                    <View
                      style={[
                        styles.stockBadge,
                        { backgroundColor: stockAppearance.tint },
                      ]}
                    >
                      <Text style={[styles.stockBadgeText, { color: stockAppearance.ink }]}>
                        {isOut
                          ? t('common.outOfStock', 'Out of Stock')
                          : isLow
                            ? t('inventory.stockLow', { units: item.stock })
                            : t('inventory.stockIn', { units: item.stock })}
                      </Text>
                    </View>
                  </View>

                  {/* Pricing Row */}
                  <View style={styles.productPricingRow}>
                    <View>
                      <Text style={styles.priceLabel}>{t('inventory.sellingPrice', 'Selling Price')}</Text>
                      <Text style={styles.priceValue}>{item.price.toLocaleString()} DA</Text>
                    </View>
                    {Boolean(item.costPrice) && (
                      <View>
                        <Text style={styles.costPriceLabel}>
                          {t('inventory.costPrice', { price: item.costPrice.toLocaleString() })}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Quick Action Buttons */}
                  <View style={styles.cardActionsRow}>
                    {/* An admin writes the price; anyone else can only ask for it. */}
                    <TouchableOpacity
                      style={styles.actionChip}
                      onPress={() => handleOpenEditModal(item)}
                    >
                      <MaterialCommunityIcons
                        name={isAdmin ? 'pencil-outline' : 'shield-edit-outline'}
                        size={16}
                        color={colors.textSecondary}
                      />
                      <Text style={styles.actionChipText}>
                        {isAdmin
                          ? t('inventory.editPrice', 'Edit Price')
                          : t('inventory.askPriceChange', 'Ask to change price')}
                      </Text>
                    </TouchableOpacity>

                    {can.inventory_edit && (
                      <TouchableOpacity
                        style={styles.actionChip}
                        onPress={() => openStockAdjustModal(item)}
                      >
                        <MaterialCommunityIcons name="swap-vertical" size={16} color={colors.textSecondary} />
                        <Text style={styles.actionChipText}>
                          {t('inventory.adjustStock', 'Adjust Stock')}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {can.pos && (
                      <TouchableOpacity
                        disabled={isOut}
                        style={[styles.actionChip, styles.posAddBtn, isOut && styles.actionChipDisabled]}
                        onPress={() => handleAddToCart(item)}
                      >
                        <MaterialCommunityIcons name="cart-plus" size={16} color={colors.onBrand} />
                        <Text style={[styles.actionChipText, styles.actionChipTextInverse]}>
                          {t('inventory.sellInPos', 'Sell in POS')}
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
              <MaterialCommunityIcons name="package-variant" size={56} color={colors.borderStrong} />
              <Text style={styles.emptyTitle}>{t('inventory.noProducts', 'No Products Found')}</Text>
              <Text style={styles.emptySub}>
                {search
                  ? t('inventory.noProductsSearch', 'No products matched your search.')
                  : t('inventory.addFirstProduct', 'Add your first inventory product below.')}
              </Text>
              {can.inventory_edit && (
                <Button
                  mode="contained"
                  buttonColor={colors.brand}
                  textColor={colors.onBrand}
                  style={styles.emptyButton}
                  icon="plus"
                  onPress={() => setIsAddModalOpen(true)}
                >
                  {t('inventory.addProduct', 'Add Product')}
                </Button>
              )}
            </View>
          }
        />
      )}

      {/* Role Navigation Bar with Insets */}
      <RoleBottomNav currentRoute="Inventory" navigation={navigation} />

      {/* STOCK ADJUSTMENT MODAL */}
      <Modal visible={isAdjustModalOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{t('inventory.adjust.title', 'Adjust Stock Quantity')}</Text>
                <Text style={styles.modalSub}>
                  {targetProduct?.model
                    ? `${targetProduct.name} (${targetProduct.model})`
                    : targetProduct?.name}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setIsAdjustModalOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.currentStockPill}>
              <Text style={styles.currentStockLabel}>{t('inventory.adjust.currentStock', 'Current Stock:')}</Text>
              <Text style={styles.currentStockVal}>
                {t('inventory.adjust.units', { units: targetProduct?.stock ?? 0 })}
              </Text>
            </View>

            {/* Quick Delta Steppers */}
            <Text style={styles.adjustSectionLabel}>
              {t('inventory.adjust.quick', 'Quick Adjust Quantity (+ / -):')}
            </Text>
            <View style={styles.quickDeltasRow}>
              {QUICK_DELTAS.map((delta) => (
                <TouchableOpacity
                  key={delta}
                  style={[styles.deltaBtn, delta > 0 ? styles.deltaBtnPlus : styles.deltaBtnMinus]}
                  onPress={() => {
                    const current = parseInt(exactStockInput, 10) || targetProduct?.stock || 0;
                    const next = Math.max(0, current + delta);
                    setExactStockInput(next.toString());
                  }}
                >
                  <Text
                    style={[styles.deltaBtnText, { color: delta > 0 ? colors.success : colors.danger }]}
                  >
                    {delta > 0 ? `+${delta}` : delta}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Exact New Stock Input */}
            <TextInput
              label={t('inventory.adjust.newCount', 'New Exact Stock Count')}
              value={exactStockInput}
              onChangeText={setExactStockInput}
              keyboardType="numeric"
              mode="outlined"
              style={styles.fieldMd}
            />

            {/* Adjustment Reason */}
            <Text style={styles.adjustSectionLabel}>{t('inventory.adjust.reason', 'Adjustment Reason:')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.chipRowContent}
            >
              {ADJUST_REASONS.map((r) => (
                <TouchableOpacity
                  key={r.id}
                  style={[styles.reasonChip, adjustReason === r.label && styles.reasonChipActive]}
                  onPress={() => setAdjustReason(r.label)}
                >
                  <Text style={[styles.reasonChipText, adjustReason === r.label && styles.reasonChipTextActive]}>
                    {t(`inventory.reasons.${r.id}`, r.label)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Button
              mode="contained"
              buttonColor={colors.brand}
              textColor={colors.onBrand}
              loading={isUpdatingStock}
              disabled={isUpdatingStock}
              onPress={handleConfirmStockAdjust}
              style={styles.sheetButton}
            >
              {t(
                'inventory.adjust.submit',
                'Update Stock ({{units}} units)',
                { units: exactStockInput || targetProduct?.stock || 0 }
              )}
            </Button>
          </View>
        </View>
      </Modal>

      {/* ADD NEW PRODUCT MODAL */}
      <Modal visible={isAddModalOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('inventory.add.title', 'Add New Product')}</Text>
              <TouchableOpacity onPress={() => setIsAddModalOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.formScroll} keyboardShouldPersistTaps="handled">
              <TextInput
                label={t('inventory.add.name', 'Product Name *')}
                placeholder={t('inventory.add.namePlaceholder', 'e.g. iPhone 15 Silicone Case')}
                value={newProdName}
                onChangeText={setNewProdName}
                mode="outlined"
                style={styles.fieldSm}
              />

              <TextInput
                label={t('inventory.add.model', 'Model / Variant')}
                placeholder={t('inventory.add.modelPlaceholder', 'e.g. Midnight Blue / MagSafe')}
                value={newProdModel}
                onChangeText={setNewProdModel}
                mode="outlined"
                style={styles.fieldSm}
              />

              {/* Category Picker */}
              <Text style={styles.adjustSectionLabel}>{t('inventory.add.category', 'Category:')}</Text>
              <View style={styles.chipWrapRow}>
                {ADDABLE_CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.catPickChip, newProdCategory === cat && styles.catPickChipActive]}
                    onPress={() => setNewProdCategory(cat)}
                  >
                    <Text style={[styles.catPickChipText, newProdCategory === cat && styles.catPickChipTextActive]}>
                      {t(`inventory.category.${cat}`, cat.replace('_', ' ').toUpperCase())}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.formRow}>
                <TextInput
                  label={t('inventory.add.sellingPrice', 'Selling Price (DA) *')}
                  value={newProdPrice}
                  onChangeText={setNewProdPrice}
                  keyboardType="numeric"
                  mode="outlined"
                  style={styles.fieldHalf}
                />
                <TextInput
                  label={t('inventory.add.costPrice', 'Cost Price (DA)')}
                  value={newProdCostPrice}
                  onChangeText={setNewProdCostPrice}
                  keyboardType="numeric"
                  mode="outlined"
                  style={styles.fieldHalf}
                />
              </View>

              <View style={styles.formRow}>
                <TextInput
                  label={t('inventory.add.initialStock', 'Initial Stock *')}
                  value={newProdStock}
                  onChangeText={setNewProdStock}
                  keyboardType="numeric"
                  mode="outlined"
                  style={styles.fieldHalf}
                />
                <TextInput
                  label={t('inventory.add.lowStockAlert', 'Low Stock Alert')}
                  value={newProdThreshold}
                  onChangeText={setNewProdThreshold}
                  keyboardType="numeric"
                  mode="outlined"
                  style={styles.fieldHalf}
                />
              </View>

              <TextInput
                label={t('inventory.add.barcode', 'Barcode / SKU (Optional)')}
                placeholder={t('inventory.add.barcodePlaceholder', 'Auto-generated if blank')}
                value={newProdBarcode}
                onChangeText={setNewProdBarcode}
                mode="outlined"
                style={styles.fieldLg}
              />
            </ScrollView>

            <Button
              mode="contained"
              buttonColor={colors.success}
              textColor={colors.onBrand}
              loading={isSavingNewProduct}
              disabled={isSavingNewProduct}
              onPress={handleSaveNewProduct}
              style={styles.sheetSubmit}
            >
              {t('inventory.add.save', 'Save Product to Stock')}
            </Button>
          </View>
        </View>
      </Modal>

      {/* QUICK EDIT PRICE MODAL */}
      <Modal visible={isEditModalOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{t('inventory.edit.title', 'Edit Product Pricing')}</Text>
                <Text style={styles.modalSub}>{editProduct?.name}</Text>
              </View>
              <TouchableOpacity onPress={() => setIsEditModalOpen(false)}>
                <MaterialCommunityIcons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <TextInput
              label={t('inventory.add.sellingPrice', 'Selling Price (DA) *')}
              value={editPrice}
              onChangeText={setEditPrice}
              keyboardType="numeric"
              mode="outlined"
              style={styles.fieldMd}
            />

            <TextInput
              label={t('inventory.add.costPrice', 'Cost Price (DA)')}
              value={editCostPrice}
              onChangeText={setEditCostPrice}
              keyboardType="numeric"
              mode="outlined"
              style={styles.fieldMd}
            />

            <TextInput
              label={t('inventory.edit.threshold', 'Low Stock Alert Threshold')}
              value={editThreshold}
              onChangeText={setEditThreshold}
              keyboardType="numeric"
              mode="outlined"
              style={styles.fieldLg}
            />

            {!isAdmin && (
              <TextInput
                label={t('inventory.edit.reasonForAdmin', 'Why? Sent to the admin (optional)')}
                placeholder={t('inventory.edit.reasonPlaceholder', 'e.g. Supplier raised the cost')}
                value={editReason}
                onChangeText={setEditReason}
                mode="outlined"
                style={styles.fieldLg}
              />
            )}

            <Button
              mode="contained"
              buttonColor={colors.brand}
              textColor={colors.onBrand}
              loading={isSavingEdit}
              disabled={isSavingEdit}
              onPress={handleSaveEditProduct}
              style={styles.sheetButton}
            >
              {isAdmin || priceApproved
                ? t('inventory.edit.save', 'Save Changes')
                : t('inventory.edit.askAdmin', 'Ask an admin to approve')}
            </Button>
          </View>
        </View>
      </Modal>

      {/* The answer unlocks the write, and this phone is the one that applies it. */}
      <AdminApprovalSheet
        visible={isAskingPriceApproval}
        payload={priceApprovalPayload}
        lines={[
          ...priceChanges,
          t('inventory.approvalLineStock', 'In stock: {{n}}', { n: editProduct?.stock ?? 0 }),
        ]}
        onApproved={() => {
          setPriceGrant(priceGrantKey);
          void applyPriceEdit();
        }}
        onDismiss={() => setIsAskingPriceApproval(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
    color: colors.brandBorder,
    fontSize: fontSize.label,
  },
  kpiContainer: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  kpiScroll: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  kpiCard: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    minWidth: 90,
  },
  kpiCardAction: {
    borderColor: ramp.amber500,
  },
  kpiLabel: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  kpiValue: {
    fontSize: fontSize.subtitle,
    fontWeight: '700',
    marginTop: spacing.xxs,
  },
  searchRow: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  searchbar: {
    height: 46,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  searchInput: {
    fontSize: fontSize.bodyStrong,
  },
  categoriesRow: {
    paddingVertical: spacing.sm,
  },
  categoriesScroll: {
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  catChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  catChipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  catChipText: {
    fontSize: fontSize.label,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  catChipTextActive: {
    color: colors.onBrand,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
  },
  productCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  productCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  productTitleBlock: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  productName: {
    fontSize: fontSize.bodyStrong,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  productModel: {
    fontSize: fontSize.label,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  skuText: {
    fontSize: fontSize.caption,
    color: colors.textFaint,
    marginTop: spacing.xxs,
  },
  stockBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.xs,
  },
  stockBadgeText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  productPricingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingVertical: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginBottom: spacing.sm,
  },
  priceLabel: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  priceValue: {
    fontSize: fontSize.subtitle,
    fontWeight: '700',
    color: colors.brand,
  },
  costPriceLabel: {
    fontSize: fontSize.caption,
    color: colors.textFaint,
  },
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  actionChipText: {
    fontSize: fontSize.label,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  actionChipTextInverse: {
    color: colors.textInverse,
    fontWeight: '700',
  },
  actionChipDisabled: {
    opacity: 0.4,
  },
  /** Only one filled action per card, so this is the one that stands out. */
  posAddBtn: {
    backgroundColor: colors.brand,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.xxxl * 2,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.xxxl,
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
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  emptyButton: {
    marginTop: spacing.xl,
    borderRadius: radius.pill,
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
    fontWeight: '700',
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
  loadingText: {
    marginTop: spacing.md,
    color: colors.textMuted,
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
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  modalTitle: {
    fontSize: fontSize.subtitle,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  modalSub: {
    fontSize: fontSize.label,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  currentStockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.brandSoft,
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  },
  currentStockLabel: {
    fontSize: fontSize.body,
    color: colors.brand,
    fontWeight: '600',
  },
  currentStockVal: {
    fontSize: fontSize.bodyStrong,
    color: colors.brand,
    fontWeight: '700',
  },
  adjustSectionLabel: {
    fontSize: fontSize.label,
    fontWeight: '700',
    color: ramp.slate700,
    marginBottom: spacing.sm,
  },
  quickDeltasRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
    marginBottom: spacing.md,
  },
  deltaBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
  },
  deltaBtnPlus: {
    backgroundColor: colors.successSoft,
  },
  deltaBtnMinus: {
    backgroundColor: colors.dangerSoft,
  },
  deltaBtnText: {
    fontSize: fontSize.label,
    fontWeight: '700',
  },
  chipRowContent: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
    marginBottom: spacing.lg,
  },
  chipWrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  reasonChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  reasonChipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  reasonChipText: {
    fontSize: fontSize.label,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  reasonChipTextActive: {
    color: colors.textInverse,
    fontWeight: '700',
  },
  catPickChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  catPickChipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  catPickChipText: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  catPickChipTextActive: {
    color: colors.textInverse,
  },
  formScroll: {
    maxHeight: 380,
  },
  formRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  fieldHalf: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  fieldSm: {
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  fieldMd: {
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  fieldLg: {
    backgroundColor: colors.surface,
    marginBottom: spacing.lg,
  },
  sheetButton: {
    paddingVertical: spacing.xs,
  },
  sheetSubmit: {
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
  },
});
