import React from 'react';
import { Camera, BadgeDollarSign } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SearchInput } from '../../components/ui/Input';
import { formatCurrency } from '../../utils/formatCurrency';
import { EndOfDayButton } from '../endofday/EndOfDayButton';
import styles from './POS.module.css';

interface PosPanelHeaderProps {
  activeTab: 'products' | 'history';
  setActiveTab: React.Dispatch<React.SetStateAction<'products' | 'history'>>;
  scannerScanned: boolean;
  setIsCameraScannerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsCashDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  todayNetCash: number;
}

export const PosPanelHeader: React.FC<PosPanelHeaderProps> = ({
  activeTab,
  setActiveTab,
  scannerScanned,
  setIsCameraScannerOpen,
  setIsCashDrawerOpen,
  searchQuery,
  setSearchQuery,
  todayNetCash,
}) => {
  const { t } = useTranslation();

  return (
    <div className={styles.panelHeader}>
      <div className={styles.tabs}>
        <button 
          className={[styles.tab, activeTab === 'products' && styles.tabActive].filter(Boolean).join(' ')}
          onClick={() => setActiveTab('products')}
        >
          {t('pos.title', 'Point of Sale')}
        </button>
        <button 
          className={[styles.tab, activeTab === 'history' && styles.tabActive].filter(Boolean).join(' ')}
          onClick={() => setActiveTab('history')}
        >
          {t('pos.transactionHistory', 'Transaction History')}
        </button>
      </div>
      
      <div className={styles.headerRight}>
        {/* Hardware Barcode Scanner Status Indicator */}
        <div
          className={[styles.scannerBadge, scannerScanned && styles.scannerScanned].filter(Boolean).join(' ')}
          title="Hardware barcode scanner is active. Scanning any SKU adds item directly to cart."
        >
          <span className={styles.scannerDot} />
          <span>{scannerScanned ? 'Barcode Scanned!' : 'Scanner Ready'}</span>
        </div>

        <button
          type="button"
          className={styles.cashDrawerBtn}
          onClick={() => setIsCameraScannerOpen(true)}
          title="Scan product barcode with phone camera"
        >
          <Camera size={16} />
          <span>Camera Scan</span>
        </button>

        <button
          type="button"
          className={styles.cashDrawerBtn}
          onClick={() => setIsCashDrawerOpen(true)}
          title="View Cash Drawer & End-of-Day (Z-Report) Summary"
        >
          <BadgeDollarSign size={16} />
          <span>{t('pos.cashDrawer', 'Cash Drawer')}</span>
          <span className={styles.cashDrawerAmount}>{formatCurrency(todayNetCash)}</span>
        </button>

        {activeTab === 'products' && (
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={t('pos.searchProducts', 'Search products…')}
            className={styles.search}
          />
        )}
        <EndOfDayButton variant="compact" />
      </div>
    </div>
  );
};
