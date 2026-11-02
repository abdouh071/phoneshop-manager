/** Returns YYYY-MM-DD in local time for a given Date or string */
export const toDateStr = (d: Date | string = new Date()): string => {
  const dateObj = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dateObj.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** Checks if an ISO timestamp falls on the target local date YYYY-MM-DD */
export const isSameLocalDate = (iso: string | undefined | null, targetLocalDateStr: string): boolean => {
  if (!iso) return false;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return false;
    return toDateStr(d) === targetLocalDateStr;
  } catch {
    return false;
  }
};
