export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Dynamic Year Options (2024 up to next year)
export const buildYearOptions = (currentYear: number): number[] => {
  const years: number[] = [];
  for (let yr = 2024; yr <= currentYear + 1; yr++) {
    years.push(yr);
  }
  return years;
};
