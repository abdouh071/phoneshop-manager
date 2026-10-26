import type { AccessorySubCategory } from '../types';

export interface SubCategoryMeta {
  value: AccessorySubCategory | 'all';
  label: string;
  icon: string;
}

export const ACCESSORY_SUB_CATEGORIES: SubCategoryMeta[] = [
  { value: 'all',        label: 'All Accessories', icon: '🎧' },
  { value: 'case',       label: 'Cases & Covers',  icon: '🛡️' },
  { value: 'glass',      label: 'Screen Protectors', icon: '🪟' },
  { value: 'cable',      label: 'Cables',           icon: '🔌' },
  { value: 'charger',    label: 'Chargers',         icon: '⚡' },
  { value: 'earphone',   label: 'Earphones',        icon: '🎧' },
  { value: 'powerbank',  label: 'Power Banks',      icon: '🔋' },
  { value: 'holder',     label: 'Holders & Mounts', icon: '📍' },
  { value: 'other',      label: 'Other',            icon: '📦' },
];

/** Select options for forms (excludes 'all') */
export const ACCESSORY_SUB_CATEGORY_OPTIONS = ACCESSORY_SUB_CATEGORIES
  .filter(c => c.value !== 'all')
  .map(c => ({ value: c.value, label: `${c.icon} ${c.label}` }));

export function getSubCategoryMeta(value: string | undefined): SubCategoryMeta {
  return ACCESSORY_SUB_CATEGORIES.find(c => c.value === value) ?? ACCESSORY_SUB_CATEGORIES[0];
}
