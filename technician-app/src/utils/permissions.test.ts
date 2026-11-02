import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectivePermissions } from './permissions.ts';
import type { User } from '../types/index.ts';

const staff = (role: User['role'], permissions?: User['permissions']): User => ({
  id: 'u1',
  name: 'Test',
  email: 'test@example.com',
  role,
  permissions,
});

test('a role with no stored map keeps its preset capabilities', () => {
  const tech = effectivePermissions(staff('repair_agent'));
  assert.equal(tech.repair_add, true);
  assert.equal(tech.pos, false);

  const cashier = effectivePermissions(staff('sales_agent'));
  assert.equal(cashier.pos, true);
  assert.equal(cashier.repair_edit, false);
});

test('a stored false revokes a capability the role grants', () => {
  const tech = effectivePermissions(staff('repair_agent', { repair_status: false } as User['permissions']));
  assert.equal(tech.repair_status, false);
  // Untouched keys still come from the preset.
  assert.equal(tech.repair_edit, true);
});

test('a stored true grants a capability the role withholds', () => {
  const cashier = effectivePermissions(staff('sales_agent', { repair_add: true } as User['permissions']));
  assert.equal(cashier.repair_add, true);
});

test('admins always hold every capability', () => {
  const admin = effectivePermissions(staff('admin', { pos: false } as User['permissions']));
  Object.values(admin).forEach((granted) => assert.equal(granted, true));
});

test('nothing is granted without a user', () => {
  assert.equal(effectivePermissions(null).repairs, false);
  assert.equal(effectivePermissions(undefined).inventory_edit, false);
});

test('non-boolean junk in the profile falls back to the preset', () => {
  const tech = effectivePermissions(
    staff('repair_agent', { repair_edit: 'yes', repair_status: null } as unknown as User['permissions'])
  );
  assert.equal(tech.repair_edit, true);
  assert.equal(tech.repair_status, true);
});
