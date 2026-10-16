import { useAuthStore } from '../store/authStore';
import {
  FULL_PERMISSIONS,
  SALES_AGENT_PERMISSIONS,
  REPAIR_AGENT_PERMISSIONS,
} from '../types/permissions';
import type { Permissions } from '../types/permissions';

/**
 * Returns the current user's effective permissions.
 * - Admins → full access always.
 * - sales_agent → sales preset (can be overridden by stored permissions).
 * - repair_agent → repair preset (can be overridden by stored permissions).
 */
export const usePermissions = (): Permissions => {
  const user = useAuthStore(state => state.user);

  if (!user) return {} as Permissions;

  if (user.role === 'admin') return FULL_PERMISSIONS;

  const base =
    user.role === 'repair_agent' ? REPAIR_AGENT_PERMISSIONS : SALES_AGENT_PERMISSIONS;

  // Merge stored overrides (if any) on top of the role preset
  return {
    ...base,
    ...(user.permissions ?? {}),
  };
};
