import React from 'react';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import type { CartItem, Customer } from '../../types';
import { formatCurrency, formatPrivateCurrency } from '../../utils/formatCurrency';
import { DISCOUNT_APPROVAL_PERCENT, discountPercentOf, requiresDiscountApproval } from '../../utils/discountPolicy';
import styles from './POS.module.css';

interface PosCartFooterProps {
  items: CartItem[];
  getTotal: () => number;
  getPurchasesSubtotal: () => number;
  getReturnsSubtotal: () => number;
  getDiscountAmount: () => number;
  hasReturnItems: () => boolean;
  matchedCustomer: Customer | null;
  currentCustomerDebt: number;
  creditDebtToLog: number;
  netPayable: number;
  isCreditLimitExceeded: boolean;
  tenderPresets: number[];
  currencySymbol: string;
  isAdmin: boolean;
  creditLimitOverrideApproved: boolean;
  isBusy: boolean;
  handleCheckout: () => void;
  paymentMode: 'cash' | 'mobile' | 'card' | 'debt';
  setPaymentMode: React.Dispatch<React.SetStateAction<'cash' | 'mobile' | 'card' | 'debt'>>;
  surplusRefundMethod: 'cash' | 'store_credit' | 'debt_deduction';
  setSurplusRefundMethod: React.Dispatch<React.SetStateAction<'cash' | 'store_credit' | 'debt_deduction'>>;
  applyStoreCredit: boolean;
  setApplyStoreCredit: React.Dispatch<React.SetStateAction<boolean>>;
  cashTendered: number | string;
  setCashTendered: React.Dispatch<React.SetStateAction<number | string>>;
  downPayment: number;
  setDownPayment: React.Dispatch<React.SetStateAction<number>>;
  customerName: string;
  customerPhone: string;
  setCustomerPhone: (phone: string) => void;
  customerAttached: boolean;
  pendingDiscountValue: number | null;
  setPendingDiscountValue: React.Dispatch<React.SetStateAction<number | null>>;
  discount: { type: 'percent' | 'flat'; value: number } | null;
  setDiscount: (discount: { type: 'percent' | 'flat'; value: number } | null) => void;
  setShowCreditLimitUnlock: React.Dispatch<React.SetStateAction<boolean>>;
  setShowDiscountUnlock: React.Dispatch<React.SetStateAction<boolean>>;
}

