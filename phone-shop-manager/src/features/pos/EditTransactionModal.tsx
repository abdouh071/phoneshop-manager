/**
 * Correcting a settled invoice at the counter.
 *
 * One control per SKU, and a line only climbs as far as the shelf can give. The
 * technician phone mirrors this screen (`technician-app/src/components/EditSaleSheet.tsx`),
 * so a rule that changes here has to change there.
 *
 * A line may also be discounted. The concession is written into the line's own unit
 * price rather than stored beside it, because the receipt, the ledger, the customer
 * statement and the reports all price that line from its unit price and add those
 * lines back up — a discount kept separately would print a sum of lines that does
 * not foot to the printed total. What the till is left to enforce is how deep a
 * concession anyone may make without an admin signing for it.
 */
import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/Input';
import { AdminUnlockModal } from '../../components/ui/AdminUnlockModal';
import { useCartStore } from '../../store/cartStore';
import { useInventoryStore } from '../../store/inventoryStore';
import { useAuthStore } from '../../store/authStore';
import { useToast } from '../../components/ui/Toast';
import { Minus, Plus, AlertTriangle, Trash2 } from 'lucide-react';
import type { SaleTransaction, CartItem, PhoneModel } from '../../types';
import { formatCurrency, getCurrencySymbol } from '../../utils/formatCurrency';
import { useSettingsStore } from '../../store/settingsStore';
import { errorMessage } from '../../utils/errorUtils';
import {
  DISCOUNT_APPROVAL_PERCENT,
  lineDiscountOf,
  requiresLineDiscountApproval,
  unitPriceAfterDiscount,
} from '../../utils/discountPolicy';

interface EditTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: SaleTransaction | null;
}

/** A row of the editor: a line the document carries, or one the counter is putting on it. */
interface EditRow {
  id: string;
  product: PhoneModel;
  originalQty: number;
  added: boolean;
}

/** The ceiling only ever clamps; a product this till does not list is left unbounded. */
const UNBOUNDED_QTY = 999;

const withoutKey = <T,>(record: Record<string, T>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([id]) => id !== key));

