import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  assertModelsAllowed,
  buildKeyAlias,
  canCreateKey,
  canRevokeKey,
  keyHashFor,
  keyLimitState,
  keyPrefixFor,
  KEY_PREFIX_LENGTH,
} from '@/lib/keys/policy';
import { createApiKey, listApiKeys, revokeApiKey } from '@/lib/keys/service';
import { KeyServiceError } from '@/lib/keys/types';
import type {
  GatewayGenerateInput,
  KeyAuditEntry,
  KeyDeps,
  KeyGateway,
  KeyPlan,
  KeyRow,
  KeyStore,
  OrgForKeys,
} from '@/lib/keys/types';
import { CUT_BUDGET } from '@/lib/entitlements/policy';
import type { OrgRole } from '@/db/schema';

// ───────────────────────────────────────────────────────────────────────
//  Fakes
//
//  The service takes its two edges as arguments precisely so these exist.
//  No database, no gateway, no mocks of module graphs — and every
//  assertion below is about what the service DID, not about how it was
//  wired.
// ───────────────────────────────────────────────────────────────────────

const PLAINTEXT = 'sk-portal-abcdef0123456789abcdef0123456789';
const OWNER: OrgRole = 'owner';
const DEV: OrgRole = 'developer';
const VIEWER: OrgRole = 'viewer';
const BILLING: OrgRole = 'billing';

function plan(over: Partial<KeyPlan> = {}): KeyPlan {
  return {
    planId: 'plan-1',
    planCode: 'pro',
    maxKeys: 3,
    models: ['fast', 'smart'],
    rpm: 60,
    tpm: 200_000,
    concurrency: 5,
    maxBudgetUsd: 180,
    budgetDuration: '30d',
    effect: 'full',
    ...over,
  };
}

interface FakeStore extends KeyStore {
  rows: KeyRow[];
  audits: KeyAuditEntry[];
  org: OrgForKeys | null;
  keyPlan: KeyPlan | null;
  failInsert: boolean;
}

function fakeStore(over: Partial<FakeStore> = {}): FakeStore {
  // Methods read through `self`, never a captured local, so an override
  // passed to fakeStore({...}) is what the method actually sees.
  const self = {
    rows: [] as KeyRow[],
    audits: [] as KeyAuditEntry[],
    org: { id: 'org-1', name: 'Acme', slug: 'acme', litellmTeamId: 'team-1' } as OrgForKeys | null,
    keyPlan: plan() as KeyPlan | null,
    failInsert: false,

    async orgWithTeam() {
      return self.org;
    },
    async memberLiteLLMUserId() {
      return null;
    },
    async planForOrg() {
      return self.keyPlan;
    },
    async countActiveKeys() {
      return self.rows.filter((r) => !r.revokedAt).length;
    },
    async insertKey(row) {
      if (self.failInsert) throw new Error('connection reset');
      const id = `key-${self.rows.length + 1}`;
      self.rows.push({
        ...row,
        id,
        revokedAt: null,
        lastUsedAt: null,
      } as KeyRow);
      return { id };
    },
    async findKey(organizationId, keyId) {
      // Mirrors the real query: the tenant filter is part of the lookup,
      // not something the caller can opt out of.
      return self.rows.find((r) => r.id === keyId && r.organizationId === organizationId) ?? null;
    },
    async markRevoked(keyId, at) {
      const row = self.rows.find((r) => r.id === keyId);
      if (row) row.revokedAt = at;
    },
    async listActiveKeys() {
      return self.rows.filter((r) => !r.revokedAt);
    },
    async appendAudit(entry) {
      self.audits.push(entry);
    },
  } as FakeStore;

  return Object.assign(self, over);
}

interface FakeGateway extends KeyGateway {
  calls: { generate: GatewayGenerateInput[]; revoke: string[]; info: string[] };
  generateThrows: boolean;
  revokeThrows: boolean;
  issuedKey: string;
}

function fakeGateway(over: Partial<FakeGateway> = {}): FakeGateway {
  const self = {
    calls: {
      generate: [] as GatewayGenerateInput[],
      revoke: [] as string[],
      info: [] as string[],
    },
    generateThrows: false,
    revokeThrows: false,
    issuedKey: PLAINTEXT,

    async generate(input: GatewayGenerateInput) {
      self.calls.generate.push(input);
      if (self.generateThrows) throw new Error('LiteLLM /key/generate → 500');
      return {
        key: self.issuedKey,
        // The shape the live gateway actually returns: key_name is a
        // display mask, the token id is the only usable identifier.
        keyName: 'sk-...mask',
        token: 'litellm-token-hash',
        expires: null,
      };
    },
    async revoke(token: string) {
      self.calls.revoke.push(token);
      if (self.revokeThrows) throw new Error('LiteLLM /key/delete → 503');
    },
    async info(token: string) {
      self.calls.info.push(token);
      return { lastUsed: null, models: ['fast'] };
    },
  } as FakeGateway;

  return Object.assign(self, over);
}