export const PosCartFooter: React.FC<PosCartFooterProps> = ({
  items,
  getTotal,
  getPurchasesSubtotal,
  getReturnsSubtotal,
  getDiscountAmount,
  hasReturnItems,
  matchedCustomer,
  currentCustomerDebt,
  creditDebtToLog,
  netPayable,
  isCreditLimitExceeded,
  tenderPresets,
  currencySymbol,
  isAdmin,
  creditLimitOverrideApproved,
  isBusy,
  handleCheckout,
  paymentMode,
  setPaymentMode,
  surplusRefundMethod,
  setSurplusRefundMethod,
  applyStoreCredit,
  setApplyStoreCredit,
  cashTendered,
  setCashTendered,
  downPayment,
  setDownPayment,
  customerName,
  customerPhone,
  setCustomerPhone,
  customerAttached,
  pendingDiscountValue,
  setPendingDiscountValue,
  discount,
  setDiscount,
  setShowCreditLimitUnlock,
  setShowDiscountUnlock,
}) => {
  /**
   * The share of the basket the till is giving away, whatever the cashier typed into
   * the dinar field. A number of dinars says nothing about depth on its own — the
   * threshold is a share, so the screen has to name it.
   */
  const discountShare = discount
    ? discountPercentOf(getPurchasesSubtotal(), { mode: discount.type === 'percent' ? 'percent' : 'flat', value: discount.value })
    : 0;

  return (
          <div className={styles.cartFooter}>
            {/* If net total is negative (Shop owes customer money) — choose settlement method (Problem 6 fix) */}
            {getTotal() < 0 ? (
              <div className={styles.surplusRefundBox}>
                <div className={styles.surplusHeader}>
                  <span>🔄 Product Return — Surplus Due:</span>
                  <span className={styles.surplusDue}>{formatCurrency(Math.abs(getTotal()))}</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                  <button
                    type="button"
                    className={[styles.payBtn, surplusRefundMethod === 'cash' && styles.payActive].filter(Boolean).join(' ')}
                    onClick={() => setSurplusRefundMethod('cash')}
                    style={{ flex: 1, padding: '6px 8px', fontSize: '11px' }}
                  >
                    💵 Cash Refund
                  </button>
                  <button
                    type="button"
                    className={[styles.payBtn, surplusRefundMethod === 'store_credit' && styles.payActive].filter(Boolean).join(' ')}
                    onClick={() => setSurplusRefundMethod('store_credit')}
                    style={{ flex: 1, padding: '6px 8px', fontSize: '11px' }}
                  >
                    🎟️ Store Credit (Avoir)
                  </button>
                  {matchedCustomer && currentCustomerDebt > 0 && (
                    <button
                      type="button"
                      className={[styles.payBtn, surplusRefundMethod === 'debt_deduction' && styles.payActive].filter(Boolean).join(' ')}
                      onClick={() => setSurplusRefundMethod('debt_deduction')}
                      style={{ flex: 1, padding: '6px 8px', fontSize: '11px' }}
                    >
                      📒 Deduct Debt
                    </button>
                  )}
                </div>
                <p style={{ fontSize: '11px', color: '#92400e', margin: '6px 0 0', fontWeight: 500 }}>
                  {surplusRefundMethod === 'cash'
                    ? `💵 Return ${formatCurrency(Math.abs(getTotal()))} cash from the drawer to ${customerName || 'customer'}.`
                    : surplusRefundMethod === 'store_credit'
                    ? `🎟️ Issue ${formatCurrency(Math.abs(getTotal()))} Store Credit (Avoir) to ${customerName || 'customer'}.`
                    : `📒 Deduct ${formatCurrency(Math.abs(getTotal()))} from ${customerName}'s open debt balance.`}
                </p>
              </div>
            ) : getTotal() === 0 ? (
              <div className={styles.surplusRefundBox} style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}>
                <div className={styles.surplusHeader} style={{ color: '#166534' }}>
                  <span>🔄 Even Exchange (0 DA Difference)</span>
                  <span style={{ color: '#15803d', fontWeight: 800 }}>0 DA</span>
                </div>
                <p style={{ fontSize: '11px', color: '#15803d', margin: '2px 0 0' }}>
                  Returned items will be restocked and replacement items deducted at no charge.
                </p>
              </div>
            ) : (
              /* Regular or Deficit exchange where customer owes money */
              <div className={styles.paymentMethods}>
                {/* Store credit available banner if customer has active avoir */}
                {matchedCustomer && (matchedCustomer.storeCredit || 0) > 0 && (
                  <label className={styles.storeCreditUseToggle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="checkbox"
                        checked={applyStoreCredit}
                        onChange={e => setApplyStoreCredit(e.target.checked)}
                        style={{ cursor: 'pointer', accentColor: '#16a34a' }}
                      />
                      <span>🎟️ Use Store Credit ({formatPrivateCurrency(matchedCustomer.storeCredit || 0)} available)</span>
                    </div>
                    {applyStoreCredit && (
                      <span style={{ color: '#15803d', fontWeight: 800 }}>
                        -{formatPrivateCurrency(Math.min(matchedCustomer.storeCredit || 0, getTotal()))}
                      </span>
                    )}
                  </label>
                )}

                <div className={styles.payBtns} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
                  <button
                    type="button"
                    className={[styles.payBtn, paymentMode === 'cash' && styles.payActive].filter(Boolean).join(' ')}
                    onClick={() => setPaymentMode('cash')}
                    style={{ padding: '8px 2px', fontSize: '11px' }}
                  >
                    💵 Cash
                  </button>
                  <button
                    type="button"
                    className={[styles.payBtn, paymentMode === 'mobile' && styles.payActive].filter(Boolean).join(' ')}
                    onClick={() => setPaymentMode('mobile')}
                    style={{ padding: '8px 2px', fontSize: '11px' }}
                    title="BaridiMob / Bank Transfer"
                  >
                    📱 Mobile
                  </button>
                  <button
                    type="button"
                    className={[styles.payBtn, paymentMode === 'card' && styles.payActive].filter(Boolean).join(' ')}
                    onClick={() => setPaymentMode('card')}
                    style={{ padding: '8px 2px', fontSize: '11px' }}
                    title="CIB / Dahabia Card"
                  >
                    💳 Card
                  </button>
                  <button
                    type="button"
                    className={[styles.payBtn, paymentMode === 'debt' && styles.payActiveDebt].filter(Boolean).join(' ')}
                    onClick={() => setPaymentMode('debt')}
                    style={{ padding: '8px 2px', fontSize: '11px' }}
                  >
                    📒 Credit
                  </button>
                </div>

                {/* Instant Cash Tendered & Change Due Calculator */}
                {paymentMode === 'cash' && netPayable > 0 && (
                  <div className={styles.tenderCalculator}>
                    <div className={styles.tenderHeader}>
                      <span>💵 Cash Received & Change</span>
                      {cashTendered !== '' && Number(cashTendered) > 0 && (
                        <button
                          type="button"
                          onClick={() => setCashTendered('')}
                          style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                        >
                          Reset
                        </button>
                      )}
                    </div>

                    {/* Quick Tender Denomination Presets */}
                    <div className={styles.tenderPresetRow}>
                      <button
                        type="button"
                        className={[styles.tenderPresetBtn, Number(cashTendered) === netPayable && styles.tenderPresetBtnActive].filter(Boolean).join(' ')}
                        onClick={() => setCashTendered(netPayable)}
                      >
                        Exact ({formatCurrency(netPayable)})
                      </button>
                      {tenderPresets.map(val => (
                        <button
                          key={val}
                          type="button"
                          className={[styles.tenderPresetBtn, Number(cashTendered) === val && styles.tenderPresetBtnActive].filter(Boolean).join(' ')}
                          onClick={() => setCashTendered(val)}
                        >
                          {formatCurrency(val)}
                        </button>
                      ))}
                    </div>

                    {/* Tender Amount Input */}
                    <div className={styles.tenderInputWrap}>
                      <input
                        type="number"
                        placeholder={`Amount received (e.g. ${netPayable})`}
                        value={cashTendered === '' ? '' : cashTendered}
                        onChange={e => setCashTendered(e.target.value === '' ? '' : Number(e.target.value))}
                        className={styles.tenderInput}
                      />
                      <span className={styles.tenderCurrency}>{currencySymbol}</span>
                    </div>

                    {/* Change Due or Remaining Balance Banner */}
                    {cashTendered !== '' && Number(cashTendered) >= netPayable && (
                      <div className={styles.changeDueBanner}>
                        <span className={styles.changeDueLabel}>
                          <span>🪙</span> Change Due:
                        </span>
                        <span className={styles.changeDueAmount}>
                          {formatCurrency(Number(cashTendered) - netPayable)}
                        </span>
                      </div>
                    )}

                    {cashTendered !== '' && Number(cashTendered) > 0 && Number(cashTendered) < netPayable && (
                      <div className={styles.shortAmountBanner}>
                        <span className={styles.shortAmountLabel}>Remaining Due:</span>
                        <span className={styles.shortAmountValue}>
                          {formatCurrency(netPayable - Number(cashTendered))}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Warning if Credit Tab selected without any customer name */}
                {paymentMode === 'debt' && (!customerName || !customerName.trim()) && (
                  <div className={styles.debtWarningBox}>
                    <AlertCircle size={14} />
                    <span>Enter a customer name above to use Credit Tab.</span>
                  </div>
                )}

                {/* Phone required prompt — if customer name is entered but phone is missing */}
                {paymentMode === 'debt' && customerName && customerName.trim() && !(customerAttached && matchedCustomer?.phone) && (
                  <div style={{ marginTop: '2px' }}>
                    <Input
                      label="Customer Phone (Required for Credit)"
                      placeholder="e.g. 0550 123 456"
                      type="tel"
                      value={customerPhone}
                      onChange={e => setCustomerPhone(e.target.value)}
                      style={{ borderColor: customerPhone && customerPhone.trim() ? 'var(--color-outline-variant, #cbd5e1)' : '#f59e0b' }}
                    />
                    {!matchedCustomer && (
                      <p style={{ fontSize: '10.5px', color: '#15803d', marginTop: '2px', fontWeight: 600 }}>
                        ✨ New customer profile will be created on checkout.
                      </p>
                    )}
                  </div>
                )}

                {/* Partial Payment & Credit Debt Preview — when customer name is present */}
                {paymentMode === 'debt' && customerName && customerName.trim() && (
                  <div className={styles.creditBoxCompact}>
                    <div className={styles.creditInputRow}>
                      <span className={styles.creditLabel}>💰 Paid Now:</span>
                      <div className={styles.creditInputWrap}>
                        <input
                          type="number"
                          placeholder="0 (Full Credit)"
                          min={0}
                          max={Math.max(0, getTotal() - ((applyStoreCredit && matchedCustomer?.storeCredit) ? Math.min(matchedCustomer.storeCredit, getTotal()) : 0))}
                          value={downPayment === 0 ? '' : downPayment}
                          onChange={e => {
                            const raw = e.target.value;
                            const maxPayable = Math.max(0, getTotal() - ((applyStoreCredit && matchedCustomer?.storeCredit) ? Math.min(matchedCustomer.storeCredit, getTotal()) : 0));
                            if (raw === '') {
                              setDownPayment(0);
                            } else {
                              const v = Math.max(0, Number(raw));
                              setDownPayment(Math.min(v, maxPayable));
                            }
                          }}
                          className={styles.creditInputField}
                        />
                        <span className={styles.creditCurrencyBadge}>DA</span>
                      </div>
                    </div>

                    {downPayment > 0 && (
                      <div className={styles.creditQuickBadges}>
                        {[0.25, 0.5, 0.75].map(pct => (
                          <button
                            key={pct}
                            type="button"
                            className={styles.quickPayBadge}
                            onClick={() => {
                              const maxPayable = Math.max(0, getTotal() - ((applyStoreCredit && matchedCustomer?.storeCredit) ? Math.min(matchedCustomer.storeCredit, getTotal()) : 0));
                              setDownPayment(Math.round(maxPayable * pct));
                            }}
                          >
                            {Math.round(pct * 100)}%
                          </button>
                        ))}
                        <button
                          type="button"
                          className={styles.quickPayBadge}
                          onClick={() => {
                            const maxPayable = Math.max(0, getTotal() - ((applyStoreCredit && matchedCustomer?.storeCredit) ? Math.min(matchedCustomer.storeCredit, getTotal()) : 0));
                            setDownPayment(maxPayable);
                          }}
                        >
                          Full
                        </button>
                      </div>
                    )}

                    <div className={styles.creditMetricsRow}>
                      <div className={styles.creditMetric}>
                        <span className={styles.creditMetricLabel}>On Credit:</span>
                        <strong className={styles.creditMetricValue}>
                          +{formatPrivateCurrency(Math.max(0, getTotal() - ((applyStoreCredit && matchedCustomer?.storeCredit) ? Math.min(matchedCustomer.storeCredit, getTotal()) : 0) - (downPayment || 0)))}
                        </strong>
                      </div>
                      <div className={styles.creditMetric}>
                        <span className={styles.creditMetricLabel}>New Total:</span>
                        <strong className={styles.creditMetricTotal}>
                          {formatPrivateCurrency((matchedCustomer?.totalDebt || 0) + Math.max(0, getTotal() - ((applyStoreCredit && matchedCustomer?.storeCredit) ? Math.min(matchedCustomer.storeCredit, getTotal()) : 0) - (downPayment || 0)))}
                        </strong>
                      </div>
                    </div>

                    {/* Problem 2 fix: Real-time credit limit breach warning banner */}
                    {isCreditLimitExceeded && (
                      <div style={{ background: '#fef2f2', border: '1px solid #ef4444', borderRadius: '6px', padding: '8px 10px', fontSize: '11px', color: '#991b1b', marginTop: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 700 }}>
                          <AlertCircle size={14} />
                          <span>Credit Limit Exceeded!</span>
                        </div>
                        <p style={{ margin: '3px 0 0' }}>
                          Current debt: {formatPrivateCurrency(currentCustomerDebt)} + New: {formatPrivateCurrency(creditDebtToLog)} = {formatPrivateCurrency(currentCustomerDebt + creditDebtToLog)}.
                          Limit is {formatPrivateCurrency(matchedCustomer?.creditLimit || 0)}.
                        </p>
                        {creditLimitOverrideApproved || isAdmin ? (
                          <p style={{ margin: '4px 0 0', color: '#15803d', fontWeight: 600 }}>
                            ✓ Admin override authorized.
                          </p>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowCreditLimitUnlock(true)}
                            style={{
                              marginTop: '6px',
                              width: '100%',
                              padding: '5px 8px',
                              background: '#dc2626',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              fontSize: '11px',
                            }}
                          >
                            Authorize Admin Override
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Subtotals & Exchange Breakdown */}
            <div className={styles.totals}>
              {hasReturnItems() && (
                <>
                  <div className={styles.totalRow} style={{ color: 'var(--color-on-surface-variant)', fontSize: '11.5px' }}>
                    <span>Purchases (+):</span>
                    <span>{formatCurrency(getPurchasesSubtotal())}</span>
                  </div>
                  <div className={styles.totalRow} style={{ color: '#b45309', fontSize: '11.5px' }}>
                    <span>Returned Items (-):</span>
                    <span>-{formatCurrency(getReturnsSubtotal())}</span>
                  </div>
                </>
              )}

              <div className={styles.discountRowCompact}>
                <span className={styles.discountLabel}>Discount (DA):</span>
                <input
                  type="number"
                  placeholder="0"
                  title={`${DISCOUNT_APPROVAL_PERCENT}% of the basket or less; deeper needs an admin`}
                  value={pendingDiscountValue !== null ? pendingDiscountValue.toString() : (discount?.value ? discount.value.toString() : '')}
                  onChange={e => {
                    const raw = e.target.value;
                    if (raw === '') {
                      setPendingDiscountValue(null);
                      setDiscount(null);
                      return;
                    }
                    const v = Number(raw);
                    // The rule is the share of the basket, not a number of dinars: a
                    // thousand off a cable was stopped while a thousand off a phone —
                    // one percent of it — was free, and a deeper cut on a small sale
                    // walked straight through. Same measure the technician phone runs.
                    if (requiresDiscountApproval(isAdmin ? 'admin' : 'sales_agent', getPurchasesSubtotal(), { mode: 'flat', value: v })) {
                      setPendingDiscountValue(v);
                      setShowDiscountUnlock(true);
                    } else if (v > 0) {
                      setPendingDiscountValue(null);
                      setDiscount({ type: 'flat', value: v });
                    } else {
                      setPendingDiscountValue(null);
                      setDiscount(null);
                    }
                  }}
                  className={styles.discountInputCompact}
                />
              </div>

              {getDiscountAmount() > 0 && (
                <div className={styles.totalRow} style={{ color: 'var(--color-danger-text, #dc2626)' }}>
                  <span>Discount ({discountShare.toFixed(1)}%)</span>
                  <span>-{formatCurrency(getDiscountAmount())}</span>
                </div>
              )}

              <div className={[styles.totalRow, styles.grandTotal].join(' ')}>
                <span>{getTotal() < 0 ? 'Refund Due' : 'Net Total'}</span>
                <span style={{ color: getTotal() < 0 ? '#b45309' : undefined }}>
                  {getTotal() < 0 ? `-${formatCurrency(Math.abs(getTotal()))}` : formatCurrency(getTotal())}
                </span>
              </div>
            </div>

            {/* Problem 7 fix: Underpaid warning banner */}
            {paymentMode === 'cash' && cashTendered !== '' && Number(cashTendered) > 0 && Number(cashTendered) < netPayable && (
              <div style={{ background: '#fef2f2', border: '1px solid #f87171', borderRadius: '6px', padding: '6px 10px', fontSize: '11px', color: '#b91c1c', marginBottom: '8px', textAlign: 'center' }}>
                ⚠️ Underpaid by {formatCurrency(netPayable - Number(cashTendered))}. Collect full cash or switch to Credit Tab.
              </div>
            )}

            <Button
              size="lg"
              className={styles.checkoutBtn}
              onClick={handleCheckout}
              disabled={isBusy || items.length === 0 || (paymentMode === 'cash' && cashTendered !== '' && Number(cashTendered) > 0 && Number(cashTendered) < netPayable)}
              isLoading={isBusy}
              leftIcon={<CheckCircle size={18} />}
              style={{
                background: getTotal() < 0 ? '#b45309' : (getTotal() === 0 ? '#15803d' : undefined),
                borderColor: getTotal() < 0 ? '#92400e' : (getTotal() === 0 ? '#166534' : undefined),
              }}
            >
              {isBusy
                ? (hasReturnItems() ? 'Processing Exchange...' : 'Processing Sale...')
                : (getTotal() < 0
                  ? `Complete Exchange • Refund ${formatCurrency(Math.abs(getTotal()))}`
                  : getTotal() === 0
                    ? 'Complete Even Exchange • 0 DA'
                    : hasReturnItems()
                      ? `Complete Exchange • ${formatCurrency(Math.max(0, getTotal() - ((applyStoreCredit && matchedCustomer?.storeCredit) ? Math.min(matchedCustomer.storeCredit, getTotal()) : 0)))}`
                      : `Complete Sale • ${formatCurrency(Math.max(0, getTotal() - ((applyStoreCredit && matchedCustomer?.storeCredit) ? Math.min(matchedCustomer.storeCredit, getTotal()) : 0)))}`)}
            </Button>
          </div>
  );
};
