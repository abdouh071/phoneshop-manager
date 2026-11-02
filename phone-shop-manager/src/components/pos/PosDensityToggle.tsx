import React from 'react';
import { Laptop, Monitor, TabletSmartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePosDensityStore, type PosDensity } from '../../store/posDensityStore';
import { useToast } from '../ui/Toast';
import styles from './PosDensityToggle.module.css';

interface Props {
  className?: string;
  showLabels?: boolean;
}

export const PosDensityToggle: React.FC<Props> = ({ className, showLabels = true }) => {
  const { t } = useTranslation();
  const { density, setDensity } = usePosDensityStore();
  const toast = useToast();

  const handleSelect = (newDensity: PosDensity) => {
    if (newDensity === density) return;
    setDensity(newDensity);
    const label =
      newDensity === 'compact'
        ? t('density.compactTitle')
        : newDensity === 'touch'
        ? t('density.touchTitle')
        : t('density.standardTitle');
    const sub =
      newDensity === 'compact'
        ? t('density.compactDesc')
        : newDensity === 'touch'
        ? t('density.touchDesc')
        : t('density.standardDesc');
    toast.info(label, sub);
  };

  return (
    <div className={[styles.densityToggle, className].filter(Boolean).join(' ')} role="group" aria-label={t('density.groupLabel')}>
      <button
        type="button"
        className={[
          styles.densityBtn,
          density === 'compact' && styles.densityBtnActive,
        ].filter(Boolean).join(' ')}
        onClick={() => handleSelect('compact')}
        title={t('density.compactHint')}
      >
        <Laptop size={14} />
        {showLabels && <span className={styles.btnLabel}>{t('density.compact')}</span>}
      </button>

      <button
        type="button"
        className={[
          styles.densityBtn,
          density === 'comfortable' && styles.densityBtnActive,
        ].filter(Boolean).join(' ')}
        onClick={() => handleSelect('comfortable')}
        title={t('density.standardHint')}
      >
        <Monitor size={14} />
        {showLabels && <span className={styles.btnLabel}>{t('density.standard')}</span>}
      </button>

      <button
        type="button"
        className={[
          styles.densityBtn,
          density === 'touch' && (styles.densityBtnActiveTouch || styles.densityBtnActive),
        ].filter(Boolean).join(' ')}
        onClick={() => handleSelect('touch')}
        title={t('density.touchHint')}
      >
        <TabletSmartphone size={14} />
        {showLabels && <span className={styles.btnLabel}>{t('density.touch')}</span>}
      </button>
    </div>
  );
};
