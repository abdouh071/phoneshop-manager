import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useCartStore } from '../../store/cartStore';
import { useToast } from '../../components/ui/Toast';
import { Minus, Plus, AlertTriangle } from 'lucide-react';
import type { SaleTransaction, CartItem } from '../../types';
import { formatCurrency, getCurrencySymbol } from '../../utils/formatCurrency';
import { useSettingsStore } from '../../store/settingsStore';
import { errorMessage } from '../../utils/errorUtils';

interface EditTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: SaleTransaction | null;
}

export const EditTransactionModal: React.FC<EditTransactionModalProps> = ({
  isOpen,
  onClose,
  transaction,
}) => {
  const { editTransaction } = useCartStore();
  const { currency } = useSettingsStore();
  const currencySymbol = getCurrencySymbol(currency);
  const toast = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  // Editable items state: productId -> quantity
  const [editedQuantities, setEditedQuantities] = useState<Record<string, number>>({});
  // Editable prices state: productId -> unit price
  const [editedPrices, setEditedPrices] = useState<Record<string, number>>({});
  // Return to stock options: productId -> boolean (true = return to stock)
  const [returnToStock, setReturnToStock] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (transaction) {
      const initialQtys: Record<string, number> = {};
      const initialPrices: Record<string, number> = {};
      const initialStockOpts: Record<string, boolean> = {};
      transaction.items.forEach(item => {
        initialQtys[item.product.id] = item.quantity;
        initialPrices[item.product.id] = item.product.price;
        initialStockOpts[item.product.id] = true; // Default to returning to stock
      });
      setEditedQuantities(initialQtys);
      setEditedPrices(initialPrices);
      setReturnToStock(initialStockOpts);
    }
  }, [transaction]);

  if (!transaction) return null;

  const handleQuantityChange = (productId: string, newQty: number, maxQty: number) => {
    const validQty = Math.max(0, Math.min(maxQty, newQty));
    setEditedQuantities(prev => ({ ...prev, [productId]: validQty }));
  };

  const handlePriceChange = (productId: string, newPrice: number) => {
    const validPrice = Math.max(0, newPrice);
    setEditedPrices(prev => ({ ...prev, [productId]: validPrice }));
  };

  const handleToggleStock = (productId: string) => {
    setReturnToStock(prev => ({ ...prev, [productId]: !prev[productId] }));
  };

  // Compute subtotal and total based on edited quantities & prices
  const newItems: CartItem[] = transaction.items
    .map(item => {
      const qty = editedQuantities[item.product.id] ?? item.quantity;
      const unitPrice = editedPrices[item.product.id] ?? item.product.price;
      return {
        ...item,
        quantity: qty,
        product: {
          ...item.product,
          price: unitPrice,
        },
      };
    })
    .filter(item => item.quantity > 0);

  const newSubtotal = newItems.reduce((sum, i) => sum + i.product.price * i.quantity, 0);

  let newDiscountAmt = 0;
  if (transaction.discount) {
    newDiscountAmt = transaction.discount.type === 'percent'
      ? newSubtotal * (transaction.discount.value / 100)
      : transaction.discount.value;
  }
  const newTotal = Math.max(0, newSubtotal - newDiscountAmt);
  const diff = transaction.total - newTotal;
  const refundAmount = diff > 0 ? diff : 0;
  const additionalDue = diff < 0 ? Math.abs(diff) : 0;

  const hasChanges = transaction.items.some(
    item =>
      (editedQuantities[item.product.id] ?? item.quantity) !== item.quantity ||
      (editedPrices[item.product.id] !== undefined && editedPrices[item.product.id] !== item.product.price)
  );

  const handleSave = async () => {
    if (!hasChanges || isProcessing) return;
    setIsProcessing(true);
    try {
      await editTransaction(transaction.id, newItems, returnToStock);
      toast.success(
        'Receipt Updated',
        `Transaction ${transaction.id} has been modified.${refundAmount > 0 ? ` Refund due: ${formatCurrency(refundAmount)}` : additionalDue > 0 ? ` Extra collected: ${formatCurrency(additionalDue)}` : ''}`
      );
      onClose();
    } catch (err: unknown) {
      toast.error('Error', errorMessage(err) || 'Failed to update transaction.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Receipt & Prices"
      subtitle={`Order #${transaction.id} • ${new Date(transaction.date).toLocaleDateString()}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!hasChanges}
            isLoading={isProcessing}
          >
            {refundAmount > 0
              ? `Refund Difference (${formatCurrency(refundAmount)})`
              : additionalDue > 0
              ? `Collect Difference (${formatCurrency(additionalDue)})`
              : 'Save Changes'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <p style={{ fontSize: '13px', color: 'var(--color-on-surface-variant)', margin: 0 }}>
          Adjust item unit prices, quantities, or remove returned items. Inventory and transaction totals will recalculate automatically.
        </p>

        {/* Line Items Table */}
        <div style={{ border: '1px solid var(--color-outline-variant)', borderRadius: '12px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--color-surface-variant)', borderBottom: '1px solid var(--color-outline-variant)' }}>
                <th style={{ padding: '10px 14px' }}>Item</th>
                <th style={{ padding: '10px 14px' }}>Unit Price ({currencySymbol})</th>
                <th style={{ padding: '10px 14px', textAlign: 'center' }}>Quantity</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' }}>Line Total</th>
                <th style={{ padding: '10px 14px', textAlign: 'center' }}>Return Stock?</th>
              </tr>
            </thead>
            <tbody>
              {transaction.items.map(item => {
                const origQty = item.quantity;
                const currentQty = editedQuantities[item.product.id] ?? origQty;
                const currentPrice = editedPrices[item.product.id] ?? item.product.price;
                const returnedQty = origQty - currentQty;
                const isStockChecked = returnToStock[item.product.id] !== false;

                return (
                  <tr key={item.product.id} style={{ borderBottom: '1px solid var(--color-outline-variant)' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontWeight: 600 }}>{item.product.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                        {item.product.category}
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={currentPrice}
                        onChange={e => {
                          const v = parseFloat(e.target.value);
                          handlePriceChange(item.product.id, isNaN(v) ? 0 : v);
                        }}
                        style={{
                          width: '95px',
                          padding: '5px 8px',
                          borderRadius: '6px',
                          border: '1px solid var(--color-outline, #cbd5e1)',
                          fontSize: '13px',
                          fontWeight: 600,
                          background: 'var(--color-surface-container-lowest, #ffffff)',
                          color: 'var(--color-on-surface, #0f172a)',
                          outline: 'none',
                        }}
                      />
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'var(--color-surface-variant)', padding: '4px 8px', borderRadius: '8px' }}>
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(item.product.id, currentQty - 1, origQty)}
                          disabled={currentQty <= 0}
                          style={{
                            border: 'none',
                            background: 'none',
                            cursor: currentQty > 0 ? 'pointer' : 'not-allowed',
                            padding: '2px',
                            display: 'flex',
                            alignItems: 'center',
                            opacity: currentQty > 0 ? 1 : 0.4,
                          }}
                        >
                          <Minus size={14} />
                        </button>
                        <span style={{ fontWeight: 700, minWidth: '20px', textAlign: 'center' }}>
                          {currentQty} / {origQty}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(item.product.id, currentQty + 1, origQty)}
                          disabled={currentQty >= origQty}
                          style={{
                            border: 'none',
                            background: 'none',
                            cursor: currentQty < origQty ? 'pointer' : 'not-allowed',
                            padding: '2px',
                            display: 'flex',
                            alignItems: 'center',
                            opacity: currentQty < origQty ? 1 : 0.4,
                          }}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {formatCurrency(currentPrice * currentQty)}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      {returnedQty > 0 ? (
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px' }}>
                          <input
                            type="checkbox"
                            checked={isStockChecked}
                            onChange={() => handleToggleStock(item.product.id)}
                            style={{ accentColor: 'var(--color-primary)', width: '16px', height: '16px' }}
                          />
                          <span style={{ color: isStockChecked ? 'var(--color-success-text)' : 'var(--color-danger-text)', fontWeight: 600 }}>
                            {isStockChecked ? `+${returnedQty} Stock` : 'Do not restock'}
                          </span>
                        </label>
                      ) : (
                        <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Summary Card */}
        <div style={{ background: 'var(--color-surface-variant)', padding: '14px 18px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
            <span style={{ color: 'var(--color-on-surface-variant)' }}>Original Total:</span>
            <span>{formatCurrency(transaction.total)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
            <span style={{ color: 'var(--color-on-surface-variant)' }}>New Subtotal:</span>
            <span>{formatCurrency(newSubtotal)}</span>
          </div>
          {newDiscountAmt > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--color-danger-text)' }}>
              <span>Discount Applied:</span>
              <span>-{formatCurrency(newDiscountAmt)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
            <span style={{ color: 'var(--color-on-surface-variant)' }}>New Total:</span>
            <strong style={{ fontSize: '15px' }}>{formatCurrency(newTotal)}</strong>
          </div>
          {refundAmount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', borderTop: '1px solid var(--color-outline-variant)', paddingTop: '8px', marginTop: '4px' }}>
              <span style={{ fontWeight: 600, color: 'var(--color-danger-text)' }}>
                Refund Due to Client:
              </span>
              <strong style={{ fontSize: '16px', color: 'var(--color-danger-text)' }}>
                {formatCurrency(refundAmount)}
              </strong>
            </div>
          )}
          {additionalDue > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', borderTop: '1px solid var(--color-outline-variant)', paddingTop: '8px', marginTop: '4px' }}>
              <span style={{ fontWeight: 600, color: 'var(--color-success-text)' }}>
                Additional Payment Due:
              </span>
              <strong style={{ fontSize: '16px', color: 'var(--color-success-text)' }}>
                +{formatCurrency(additionalDue)}
              </strong>
            </div>
          )}
        </div>

        {hasChanges && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--color-warning-text)', background: 'var(--color-warning-container)', padding: '10px 14px', borderRadius: '8px' }}>
            <AlertTriangle size={16} />
            <span>Saving will adjust the transaction prices, totals, and modify inventory stock as selected above.</span>
          </div>
        )}
      </div>
    </Modal>
  );
};
