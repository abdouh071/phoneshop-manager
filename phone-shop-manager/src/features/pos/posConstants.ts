export const getCategoryIcon = (category: string) => {
  switch (category) {
    case 'smartphone': return '📱';
    case 'tablet': return '📟';
    case 'wearable': return '⌚';
    case 'accessory': return '⚡';
    default: return '📦';
  }
};

export const posCategories = [
  { id: 'all', label: 'All Items', icon: '✨' },
  { id: 'smartphone', label: 'Phones', icon: '📱' },
  { id: 'accessory', label: 'Accessories', icon: '⚡' },
  { id: 'wearable', label: 'Wearables', icon: '⌚' },
  { id: 'tablet', label: 'Tablets', icon: '📟' },
];
