/**
 * Reject if `promise` has not settled in `ms`. The timer is cleared as soon as it settles so a
 * resolved write does not keep a pending rejection alive.
 */
export const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Firestore ${label} timed out.`)), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
