/**
 * The approval prompt's PIN check.
 *
 * Covers the three things that would be felt immediately in the shop if they broke: a PIN
 * hashed by the old fixed-salt code still authorizes, a wrong PIN does not, and a till that
 * cannot read the verifiers says so instead of claiming nobody has a PIN. The silent
 * v1 → v2 rewrite is checked too — it now lands in `users/{uid}/secrets/approvalPin` and
 * clears the exposed profile field. The last group is the deployed-functions path: the
 * server's answer is taken, and a "no" from it is never traded for a local "yes".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type FakeDoc = Record<string, unknown>;

const fake = vi.hoisted(() => {
  const store = new Map<string, FakeDoc>();
  const flags = { failListReads: false, denySecretReads: false };
  const stats = { reads: 0 };
  const DELETE_MARKER = '__deleteField__';

  return {
    stats,
    flags,
    seed(name: string, id: string, data: FakeDoc): void {
      store.set(`${name}/${id}`, { ...data });
    },
    seedPath(path: string, data: FakeDoc): void {
      store.set(path, { ...data });
    },
    read(name: string, id: string): FakeDoc | undefined {
      return store.get(`${name}/${id}`);
    },
    readPath(path: string): FakeDoc | undefined {
      return store.get(path);
    },
    reset(): void {
      store.clear();
      flags.failListReads = false;
      flags.denySecretReads = false;
      stats.reads = 0;
    },
    collection: (_db: unknown, name: string) => ({ coll: name }),
    doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    query: (base: { coll: string }) => base,
    orderBy: () => ({ type: 'orderBy' }),
    limit: (n: number) => ({ type: 'limit', n }),
    deleteField: () => DELETE_MARKER,
    getDocs: async (q: { coll: string }) => {
      stats.reads++;
      if (flags.failListReads) throw new Error('unavailable: offline');
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
    limit: fake.limit,
    deleteField: fake.deleteField,
    getDocs: fake.getDocs,
    getDoc: fake.getDoc,
    setDoc: fake.setDoc,
    deleteDoc: fake.deleteDoc,
  };
});

vi.mock('../lib/firebase', () => ({ db: {}, auth: { currentUser: null } }));

vi.mock('./authStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'agent_1', name: 'Hala', role: 'sales_agent' } }) },
}));

vi.mock('../services/activityLogService', () => ({
  activityLogService: { log: vi.fn(() => Promise.resolve()) },
}));

/** What the Cloud Function answers. `null` stands for "not deployed", the shop's default. */
const server = vi.hoisted(() => ({
  pinAnswer: null as null | Record<string, unknown>,
}));

vi.mock('../services/serverEnforcement', () => ({
  serverEnforcement: {
    verifyApprovalPin: async () =>
      server.pinAnswer ?? { status: 'unavailable', message: 'functions are not deployed' },
    sealEndOfDay: async () => ({ status: 'unavailable', message: 'functions are not deployed' }),
  },
}));

const LEGACY_SALT = 'phone-shop-admin-approval-v1-salt';

const legacyHash = async (pin: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin + LEGACY_SALT));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
};

const loadApprovalStore = async () => {
  vi.resetModules();
  return (await import('./approvalStore')).useApprovalStore;
};

beforeEach(() => {
  fake.reset();
  server.pinAnswer = null;
});

