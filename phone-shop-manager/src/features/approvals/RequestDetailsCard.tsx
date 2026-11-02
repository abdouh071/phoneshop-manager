import React from 'react';
import { Package, Smartphone, Wrench, Receipt, FileText, Clock } from 'lucide-react';
import { formatCurrency } from '../../utils/formatCurrency';
import type { ApprovalActionData } from '../../types';

export interface WorkerInfo {
  uid: string;
  name: string;
  email?: string;
  role?: string;
  avatar?: string;
}

export interface RequestDetailsCardProps {
  actionLabel?: string;
  actionType?: string;
  actionData?: ApprovalActionData | null;
  requestedBy?: WorkerInfo;
  requestedAt?: string;
  reason?: string;
  compact?: boolean;
}

export const RequestDetailsCard: React.FC<RequestDetailsCardProps> = ({ actionLabel, actionData, requestedBy, requestedAt, reason, compact = false }) => {
  // Extract known item data if available
  const productName = actionData?.productName || actionData?.partName || actionData?.itemName;
  const model = actionData?.model || actionData?.deviceModel;
  const sku = actionData?.sku || actionData?.partNumber;
  const category = actionData?.category;
  const price = actionData?.price !== undefined ? actionData.price : actionData?.catalogPrice;
  const currentStock = actionData?.currentStock !== undefined ? actionData.currentStock : actionData?.stock;
  const customerName = actionData?.customerName;
  const ticketNumber = actionData?.ticketNumber;
  const discountAmount = actionData?.discountAmount;
  const invoiceNumber = actionData?.invoiceNumber;
  const restockAmount = actionData?.restockAmount;

  // Determine role styling
  const getRoleBadge = (role?: string) => {
    switch (role) {
      case 'admin':
        return { label: 'Admin', bg: 'rgba(99, 102, 241, 0.12)', color: '#4f46e5', border: 'rgba(99, 102, 241, 0.3)' };
      case 'sales_agent':
      case 'sales':
        return { label: 'Sales Agent', bg: 'rgba(14, 165, 233, 0.12)', color: '#0284c7', border: 'rgba(14, 165, 233, 0.3)' };
      case 'repair_technician':
      case 'technician':
        return { label: 'Technician', bg: 'rgba(16, 185, 129, 0.12)', color: '#059669', border: 'rgba(16, 185, 129, 0.3)' };
      case 'inventory_manager':
        return { label: 'Inventory Mgr', bg: 'rgba(245, 158, 11, 0.12)', color: '#d97706', border: 'rgba(245, 158, 11, 0.3)' };
      default:
        return { label: (role || 'Staff').replace('_', ' '), bg: 'rgba(100, 116, 139, 0.12)', color: '#475569', border: 'rgba(100, 116, 139, 0.3)' };
    }
  };

  const roleStyle = getRoleBadge(requestedBy?.role);

  // Time formatter
  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      fontSize: '13px',
    }}>
      {/* ─── WORKER INFO SECTION ─── */}
      {requestedBy && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'var(--color-surface-variant, #f8fafc)',
          borderRadius: '8px',
          border: '1px solid var(--color-outline, #e2e8f0)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: roleStyle.bg,
              color: roleStyle.color,
              border: `1.5px solid ${roleStyle.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '12px',
              flexShrink: 0,
            }}>
              {requestedBy.avatar?.length === 1
                ? requestedBy.avatar
                : requestedBy.name
                ? requestedBy.name.slice(0, 2).toUpperCase()
                : 'U'}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontWeight: 700, color: 'var(--color-on-surface, #0f172a)' }}>
                  {requestedBy.name}
                </span>
                <span style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '1px 6px',
                  borderRadius: '10px',
                  background: roleStyle.bg,
                  color: roleStyle.color,
                  border: `1px solid ${roleStyle.border}`,
                  letterSpacing: '0.03em',
                }}>
                  {roleStyle.label}
                </span>
              </div>
              {requestedBy.email && (
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant, #64748b)' }}>
                  {requestedBy.email}
                </div>
              )}
            </div>
          </div>

          {requestedAt && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              color: 'var(--color-on-surface-variant, #64748b)',
            }}>
              <Clock size={12} />
              <span>{formatTime(requestedAt)}</span>
            </div>
          )}
        </div>
      )}

      {/* ─── TARGET PRODUCT / ITEM BOX ─── */}
      {(productName || actionLabel) && (
        <div style={{
          padding: '12px',
          background: 'var(--color-surface, #ffffff)',
          borderRadius: '10px',
          border: '1px solid var(--color-outline, #e2e8f0)',
          borderLeft: '4px solid var(--color-primary, #4f46e5)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
        }}>
          {/* Header with Product Name */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                background: 'rgba(79, 70, 229, 0.1)',
                color: 'var(--color-primary, #4f46e5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                {category === 'smartphone' || category === 'tablet' ? (
                  <Smartphone size={16} />
                ) : ticketNumber ? (
                  <Wrench size={16} />
                ) : invoiceNumber ? (
                  <Receipt size={16} />
                ) : (
                  <Package size={16} />
                )}
              </div>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-on-surface-variant, #64748b)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {productName ? 'Target Item / Product' : 'Restricted Action'}
                </div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-on-surface, #0f172a)' }}>
                  {productName || actionLabel}
                </div>
              </div>
            </div>

            {/* Action pill if product name is distinct from action */}
            {productName && actionLabel && (
              <span style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '3px 8px',
                borderRadius: '6px',
                background: 'var(--color-surface-variant, #f1f5f9)',
                color: 'var(--color-on-surface, #334155)',
                border: '1px solid var(--color-outline, #cbd5e1)',
                whiteSpace: 'nowrap',
              }}>
                {actionLabel}
              </span>
            )}
          </div>

          {/* Metadata Grid (SKU, Price, Stock, Category, Customer, etc.) */}
          {(model || sku || category || price !== undefined || currentStock !== undefined || customerName || ticketNumber || discountAmount !== undefined || restockAmount) && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: compact ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '6px',
              marginTop: '4px',
              paddingTop: '8px',
              borderTop: '1px solid var(--color-outline, #f1f5f9)',
            }}>
              {model && (
                <div style={{ background: 'var(--color-surface-variant, #f8fafc)', padding: '6px 8px', borderRadius: '6px', fontSize: '11px' }}>
                  <div style={{ color: 'var(--color-on-surface-variant, #64748b)', fontWeight: 500 }}>Model / Var</div>
                  <div style={{ fontWeight: 600, color: 'var(--color-on-surface, #0f172a)', marginTop: '1px' }}>{model}</div>
                </div>
              )}

              {sku && (
                <div style={{ background: 'var(--color-surface-variant, #f8fafc)', padding: '6px 8px', borderRadius: '6px', fontSize: '11px' }}>
                  <div style={{ color: 'var(--color-on-surface-variant, #64748b)', fontWeight: 500 }}>SKU / Part #</div>
                  <div style={{ fontWeight: 600, color: 'var(--color-on-surface, #0f172a)', marginTop: '1px', fontFamily: 'monospace' }}>{sku}</div>
                </div>
              )}

              {price !== undefined && (
                <div style={{ background: 'rgba(16, 185, 129, 0.08)', padding: '6px 8px', borderRadius: '6px', fontSize: '11px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                  <div style={{ color: '#047857', fontWeight: 500 }}>Price</div>
                  <div style={{ fontWeight: 700, color: '#065f46', marginTop: '1px' }}>{formatCurrency(price)}</div>
                </div>
              )}

              {currentStock !== undefined && (
                <div style={{
                  background: currentStock === 0 ? 'rgba(239, 68, 68, 0.08)' : currentStock < 5 ? 'rgba(245, 158, 11, 0.08)' : 'var(--color-surface-variant, #f8fafc)',
                  padding: '6px 8px',
                  borderRadius: '6px',
                  fontSize: '11px',
                }}>
                  <div style={{ color: 'var(--color-on-surface-variant, #64748b)', fontWeight: 500 }}>Current Stock</div>
                  <div style={{
                    fontWeight: 700,
                    color: currentStock === 0 ? '#ef4444' : currentStock < 5 ? '#d97706' : 'var(--color-on-surface, #0f172a)',
                    marginTop: '1px',
                  }}>
                    {currentStock === 0 ? 'Out of Stock' : `${currentStock} units`}
                  </div>
                </div>
              )}

              {category && (
                <div style={{ background: 'var(--color-surface-variant, #f8fafc)', padding: '6px 8px', borderRadius: '6px', fontSize: '11px' }}>
                  <div style={{ color: 'var(--color-on-surface-variant, #64748b)', fontWeight: 500 }}>Category</div>
                  <div style={{ fontWeight: 600, color: 'var(--color-on-surface, #0f172a)', marginTop: '1px', textTransform: 'capitalize' }}>{category}</div>
                </div>
              )}

              {customerName && (
                <div style={{ background: 'var(--color-surface-variant, #f8fafc)', padding: '6px 8px', borderRadius: '6px', fontSize: '11px' }}>
                  <div style={{ color: 'var(--color-on-surface-variant, #64748b)', fontWeight: 500 }}>Customer</div>
                  <div style={{ fontWeight: 600, color: 'var(--color-on-surface, #0f172a)', marginTop: '1px' }}>{customerName}</div>
                </div>
              )}

              {ticketNumber && (
                <div style={{ background: 'var(--color-surface-variant, #f8fafc)', padding: '6px 8px', borderRadius: '6px', fontSize: '11px' }}>
                  <div style={{ color: 'var(--color-on-surface-variant, #64748b)', fontWeight: 500 }}>Ticket #</div>
                  <div style={{ fontWeight: 700, color: 'var(--color-primary, #4f46e5)', marginTop: '1px' }}>#{ticketNumber}</div>
                </div>
              )}

              {discountAmount !== undefined && (
                <div style={{ background: 'rgba(239, 68, 68, 0.08)', padding: '6px 8px', borderRadius: '6px', fontSize: '11px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                  <div style={{ color: '#b91c1c', fontWeight: 500 }}>Requested Discount</div>
                  <div style={{ fontWeight: 700, color: '#dc2626', marginTop: '1px' }}>-{formatCurrency(discountAmount)}</div>
                </div>
              )}

              {restockAmount && (
                <div style={{ background: 'rgba(16, 185, 129, 0.08)', padding: '6px 8px', borderRadius: '6px', fontSize: '11px' }}>
                  <div style={{ color: '#047857', fontWeight: 500 }}>Restock Qty</div>
                  <div style={{ fontWeight: 700, color: '#059669', marginTop: '1px' }}>+{restockAmount} units</div>
                </div>
              )}
            </div>
          )}

          {/* Any other action data values not covered above */}
          {actionData && Object.keys(actionData).filter(k => 
            !['productName', 'partName', 'itemName', 'model', 'deviceModel', 'sku', 'partNumber', 'category', 'price', 'catalogPrice', 'cost', 'costPrice', 'currentStock', 'stock', 'customerName', 'ticketNumber', 'discountAmount', 'restockAmount', 'itemType'].includes(k)
          ).length > 0 && (
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px',
              marginTop: '4px',
            }}>
              {Object.entries(actionData)
                .filter(([k]) => !['productName', 'partName', 'itemName', 'model', 'deviceModel', 'sku', 'partNumber', 'category', 'price', 'catalogPrice', 'cost', 'costPrice', 'currentStock', 'stock', 'customerName', 'ticketNumber', 'discountAmount', 'restockAmount', 'itemType'].includes(k))
                .slice(0, 4)
                .map(([key, val]) => (
                  <span key={key} style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: 'var(--color-surface-variant, #f1f5f9)',
                    color: 'var(--color-on-surface-variant, #64748b)',
                  }}>
                    <strong>{key.replace(/([A-Z])/g, ' $1').toLowerCase()}:</strong> {String(val)}
                  </span>
                ))}
            </div>
          )}
        </div>
      )}

      {/* ─── WORKER REASON / NOTE ─── */}
      {reason && (
        <div style={{
          padding: '8px 12px',
          background: 'rgba(99, 102, 241, 0.05)',
          borderRadius: '8px',
          border: '1px solid rgba(99, 102, 241, 0.2)',
          fontSize: '12px',
          color: 'var(--color-on-surface, #0f172a)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px',
        }}>
          <FileText size={15} style={{ color: 'var(--color-primary, #4f46e5)', marginTop: '2px', flexShrink: 0 }} />
          <div>
            <span style={{ fontWeight: 600, color: 'var(--color-primary, #4f46e5)' }}>Worker Note: </span>
            <span style={{ fontStyle: 'italic' }}>"{reason}"</span>
          </div>
        </div>
      )}
    </div>
  );
};
