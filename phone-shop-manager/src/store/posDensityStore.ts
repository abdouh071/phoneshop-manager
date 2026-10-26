import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PosDensity = 'compact' | 'comfortable' | 'touch';

export interface PosDensityOption {
  key: PosDensity;
  name: string;
  shortName: string;
  iconName: 'laptop' | 'monitor' | 'touch';
  tag: string;
  description: string;
  targetDevice: string;
}

export const POS_DENSITY_OPTIONS: PosDensityOption[] = [
  {
    key: 'compact',
    name: 'Compact Laptop',
    shortName: 'Compact',
    iconName: 'laptop',
    tag: '13"–14" Laptops',
    description: 'Condensed product cards, tight cart rows, and zero vertical scrolling on 768p/1080p laptop displays.',
    targetDevice: 'MacBook Air, ThinkPad, 13"–14" Counter Laptops',
  },
  {
    key: 'comfortable',
    name: 'Standard Desktop',
    shortName: 'Standard',
    iconName: 'monitor',
    tag: 'Balanced',
    description: 'Balanced card sizes and spacing designed for regular desktop monitors with a mouse & physical barcode scanner.',
    targetDevice: '21"–27" PC Monitors, Back-Office Workstations',
  },
  {
    key: 'touch',
    name: 'Touchscreen POS',
    shortName: 'Touchscreen',
    iconName: 'touch',
    tag: '15"+ All-in-One Touch',
    description: 'Large tap targets (44px+), jumbo circular quantity buttons, on-screen numpad, and high-contrast touch checkout.',
    targetDevice: 'All-in-One POS Touch Terminals, Counter Tablets',
  },
];

interface PosDensityState {
  density: PosDensity;
  setDensity: (density: PosDensity) => void;
  cycleDensity: () => PosDensity;
}

function applyDensityAttribute(density: PosDensity) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-pos-density', density);
    const posRoot = document.querySelector('[data-pos-root]');
    if (posRoot) {
      posRoot.setAttribute('data-pos-density', density);
    }
  }
}

export const usePosDensityStore = create<PosDensityState>()(
  persist(
    (set, get) => ({
      density: 'comfortable',
      setDensity: (density: PosDensity) => {
        set({ density });
        applyDensityAttribute(density);
      },
      cycleDensity: () => {
        const order: PosDensity[] = ['compact', 'comfortable', 'touch'];
        const currentIdx = order.indexOf(get().density);
        const next = order[(currentIdx + 1) % order.length];
        set({ density: next });
        applyDensityAttribute(next);
        return next;
      },
    }),
    {
      name: 'phoneshop_pos_density',
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyDensityAttribute(state.density || 'comfortable');
        }
      },
    }
  )
);
