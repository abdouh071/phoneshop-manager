import type { Permissions, User } from '../types';

/**
 * Role presets and the merge rule, kept identical to the desktop app's
 * `src/types/permissions.ts` + `usePermissions`. Two apps, one contract: a
 * technician granted or revoked a capability sees the same thing on both.
 *
 * These are display capabilities, not security. On the Spark plan there are no
 * Cloud Functions, so the Firestore rules only check that the caller is signed
 * in; a screen that hides a button is a workflow guard, not a wall.
 */
const ADMIN_PERMISSIONS: Permissions = {
  dashboard: true,
  pos: true,
  repairs: true,
  repair_add: true,
  repair_edit: true,
  repair_status: true,
  repair_assign: true,
  inventory_products: true,
  inventory_parts: true,
  inventory_edit: true,
  parts_sell: true,
  customers: true,
  customers_debt: true,
  reports: true,
  activity: true,
};

const SALES_AGENT_PERMISSIONS: Permissions = {
  dashboard: true,
  pos: true,
  repairs: false,
  repair_add: false,
  repair_edit: false,
  repair_status: false,
  repair_assign: false,
  inventory_products: true,
  inventory_parts: false,
  inventory_edit: false,
  parts_sell: false,
  customers: true,
  customers_debt: false,
  reports: false,
  activity: false,
};

const REPAIR_AGENT_PERMISSIONS: Permissions = {
  dashboard: true,
  pos: false,
  repairs: true,
  repair_add: true,
  repair_edit: true,
  repair_status: true,
  repair_assign: true,
  inventory_products: false,
  inventory_parts: true,
  inventory_edit: false,
  parts_sell: true,
  customers: true,
  customers_debt: false,
  reports: false,
  activity: false,
};

const DENY_ALL: Permissions = {
  dashboard: false,
  pos: false,
  repairs: false,
  repair_add: false,
  repair_edit: false,
  repair_status: false,
  repair_assign: false,
  inventory_products: false,
  inventory_parts: false,
  inventory_edit: false,
  parts_sell: false,
  customers: false,
  customers_debt: false,
  reports: false,
  activity: false,
};

const PRESETS: Record<User['role'], Permissions> = {
  admin: ADMIN_PERMISSIONS,
  sales_agent: SALES_AGENT_PERMISSIONS,
  repair_agent: REPAIR_AGENT_PERMISSIONS,
};

/**
 * The stored object overrides the preset key by key — an explicit `false` from
 * the admin wins over the role grant, which is what the mobile screens used to
 * get wrong by testing `role === 'repair_agent' || permissions?.repair_edit`.
 * Anything the profile does not state falls back to the preset, so a technician
 * created without a `permissions` map keeps the capabilities of their role.
 */
export const effectivePermissions = (user: User | null | undefined): Permissions => {
  if (!user) return DENY_ALL;

  const preset = PRESETS[user.role] ?? DENY_ALL;
  if (user.role === 'admin') return ADMIN_PERMISSIONS;

  const stored = user.permissions;
  if (!stored) return preset;

  const merged = { ...preset };
  (Object.keys(preset) as (keyof Permissions)[]).forEach((key) => {
    if (typeof stored[key] === 'boolean') merged[key] = stored[key] as boolean;
  });
  return merged;
};
