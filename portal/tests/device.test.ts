import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTERVAL_SECONDS,
  DEVICE_CODE_TTL_SECONDS,
  USER_CODE_ALPHABET,
  USER_CODE_LENGTH,
  hashDeviceCode,
  isCodeExpired,
  issueDeviceCode,
} from '@/lib/auth/device/policy';
import type { DeviceCodeIdentity, DeviceStore } from '@/lib/auth/device/store';
import {
  approveDeviceCode,
  issueDeviceKey,
  pollDeviceToken,
  requestDeviceCode,
} from '@/lib/auth/device/service';
import { DeviceServiceError, type DeviceDeps } from '@/lib/auth/device/types';
import type { KeyPlan, KeyRow, OrgForKeys } from '@/lib/keys/types';
import type { DeviceKeyStore } from '@/lib/auth/device/types';

type DeviceKeyStoreLike = DeviceKeyStore;
import type { OrgRole } from '@/db/schema';

// ───────────────────────────────────────────────────────────────────────
//  Fakes
// ───────────────────────────────────────────────────────────────────────

const OWNER: OrgRole = 'owner';
const VIEWER: OrgRole = 'viewer';

interface FakeDeviceRow {
  id: string;
  deviceCodeHash: string;
  userCode: string;
  status: DeviceCodeIdentity['status'];
  intervalSeconds: number;
  expiresAt: Date | null;
  approvedAt: Date | null;
  consumedAt: Date | null;
  keyId: string | null;
  keyPlaintext: string | null;
  models: string[];
  lastPolledAt: Date | null;
  userId: string | null;
  organizationId: string | null;
}

interface FakeDeviceStoreState extends DeviceStore {
  rows: FakeDeviceRow[];
  calls: string[];
  nowFn: () => Date;
}

function fakeDeviceStore(over: Partial<FakeDeviceStoreState> = {}): FakeDeviceStoreState {
  const self = {
    rows: [] as FakeDeviceRow[],
    calls: [] as string[],
    nowFn: () => new Date(),
    ...over,

    async insert(input: { deviceCodeHash: string; userCode: string; expiresAt: Date; intervalSeconds: number }) {
      const id = `device-${self.rows.length + 1}`;
      self.rows.push({
        id,
        deviceCodeHash: input.deviceCodeHash,
        userCode: input.userCode,
        status: 'pending',
        intervalSeconds: input.intervalSeconds,
        expiresAt: input.expiresAt,
        approvedAt: null,
        consumedAt: null,
        keyId: null,
        keyPlaintext: null,
        models: [],
        lastPolledAt: null,
        userId: null,
        organizationId: null,
      });
      self.calls.push('insert');
      return { id };
    },

    identity(row: FakeDeviceRow): DeviceCodeIdentity {
      return {
        id: row.id,
        userCode: row.userCode,
        userId: row.userId,
        organizationId: row.organizationId,
        status: row.status,
        intervalSeconds: row.intervalSeconds,
        expiresAt: row.expiresAt,
        approvedAt: row.approvedAt,
        consumedAt: row.consumedAt,
        keyId: row.keyId,
        keyPlaintext: row.keyPlaintext,
        models: row.models,
        lastPolledAt: row.lastPolledAt,
        userEmail: row.userId ? 'user@example.com' : null,
        userName: row.userId ? 'Test User' : null,
        organizationSlug: row.organizationId ? 'acme' : null,
        organizationName: row.organizationId ? 'Acme' : null,
        createdAt: new Date('2026-10-01T00:00:00Z'),
      };
    },

    async findByDeviceCodeHash(hash: string) {
      const row = self.rows.find((r) => r.deviceCodeHash === hash) ?? null;
      return row ? self.identity(row) : null;
    },

    async findByUserCode(code: string) {
      const row = self.rows.find((r) => r.userCode === code) ?? null;
      return row ? self.identity(row) : null;
    },

    async approve(input: { id: string; userId: string; organizationId: string; keyId: string; keyPlaintext: string; at: Date }) {
      const row = self.rows.find((r) => r.id === input.id);
      if (!row) throw new Error('no such row');
      row.userId = input.userId;
      row.organizationId = input.organizationId;
      row.status = 'approved';
      row.approvedAt = input.at;
      row.keyId = input.keyId;
      row.keyPlaintext = input.keyPlaintext;
      self.calls.push('approve');
    },

    async consume(id: string, at: Date) {
      const row = self.rows.find((r) => r.id === id);
      if (!row) throw new Error('no such row');
      row.status = 'consumed';
      row.consumedAt = at;
      row.keyPlaintext = null;
      self.calls.push('consume');
    },

    async expirePending() {
      let n = 0;
      for (const row of self.rows) {
        if (row.status === 'pending' && row.expiresAt && row.expiresAt.getTime() <= self.nowFn().getTime()) {
          row.status = 'expired';
          n += 1;
        }
      }
      return n;
    },

    async revokeForOrganization() {
      return 0;
    },

    async updateModels(id: string, models: string[]) {
      const row = self.rows.find((r) => r.id === id);
      if (!row) throw new Error('no such row');
      row.models = models;
    },

    async touchPolledAt(id: string, at: Date) {
      const row = self.rows.find((r) => r.id === id);
      if (!row) throw new Error('no such row');
      row.lastPolledAt = at;
    },
  };

  return self;
}

