import { useState, useEffect } from 'react';

/**
 * Returns a debounced copy of `value` that only updates after `delay` ms of
 * inactivity.  Use this to prevent filtering / API calls on every keystroke.
 *
 * @example
 *   const debouncedQuery = useDebounce(searchQuery, 150);
 *   // use debouncedQuery in useMemo / useEffect
 */
export function useDebounce<T>(value: T, delay = 150): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