describe('verifyPin', () => {
  it('authorizes a PIN stored in the legacy format and rewrites it in the strong format', async () => {
    const legacy = await legacyHash('2468');
    fake.seed('users', 'admin_1', { name: 'Rania', role: 'admin', status: 'active', approvalPin: legacy });

    const result = await (await loadApprovalStore()).getState().verifyPin('2468');

    expect(result).toMatchObject({ success: true, adminName: 'Rania', adminId: 'admin_1' });
    await vi.waitFor(() => {
      expect(String(fake.readPath('users/admin_1/secrets/approvalPin')?.verifier)).toMatch(/^v2:210000:[0-9a-f]{32}:[0-9a-f]{64}$/);
    });
    // The exposed profile field is gone; only the flag remains.
    expect(fake.read('users', 'admin_1')).not.toHaveProperty('approvalPin');
    expect(fake.read('users', 'admin_1')).toMatchObject({ hasApprovalPin: true });
    // And the upgraded verifier keeps authorizing the same PIN.
    expect(await (await loadApprovalStore()).getState().verifyPin('2468')).toMatchObject({ success: true });
  });

  it('rejects a wrong PIN and leaves the verifier untouched', async () => {
    const legacy = await legacyHash('2468');
    fake.seed('users', 'admin_1', { name: 'Rania', role: 'admin', status: 'active', approvalPin: legacy });

    const result = await (await loadApprovalStore()).getState().verifyPin('2469');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Incorrect approval PIN/);
    expect(fake.read('users', 'admin_1')?.approvalPin).toBe(legacy);
  });

  it('does not accept a PIN that belongs to a non-admin', async () => {
    fake.seed('users', 'admin_1', { name: 'Rania', role: 'admin', status: 'active', approvalPin: await legacyHash('2468') });
    fake.seed('users', 'agent_1', { name: 'Hala', role: 'sales_agent', status: 'active', approvalPin: await legacyHash('1357') });

    const store = await loadApprovalStore();
    expect(await store.getState().verifyPin('1357')).toMatchObject({ success: false });
    expect(await store.getState().verifyPin('2468')).toMatchObject({ success: true, adminName: 'Rania' });
  });

  it('reports "no PIN configured" only when no eligible admin has one', async () => {
    fake.seed('users', 'admin_1', { name: 'Rania', role: 'admin', status: 'active', approvalPin: '' });
    fake.seed('users', 'admin_2', { name: 'Bassam', role: 'admin', status: 'revoked', approvalPin: await legacyHash('2468') });

    const result = await (await loadApprovalStore()).getState().verifyPin('2468');

    expect(result).toMatchObject({ success: false, noPinConfigured: true });
  });

  it('says the server was unreachable rather than claiming nobody has a PIN', async () => {
    fake.flags.failListReads = true;

    const result = await (await loadApprovalStore()).getState().verifyPin('2468');

    expect(result.success).toBe(false);
    expect(result.noPinConfigured).toBeFalsy();
    expect(result.error).toMatch(/remote approval/);
  });

  it('points a staff till at remote approval when the rules deny the verifiers', async () => {
    fake.seed('users', 'admin_1', { name: 'Rania', role: 'admin', status: 'active', hasApprovalPin: true });
    fake.seedPath('users/admin_1/secrets/approvalPin', { verifier: await legacyHash('2468') });
    fake.flags.denySecretReads = true;

    const result = await (await loadApprovalStore()).getState().verifyPin('2468');

    expect(result.success).toBe(false);
    expect(result.noPinConfigured).toBeFalsy();
    expect(result.error).toMatch(/Quick PIN is not available on this till/);
    expect(result.error).toMatch(/Remote Request/);
  });

  it('refuses an empty PIN before reading anything', async () => {
    const store = await loadApprovalStore();

    expect(await store.getState().verifyPin('   ')).toMatchObject({ success: false });
    expect(fake.stats.reads).toBe(0);
  });

  it('takes the server\'s answer when the callables are deployed, without reading users', async () => {
    server.pinAnswer = {
      status: 'ok',
      data: { verified: true, adminId: 'admin_9', adminName: 'Yacine', legacyVerifierUpgraded: true },
    };

    const result = await (await loadApprovalStore()).getState().verifyPin('2468');

    expect(result).toMatchObject({ success: true, adminName: 'Yacine', adminId: 'admin_9' });
    expect(fake.stats.reads).toBe(0);
  });

  it('does not quietly fall back to the till when the server refuses the PIN', async () => {
    // A verifier this device still holds would accept this PIN; the server's "no" wins.
    fake.seed('users', 'admin_1', { name: 'Rania', role: 'admin', status: 'active', approvalPin: await legacyHash('2468') });
    server.pinAnswer = { status: 'rejected', code: 'permission-denied', message: 'Incorrect approval PIN.' };

    const result = await (await loadApprovalStore()).getState().verifyPin('2468');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Incorrect approval PIN/);
  });

  it('passes a rate limit back to the person typing instead of retrying locally', async () => {
    server.pinAnswer = { status: 'rejected', code: 'resource-exhausted', message: 'Too many PIN attempts.' };

    const result = await (await loadApprovalStore()).getState().verifyPin('2468');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Too many PIN attempts/);
  });
});
