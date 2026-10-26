import React from 'react';
import { Laptop, Monitor, TabletSmartphone } from 'lucide-react';
import { usePosDensityStore, type PosDensity } from '../../store/posDensityStore';
import { useToast } from '../ui/Toast';
import styles from './PosDensityToggle.module.css';

interface Props {
  className?: string;
  showLabels?: boolean;
}

export const PosDensityToggle: React.FC<Props> = ({ className, showLabels = true }) => {
  const { density, setDensity } = usePosDensityStore();
  const toast = useToast();

  const handleSelect = (newDensity: PosDensity) => {
    if (newDensity === density) return;
    setDensity(newDensity);
    const label =
      newDensity === 'compact'
        ? 'Compact Laptop Mode (Alt+D)'
        : newDensity === 'touch'
        ? 'Touchscreen POS Mode (Alt+D)'
        : 'Standard Desktop Mode (Alt+D)';
    const sub =
      newDensity === 'compact'
        ? 'Dense cards, tight cart, zero vertical scrolling for 13"–14" laptops.'
        : newDensity === 'touch'
        ? 'Large tap targets (44px+), big buttons, and touch numpad for counter screens.'
        : 'Balanced spacing for regular monitors and mouse interaction.';
    toast.info(label, sub);
  };

  return (
    <div className={[styles.densityToggle, className].filter(Boolean).join(' ')} role="group" aria-label="POS Layout Density">
      <button
        type="button"
        className={[
          styles.densityBtn,
          density === 'compact' && styles.densityBtnActive,
        ].filter(Boolean).join(' ')}
        onClick={() => handleSelect('compact')}
        title="Compact Laptop Mode (Alt+D) — Tighter cards & zero-scroll cart for 13–14 inch displays"
      >
        <Laptop size={14} />
        {showLabels && <span className={styles.btnLabel}>Compact</span>}
      </button>

      <button
        type="button"
        className={[
          styles.densityBtn,
          density === 'comfortable' && styles.densityBtnActive,
        ].filter(Boolean).join(' ')}
        onClick={() => handleSelect('comfortable')}
        title="Standard Desktop Mode — Balanced spacing for normal desktop monitors"
      >
        <Monitor size={14} />
        {showLabels && <span className={styles.btnLabel}>Standard</span>}
      </button>

      <button
        type="button"
        className={[
          styles.densityBtn,
          density === 'touch' && (styles.densityBtnActiveTouch || styles.densityBtnActive),
        ].filter(Boolean).join(' ')}
        onClick={() => handleSelect('touch')}
        title="Touchscreen POS Mode (Alt+D) — Large tap targets (44px+), jumbo buttons & touch keypad"
      >
        <TabletSmartphone size={14} />
        {showLabels && <span className={styles.btnLabel}>Touch</span>}
      </button>
    </div>
  );
};
