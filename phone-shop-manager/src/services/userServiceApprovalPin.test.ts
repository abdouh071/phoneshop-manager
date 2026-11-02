/**
 * Approval PIN isolation in the users service.
 *
 * Staff lists are read by every screen and end up in the session cache, so they must never
 * carry `users/{uid}.approvalPin`. The verifier is read by one narrow call that the approval
 * prompt makes, is kept in memory only, and falls back to that memory copy when the till is
 * offline (PIN approval has to keep working on a staff terminal with no connection).
 *
 * `firebase/firestore` and `../lib/firebase` are replaced by an in-memory fake so the module
 * can be re-imported per test with a clean verifier cache.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type FakeDoc = Record<string, unknown>;

const fake = vi.hoisted(() => {
  const store = new Map<string, Map<string, FakeDoc>>();
  const stats = { listReads: 0, writes: [] as Array<{ id: string; data: FakeDoc }> };
  const flags = { failListReads: false };

  const collOf = (name: string): Map<string, FakeDoc> => {
    let c = store.get(name);
    if (!c) {
      c = new Map<string, FakeDoc>();
      store.set(name, c);
    }
    return c;
  };

  return {
    stats,
    flags,
    seed(name: string, id: string, data: FakeDoc): void {
      collOf(name).set(id, { ...data });
    },
    read(name: string, id: string): FakeDoc | undefined {
      return store.get(name)?.get(id);
    },
    reset(): void {
      store.clear();
      stats.listReads = 0;
      stats.writes.length = 0;
      flags.failListReads = false;
    },
    collection: (_db: unknown, name: string) => ({ coll: name }),
    doc: (_db: unknown, name: string, id: string) => ({ coll: name, id }),
    query: (base: { coll: string }) => base,
    orderBy: () => ({ type: 'orderBy' }),
    getDocs: async (q: { coll: string }) => {
      stats.listReads++;
      if (flags.failListReads) throw new Error('unavailable: offline cache used');
      const coll = store.get(q.coll) ?? new Map<string, FakeDoc>();
      return {
        docs: [...coll.entries()].map(([id, data]) => ({
          id,
          data: () => ({ ...data }),
        })),
      };
    },
    getDoc: async (ref: { coll: string; id: string }) => {
      const data = store.get(ref.coll)?.get(ref.id);
      return {
        id: ref.id,
        exists: () => data !== undefined,
        data: () => ({ ...(data ?? {}) }),
      };
    },
    setDoc: async (ref: { coll: string; id: string }, data: FakeDoc) => {
      if (flags.failListReads) throw new Error('permission-denied: users/' + ref.id);
      stats.writes.push({ id: ref.id, data: { ...data } });
      collOf(ref.coll).set(ref.id, { ...(store.get(ref.coll)?.get(ref.id) ?? {}), ...data });
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
    getDocs: fake.getDocs,
    getDoc: fake.getDoc,
    setDoc: fake.setDoc,
  };
});

vi.mock('../lib/firebase', () => ({ db: {} }));

const loadUserService = async () => {
  vi.resetModules();
  return (await import('./userService')).userService;
};

const SEED_USERS = {
  admin_with_pin: { name: 'Rania', role: 'admin', status: 'active', approvalPin: 'v2:210000:aaaa:bbbb', permissions: { pos: true } },
  admin_no_pin: { name: 'Samir', role: 'admin', status: 'active', approvalPin: '', pushToken: 'tok-2' },
  super_with_pin: { name: 'Owner', role: 'admin', status: 'active', isSuperAdmin: true, approvalPin: 'c'.repeat(64) },
  revoked_admin: { name: 'Bassam', role: 'admin', status: 'revoked', approvalPin: 'd'.repeat(64) },
  sales_agent: { name: 'Hala', role: 'sales_agent', status: 'active', approvalPin: 'e'.repeat(64) },
} as const;

const seedUsers = async () => {
  for (const [id, data] of Object.entries(SEED_USERS)) {
    fake.seed('users', id, { ...data });
  }
};

beforeEach(() => {
  fake.reset();
});

describe('staff reads never carry a verifier', () => {
  it('getAllUsers drops approvalPin and reports it as a boolean', async () => {
    await seedUsers();
    const { getAllUsers } = await loadUserService();
    const users = await getAllUsers();

    for (const user of users) {
      expect('approvalPin' in user).toBe(false);
    }
    const byId = Object.fromEntries(users.map(u => [u.id, u]));
    expect(byId.admin_with_pin.hasApprovalPin).toBe(true);
    expect(byId.admin_no_pin.hasApprovalPin).toBe(false);
    expect(byId.sales_agent.hasApprovalPin).toBe(true);
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

    expect(fake.stats.writes).toEqual([{ id: 'admin_no_pin', data: { approvalPin: 'v2:210000:ffff:eeee' } }]);
    expect(fake.read('users', 'admin_no_pin')).toMatchObject({ name: 'Samir', pushToken: 'tok-2', approvalPin: 'v2:210000:ffff:eeee' });
    expect(holders.map(h => h.id)).toContain('admin_no_pin');
  });

  it('clearing a PIN removes that admin from the prompt', async () => {
    await seedUsers();
    const { getApprovalPinVerifiers, clearApprovalPinVerifier, getAllUsers } = await loadUserService();
    expect((await getApprovalPinVerifiers()).map(h => h.id)).toContain('admin_with_pin');

    await clearApprovalPinVerifier('admin_with_pin');

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
});