function deps(store: FakeStore, gateway: FakeGateway): KeyDeps {
  return { store, gateway };
}

const CREATE = {
  organizationId: 'org-1',
  userId: 'user-1',
  role: OWNER,
  name: 'laptop',
  models: ['fast'],
};

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

// ───────────────────────────────────────────────────────────────────────
//  Policy — pure rules
// ───────────────────────────────────────────────────────────────────────

describe('key material handling', () => {
  it('stores a hash, never the key', () => {
    expect(keyHashFor(PLAINTEXT)).toBe(
      createHash('sha256').update(PLAINTEXT).digest('hex'),
    );
    expect(keyHashFor(PLAINTEXT)).not.toContain(PLAINTEXT);
    expect(keyHashFor(PLAINTEXT)).toHaveLength(64);
  });

  it('hashes deterministically and distinguishes different keys', () => {
    expect(keyHashFor('sk-a')).toBe(keyHashFor('sk-a'));
    expect(keyHashFor('sk-a')).not.toBe(keyHashFor('sk-b'));
  });

  it('keeps a display prefix that is never the whole key', () => {
    const prefix = keyPrefixFor(PLAINTEXT);
    expect(prefix).toHaveLength(KEY_PREFIX_LENGTH);
    expect(prefix).toBe(PLAINTEXT.slice(0, KEY_PREFIX_LENGTH));
    expect(PLAINTEXT.startsWith(prefix) && prefix !== PLAINTEXT).toBe(true);
  });

  it('builds a unique, org-scoped alias per key', () => {
    const a = buildKeyAlias({ orgSlug: 'acme', name: 'laptop' });
    const b = buildKeyAlias({ orgSlug: 'acme', name: 'laptop' });
    expect(a).not.toBe(b);
    expect(a.startsWith('acme-laptop-')).toBe(true);
    expect(buildKeyAlias({ orgSlug: 'acme', name: '!!' })).toMatch(/^acme-/);
  });
});

describe('model allowlist', () => {
  it('accepts a subset and deduplicates', () => {
    const check = assertModelsAllowed(['fast', 'fast'], ['fast', 'smart']);
    expect(check.ok).toBe(true);
    expect(check.models).toEqual(['fast']);
  });

  it('rejects a model the plan does not include', () => {
    const check = assertModelsAllowed(['frontier'], ['fast', 'smart']);
    expect(check.ok).toBe(false);
    expect(check.error).toContain('frontier');
  });

  it('rejects an empty selection', () => {
    expect(assertModelsAllowed([], ['fast']).ok).toBe(false);
  });
});

describe('key ceiling', () => {
  it('blocks creation at the plan limit with an actionable message', () => {
    const state = keyLimitState(3, 3);
    expect(state.canCreate).toBe(false);
    expect(state.error).toContain('Revoke one');
  });

  it('counts a revoked key as freed', () => {
    expect(keyLimitState(2, 3).canCreate).toBe(true);
    expect(keyLimitState(2, 3).remaining).toBe(1);
  });
});

