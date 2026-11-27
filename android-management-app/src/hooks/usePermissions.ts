import { useMemo } from 'react';
import { useAuthStore } from '../store/authStore';
import { effectivePermissions } from '../utils/permissions';
import type { Permissions } from '../types';

/**
 * What this device may show. Same name, same file location and same semantics
 * as the desktop `usePermissions`, so a capability reads identically in both
 * apps; the merge itself lives in `utils/permissions.ts` where `node --test`
 * can reach it without pulling Firebase into the runtime.
 */
export const usePermissions = (): Permissions => {
  const user = useAuthStore((state) => state.user);
  return useMemo(() => effectivePermissions(user), [user]);
};
