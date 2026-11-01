import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  GitMerge,
  Store,
  User,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Phone,
  Wrench,
  DollarSign,
  Package,
} from 'lucide-react';
import { useCustomerStore } from '../../store/customerStore';
import { useRepairStore } from '../../store/repairStore';
import { useToast } from '../../components/ui/Toast';
import type { Customer } from '../../types';
import { isShopCustomer, isRetailCustomer } from '../../types';
import { formatCurrency } from '../../utils/formatCurrency';
import styles from './MergeCustomersModal.module.css';

interface MergeCustomersModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialAccountA?: Customer | null;
  initialAccountB?: Customer | null;
  initialReason?: string;
}

export const MergeCustomersModal: React.FC<MergeCustomersModalProps> = ({
  isOpen,
  onClose,
  initialAccountA,
  initialAccountB,
  initialReason,
}) => {
  const { t } = useTranslation();
  const { customers, debts, mergeCustomers, findDuplicates, autoResolveAllDuplicates } = useCustomerStore();
  // Only show active (non-merged) customers in the selectors
  const activeCustomers = useMemo(() => customers.filter(c => !c.mergedIntoId), [customers]);
  const { tickets } = useRepairStore();
  const toast = useToast();

  const detectedDuplicates = useMemo(() => findDuplicates(), [customers, isOpen]);

  const [selectedPairIndex, setSelectedPairIndex] = useState<number>(-1);
  const [accountAId, setAccountAId] = useState<string>('');
  const [accountBId, setAccountBId] = useState<string>('');

  const [keepAs, setKeepAs] = useState<'shop_repairer' | 'retail'>('shop_repairer');
  const [finalName, setFinalName] = useState<string>('');
  const [finalPhone, setFinalPhone] = useState<string>('');
  const [finalShopName, setFinalShopName] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize accounts when modal opens
  useEffect(() => {
    if (!isOpen) return;

    if (initialAccountA && initialAccountB) {
      setAccountAId(initialAccountA.id);
      setAccountBId(initialAccountB.id);
      setSelectedPairIndex(-1);
    } else if (initialAccountA) {
      setAccountAId(initialAccountA.id);
      // Auto-suggest matching duplicate if one exists
      const match = detectedDuplicates.find(
        d => d.retail.id === initialAccountA.id || d.shop.id === initialAccountA.id
      );
      if (match) {
        setAccountBId(match.retail.id === initialAccountA.id ? match.shop.id : match.retail.id);
      } else {
        const other = activeCustomers.find(c => c.id !== initialAccountA.id);
        setAccountBId(other ? other.id : '');
      }
    } else if (detectedDuplicates.length > 0) {
      setSelectedPairIndex(0);
      setAccountAId(detectedDuplicates[0].retail.id);
      setAccountBId(detectedDuplicates[0].shop.id);
    } else {
      const retails = activeCustomers.filter(isRetailCustomer);
      const shops = activeCustomers.filter(isShopCustomer);
      if (retails.length > 0 && shops.length > 0) {
        setAccountAId(retails[0].id);
        setAccountBId(shops[0].id);
      } else if (activeCustomers.length >= 2) {
        setAccountAId(activeCustomers[0].id);
        setAccountBId(activeCustomers[1].id);
      }
    }
  }, [isOpen, initialAccountA, initialAccountB, detectedDuplicates, activeCustomers]);

  const accountA = useMemo(() => activeCustomers.find(c => c.id === accountAId), [activeCustomers, accountAId]);
  const accountB = useMemo(() => activeCustomers.find(c => c.id === accountBId), [activeCustomers, accountBId]);

  // Adjust default destination & final values when selected accounts change
  useEffect(() => {
    if (!accountA && !accountB) return;

    const hasShop = (accountA && isShopCustomer(accountA)) || (accountB && isShopCustomer(accountB));
    const shopCandidate = (accountA && isShopCustomer(accountA)) ? accountA : accountB;
    const retailCandidate = (accountA && !isShopCustomer(accountA)) ? accountA : accountB;

    if (hasShop) {
      setKeepAs('shop_repairer');
      setFinalShopName(shopCandidate?.shopName || `${shopCandidate?.name || 'Shop'}'s Workshop`);
    } else {
      setKeepAs('retail');
      setFinalShopName('');
    }

    const preferredName = shopCandidate?.name || retailCandidate?.name || accountA?.name || '';
    const preferredPhone = shopCandidate?.phone || retailCandidate?.phone || accountA?.phone || '';
    setFinalName(preferredName);
    setFinalPhone(preferredPhone);
  }, [accountAId, accountBId]);

  // Helper stats for an account
  const getAccountStats = (c?: Customer) => {
    if (!c) return { debt: 0, repairsCount: 0, orders: 0, spent: 0 };
    const debt = debts
      .filter(d => d.customerId === c.id && d.status !== 'paid')
      .reduce((sum, d) => sum + d.remainingBalance, 0);
    const cleanPhone = (c.phone || '').replace(/\D/g, '');
    const repairsCount = tickets.filter(
      t => t.customerId === c.id || (cleanPhone && (t.customerPhone || '').replace(/\D/g, '') === cleanPhone)
    ).length;
    return {
      debt,
      repairsCount,
      orders: c.totalPurchases || 0,
      spent: c.totalSpent || 0,
    };
  };

  const statsA = useMemo(() => getAccountStats(accountA), [accountA, debts, tickets]);
  const statsB = useMemo(() => getAccountStats(accountB), [accountB, debts, tickets]);

  const combinedDebt = statsA.debt + statsB.debt;
  const combinedOrders = statsA.orders + statsB.orders;
  const combinedSpent = statsA.spent + statsB.spent;
  const combinedRepairs = statsA.repairsCount + statsB.repairsCount;

  // Decide which account acts as primary (retained ID) and which is secondary (absorbed)
  const primaryAccount = useMemo(() => {
    if (!accountA || !accountB) return null;
    if (keepAs === 'shop_repairer') {
      return isShopCustomer(accountA) ? accountA : accountB;
    } else {
      return !isShopCustomer(accountA) ? accountA : accountB;
    }
  }, [accountA, accountB, keepAs]);

  const secondaryAccount = useMemo(() => {
    if (!accountA || !accountB || !primaryAccount) return null;
    return primaryAccount.id === accountA.id ? accountB : accountA;
  }, [accountA, accountB, primaryAccount]);

  const handleDuplicateSelect = (index: number) => {
    setSelectedPairIndex(index);
    if (detectedDuplicates[index]) {
      setAccountAId(detectedDuplicates[index].retail.id);
      setAccountBId(detectedDuplicates[index].shop.id);
    }
  };

  const handleConfirmMerge = async () => {
    if (!accountA || !accountB || !primaryAccount || !secondaryAccount) {
      toast.error(
        t('customers.invalidSelection', 'Invalid Selection'),
        t('customers.selectTwoDifferentAccounts', 'Please select two different accounts to merge.')
      );
      return;
    }
    if (accountA.id === accountB.id) {
      toast.error(
        t('customers.duplicateSelection', 'Duplicate Selection'),
        t('customers.cannotMergeSelf', 'Cannot merge an account into itself.')
      );
      return;
    }
    if (!finalName.trim()) {
      toast.error(
        t('customers.nameRequired', 'Name Required'),
        t('customers.enterNameForMerged', 'Please enter a name for the merged account.')
      );
      return;
    }
    if (keepAs === 'shop_repairer' && !finalShopName.trim()) {
      toast.error(
        t('customers.shopNameRequired', 'Shop Name Required'),
        t('customers.enterShopNameForB2B', 'Please enter a shop name for the B2B account.')
      );
      return;
    }

    setIsSubmitting(true);
    try {
      await mergeCustomers({
        primaryCustomerId: primaryAccount.id,
        secondaryCustomerId: secondaryAccount.id,
        keepAs,
        customName: finalName.trim(),
        customPhone: finalPhone.trim(),
        customShopName: keepAs === 'shop_repairer' ? finalShopName.trim() : undefined,
        deleteSecondaryDoc: true,
      });

      toast.success(
        t('customers.accountsMergedSuccess', 'Accounts Merged Successfully'),
        t('customers.accountsMergedDesc', {
          secondary: secondaryAccount.name,
          primary: finalName.trim(),
          type: keepAs === 'shop_repairer' ? t('common.b2bShop', 'B2B Shop') : t('common.retailCustomer', 'Retail Client'),
          defaultValue: `Merged "${secondaryAccount.name}" into "${finalName.trim()}" (Kept as ${keepAs === 'shop_repairer' ? 'B2B Shop' : 'Retail Client'}). All debts, repairs, and orders combined into primary account; duplicate customer profile deleted.`
        })
      );
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(
        t('customers.mergeFailed', 'Merge Failed'),
        t('customers.couldNotCompleteMerge', 'Could not complete the account merge.')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMergeAll = async () => {
    if (detectedDuplicates.length === 0) return;
    setIsSubmitting(true);
    try {
      const { mergedCount, deletedCount } = await autoResolveAllDuplicates({ deleteSecondary: true });

      toast.success(
        t('customers.batchFusionCompleted', 'Batch Safe Fusion Completed'),
        t('customers.batchFusionDesc', {
          merged: mergedCount,
          deleted: deletedCount,
          defaultValue: `Successfully merged ${mergedCount} duplicate accounts. Cleaned up ${deletedCount} duplicate accounts from database. All debts, repair history, and orders safely consolidated into single accounts.`
        })
      );
      onClose();
    } catch (err) {
      console.error('Batch merge error:', err);
      toast.error(
        t('customers.batchMergeIncomplete', 'Batch Merge Incomplete'),
        t('customers.batchMergeError', 'An error occurred during batch account fusion.')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('customers.mergeDeduplicateTitle', 'Merge & Deduplicate Customer Accounts')}
      size="md"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <div>
            {detectedDuplicates.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleMergeAll}
                isLoading={isSubmitting}
                style={{
                  borderColor: '#ca8a04',
                  color: '#854d0e',
                  background: '#fefce8',
                  fontWeight: 600,
                }}
              >
                ⚡ {t('customers.autoResolveAll', { count: detectedDuplicates.length, defaultValue: `Auto-Resolve All (${detectedDuplicates.length})` })}
              </Button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirmMerge}
              isLoading={isSubmitting}
              leftIcon={<GitMerge size={16} />}
            >
              {t('customers.mergeRetainPrimary', 'Merge & Retain Primary')}
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.container}>
        {/* Banner Notice */}
        <div className={styles.banner}>
          <GitMerge size={22} className={styles.bannerIcon} />
          <p className={styles.bannerText}>
            {t('customers.step1ChooseAccounts', 'Step 1: Choose Two Customer Accounts to Merge')}
          </p>
        </div>

        {/* Detected Duplicates Picker (if any) */}
        {detectedDuplicates.length > 0 && (
          <div className={styles.duplicateSelectorBar}>
            <div className={styles.duplicateBarHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 600 }}>⚡ {t('customers.detectedDuplicatesTitle', 'Detected Duplicate Accounts')} ({detectedDuplicates.length})</span>
                <span style={{ fontSize: '11px', color: '#a16207' }}>Match: Name or Phone Number</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleMergeAll}
                isLoading={isSubmitting}
                style={{
                  fontSize: '11px',
                  padding: '4px 10px',
                  borderColor: '#ca8a04',
                  color: '#854d0e',
                  background: '#fefce8',
                  fontWeight: 600,
                }}
              >
                ⚡ {t('customers.autoResolveAll', { count: detectedDuplicates.length, defaultValue: `Auto-Resolve All (${detectedDuplicates.length})` })}
              </Button>
            </div>
            <select
              className={styles.duplicateSelect}
              value={selectedPairIndex}
              onChange={(e) => handleDuplicateSelect(Number(e.target.value))}
            >
              <option value={-1}>-- {t('customers.resolveThisPair', 'Choose a detected duplicate or select manually below')} --</option>
              {detectedDuplicates.map((dup, idx) => (
                <option key={`${dup.retail.id}_${dup.shop.id}`} value={idx}>
                  {isShopCustomer(dup.retail) ? '🏪' : '👤'} {dup.retail.shopName ? `${dup.retail.shopName} (${dup.retail.name})` : dup.retail.name} ({dup.retail.phone || 'No phone'}) ➔ {isShopCustomer(dup.shop) ? '🏪' : '👤'} {dup.shop.shopName ? `${dup.shop.shopName} (${dup.shop.name})` : dup.shop.name} ({dup.shop.phone || 'No phone'}) — [{dup.reason}]
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Side-by-Side Account Selectors and Profiles */}
        <div className={styles.comparisonGrid}>
          {/* Account A Card */}
          <div className={`${styles.accountCard} ${styles.accountCardActive}`}>
            <div className={styles.searchSelectWrap}>
              <label className={styles.selectLabel}>{t('customers.accountA', 'Account A')}:</label>
              <select
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  background: '#ffffff',
                }}
                value={accountAId}
                onChange={(e) => {
                  setAccountAId(e.target.value);
                  setSelectedPairIndex(-1);
                }}
              >
                {activeCustomers.map(c => (
                  <option key={c.id} value={c.id} disabled={c.id === accountBId}>
                    {isShopCustomer(c) ? '🏪 [Shop] ' : '👤 [Retail] '}
                    {c.shopName ? `${c.shopName} (${c.name})` : c.name} — {c.phone}
                  </option>
                ))}
              </select>
            </div>

            {accountA && (
              <>
                <div className={styles.accountCardHeader}>
                  <div>
                    <h4 className={styles.accountName}>{accountA.name}</h4>
                    {accountA.shopName && (
                      <p className={styles.accountShopName}>🏪 {accountA.shopName}</p>
                    )}
                  </div>
                  <span className={isShopCustomer(accountA) ? styles.accountBadgeShop : styles.accountBadgeRetail}>
                    {isShopCustomer(accountA) ? `🏪 ${t('common.b2bShop', 'B2B Shop')}` : `👤 ${t('common.retailCustomer', 'Retail')}`}
                  </span>
                </div>

                <div className={styles.accountMeta}>
                  <span>📞 {accountA.phone || t('common.none', 'No phone')}</span>
                  {accountA.email && <span>✉️ {accountA.email}</span>}
                </div>

                <div className={styles.statRow}>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>{t('customers.debtBalance', 'Debt Balance')}</span>
                    <span className={styles.statValue} style={{ color: statsA.debt > 0 ? '#dc2626' : '#16a34a' }}>
                      {formatCurrency(statsA.debt)}
                    </span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>{t('customers.repairs', 'Repair Phones')}</span>
                    <span className={styles.statValue}>{statsA.repairsCount}</span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>{t('customers.orders', 'Orders')}</span>
                    <span className={styles.statValue}>{statsA.orders}</span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>{t('customers.totalSpent', 'Spent')}</span>
                    <span className={styles.statValue}>{formatCurrency(statsA.spent)}</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Merge Arrow */}
          <div className={styles.mergeArrowWrap}>
            <div style={{
              background: '#e2e8f0',
              borderRadius: '50%',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#475569',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}>
              <GitMerge size={18} />
            </div>
          </div>

          {/* Account B Card */}
          <div className={`${styles.accountCard} ${styles.accountCardActive}`}>
            <div className={styles.searchSelectWrap}>
              <label className={styles.selectLabel}>{t('customers.accountB', 'Account B')}:</label>
              <select
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  background: '#ffffff',
                }}
                value={accountBId}
                onChange={(e) => {
                  setAccountBId(e.target.value);
                  setSelectedPairIndex(-1);
                }}
              >
                {activeCustomers.map(c => (
                  <option key={c.id} value={c.id} disabled={c.id === accountAId}>
                    {isShopCustomer(c) ? '🏪 [Shop] ' : '👤 [Retail] '}
                    {c.shopName ? `${c.shopName} (${c.name})` : c.name} — {c.phone}
                  </option>
                ))}
              </select>
            </div>

            {accountB && (
              <>
                <div className={styles.accountCardHeader}>
                  <div>
                    <h4 className={styles.accountName}>{accountB.name}</h4>
                    {accountB.shopName && (
                      <p className={styles.accountShopName}>🏪 {accountB.shopName}</p>
                    )}
                  </div>
                  <span className={isShopCustomer(accountB) ? styles.accountBadgeShop : styles.accountBadgeRetail}>
                    {isShopCustomer(accountB) ? `🏪 ${t('common.b2bShop', 'B2B Shop')}` : `👤 ${t('common.retailCustomer', 'Retail')}`}
                  </span>
                </div>

                <div className={styles.accountMeta}>
                  <span>📞 {accountB.phone || t('common.none', 'No phone')}</span>
                  {accountB.email && <span>✉️ {accountB.email}</span>}
                </div>

                <div className={styles.statRow}>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>{t('customers.debtBalance', 'Debt Balance')}</span>
                    <span className={styles.statValue} style={{ color: statsB.debt > 0 ? '#dc2626' : '#16a34a' }}>
                      {formatCurrency(statsB.debt)}
                    </span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>{t('customers.repairs', 'Repair Phones')}</span>
                    <span className={styles.statValue}>{statsB.repairsCount}</span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>{t('customers.orders', 'Orders')}</span>
                    <span className={styles.statValue}>{statsB.orders}</span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>{t('customers.totalSpent', 'Spent')}</span>
                    <span className={styles.statValue}>{formatCurrency(statsB.spent)}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Destination Decision */}
        <div className={styles.decisionSection}>
          <span className={styles.decisionTitle}>
            <CheckCircle2 size={16} color="#2563eb" /> {t('customers.step2ChooseDetails', 'Step 2: Choose Merged Account Type & Details')}
          </span>

          <div className={styles.optionCards}>
            {/* Keep in Shop */}
            <div
              className={`${styles.optionCard} ${
                keepAs === 'shop_repairer' ? styles.optionCardSelectedShop : ''
              }`}
              onClick={() => setKeepAs('shop_repairer')}
            >
              <div className={styles.optionCardHeader}>
                <span className={styles.optionTitle} style={{ color: '#b45309' }}>
                  <Store size={16} /> {t('customers.keepAsShop', 'Keep as B2B Shop Account')}
                </span>
                <div
                  className={`${styles.optionRadio} ${
                    keepAs === 'shop_repairer' ? styles.optionRadioActiveShop : ''
                  }`}
                >
                  {keepAs === 'shop_repairer' && <div className={styles.optionRadioInner} />}
                </div>
              </div>
              <p className={styles.optionDesc}>
                {t('customers.upgradeClientToShopDesc', { name: finalName, defaultValue: 'Will remain listed in Shops & Parts Accounts. Retains B2B wholesale pricing.' })}
              </p>
            </div>

            {/* Keep in Retail */}
            <div
              className={`${styles.optionCard} ${
                keepAs === 'retail' ? styles.optionCardSelectedRetail : ''
              }`}
              onClick={() => setKeepAs('retail')}
            >
              <div className={styles.optionCardHeader}>
                <span className={styles.optionTitle} style={{ color: '#1d4ed8' }}>
                  <User size={16} /> {t('customers.keepAsRetail', 'Keep as Retail Client')}
                </span>
                <div
                  className={`${styles.optionRadio} ${
                    keepAs === 'retail' ? styles.optionRadioActiveRetail : ''
                  }`}
                >
                  {keepAs === 'retail' && <div className={styles.optionRadioInner} />}
                </div>
              </div>
              <p className={styles.optionDesc}>
                {t('customers.convertShopToRetailDesc', { name: finalName, defaultValue: 'Will remain listed in Retail Customer Directory.' })}
              </p>
            </div>
          </div>
        </div>

        {/* Final Account Fields Confirmation */}
        <div className={styles.fieldsGrid}>
          <div>
            <label className={styles.selectLabel}>{t('customers.finalName', 'Final Contact / Customer Name *')}</label>
            <Input
              value={finalName}
              onChange={setFinalName}
              placeholder="e.g. Karim Benali"
            />
          </div>
          <div>
            <label className={styles.selectLabel}>{t('customers.finalPhone', 'Final Phone Number *')}</label>
            <Input
              value={finalPhone}
              onChange={setFinalPhone}
              placeholder="e.g. 0555 12 34 56"
            />
          </div>
          {keepAs === 'shop_repairer' && (
            <div style={{ gridColumn: 'span 2' }}>
              <label className={styles.selectLabel}>{t('customers.shopWorkshopNameRequired', 'Shop / Workshop Name *')}</label>
              <Input
                value={finalShopName}
                onChange={setFinalShopName}
                placeholder="e.g. Benali Phone Repair"
              />
            </div>
          )}
        </div>

        {/* Consolidation Summary Box */}
        <div className={styles.summaryBox}>
          <span className={styles.summaryTitle}>{t('customers.summaryConsolidated', 'Summary of Consolidated Account')}</span>
          <div className={styles.summaryGrid}>
            <div className={styles.summaryItem}>
              <span className={styles.summaryItemLabel}>{t('customers.activeDebt', 'Combined Debt')}</span>
              <span
                className={styles.summaryItemValue}
                style={{ color: combinedDebt > 0 ? '#d97706' : '#16a34a' }}
              >
                {formatCurrency(combinedDebt)}
              </span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryItemLabel}>{t('customers.totalOrders', 'Total Orders')}</span>
              <span className={styles.summaryItemValue}>{combinedOrders}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryItemLabel}>{t('customers.totalRepairs', 'Repair Phones Preserved')}</span>
              <span className={styles.summaryItemValue}>{combinedRepairs}</span>
            </div>
          </div>
          {secondaryAccount && (
            <p style={{ margin: 0, fontSize: '12px', color: '#92400e', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle size={13} />
              {secondaryAccount.shopName || secondaryAccount.name} ➔ {finalName}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
};