export const EditTransactionModal: React.FC<EditTransactionModalProps> = ({
  isOpen,
  onClose,
  transaction,
}) => {
  const { editTransaction } = useCartStore();
  const { currency } = useSettingsStore();
  const role = useAuthStore(state => state.user?.role);
  const inventory = useInventoryStore(state => state.products);
  const parts = useInventoryStore(state => state.parts);
  const currencySymbol = getCurrencySymbol(currency);
  const toast = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  /**
   * An admin's answer belongs to the exact concessions it was given for — deepen the
   * discount afterwards and the number they signed for is no longer the number being
   * written, so the key has to be re-asked. The till gates a discount the same way.
   */
  const [approvedKey, setApprovedKey] = useState<string | null>(null);
  const [isAskingDiscount, setIsAskingDiscount] = useState(false);

  // Editable items state: productId -> quantity
  const [editedQuantities, setEditedQuantities] = useState<Record<string, number>>({});
  // Editable prices state: productId -> unit price
  const [editedPrices, setEditedPrices] = useState<Record<string, number>>({});
  /**
   * The discount exactly as it was typed, kept apart from the price it produced.
   * Re-deriving the field from the price would rewrite the number under the caret —
   * 100 DA over three units lands back as 99.99 — so the text lives here until
   * something else moves the line, and then the field reads the truth again.
   */
  const [discountInputs, setDiscountInputs] = useState<Record<string, string>>({});
  // Return to stock options: productId -> boolean (true = return to stock)
  const [returnToStock, setReturnToStock] = useState<Record<string, boolean>>({});
  // Products the counter puts on an invoice that never carried them
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [addedProducts, setAddedProducts] = useState<Record<string, PhoneModel>>({});
  const [isPicking, setIsPicking] = useState(false);
  const [pickSearch, setPickSearch] = useState('');

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
      setDiscountInputs({});
      setAddedIds([]);
      setAddedProducts({});
      setIsPicking(false);
      setPickSearch('');
      setApprovedKey(null);
      setIsAskingDiscount(false);
    }
  }, [transaction]);

  if (!transaction) return null;

  const shelfLevels = [...inventory, ...parts];
  /** `undefined` — this till has no count for the product, so nothing is refused. */
  const shelfOf = (productId: string): number | undefined =>
    shelfLevels.find(p => p.id === productId)?.stock;

  const rows: EditRow[] = [
    ...transaction.items.map(item => ({
      id: item.product.id,
      product: item.product,
      originalQty: item.quantity,
      added: false,
    })),
    ...addedIds
      .filter(id => addedProducts[id])
      .map(id => ({ id, product: addedProducts[id], originalQty: 0, added: true })),
  ];

  // Sold units are already committed; anything new has to come off the counter.
  const ceilingOf = (row: EditRow): number => {
    const onShelf = shelfOf(row.id);
    if (onShelf === undefined) return UNBOUNDED_QTY;
    return Math.min(UNBOUNDED_QTY, row.originalQty + Math.max(0, onShelf));
  };

  // The till's own list is the authority for what may join the document — the same
  // list that refuses an out-of-stock product when a new cart is built.
  const pickSource = transaction.saleType === 'parts_b2b' ? parts : inventory;
  const pickList = pickSource.filter(product => {
    const q = pickSearch.trim().toLowerCase();
    if (!q) return true;
    return [product.name, product.model, product.category, product.sku, product.storage, product.color]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q);
  });

  const handleQuantityChange = (productId: string, newQty: number, maxQty: number) => {
    const validQty = Math.max(0, Math.min(maxQty, newQty));
    setEditedQuantities(prev => ({ ...prev, [productId]: validQty }));
    // Another unit changes what a typed discount is worth, so the field reads the
    // concession back off the line rather than keeping a stale number.
    setDiscountInputs(prev => withoutKey(prev, productId));
  };

  const handlePriceChange = (productId: string, newPrice: number) => {
    const validPrice = Math.max(0, newPrice);
    setEditedPrices(prev => ({ ...prev, [productId]: validPrice }));
    setDiscountInputs(prev => withoutKey(prev, productId));
  };

  /**
   * The discount and the unit price are one number seen from two sides, so typing in
   * one moves the other rather than fighting it: the concession is measured from the
   * price the document carried and spread over the units it holds.
   */
  const handleDiscountChange = (row: EditRow, quantity: number, raw: string) => {
    const parsed = parseFloat(raw);
    setDiscountInputs(prev => ({ ...prev, [row.id]: raw }));
    setEditedPrices(prev => ({
      ...prev,
      [row.id]: unitPriceAfterDiscount(row.product.price, Number.isFinite(parsed) ? parsed : 0, quantity),
    }));
  };

  const handleToggleStock = (productId: string) => {
    setReturnToStock(prev => ({ ...prev, [productId]: !prev[productId] }));
  };

  // Compute subtotal and total based on edited quantities & prices
  const newItems: CartItem[] = rows
    .map<CartItem>(row => {
      const priced: PhoneModel = { ...row.product, price: editedPrices[row.id] ?? row.product.price };
      const quantity = editedQuantities[row.id] ?? row.originalQty;
      const original = row.added
        ? undefined
        : transaction.items.find(item => item.product.id === row.id);
      return original
        ? { ...original, quantity, product: priced }
        : { product: priced, quantity };
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

  /** What each line gives away against the price the document carried for it. */
  const concessions = rows
    .map(row => {
      const quantity = editedQuantities[row.id] ?? row.originalQty;
      const unitPrice = editedPrices[row.id] ?? row.product.price;
      return { row, quantity, ...lineDiscountOf(row.product.price, unitPrice, quantity) };
    })
    .filter(line => line.granted > 0);

  const concessionsTotal = concessions.reduce((sum, line) => sum + line.granted, 0);

  /**
   * A concession deeper than the shop's own threshold, which is the only thing an
   * admin here is being asked to sign for — the rest of the edit was already
   * authorised to reach this screen.
   */
  const deepConcessions = concessions.filter(line => requiresLineDiscountApproval(role, line.percent));
  const concessionKey = deepConcessions
    .map(line => `${line.row.id}:${Math.round(line.percent * 10) / 10}`)
    .sort()
    .join('|');
  const needsDiscountApproval = deepConcessions.length > 0 && approvedKey !== concessionKey;
  const deepestPercent = deepConcessions.reduce((worst, line) => Math.max(worst, line.percent), 0);
  const discountSummary = deepConcessions
    .map(line => `${line.row.product.name} −${line.percent.toFixed(1)}% (${formatCurrency(line.granted)})`)
    .join(', ');

  const onInvoice = new Set(transaction.items.map(item => item.product.id));

  const pickProduct = (product: PhoneModel) => {
    const id = product?.id;
    if (!id || onInvoice.has(id) || addedIds.includes(id)) return;
    setAddedProducts(prev => ({ ...prev, [id]: product }));
    setAddedIds(prev => [...prev, id]);
    setEditedQuantities(prev => ({ ...prev, [id]: 1 }));
    setEditedPrices(prev => ({ ...prev, [id]: product.price }));
    setReturnToStock(prev => ({ ...prev, [id]: true }));
    setIsPicking(false);
    setPickSearch('');
  };

  const removeAddedRow = (productId: string) => {
    setAddedIds(prev => prev.filter(id => id !== productId));
    setEditedQuantities(prev => withoutKey(prev, productId));
    setEditedPrices(prev => withoutKey(prev, productId));
    setDiscountInputs(prev => withoutKey(prev, productId));
  };

  const addedLineCount = rows.filter(row => row.added && (editedQuantities[row.id] ?? 0) > 0).length;

  const hasChanges =
    addedLineCount > 0 ||
    transaction.items.some(
      item =>
        (editedQuantities[item.product.id] ?? item.quantity) !== item.quantity ||
        (editedPrices[item.product.id] !== undefined && editedPrices[item.product.id] !== item.product.price)
    );

  const commitEdit = async () => {
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

  const handleSave = () => {
    if (!hasChanges || isProcessing) return;
    if (needsDiscountApproval) {
      setIsAskingDiscount(true);
      return;
    }
    void commitEdit();
  };

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Receipt & Prices"
      subtitle={`Order #${transaction.id} • ${new Date(transaction.date).toLocaleDateString()}`}
      size="md"
      closeOnEscape={!isPicking}
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
            {needsDiscountApproval
              ? `Authorize Discount (${deepConcessions.length} line${deepConcessions.length > 1 ? 's' : ''})`
              : refundAmount > 0
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
          Adjust item unit prices, quantities and discounts, put a product the invoice never carried onto it, or
          drop a line back to zero. Inventory and transaction totals recalculate automatically, a line the shelf
          cannot give is refused before anything is written, and a discount deeper than{' '}
          {DISCOUNT_APPROVAL_PERCENT}% of what that line was listed at needs an admin to authorize it.
        </p>

        {/* Line Items Table */}
        <div style={{ border: '1px solid var(--color-outline-variant)', borderRadius: '12px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--color-surface-variant)', borderBottom: '1px solid var(--color-outline-variant)' }}>
                <th style={{ padding: '10px 14px' }}>Item</th>
                <th style={{ padding: '10px 14px' }}>Unit Price & Discount ({currencySymbol})</th>
                <th style={{ padding: '10px 14px', textAlign: 'center' }}>Quantity</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' }}>Line Total</th>
                <th style={{ padding: '10px 14px', textAlign: 'center' }}>Return Stock?</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const pid = row.id;
                const origQty = row.originalQty;
                const currentQty = editedQuantities[pid] ?? origQty;
                const currentPrice = editedPrices[pid] ?? row.product.price;
                const returnedQty = origQty - currentQty;
                const isStockChecked = returnToStock[pid] !== false;
                const maxQty = ceilingOf(row);
                const atCeiling = currentQty >= maxQty;
                const onShelf = shelfOf(pid);
                const concession = lineDiscountOf(row.product.price, currentPrice, currentQty);
                const gatedDiscount = requiresLineDiscountApproval(role, concession.percent);

                return (
                  <tr key={pid} style={{ borderBottom: '1px solid var(--color-outline-variant)' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontWeight: 600 }}>{row.product.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                        {row.added
                          ? `New line · ${onShelf === undefined ? 'stock unknown' : `${onShelf} on the shelf`}`
                          : row.product.category}
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          aria-label={`Unit price in dinars on ${row.product.name}`}
                          value={currentPrice}
                          onChange={e => {
                            const v = parseFloat(e.target.value);
                            handlePriceChange(pid, isNaN(v) ? 0 : v);
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            placeholder={`Disc. ${currencySymbol}`}
                            aria-label={`Discount in dinars on ${row.product.name}`}
                            value={discountInputs[pid] ?? (concession.granted > 0 ? String(concession.granted) : '')}
                            onChange={e => handleDiscountChange(row, currentQty, e.target.value)}
                            disabled={currentQty <= 0}
                            style={{
                              width: '95px',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              border: `1px ${concession.granted > 0 ? 'solid' : 'dashed'} var(--color-outline, #cbd5e1)`,
                              fontSize: '12px',
                              background: 'var(--color-surface-container-lowest, #ffffff)',
                              color: concession.granted > 0 ? 'var(--color-danger-text, #dc2626)' : 'var(--color-on-surface, #0f172a)',
                              outline: 'none',
                              opacity: currentQty > 0 ? 1 : 0.4,
                            }}
                          />
                          {concession.granted > 0 && (
                            <span
                              style={{
                                fontSize: '12px',
                                fontWeight: 700,
                                whiteSpace: 'nowrap',
                                color: gatedDiscount ? 'var(--color-danger-text, #dc2626)' : 'var(--color-on-surface-variant)',
                              }}
                            >
                              -{concession.percent.toFixed(1)}%
                            </span>
                          )}
                        </div>
                        {gatedDiscount && (
                          <div style={{ fontSize: '11px', color: 'var(--color-warning-text)', maxWidth: '160px' }}>
                            Over {DISCOUNT_APPROVAL_PERCENT}% — an admin has to authorize this line before it saves.
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'var(--color-surface-variant)', padding: '4px 8px', borderRadius: '8px' }}>
                        <button
                          type="button"
                          aria-label={`Decrease quantity of ${row.product.name}`}
                          title="Decrease quantity"
                          onClick={() => handleQuantityChange(pid, currentQty - 1, maxQty)}
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
                        <span style={{ fontWeight: 700, minWidth: '44px', textAlign: 'center' }}>
                          {row.added ? currentQty : `${currentQty} / ${origQty}`}
                        </span>
                        <button
                          type="button"
                          aria-label={`Increase quantity of ${row.product.name}`}
                          title="Increase quantity"
                          onClick={() => handleQuantityChange(pid, currentQty + 1, maxQty)}
                          disabled={atCeiling}
                          style={{
                            border: 'none',
                            background: 'none',
                            cursor: atCeiling ? 'not-allowed' : 'pointer',
                            padding: '2px',
                            display: 'flex',
                            alignItems: 'center',
                            opacity: atCeiling ? 0.4 : 1,
                          }}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      {atCeiling && onShelf !== undefined && (
                        <div style={{ fontSize: '11px', fontStyle: 'italic', color: 'var(--color-on-surface-variant)', marginTop: '4px' }}>
                          {onShelf <= 0
                            ? 'The shelf is empty — this line cannot grow.'
                            : `The shelf holds ${onShelf}, so this line stops at ${maxQty}.`}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 600 }}>{formatCurrency(currentPrice * currentQty)}</div>
                      {concession.granted > 0 && (
                        <div style={{ fontSize: '11px', color: 'var(--color-danger-text, #dc2626)' }}>
                          was {formatCurrency(row.product.price * currentQty)}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      {row.added ? (
                        <button
                          type="button"
                          onClick={() => removeAddedRow(pid)}
                          title="Remove this line from the invoice"
                          style={{
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: 'var(--color-danger-text)',
                          }}
                        >
                          <Trash2 size={14} />
                          Remove line
                        </button>
                      ) : returnedQty > 0 ? (
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px' }}>
                          <input
                            type="checkbox"
                            checked={isStockChecked}
                            onChange={() => handleToggleStock(pid)}
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

        <button
          type="button"
          onClick={() => setIsPicking(true)}
          style={{
            border: '1px dashed var(--color-outline, #cbd5e1)',
            background: 'none',
            borderRadius: '12px',
            padding: '12px 14px',
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--color-primary)',
            cursor: 'pointer',
          }}
        >
          + Add a product to this invoice
        </button>

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
          {concessionsTotal > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--color-danger-text)' }}>
              <span>Given away on lines:</span>
              <span>-{formatCurrency(concessionsTotal)}</span>
            </div>
          )}
          {addedLineCount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
              <span style={{ color: 'var(--color-on-surface-variant)' }}>New lines added:</span>
              <span>{addedLineCount}</span>
            </div>
          )}
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

      <Modal
        isOpen={isPicking}
        onClose={() => setIsPicking(false)}
        title="Add a product to this invoice"
        subtitle="Only what the shelf holds can join a document that was already sold"
        size="md"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <SearchInput
            value={pickSearch}
            onChange={setPickSearch}
            placeholder="Search by name, model, category or SKU..."
            aria-label={`Searching ${pickSource.length} ${transaction.saleType === 'parts_b2b' ? 'parts' : 'products'}`}
          />

          {pickList.length === 0 ? (
            <p style={{ textAlign: 'center', padding: '20px', fontSize: '13px', color: 'var(--color-on-surface-variant)', margin: 0 }}>
              Nothing matches “{pickSearch}”.
            </p>
          ) : (
            <div style={{ maxHeight: '360px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {pickList.map(product => {
                const already = onInvoice.has(product.id) || addedIds.includes(product.id);
                // The till's own list is the shelf's answer here, exactly as it is when
                // the same product is added to a new cart: nothing with no units behind
                // it can join a document that was already sold.
                const empty = (Number(product.stock) || 0) <= 0;
                const off = already || empty;
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => pickProduct(product)}
                    disabled={off}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                      textAlign: 'left',
                      padding: '12px 14px',
                      borderRadius: '10px',
                      border: '1px solid var(--color-outline-variant)',
                      background: 'var(--color-surface-container-lowest, #ffffff)',
                      cursor: off ? 'not-allowed' : 'pointer',
                      opacity: off ? 0.45 : 1,
                      fontSize: '13px',
                    }}
                  >
                    <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <strong>{product.name} {product.model}</strong>
                      <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                        {already
                          ? 'Already on this invoice'
                          : empty
                          ? 'Out of stock'
                          : `${product.stock} on the shelf${product.category ? ` · ${product.category}` : ''}`}
                      </span>
                    </span>
                    <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {formatCurrency(product.price)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <Button variant="ghost" onClick={() => setIsPicking(false)}>
            Back to the invoice
          </Button>
        </div>
      </Modal>

      {/* The same override the till asks for on a deep discount, so one rule and one
          audit trail cover a concession made at either moment. */}
      <AdminUnlockModal
        isOpen={isAskingDiscount}
        onClose={() => setIsAskingDiscount(false)}
        onSuccess={() => {
          setIsAskingDiscount(false);
          setApprovedKey(concessionKey);
          void commitEdit();
        }}
        actionName={`Authorize line discounts on receipt #${transaction.invoiceNumber || transaction.id.slice(0, 8)}: ${discountSummary}`}
        actionType="pos_discount_override"
        targetId={transaction.id}
        actionData={{
          itemType: 'pos_discount',
          invoiceNumber: transaction.invoiceNumber || transaction.id,
          discountAmount: Math.round(concessionsTotal),
          discountPercent: Number(deepestPercent.toFixed(1)),
          discountLines: discountSummary,
          customerName: transaction.customerName || 'Walk-in Customer',
          newTotal: Math.round(newTotal),
        }}
      />
    </>
  );
};
