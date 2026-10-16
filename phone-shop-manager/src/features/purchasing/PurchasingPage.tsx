import React, { useEffect, useState, useMemo } from 'react';
import { Plus, Search, Truck, Building2, Package, CheckCircle2, MoreVertical, XCircle, FileText } from 'lucide-react';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/Input';
import { usePurchasingStore } from '../../store/purchasingStore';
import { SupplierModal } from './SupplierModal';
import { POBuilderModal } from './POBuilderModal';
import { POViewerModal } from './POViewerModal';
import { EmptyState } from '../../components/ui/EmptyState';
import { usePermissions } from '../../hooks/usePermissions';
import type { PurchaseOrder, POStatus } from '../../types';
import styles from './Purchasing.module.css';
import { formatCurrency } from '../../utils/formatCurrency';


import { useLocation } from 'react-router-dom';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const StatusBadge: React.FC<{ status: POStatus }> = ({ status }) => {
  const configs: Record<POStatus, { bg: string; color: string; label: string }> = {
    draft: { bg: '#f1f5f9', color: '#64748b', label: 'Draft' },
    sent: { bg: '#eff6ff', color: '#3b82f6', label: 'Sent' },
    partially_received: { bg: '#fef3c7', color: '#d97706', label: 'Partially Received' },
    completed: { bg: '#dcfce7', color: '#16a34a', label: 'Completed' },
    cancelled: { bg: '#fee2e2', color: '#dc2626', label: 'Cancelled' },
  };
  const c = configs[status];
  return (
    <span style={{
      background: c.bg,
      color: c.color,
      padding: '4px 10px',
      borderRadius: '12px',
      fontSize: '12px',
      fontWeight: 600,
    }}>
      {c.label}
    </span>
  );
};

