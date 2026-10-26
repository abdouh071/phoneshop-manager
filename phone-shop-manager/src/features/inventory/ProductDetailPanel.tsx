import React from 'react';
import { SlidePanel } from '../../components/ui/SlidePanel';
import { Button } from '../../components/ui/Button';
import { StockBadge } from '../../components/ui/Badge';
import type { PhoneModel } from '../../types';
import { Edit, Tag, Package, AlertTriangle, FileText, Truck, Clock } from 'lucide-react';
import { useActivityStore } from '../../store/activityStore';
import { useAuthStore } from '../../store/authStore';
import { usePermissions } from '../../hooks/usePermissions';
import styles from './ProductDetail.module.css';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { usePrivacyStore } from '../../store/privacyStore';
import { getSubCategoryMeta } from '../../utils/accessorySubCategories';

interface ProductDetailPanelProps {
  product: PhoneModel | null;
  onClose: () => void;
  onEdit: (p: PhoneModel) => void;
}

export const ProductDetailPanel: React.FC<ProductDetailPanelProps> = ({ product, onClose, onEdit }) => {
  const { activities } = useActivityStore();
  const { user } = useAuthStore();
  const permissions = usePermissions();
  const canViewFinancials = user?.role === 'admin' || (permissions.inventory_edit && permissions.reports);
  const isPrivacyActive = usePrivacyStore(s => s.isPrivacyActive);
  
  if (!product) return null;

  const margin = product.price > 0
    ? (((product.price - product.costPrice) / product.price) * 100)
    : 0;
  const profit = product.price - product.costPrice;
  const stockValue = product.costPrice * product.stock;
  const potentialRevenue = product.price * product.stock;

  const productActivities = activities.filter(a => a.entityId === product.id || (a as any).productId === product.id);

  return (
    <SlidePanel
      isOpen={!!product}
      onClose={onClose}
      title="Product Details"
      subtitle={`${product.name} ${product.model}`}
      width="md"
      footer={
        <Button leftIcon={<Edit size={16} />} onClick={() => onEdit(product)}>
          Edit Product
        </Button>
      }
    >
      <div className={styles.container}>

        {/* Header */}
        <div className={styles.productHeader}>
          <div className={styles.avatar}>{product.name[0]}</div>
          <div>
            <h2 className={styles.productName}>{product.name} {product.model}</h2>
            <div className={styles.badgeRow}>
              <StockBadge status={product.stockStatus} />
              <span className={styles.categoryBadge}>
                {product.category.charAt(0).toUpperCase() + product.category.slice(1)}
                {product.category === 'accessory' && product.accessorySubCategory && (
                  ` · ${getSubCategoryMeta(product.accessorySubCategory).icon} ${getSubCategoryMeta(product.accessorySubCategory).label}`
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Price cards */}
        <div className={styles.priceGrid}>
          {canViewFinancials && (
            <div className={styles.priceCard}>
              <p className={styles.priceLabel}>Buy Price (Cost)</p>
              <p data-privacy-cost className={[styles.priceValue, 'privacy-cost'].join(' ')}>
                {formatPrivateCurrency(product.costPrice)}
              </p>
            </div>
          )}
          <div className={styles.priceCard}>
            <p className={styles.priceLabel}>Sell Price</p>
            <p className={[styles.priceValue, styles.sellPrice].join(' ')}>{formatCurrency(product.price)}</p>
          </div>
          {canViewFinancials && (
            <>
              <div className={styles.priceCard}>
                <p className={styles.priceLabel}>Profit / Unit</p>
                <p data-privacy-cost className={[styles.priceValue, profit >= 0 ? styles.profitGood : styles.profitBad, 'privacy-cost'].join(' ')}>
                  {formatPrivateCurrency(profit)}
                </p>
              </div>
              <div className={styles.priceCard}>
                <p className={styles.priceLabel}>Margin</p>
                <p data-privacy-cost className={[styles.priceValue, margin >= 20 ? styles.profitGood : margin >= 10 ? styles.profitOk : styles.profitBad, 'privacy-cost'].join(' ')}>
                  {isPrivacyActive ? '••%' : `${margin.toFixed(1)}%`}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Stock value */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}><Package size={14} /> Stock Overview</h3>
          <div className={styles.detailGrid}>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Current Stock</span>
              <span className={styles.detailValue}>{product.stock} units</span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Low Stock Alert</span>
              <span className={styles.detailValue}>≤ {product.lowStockThreshold} units</span>
            </div>
            {canViewFinancials && (
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Stock Cost Value</span>
                <span data-privacy-cost className={[styles.detailValue, 'privacy-cost'].join(' ')}>
                  {formatPrivateCurrency(stockValue)}
                </span>
              </div>
            )}
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Potential Revenue</span>
              <span className={styles.detailValue}>{formatCurrency(potentialRevenue)}</span>
            </div>
          </div>
        </div>

        {/* Product info */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}><Tag size={14} /> Product Info</h3>
          <div className={styles.detailGrid}>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>SKU</span>
              <code className={styles.skuCode}>{product.sku}</code>
            </div>

            {product.location && (
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Storage Location</span>
                <span className={styles.detailValue}>{product.location}</span>
              </div>
            )}

            {product.category !== 'accessory' && product.storage && product.storage.trim().toUpperCase() !== 'N/A' && product.storage.trim().toLowerCase() !== 'none' && (
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Storage</span>
                <span className={styles.detailValue}>{product.storage}</span>
              </div>
            )}
            {product.color && product.color.trim().toUpperCase() !== 'N/A' && product.color.trim().toLowerCase() !== 'none' && (
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Color</span>
                <span className={styles.detailValue}>{product.color}</span>
              </div>
            )}
          </div>
        </div>

        {/* Supplier */}
        {product.supplier && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}><Truck size={14} /> Supplier</h3>
            <p className={styles.supplierName}>{product.supplier}</p>
          </div>
        )}

        {/* Low stock warning */}
        {(product.stockStatus === 'low_stock' || product.stockStatus === 'out_of_stock') && (
          <div className={styles.stockWarning}>
            <AlertTriangle size={14} />
            <span>
              {product.stockStatus === 'out_of_stock'
                ? 'This product is out of stock. Contact your supplier to reorder.'
                : `Stock is critically low (${product.stock} remaining). Reorder soon.`}
            </span>
          </div>
        )}

        {/* Notes */}
        {product.notes && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}><FileText size={14} /> Staff Notes</h3>
            <p className={styles.notes}>{product.notes}</p>
          </div>
        )}

        {/* Activity History */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}><Clock size={14} /> Activity History</h3>
          {productActivities.length === 0 ? (
            <p style={{ color: 'var(--color-on-surface-variant)', fontSize: '13px' }}>No activity logged yet.</p>
          ) : (
            <div className={styles.historyTimeline}>
              {productActivities.map(act => (
                <div key={act.id} className={styles.historyItem}>
                  <div className={styles.historyDot} />
                  <div className={styles.historyContent}>
                    <p className={styles.historyMessage}>{act.message}</p>
                    <p className={styles.historyMeta}>
                      {new Date(act.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </SlidePanel>
  );
};
