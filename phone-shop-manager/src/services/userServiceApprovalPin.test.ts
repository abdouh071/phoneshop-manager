/**
 * Approval PIN isolation in the users service.
 *
 * Staff lists are read by every screen and end up in the session cache, so they must never
 * carry a verifier. The verifier lives in `users/{uid}/secrets/approvalPin`, which the rules
 * open only to the owner and admins; the approval prompt reads it through one narrow call,
 * keeps it in memory only, and falls back to that memory copy when the till is offline.
 * Legacy on-profile verifiers are moved into the subcollection by a best-effort migration.
 *
 * `firebase/firestore` and `../lib/firebase` are replaced by an in-memory fake so the module
 * can be re-imported per test with a clean verifier cache.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type FakeDoc = Record<string, unknown>;

const fake = vi.hoisted(() => {
  const store = new Map<string, FakeDoc>();
  const stats = { listReads: 0, writes: [] as Array<{ path: string; data: FakeDoc }> };
  const flags = { failListReads: false, denySecretReads: false };
  const auth = { currentUser: null as null | { uid: string } };
  const DELETE_MARKER = '__deleteField__';

  return {
    stats,
    flags,
    auth,
    seedPath(path: string, data: FakeDoc): void {
      store.set(path, { ...data });
    },
    seed(name: string, id: string, data: FakeDoc): void {
      store.set(`${name}/${id}`, { ...data });
    },
    readPath(path: string): FakeDoc | undefined {
      return store.get(path);
    },
    read(name: string, id: string): FakeDoc | undefined {
      return store.get(`${name}/${id}`);
    },
    reset(): void {
      store.clear();
      stats.listReads = 0;
      stats.writes.length = 0;
      flags.failListReads = false;
      flags.denySecretReads = false;
      auth.currentUser = null;
    },
    collection: (_db: unknown, name: string) => ({ coll: name }),
    doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    query: (base: { coll: string }) => base,
    orderBy: () => ({ type: 'orderBy' }),
    serverTimestamp: () => 'SERVER_TS',
    deleteField: () => DELETE_MARKER,
    getDocs: async (q: { coll: string }) => {
      stats.listReads++;
      if (flags.failListReads) throw new Error('unavailable: offline cache used');
      const prefix = q.coll + '/';
      const docs = [...store.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path, data]) => ({ id: path.slice(prefix.length), data: () => ({ ...data }) }));
      return { docs };
    },
    getDoc: async (ref: { path: string }) => {
      if (flags.denySecretReads && ref.path.includes('/secrets/')) {
        throw Object.assign(new Error('permission-denied: ' + ref.path), { code: 'permission-denied' });
      }
      const data = store.get(ref.path);
      return {
        id: ref.path.split('/').pop(),
        exists: () => data !== undefined,
        data: () => ({ ...(data ?? {}) }),
      };
    },
    setDoc: async (ref: { path: string }, data: FakeDoc) => {
      if (flags.failListReads) throw new Error('permission-denied: ' + ref.path);
      stats.writes.push({ path: ref.path, data: { ...data } });
      const merged: FakeDoc = { ...(store.get(ref.path) ?? {}), ...data };
      for (const [key, value] of Object.entries(data)) {
        if (value === DELETE_MARKER) delete merged[key];
      }
      store.set(ref.path, merged);
    },
    deleteDoc: async (ref: { path: string }) => {
      store.delete(ref.path);
    },
  };
});

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    collection: fake.collection,
    doc: fake.doc,
    query: fake.query,
    orderBy: fake.orderBy,
    serverTimestamp: fake.serverTimestamp,
    deleteField: fake.deleteField,
    getDocs: fake.getDocs,
    getDoc: fake.getDoc,
    setDoc: fake.setDoc,
    deleteDoc: fake.deleteDoc,
  };
});

vi.mock('../lib/firebase', () => ({ db: {}, auth: fake.auth }));

const loadUserService = async () => {
  vi.resetModules();
  return (await import('./userService')).userService;
};

const SEED_USERS = {
  admin_with_pin: { name: 'Rania', role: 'admin', status: 'active', hasApprovalPin: true, permissions: { pos: true } },
  admin_no_pin: { name: 'Samir', role: 'admin', status: 'active', hasApprovalPin: false, pushToken: 'tok-2' },
  super_with_pin: { name: 'Owner', role: 'admin', status: 'active', isSuperAdmin: true, hasApprovalPin: true },
  revoked_admin: { name: 'Bassam', role: 'admin', status: 'revoked', hasApprovalPin: true },
  sales_agent: { name: 'Hala', role: 'sales_agent', status: 'active', hasApprovalPin: false },
} as const;

const SEED_SECRETS: Record<string, string> = {
  admin_with_pin: 'v2:210000:aaaa:bbbb',
  super_with_pin: 'c'.repeat(64),
  revoked_admin: 'd'.repeat(64),
};

const seedUsers = async () => {
  for (const [id, data] of Object.entries(SEED_USERS)) {
    fake.seed('users', id, { ...data });
  }
  for (const [id, verifier] of Object.entries(SEED_SECRETS)) {
    fake.seedPath(`users/${id}/secrets/approvalPin`, { verifier });
  }
};

beforeEach(() => {
  fake.reset();
});

describe('staff reads never carry a verifier', () => {
  it('getAllUsers drops approvalPin and reports it as a boolean', async () => {
    await seedUsers();
    fake.seed('users', 'legacy_admin', { name: 'Legacy', role: 'admin', status: 'active', approvalPin: 'old-shape' });
    const { getAllUsers } = await loadUserService();
    const users = await getAllUsers();

    for (const user of users) {
      expect('approvalPin' in user).toBe(false);
    }
    const byId = Object.fromEntries(users.map(u => [u.id, u]));
    expect(byId.admin_with_pin.hasApprovalPin).toBe(true);
    expect(byId.admin_no_pin.hasApprovalPin).toBe(false);
    expect(byId.sales_agent.hasApprovalPin).toBe(false);
    // A profile not yet migrated still reports the flag without carrying the verifier.
    expect(byId.legacy_admin.hasApprovalPin).toBe(true);
  });

  it('keeps every other profile field so nothing else silently regresses', async () => {
    await seedUsers();
    const { getAllUsers, getUserById } = await loadUserService();
    const users = await getAllUsers();
    const byId = Object.fromEntries(users.map(u => [u.id, u]));

    expect(byId.admin_with_pin.permissions).toEqual({ pos: true });
    expect(byId.admin_no_pin).toMatchObject({ pushToken: 'tok-2', status: 'active' });
    expect(byId.super_with_pin.isSuperAdmin).toBe(true);

    const single = await getUserById('admin_with_pin');
    expect(single).toMatchObject({ id: 'admin_with_pin', name: 'Rania', hasApprovalPin: true });
    expect('approvalPin' in (single ?? {})).toBe(false);
  });

  it('returns null for an unknown uid', async () => {
    await seedUsers();
    const { getUserById } = await loadUserService();
    expect(await getUserById('ghost')).toBeNull();
  });
});

describe('getApprovalPinVerifiers', () => {
  it('lists only active admins that configured a PIN, with the verifier intact', async () => {
    await seedUsers();
    const { getApprovalPinVerifiers } = await loadUserService();
    const holders = await getApprovalPinVerifiers();

    expect(holders.map(h => h.id).sort()).toEqual(['admin_with_pin', 'super_with_pin']);
    expect(holders.find(h => h.id === 'super_with_pin')?.approvalPin).toBe('c'.repeat(64));
    // The agent's own PIN is not part of the approval prompt's search space.
    expect(holders.find(h => h.id === 'sales_agent')).toBeUndefined();
  });

  it('serves the second prompt from the in-memory copy instead of re-reading users', async () => {
    await seedUsers();
    const { getApprovalPinVerifiers } = await loadUserService();
    await getApprovalPinVerifiers();
    const afterFirst = fake.stats.listReads;
    const again = await getApprovalPinVerifiers();

    expect(fake.stats.listReads).toBe(afterFirst);
    expect(again).toHaveLength(2);
  });

  it('re-reads after a PIN is set so the new verifier takes effect immediately', async () => {
    await seedUsers();
    const { getApprovalPinVerifiers, setApprovalPinVerifier } = await loadUserService();
    await getApprovalPinVerifiers();

    await setApprovalPinVerifier('admin_no_pin', 'v2:210000:ffff:eeee');
    const holders = await getApprovalPinVerifiers();

    expect(fake.readPath('users/admin_no_pin/secrets/approvalPin')).toMatchObject({ verifier: 'v2:210000:ffff:eeee' });
    expect(fake.read('users', 'admin_no_pin')).toMatchObject({ name: 'Samir', pushToken: 'tok-2', hasApprovalPin: true });
    expect(holders.map(h => h.id)).toContain('admin_no_pin');
  });

  it('clearing a PIN removes that admin from the prompt', async () => {
    await seedUsers();
    const { getApprovalPinVerifiers, clearApprovalPinVerifier, getAllUsers } = await loadUserService();
    expect((await getApprovalPinVerifiers()).map(h => h.id)).toContain('admin_with_pin');

    await clearApprovalPinVerifier('admin_with_pin');

    expect(fake.readPath('users/admin_with_pin/secrets/approvalPin')).toBeUndefined();
    expect((await getApprovalPinVerifiers()).map(h => h.id)).not.toContain('admin_with_pin');
    const users = await getAllUsers();
    expect(users.find(u => u.id === 'admin_with_pin')?.hasApprovalPin).toBe(false);
  });

  it('falls back to the session copy once the fresh window has passed', async () => {
    await seedUsers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const { getApprovalPinVerifiers } = await loadUserService();
      await getApprovalPinVerifiers();
      vi.advanceTimersByTime(61_000);
      fake.flags.failListReads = true;

      const holders = await getApprovalPinVerifiers();
      expect(fake.stats.listReads).toBe(2);
      expect(holders).toHaveLength(2);
      expect(warn).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      warn.mockRestore();
    }
  });

  it('surfaces a cold failure so the prompt can point at remote approval', async () => {
    await seedUsers();
    fake.flags.failListReads = true;
    const { getApprovalPinVerifiers } = await loadUserService();

    await expect(getApprovalPinVerifiers()).rejects.toThrow(/offline/);
  });

  it('falls back to a legacy on-profile verifier until migration moves it', async () => {
    await seedUsers();
    fake.seed('users', 'legacy_admin', { name: 'Legacy', role: 'admin', status: 'active', approvalPin: 'v1-legacy-shape' });
    const { getApprovalPinVerifiers } = await loadUserService();

    const holders = await getApprovalPinVerifiers();

    expect(holders.find(h => h.id === 'legacy_admin')?.approvalPin).toBe('v1-legacy-shape');
  });

  it('is denied on a staff till instead of leaking verifiers', async () => {
    await seedUsers();
    fake.flags.denySecretReads = true;
    const { getApprovalPinVerifiers } = await loadUserService();

    await expect(getApprovalPinVerifiers()).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('migrateLegacyApprovalPins', () => {
  const seedLegacy = () => {
    fake.seed('users', 'admin_1', { name: 'Rania', role: 'admin', status: 'active', approvalPin: 'legacy-a' });
    fake.seed('users', 'owner', { name: 'Owner', role: 'admin', status: 'active', isSuperAdmin: true, approvalPin: 'legacy-o' });
    fake.seed('users', 'agent_1', { name: 'Hala', role: 'sales_agent', status: 'active', approvalPin: 'legacy-s' });
    fake.seed('users', 'clean_admin', { name: 'Samir', role: 'admin', status: 'active', hasApprovalPin: true });
    fake.seedPath('users/clean_admin/secrets/approvalPin', { verifier: 'v2:210000:abcd:efgh' });
  };

  it('an admin moves the team but never the owner', async () => {
    seedLegacy();
    fake.auth.currentUser = { uid: 'admin_1' };
    const { migrateLegacyApprovalPins } = await loadUserService();

    expect(await migrateLegacyApprovalPins()).toBe(2);
    expect(fake.readPath('users/admin_1/secrets/approvalPin')).toMatchObject({ verifier: 'legacy-a' });
    expect(fake.readPath('users/agent_1/secrets/approvalPin')).toMatchObject({ verifier: 'legacy-s' });
    expect(fake.readPath('users/owner/secrets/approvalPin')).toBeUndefined();
    expect(fake.read('users', 'owner')).toMatchObject({ approvalPin: 'legacy-o' });
    expect(fake.read('users', 'admin_1')).not.toHaveProperty('approvalPin');
    expect(fake.read('users', 'admin_1')).toMatchObject({ hasApprovalPin: true });
  });

  it('the owner moves every legacy field, including staff profiles', async () => {
    seedLegacy();
    fake.auth.currentUser = { uid: 'owner' };
    const { migrateLegacyApprovalPins } = await loadUserService();

    expect(await migrateLegacyApprovalPins()).toBe(3);
    expect(fake.readPath('users/owner/secrets/approvalPin')).toMatchObject({ verifier: 'legacy-o' });
    expect(fake.readPath('users/admin_1/secrets/approvalPin')).toMatchObject({ verifier: 'legacy-a' });
    expect(fake.readPath('users/agent_1/secrets/approvalPin')).toMatchObject({ verifier: 'legacy-s' });
  });

  it('a staff session migrates only its own profile', async () => {
    seedLegacy();
    fake.auth.currentUser = { uid: 'agent_1' };
    const { migrateLegacyApprovalPins } = await loadUserService();

    expect(await migrateLegacyApprovalPins()).toBe(1);
    expect(fake.readPath('users/agent_1/secrets/approvalPin')).toMatchObject({ verifier: 'legacy-s' });
    expect(fake.readPath('users/admin_1/secrets/approvalPin')).toBeUndefined();
    expect(fake.readPath('users/owner/secrets/approvalPin')).toBeUndefined();
  });

  it('is idempotent: a second run finds nothing left to move', async () => {
    seedLegacy();
    fake.auth.currentUser = { uid: 'owner' };
    const { migrateLegacyApprovalPins } = await loadUserService();

    expect(await migrateLegacyApprovalPins()).toBe(3);
    expect(await migrateLegacyApprovalPins()).toBe(0);
    expect(fake.readPath('users/clean_admin/secrets/approvalPin')).toMatchObject({ verifier: 'v2:210000:abcd:efgh' });
  });

  it('does nothing without a signed-in user', async () => {
    seedLegacy();
    const { migrateLegacyApprovalPins } = await loadUserService();

    expect(await migrateLegacyApprovalPins()).toBe(0);
    expect(fake.stats.writes).toHaveLength(0);
  });
});
