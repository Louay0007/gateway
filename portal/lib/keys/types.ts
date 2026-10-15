/**
 * Key-service ports — the seams between policy and infrastructure.
 *
 * Why the service takes its dependencies as arguments instead of importing
 * `@/db` and `@/lib/litellm/client` directly:
 *
 *   - The plaintext-once and revoke paths are the two places in Phase 3
 *     where a mistake costs money or leaks a credential. They are exactly
 *     the paths worth testing exhaustively, and they cannot be tested
 *     exhaustively if importing them boots a Postgres pool and requires a
 *     running gateway.
 *   - With the two edges behind interfaces, tests/keys.test.ts drives the
 *     whole orchestration with fakes and asserts on what was and was not
 *     persisted. The production wiring lives in ./index.ts.
 *
 * Nothing in this file imports infrastructure, so it can be imported from
 * anywhere (including a client component's type position).
 */

import type { OrgRole } from '@/db/schema';
import type { Effect } from '@/lib/entitlements/policy';

/**
 * The error vocabulary shared with the HTTP layer (IMPLEMENTATION.md §3).
 * `status` is carried on the error so a route can map a failure without
 * re-deriving intent from a message string.
 */
export type KeyErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'upstream'
  | 'internal'
  | 'payment_required';

/** HTTP status per code. `payment_required` is the paywall: no live plan. */
export const KEY_ERROR_STATUS: Record<KeyErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation: 400,
  upstream: 502,
  internal: 500,
  payment_required: 402,
};

export class KeyServiceError extends Error {
  constructor(
    message: string,
    readonly code: KeyErrorCode,
    readonly status: number,
  ) {
    super(message);
    this.name = 'KeyServiceError';
  }
}

// ───────────────────────────────────────────────────────────────────────
//  Stored shape
// ───────────────────────────────────────────────────────────────────────

/** One row of `api_keys`. The plaintext is NOT here — by design, always. */
export interface KeyRow {
  id: string;
  organizationId: string;
  createdBy: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  litellmKeyName: string | null;
  litellmKeyHash: string | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

/**
 * What leaves the server. Deliberately narrower than KeyRow: no
 * `keyHash`, no `litellmKeyHash`, no customer cost. `isOwn` exists so the
 * UI can decide whether to offer "revoke" without the client re-deriving
 * the role matrix.
 */
export interface KeyView {
  id: string;
  name: string;
  keyPrefix: string;
  models: string[] | null;
  createdBy: string;
  isOwn: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** The plan-derived limits a new key inherits. */
export interface KeyPlan {
  planId: string;
  planCode: string;
  maxKeys: number;
  models: string[];
  rpm: number | null;
  tpm: number | null;
  concurrency: number | null;
  /** Always > 0. A zero budget means UNLIMITED upstream (BLUEPRINT.md §9.4). */
  maxBudgetUsd: number;
  budgetDuration: string;
  effect: Effect;
}

export interface OrgForKeys {
  id: string;
  name: string;
  slug: string;
  litellmTeamId: string | null;
}

export interface KeyAuditEntry {
  actorId: string;
  organizationId: string;
  action: 'key.created' | 'key.revoked';
  targetId: string;
  after: Record<string, unknown>;
}

// ───────────────────────────────────────────────────────────────────────
//  Gateway port — implemented over LiteLLM in ./gateway.ts
// ───────────────────────────────────────────────────────────────────────

export interface GatewayGenerateInput {
  /**
   * The plaintext the gateway should STORE, in its own `sk-<body>` form.
   *
   * The portal chooses the random body (see policy.ts `mintKey`) because the
   * customer-facing `zn-<body>` has to be derivable from it: the auth edge
   * restores the `sk-` prefix on the way in. LiteLLM honours a caller-supplied
   * `key` and echoes it back verbatim.
   */
  key: string;
  keyAlias: string;
  teamId: string;
  /** Pinned at creation; see the anti-spoofing note in service.ts. */
  userId: string;
  models: string[];
  maxBudgetUsd: number;
  budgetDuration: string;
  rpmLimit: number | null;
  tpmLimit: number | null;
  maxParallelRequests: number | null;
}

export interface GatewayGenerateResult {
  /** PLAINTEXT — return to the caller exactly once, then forget it. */
  key: string;
  /**
   * DISPLAY MASK ("sk-...w9Sg") for humans. NOT an identifier: the
   * gateway's delete/info/update routes all answer 404 to it. Anything
   * that must find the key upstream uses `token`.
   */
  keyName: string;
  /** LiteLLM's token id (hash). The only identifier that works upstream. */
  token: string;
  expires: string | null;
}

export interface GatewayKeyInfo {
  lastUsed: string | null;
  models: string[];
}

export interface KeyGateway {
  generate(input: GatewayGenerateInput): Promise<GatewayGenerateResult>;
  /** `token` is LiteLLM's token id — never the display mask. */
  revoke(token: string): Promise<void>;
  info(token: string): Promise<GatewayKeyInfo>;
}

// ───────────────────────────────────────────────────────────────────────
//  Store port — implemented over Drizzle in ./store.ts
// ───────────────────────────────────────────────────────────────────────

export interface KeyStore {
  orgWithTeam(organizationId: string): Promise<OrgForKeys | null>;
  /** `organization_members.litellm_user_id`, when one was provisioned. */
  memberLiteLLMUserId(organizationId: string, userId: string): Promise<string | null>;
  planForOrg(organizationId: string): Promise<KeyPlan | null>;
  countActiveKeys(organizationId: string): Promise<number>;
  insertKey(row: Omit<KeyRow, 'id' | 'revokedAt' | 'lastUsedAt'>): Promise<{ id: string }>;
  findKey(organizationId: string, keyId: string): Promise<KeyRow | null>;
  markRevoked(keyId: string, at: Date): Promise<void>;
  listActiveKeys(organizationId: string, limit: number): Promise<KeyRow[]>;
  appendAudit(entry: KeyAuditEntry): Promise<void>;
}

export interface KeyDeps {
  store: KeyStore;
  gateway: KeyGateway;
}

// ───────────────────────────────────────────────────────────────────────
//  Service inputs / outputs
// ───────────────────────────────────────────────────────────────────────

export interface CreateKeyInput {
  organizationId: string;
  userId: string;
  role: OrgRole;
  name: string;
  models: string[];
}

export interface CreateKeyResult {
  key: KeyView;
  /** The one and only time this value exists outside the client's memory. */
  plaintext: string;
}

export interface RevokeKeyInput {
  organizationId: string;
  userId: string;
  role: OrgRole;
  keyId: string;
}

export interface RevokeKeyResult {
  id: string;
  revokedAt: string;
}

export interface ListKeysInput {
  organizationId: string;
  userId: string;
}