export const PurchasingPage = () => {
  const { fetchData, purchaseOrders, suppliers, getFilteredPOs, getFilteredSuppliers, searchQuery, setSearchQuery, isLoading } = usePurchasingStore();
  const permissions = usePermissions();
  const [activeTab, setActiveTab] = useState<'pos' | 'suppliers'>('pos');
  const location = useLocation();

  // Modals state
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);

  const [isPOBuilderOpen, setIsPOBuilderOpen] = useState(false);
  const [editingPOId, setEditingPOId] = useState<string | null>(null);

  const [viewingPO, setViewingPO] = useState<PurchaseOrder | null>(null);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle deep links from Activity Log (e.g. /purchasing?tab=orders&focusId=...)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    const focusId = params.get('focusId') || params.get('po');

    if (tab === 'suppliers') {
      setActiveTab('suppliers');
      if (focusId && suppliers.length > 0) {
        const sup = suppliers.find(s => s.id === focusId || s.name.toLowerCase().includes(focusId.toLowerCase()));
        if (sup) {
          setEditingSupplierId(sup.id);
          setIsSupplierModalOpen(true);
        }
      }
    } else if (tab === 'orders' || focusId) {
      setActiveTab('pos');
      if (focusId && purchaseOrders.length > 0) {
        const po = purchaseOrders.find(p => p.id === focusId || p.poNumber.toLowerCase().includes(focusId.toLowerCase()));
        if (po) {
          setViewingPO(po);
        }
      }
    }
  }, [location.search, purchaseOrders, suppliers]);

  const filteredPOs = getFilteredPOs();
  const filteredSuppliers = getFilteredSuppliers();

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerTitle}>
          <h1>Purchasing & Suppliers</h1>
          <p>Manage purchase orders and supplier relationships</p>
        </div>
        <div className={styles.headerActions}>
          <SearchInput
            placeholder={activeTab === 'pos' ? "Search POs..." : "Search suppliers..."}
            value={searchQuery}
            onChange={setSearchQuery}
          />
          {activeTab === 'pos' ? (
            <Button leftIcon={<Plus size={16} />} onClick={() => setIsPOBuilderOpen(true)}>
              Create PO
            </Button>
          ) : (
            <Button leftIcon={<Plus size={16} />} onClick={() => { setEditingSupplierId(null); setIsSupplierModalOpen(true); }}>
              Add Supplier
            </Button>
          )}
        </div>
      </header>

      <div className={styles.tabs}>
        <button
          className={[styles.tab, activeTab === 'pos' && styles.activeTab].filter(Boolean).join(' ')}
          onClick={() => setActiveTab('pos')}
        >
          <FileText size={16} /> Purchase Orders
        </button>
        <button
          className={[styles.tab, activeTab === 'suppliers' && styles.activeTab].filter(Boolean).join(' ')}
          onClick={() => setActiveTab('suppliers')}
        >
          <Building2 size={16} /> Suppliers
        </button>
      </div>

      <div className={styles.content}>
        {isLoading ? (
          <div>Loading...</div>
        ) : activeTab === 'pos' ? (
          // --- PURCHASE ORDERS VIEW ---
          filteredPOs.length === 0 ? (
            <EmptyState
              icon={<FileText size={48} />}
              title="No Purchase Orders"
              description="You haven't created any purchase orders yet."
              action={<Button leftIcon={<Plus size={16} />} onClick={() => setIsPOBuilderOpen(true)}>Create PO</Button>}
            />
          ) : (
            <Card>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>PO Number</th>
                      <th>Date</th>
                      <th>Supplier</th>
                      <th>Status</th>
                      <th>Items</th>
                      <th>Total</th>
                      <th align="right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPOs.map(po => {
                      const totalQty = po.items.reduce((s, i) => s + i.requestedQty, 0);
                      return (
                        <tr key={po.id} className={styles.tr}>
                          <td><strong>{po.poNumber}</strong></td>
                          <td>{formatDate(po.orderDate)}</td>
                          <td>{po.supplierName}</td>
                          <td><StatusBadge status={po.status} /></td>
                          <td>{po.items.length} products ({totalQty} units)</td>
                          <td>{formatCurrency(po.totalAmount)}</td>
                          <td align="right">
                            <div className={styles.actions}>
                              <Button variant="ghost" size="sm" onClick={() => setViewingPO(po)}>View</Button>
                              {(po.status === 'draft' || po.status === 'sent') && (
                                <Button variant="secondary" size="sm" onClick={() => { setEditingPOId(po.id); setIsPOBuilderOpen(true); }}>Edit</Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        ) : (
          // --- SUPPLIERS VIEW ---
          filteredSuppliers.length === 0 ? (
            <EmptyState
              icon={<Building2 size={48} />}
              title="No Suppliers Found"
              description="Add your first supplier to start creating purchase orders."
              action={<Button leftIcon={<Plus size={16} />} onClick={() => { setEditingSupplierId(null); setIsSupplierModalOpen(true); }}>Add Supplier</Button>}
            />
          ) : (
            <div className={styles.supplierGrid}>
              {filteredSuppliers.map(supplier => (
                <Card key={supplier.id} className={styles.supplierCard}>
                  <div className={styles.supplierHeader}>
                    <div>
                      <h3 className={styles.supplierName}>{supplier.name}</h3>
                      {supplier.contactName && <p className={styles.supplierContact}>{supplier.contactName}</p>}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => { setEditingSupplierId(supplier.id); setIsSupplierModalOpen(true); }}>Edit</Button>
                  </div>
                  <div className={styles.supplierBody}>
                    {supplier.email && <p><strong>Email:</strong> {supplier.email}</p>}
                    {supplier.phone && <p><strong>Phone:</strong> {supplier.phone}</p>}
                    {supplier.address && <p><strong>Address:</strong> {supplier.address}</p>}
                  </div>
                </Card>
              ))}
            </div>
          )
        )}
      </div>

      {/* Modals */}
      <SupplierModal 
        isOpen={isSupplierModalOpen} 
        onClose={() => setIsSupplierModalOpen(false)} 
        supplierId={editingSupplierId} 
      />

      <POBuilderModal
        isOpen={isPOBuilderOpen}
        onClose={() => setIsPOBuilderOpen(false)}
        poId={editingPOId}
      />

      {viewingPO && (
        <POViewerModal
          po={viewingPO}
          onClose={() => setViewingPO(null)}
        />
      )}
    </div>
  );
};