describe('role matrix (IMPLEMENTATION.md §1.2)', () => {
  it('lets developer and above create keys', () => {
    expect(canCreateKey('developer')).toBe(true);
    expect(canCreateKey('admin')).toBe(true);
    expect(canCreateKey('owner')).toBe(true);
  });

  it('never lets viewer or billing create keys', () => {
    expect(canCreateKey('viewer')).toBe(false);
    expect(canCreateKey('billing')).toBe(false);
  });

  it('lets a developer revoke only their own keys', () => {
    expect(canRevokeKey('developer', true)).toBe(true);
    expect(canRevokeKey('developer', false)).toBe(false);
  });

  it('lets admin and owner revoke any key', () => {
    expect(canRevokeKey('admin', false)).toBe(true);
    expect(canRevokeKey('owner', false)).toBe(true);
  });

  it('never lets viewer or billing revoke', () => {
    expect(canRevokeKey('viewer', true)).toBe(false);
    expect(canRevokeKey('billing', true)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────
//  Creation — the plaintext-once path
// ───────────────────────────────────────────────────────────────────────

describe('createApiKey', () => {
  it('refuses to mint a key before a subscription exists (the paywall)', async () => {
    // No plan resolves ⇒ no live subscription. This is the state every
    // brand-new account is in (no free tier), so the answer must be the
    // paywall — a 402 with words the dashboard can act on — not a 500
    // that looks like our fault.
    const store = fakeStore({ keyPlan: null });

    await expectCode(
      createApiKey(CREATE, deps(store, fakeGateway())),
      'payment_required',
    );
    const error = await createApiKey(CREATE, deps(store, fakeGateway())).catch((e) => e);
    expect(error.status).toBe(402);
    expect(store.rows).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
  });

  it('returns the plaintext exactly once and persists only hash + prefix', async () => {
    const store = fakeStore();
    const gateway = fakeGateway();

    const result = await createApiKey(CREATE, deps(store, gateway));

    expect(result.plaintext).toBe(PLAINTEXT);
    expect(store.rows).toHaveLength(1);
    const row = store.rows[0]!;
    expect(row.keyHash).toBe(keyHashFor(PLAINTEXT));
    expect(row.keyPrefix).toBe(keyPrefixFor(PLAINTEXT));

    // Nothing persisted, logged, or audited may contain the secret.
    const persisted = JSON.stringify({ rows: store.rows, audits: store.audits });
    expect(persisted).not.toContain(PLAINTEXT);
    expect(JSON.stringify(store.audits)).not.toContain(keyHashFor(PLAINTEXT));
  });

  it('writes an audit row without key material', async () => {
    const store = fakeStore();
    await createApiKey(CREATE, deps(store, fakeGateway()));

    expect(store.audits).toHaveLength(1);
    const audit = store.audits[0]!;
    expect(audit.action).toBe('key.created');
    expect(audit.actorId).toBe('user-1');
    expect(audit.organizationId).toBe('org-1');
    expect(JSON.stringify(audit.after)).not.toContain(PLAINTEXT);
  });

  it('issues the key against the org team with the plan limits', async () => {
    const store = fakeStore();
    const gateway = fakeGateway();

    await createApiKey({ ...CREATE, models: ['fast', 'smart'] }, deps(store, gateway));

    const issued = gateway.calls.generate[0]!;
    expect(issued.teamId).toBe('team-1');
    expect(issued.models).toEqual(['fast', 'smart']);
    expect(issued.maxBudgetUsd).toBe(180);
    expect(issued.rpmLimit).toBe(60);
    expect(issued.tpmLimit).toBe(200_000);
    expect(issued.budgetDuration).toBe('30d');
  });

  /**
   * The same bug class as the entitlement tests, one layer out: a
   * max_budget of 0 is UNLIMITED in LiteLLM, not "denied". A free org
   * that reaches this code path must get CUT_BUDGET.
   */
  it('never sends a zero budget to the gateway', async () => {
    const store = fakeStore({ keyPlan: plan({ maxBudgetUsd: 0, effect: 'cut' }) });
    const gateway = fakeGateway();

    await createApiKey(CREATE, deps(store, gateway));

    const issued = gateway.calls.generate[0]!;
    expect(issued.maxBudgetUsd).toBe(CUT_BUDGET);
    expect(issued.maxBudgetUsd).toBeGreaterThan(0);
  });

  it('pins user_id so spend cannot be moved to an arbitrary end user', async () => {
    const store = fakeStore();
    const gateway = fakeGateway();
    await createApiKey(CREATE, deps(store, gateway));
    expect(gateway.calls.generate[0]!.userId).toBe('org-acme');

    const pinned = fakeStore({ memberLiteLLMUserId: async () => 'member-42' });
    const gateway2 = fakeGateway();
    await createApiKey(CREATE, deps(pinned, gateway2));
    expect(gateway2.calls.generate[0]!.userId).toBe('member-42');
  });

  it('refuses viewer and billing before touching the gateway', async () => {
    for (const role of [VIEWER, BILLING] as OrgRole[]) {
      const store = fakeStore();
      const gateway = fakeGateway();
      await expectCode(createApiKey({ ...CREATE, role }, deps(store, gateway)), 'forbidden');
      expect(gateway.calls.generate).toHaveLength(0);
      expect(store.rows).toHaveLength(0);
    }
  });

  it('rejects a model outside the plan without minting anything', async () => {
    const store = fakeStore();
    const gateway = fakeGateway();
    await expectCode(
      createApiKey({ ...CREATE, models: ['frontier'] }, deps(store, gateway)),
      'validation',
    );
    expect(gateway.calls.generate).toHaveLength(0);
    expect(store.rows).toHaveLength(0);
  });

  it('enforces the plan key ceiling', async () => {
    const store = fakeStore();
    store.rows = [
      { id: 'a', revokedAt: null },
      { id: 'b', revokedAt: null },
      { id: 'c', revokedAt: null },
    ] as KeyRow[];
    const gateway = fakeGateway();

    await expectCode(createApiKey(CREATE, deps(store, gateway)), 'conflict');
    expect(gateway.calls.generate).toHaveLength(0);
  });

  it('will not mint a key for an org with no gateway team', async () => {
    const store = fakeStore({
      org: { id: 'org-1', name: 'Acme', slug: 'acme', litellmTeamId: null },
    });
    const gateway = fakeGateway();
    await expectCode(createApiKey(CREATE, deps(store, gateway)), 'upstream');
    expect(gateway.calls.generate).toHaveLength(0);
  });

  it('stores nothing when the gateway refuses', async () => {
    const store = fakeStore();
    const gateway = fakeGateway({ generateThrows: true });

    await expectCode(createApiKey(CREATE, deps(store, gateway)), 'upstream');
    expect(store.rows).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
  });

  /**
   * The orphan. LiteLLM has issued a live credential; if our row never
   * lands, nothing upstream will ever revoke it and it spends against a
   * ceiling we no longer track. The service must revoke before failing.
   */
  it('revokes the issued key when the insert fails', async () => {
    const store = fakeStore({ failInsert: true });
    const gateway = fakeGateway();

    await expectCode(createApiKey(CREATE, deps(store, gateway)), 'internal');
    expect(gateway.calls.revoke).toEqual(['litellm-token-hash']);
  });
});

// ───────────────────────────────────────────────────────────────────────
//  Revocation
// ───────────────────────────────────────────────────────────────────────

describe('revokeApiKey', () => {
  async function seedKey(over: Partial<KeyRow> = {}) {
    const store = fakeStore();
    store.rows.push({
      id: 'key-1',
      organizationId: 'org-1',
      createdBy: 'user-1',
      name: 'laptop',
      keyPrefix: keyPrefixFor(PLAINTEXT),
      keyHash: keyHashFor(PLAINTEXT),
      litellmKeyName: 'litellm-key-name',
      litellmKeyHash: 'litellm-token-hash',
      revokedAt: null,
      lastUsedAt: null,
      expiresAt: null,
      createdAt: new Date('2026-10-01T00:00:00Z'),
      ...over,
    });
    return store;
  }

  it('deletes upstream first, then marks the row', async () => {
    const store = await seedKey();
    const gateway = fakeGateway();

    const result = await revokeApiKey(
      { organizationId: 'org-1', userId: 'user-1', role: OWNER, keyId: 'key-1' },
      deps(store, gateway),
    );

    // The token id, never the display mask: /key/delete answers 404 to
    // "sk-...mask", which is the bug this assertion pins.
    expect(gateway.calls.revoke).toEqual(['litellm-token-hash']);
    expect(store.rows[0]!.revokedAt).not.toBeNull();
    expect(result.id).toBe('key-1');
    expect(store.audits[0]!.action).toBe('key.revoked');
    expect(JSON.stringify(store.audits)).not.toContain(PLAINTEXT);
  });

  /**
   * Order matters. Marking the row revoked before LiteLLM confirms would
   * produce a key that reads as dead in the dashboard and keeps spending
   * real money — invisible until the bill arrives.
   */
  it('leaves the key active when the gateway refuses the delete', async () => {
    const store = await seedKey();
    const gateway = fakeGateway({ revokeThrows: true });

    await expectCode(
      revokeApiKey(
        { organizationId: 'org-1', userId: 'user-1', role: OWNER, keyId: 'key-1' },
        deps(store, gateway),
      ),
      'upstream',
    );
    expect(store.rows[0]!.revokedAt).toBeNull();
    expect(store.audits).toHaveLength(0);
  });

  it('is idempotent in the sense that matters: a second revoke is a conflict, not a double delete', async () => {
    const store = await seedKey();
    const gateway = fakeGateway();

    await revokeApiKey(
      { organizationId: 'org-1', userId: 'user-1', role: OWNER, keyId: 'key-1' },
      deps(store, gateway),
    );
    await expectCode(
      revokeApiKey(
        { organizationId: 'org-1', userId: 'user-1', role: OWNER, keyId: 'key-1' },
        deps(store, gateway),
      ),
      'conflict',
    );
    expect(gateway.calls.revoke).toHaveLength(1);
  });

  it('answers 404 for a key in another org — never 403', async () => {
    const store = await seedKey();
    const gateway = fakeGateway();

    await expectCode(
      revokeApiKey(
        { organizationId: 'org-OTHER', userId: 'user-1', role: OWNER, keyId: 'key-1' },
        deps(store, gateway),
      ),
      'not_found',
    );
    expect(gateway.calls.revoke).toHaveLength(0);
  });

  it('stops a developer from revoking a colleague key, and lets admin do it', async () => {
    const store = await seedKey({ createdBy: 'user-2' });
    const denied = fakeGateway();
    await expectCode(
      revokeApiKey(
        { organizationId: 'org-1', userId: 'user-1', role: DEV, keyId: 'key-1' },
        deps(store, denied),
      ),
      'forbidden',
    );
    expect(denied.calls.revoke).toHaveLength(0);

    const allowed = fakeGateway();
    await revokeApiKey(
      { organizationId: 'org-1', userId: 'user-1', role: 'admin', keyId: 'key-1' },
      deps(store, allowed),
    );
    expect(allowed.calls.revoke).toEqual(['litellm-token-hash']);
  });

  it('refuses a row with no gateway token instead of faking a revoke', async () => {
    const store = await seedKey({ litellmKeyHash: null });
    await expectCode(
      revokeApiKey(
        { organizationId: 'org-1', userId: 'user-1', role: OWNER, keyId: 'key-1' },
        deps(store, fakeGateway()),
      ),
      'internal',
    );
    expect(store.rows[0]!.revokedAt).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────
//  Listing
// ───────────────────────────────────────────────────────────────────────

describe('listApiKeys', () => {
  it('returns prefixes and ownership, never hashes', async () => {
    const store = fakeStore();
    const gateway = fakeGateway();
    await createApiKey(CREATE, deps(store, gateway));

    const { keys } = await listApiKeys(
      { organizationId: 'org-1', userId: 'user-1' },
      deps(store, gateway),
    );

    expect(keys).toHaveLength(1);
    expect(keys[0]!.keyPrefix).toBe(keyPrefixFor(PLAINTEXT));
    expect(keys[0]!.isOwn).toBe(true);
    expect(JSON.stringify(keys)).not.toContain(keyHashFor(PLAINTEXT));
    expect(JSON.stringify(keys)).not.toContain(PLAINTEXT);
  });

  it('marks another member\'s key as not their own', async () => {
    const store = fakeStore();
    const gateway = fakeGateway();
    await createApiKey(CREATE, deps(store, gateway));

    const { keys } = await listApiKeys(
      { organizationId: 'org-1', userId: 'user-2' },
      deps(store, gateway),
    );
    expect(keys[0]!.isOwn).toBe(false);
  });

  it('enriches from the gateway but survives the gateway being down', async () => {
    const store = fakeStore();
    const gateway = fakeGateway();
    await createApiKey(CREATE, deps(store, gateway));

    const failing = fakeGateway({
      info: async () => {
        throw new Error('gateway down');
      },
    });
    const { keys } = await listApiKeys(
      { organizationId: 'org-1', userId: 'user-1' },
      deps(store, failing),
    );

    expect(keys).toHaveLength(1);
    expect(keys[0]!.lastUsedAt).toBeNull();
  });

  it('enriches by gateway token id, never the display mask', async () => {
    const store = fakeStore();
    const gateway = fakeGateway();
    await createApiKey(CREATE, deps(store, gateway));

    const { keys } = await listApiKeys(
      { organizationId: 'org-1', userId: 'user-1' },
      deps(store, gateway),
    );

    // /key/info answers 404 to "sk-...mask"; asking with the mask would
    // silently leave the models column empty on every list.
    expect(gateway.calls.info).toEqual(['litellm-token-hash']);
    expect(keys[0]!.models).toEqual(['fast']);
  });

  it('excludes revoked keys', async () => {
    const store = fakeStore();
    const gateway = fakeGateway();
    await createApiKey(CREATE, deps(store, gateway));
    await revokeApiKey(
      { organizationId: 'org-1', userId: 'user-1', role: OWNER, keyId: 'key-1' },
      deps(store, gateway),
    );

    const { keys } = await listApiKeys(
      { organizationId: 'org-1', userId: 'user-1' },
      deps(store, gateway),
    );
    expect(keys).toHaveLength(0);
  });
});

describe('error type', () => {
  it('carries the HTTP status so routes map without parsing messages', () => {
    const err = new KeyServiceError('nope', 'conflict', 409);
    expect(err.code).toBe('conflict');
    expect(err.status).toBe(409);
    expect(err.name).toBe('KeyServiceError');
  });
});
