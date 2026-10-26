/**
 * Haptic feedback hook using the Vibration API (supported on Android Chrome).
 * Silently no-ops on browsers / platforms that don't support it.
 */
export function useHaptic() {
  const vibrate = (pattern: number | number[]) => {
    try {
      if (navigator.vibrate) {
        navigator.vibrate(pattern);
      }
    } catch {
      // Not supported — silently ignore
    }
  };

  return {
    /** Light tap — for button presses, selections */
    tap: () => vibrate(10),
    /** Success pulse — for confirmations, completions */
    success: () => vibrate([10, 50, 10]),
    /** Error buzz — for failures, rejections */
    error: () => vibrate([40, 30, 40]),
    /** Warning double pulse — for warnings, overdue alerts */
    warning: () => vibrate([20, 40, 20]),
    /** Heavy confirmation — for approvals, destructive actions */
    heavy: () => vibrate([60, 30, 60]),
    /** Custom pattern */
    custom: (pattern: number | number[]) => vibrate(pattern),
  };
}