function plan(over: Partial<KeyPlan> = {}): KeyPlan {
  return {
    planId: 'plan-1',
    planCode: 'pro',
    maxKeys: 3,
    models: ['fast', 'smart', 'frontier'],
    rpm: 60,
    tpm: 200_000,
    concurrency: 5,
    maxBudgetUsd: 180,
    budgetDuration: '30d',
    effect: 'full',
    ...over,
  };
}

interface FakeKeyStoreState {
  org: OrgForKeys | null;
  keyPlan: KeyPlan | null;
  rows: KeyRow[];
  audits: { action: string; targetId: string }[];
  gateway: { revoked: string[]; generated: number };
}

function fakeKeys(over: Partial<FakeKeyStoreState> = {}) {
  const self: FakeKeyStoreState = {
    org: { id: 'org-1', name: 'Acme', slug: 'acme', litellmTeamId: 'team-1' },
    keyPlan: plan(),
    rows: [],
    audits: [],
    gateway: { revoked: [], generated: 0 },
    ...over,
  };

  const keys = {
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
    async insertKey(row: Parameters<DeviceKeyStoreLike['insertKey']>[0]) {
      const id = `key-${self.rows.length + 1}`;
      self.rows.push({ ...row, id, revokedAt: null, lastUsedAt: null } as KeyRow);
      return { id };
    },
    async markRevoked(keyId: string, at: Date) {
      const row = self.rows.find((r) => r.id === keyId);
      if (row) row.revokedAt = at;
    },
    async listActiveKeys() {
      return self.rows.filter((r) => !r.revokedAt);
    },
    async appendAudit(entry: { action: string; targetId: string }) {
      self.audits.push({ action: entry.action, targetId: entry.targetId });
    },
  };

  const gateway = {
    async generate(input: { key: string }) {
      self.gateway.generated += 1;
      return {
        key: input.key,
        keyName: 'display-mask',
        token: 'litellm-token-hash',
        expires: null,
      };
    },
    async revoke(token: string) {
      self.gateway.revoked.push(token);
    },
    async info() {
      return { lastUsed: null, models: ['fast'] };
    },
  };

  return { self, keys, gateway };
}

function deps(
  device: FakeDeviceStoreState,
  keys: ReturnType<typeof fakeKeys>,
  now: () => Date = () => new Date('2026-10-16T00:00:00Z'),
): DeviceDeps {
  device.nowFn = now;
  return {
    store: device,
    keys: keys.keys,
    gateway: keys.gateway,
    now,
  };
}

// ───────────────────────────────────────────────────────────────────────
//  Policy
// ───────────────────────────────────────────────────────────────────────

describe('device policy', () => {
  it('issues unique high-entropy codes with a 15-minute TTL', () => {
    const now = new Date('2026-10-16T00:00:00Z');
    const a = issueDeviceCode(now);
    const b = issueDeviceCode(now);
    expect(a.deviceCode).not.toBe(b.deviceCode);
    expect(a.userCode).not.toBe(b.userCode);
    expect(a.deviceCodeHash).toHaveLength(64); // sha256 hex
    expect(a.intervalSeconds).toBe(DEFAULT_INTERVAL_SECONDS);
    expect(a.expiresAt.getTime() - now.getTime()).toBe(DEVICE_CODE_TTL_SECONDS * 1000);
  });

  it('user codes use the restricted alphabet and fixed length', () => {
    for (let i = 0; i < 20; i++) {
      const { userCode } = issueDeviceCode();
      expect(userCode).toHaveLength(USER_CODE_LENGTH);
      for (const ch of userCode) {
        expect(USER_CODE_ALPHABET).toContain(ch);
      }
    }
  });

  it('hashes device codes with sha256', () => {
    const { deviceCode } = issueDeviceCode();
    expect(hashDeviceCode(deviceCode)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('treats a missing expiry as expired', () => {
    expect(isCodeExpired({ expiresAt: null })).toBe(true);
    expect(isCodeExpired({ expiresAt: new Date('2000-01-01T00:00:00Z') })).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────
//  Request
// ───────────────────────────────────────────────────────────────────────

describe('requestDeviceCode', () => {
  it('stores the hash, returns the plaintext once', async () => {
    const device = fakeDeviceStore();
    const keys = fakeKeys();
    const created = await requestDeviceCode(deps(device, keys), { now: new Date('2026-10-16T00:00:00Z') });

    expect(created.deviceCode.length).toBeGreaterThan(20);
    expect(created.userCode).toHaveLength(USER_CODE_LENGTH);
    expect(device.rows).toHaveLength(1);
    expect(device.rows[0]!.deviceCodeHash).toBe(hashDeviceCode(created.deviceCode));
    expect(device.rows[0]!.status).toBe('pending');
    expect(JSON.stringify(device.rows)).not.toContain(created.deviceCode);
  });
});

// ───────────────────────────────────────────────────────────────────────
//  Approval
// ───────────────────────────────────────────────────────────────────────

describe('approveDeviceCode', () => {
  async function setup() {
    const device = fakeDeviceStore();
    const keys = fakeKeys();
    const created = await requestDeviceCode(deps(device, keys), { now: new Date('2026-10-16T00:00:00Z') });
    return { device, keys, created };
  }

  it('mints a device key, binds the code, holds the plaintext once', async () => {
    const { device, keys, created } = await setup();
    const result = await approveDeviceCode(deps(device, keys), {
      userCode: created.userCode,
      actorUserId: 'user-1',
      organizationId: 'org-1',
      role: OWNER,
    });

    expect(result.approved).toBe(true);
    // One device key was minted and registered as kind='device'.
    expect(keys.self.rows).toHaveLength(1);
    expect(keys.self.rows[0]!.kind).toBe('device');
    expect(keys.self.rows[0]!.name).toBe('OpenCode Desktop');
    // The held plaintext is the minted customer key, not the gateway form.
    const held = device.rows[0]!.keyPlaintext;
    expect(held).toMatch(/^zn-/);
    // Models were remembered for the token response.
    expect(device.rows[0]!.models).toEqual(['fast', 'smart', 'frontier']);
    expect(device.rows[0]!.status).toBe('approved');
    expect(device.rows[0]!.userId).toBe('user-1');
    expect(device.rows[0]!.organizationId).toBe('org-1');
    // The plaintext never lands anywhere else.
    expect(JSON.stringify(keys.self.rows)).not.toContain(held);
    expect(JSON.stringify(keys.self.audits)).not.toContain(held);
  });

  it('refuses unknown codes with 400', async () => {
    const device = fakeDeviceStore();
    const keys = fakeKeys();
    await expect(
      approveDeviceCode(deps(device, keys), {
        userCode: 'NOTACODE',
        actorUserId: 'user-1',
        organizationId: 'org-1',
        role: OWNER,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('is idempotent on double approval (no second key minted)', async () => {
    const { device, keys, created } = await setup();
    await approveDeviceCode(deps(device, keys), {
      userCode: created.userCode,
      actorUserId: 'user-1',
      organizationId: 'org-1',
      role: OWNER,
    });
    const second = await approveDeviceCode(deps(device, keys), {
      userCode: created.userCode,
      actorUserId: 'user-1',
      organizationId: 'org-1',
      role: OWNER,
    });
    expect(second.approved).toBe(true);
    expect(keys.self.gateway.generated).toBe(1);
  });

  it('refuses expired codes with 400 and consumes them', async () => {
    const device = fakeDeviceStore();
    const keys = fakeKeys();
    const created = await requestDeviceCode(deps(device, keys), {
      now: new Date('2026-10-16T00:00:00Z'),
    });
    // Let it expire (TTL is 15 minutes).
    const late = () => new Date('2026-10-16T01:00:00Z');
    await expect(
      approveDeviceCode(deps(device, keys, late), {
        userCode: created.userCode,
        actorUserId: 'user-1',
        organizationId: 'org-1',
        role: OWNER,
      }),
    ).rejects.toMatchObject({ status: 400, code: 'expired' });
    expect(device.rows[0]!.status).toBe('consumed');
  });

  it('refuses roles that cannot mint keys', async () => {
    const { device, keys, created } = await setup();
    await expect(
      approveDeviceCode(deps(device, keys), {
        userCode: created.userCode,
        actorUserId: 'user-1',
        organizationId: 'org-1',
        role: VIEWER,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses accounts without an active plan', async () => {
    const { device, keys, created } = await setup();
    keys.self.keyPlan = null;
    await expect(
      approveDeviceCode(deps(device, keys), {
        userCode: created.userCode,
        actorUserId: 'user-1',
        organizationId: 'org-1',
        role: OWNER,
      }),
    ).rejects.toMatchObject({ status: 402 });
    // No key was minted at the gateway.
    expect(keys.self.gateway.generated).toBe(0);
  });

  it('rotates the previous device key before minting (one key per device)', async () => {
    const { device, keys, created } = await setup();
    // Seed a previous device key for the same org.
    keys.self.rows.push({
      id: 'key-old',
      organizationId: 'org-1',
      createdBy: 'user-1',
      name: 'OpenCode Desktop',
      keyPrefix: 'zn-old',
      keyHash: 'hash-old',
      litellmKeyName: 'mask-old',
      litellmKeyHash: 'litellm-old',
      revokedAt: null,
      lastUsedAt: null,
      expiresAt: null,
      kind: 'device',
      createdAt: new Date('2026-10-01T00:00:00Z'),
    });

    await approveDeviceCode(deps(device, keys), {
      userCode: created.userCode,
      actorUserId: 'user-1',
      organizationId: 'org-1',
      role: OWNER,
    });

    // Upstream revoked first, row marked revoked — and a fresh key exists.
    expect(keys.self.gateway.revoked).toEqual(['litellm-old']);
    expect(keys.self.rows.find((r) => r.id === 'key-old')!.revokedAt).not.toBeNull();
    expect(keys.self.rows.filter((r) => r.kind === 'device' && !r.revokedAt)).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────
//  Polling
// ───────────────────────────────────────────────────────────────────────

describe('pollDeviceToken', () => {
  it('returns pending while the code is unapproved', async () => {
    const device = fakeDeviceStore();
    const keys = fakeKeys();
    const now = new Date('2026-10-16T00:00:00Z');
    const created = await requestDeviceCode(deps(device, keys), { now });
    const outcome = await pollDeviceToken(deps(device, keys, () => new Date(now.getTime() + 10_000)), {
      deviceCode: created.deviceCode,
      now: new Date(now.getTime() + 10_000),
    });
    expect(outcome).toMatchObject({ kind: 'pending', intervalSeconds: DEFAULT_INTERVAL_SECONDS });
  });

  it('enforces the polling interval with slow_down', async () => {
    const device = fakeDeviceStore();
    const keys = fakeKeys();
    const now = new Date('2026-10-16T00:00:00Z');
    const created = await requestDeviceCode(deps(device, keys), { now });
    const d = deps(device, keys);
    await pollDeviceToken(d, { deviceCode: created.deviceCode, now });
    await expect(
      pollDeviceToken(d, { deviceCode: created.deviceCode, now: new Date(now.getTime() + 1000) }),
    ).rejects.toMatchObject({ status: 400, code: 'slow_down' });
  });

  it('rejects unknown device codes with 400', async () => {
    const device = fakeDeviceStore();
    const keys = fakeKeys();
    await expect(
      pollDeviceToken(deps(device, keys), { deviceCode: 'unknown' }),
    ).rejects.toMatchObject({ status: 400, code: 'validation' });
  });

  it('grants the token once on approval and consumes the code', async () => {
    const device = fakeDeviceStore();
    const keys = fakeKeys();
    const now = new Date('2026-10-16T00:00:00Z');
    const created = await requestDeviceCode(deps(device, keys), { now });
    await approveDeviceCode(deps(device, keys), {
      userCode: created.userCode,
      actorUserId: 'user-1',
      organizationId: 'org-1',
      role: OWNER,
    });

    const outcome = await pollDeviceToken(deps(device, keys), {
      deviceCode: created.deviceCode,
      now: new Date(now.getTime() + 60_000),
    });
    expect(outcome.kind).toBe('granted');
    if (outcome.kind !== 'granted') throw new Error('expected granted');
    expect(outcome.token).toMatch(/^zn-/);
    expect(outcome.models).toEqual(['fast', 'smart', 'frontier']);
    expect(outcome.user).toMatchObject({ id: 'user-1', email: 'user@example.com' });
    expect(outcome.organization).toMatchObject({ id: 'org-1', slug: 'acme' });
    // Consumed: plaintext nulled, replay impossible.
    expect(device.rows[0]!.status).toBe('consumed');
    expect(device.rows[0]!.keyPlaintext).toBeNull();

    await expect(
      pollDeviceToken(deps(device, keys), { deviceCode: created.deviceCode }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_grant' });
  });

  it('rejects expired codes with 400', async () => {
    const device = fakeDeviceStore();
    const keys = fakeKeys();
    const created = await requestDeviceCode(deps(device, keys), {
      now: new Date('2026-10-16T00:00:00Z'),
    });
    await expect(
      pollDeviceToken(deps(device, keys), {
        deviceCode: created.deviceCode,
        now: new Date('2026-10-16T01:00:00Z'),
      }),
    ).rejects.toMatchObject({ status: 400, code: 'expired' });
  });

  it('rejects revoked codes with 400', async () => {
    const device = fakeDeviceStore();
    const keys = fakeKeys();
    const now = new Date('2026-10-16T00:00:00Z');
    const created = await requestDeviceCode(deps(device, keys), { now });
    device.rows[0]!.status = 'revoked';
    await expect(
      pollDeviceToken(deps(device, keys), { deviceCode: created.deviceCode, now }),
    ).rejects.toMatchObject({ status: 400, code: 'access_denied' });
  });
});

// ───────────────────────────────────────────────────────────────────────
//  Key issuance details
// ───────────────────────────────────────────────────────────────────────

describe('issueDeviceKey', () => {
  it('expires in about 30 days and falls back when the gateway omits expiry', async () => {
    const device = fakeDeviceStore();
    const keys = fakeKeys();
    const now = new Date('2026-10-16T00:00:00Z');
    const issued = await issueDeviceKey(deps(device, keys, () => now), {
      organizationId: 'org-1',
      userId: 'user-1',
      models: ['fast', 'smart', 'frontier'],
    });
    const days = (issued.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(30, 5);
    expect(keys.self.rows[0]!.expiresAt?.getTime()).toBe(issued.expiresAt.getTime());
  });

  it('carries a DeviceServiceError with an HTTP status', () => {
    const err = new DeviceServiceError('nope', 'conflict', 409);
    expect(err.code).toBe('conflict');
    expect(err.status).toBe(409);
    expect(err.name).toBe('DeviceServiceError');
  });
});
