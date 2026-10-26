/**
 * API-key POLICY — pure functions, zero infrastructure.
 *
 * Same discipline as lib/entitlements/policy.ts: the rules that protect
 * money and access live in a module with no database, no gateway client,
 * and no Next.js import, so they can be unit-tested anywhere. The
 * orchestration (lib/keys/service.ts) decides *how*; this file decides
 * *what is allowed*.
 *
 * Two invariants this file exists to keep:
 *
 *   1. THE PLAINTEXT IS SHOWN EXACTLY ONCE. What we persist is a SHA-256
 *      hash plus a short display prefix. Key.prefixFor / Key.hashFor are
 *      the only sanctioned way to derive either, and nothing here (or in
 *      service.ts) ever hands the plaintext to a log, an audit row, or a
 *      list response.
 *
 *   2. THE ROLE MATRIX IS ENFORCED HERE, NOT IN THE UI. viewer and
 *      billing can never mint or revoke; a developer may only revoke
 *      keys they created themselves; admin and owner may revoke any.
 *      Hiding a button is not authorization — this function is what the
 *      API route consults on every request.
 */

import { createHash, randomBytes } from 'node:crypto';
import { slugify } from '@/lib/org/slug';
import type { OrgRole } from '@/db/schema';

/** How much of the key we keep for display. Enough to identify a key in
 *  a table, too short to be useful to anyone who never sees the full
 *  value. */
export const KEY_PREFIX_LENGTH = 12;

// ───────────────────────────────────────────────────────────────────────
//  Key format — a customer key is `zn-<body>`, and the gateway holds the
//  SAME body under LiteLLM's required `sk-<body>` prefix.
//
//  WHY TWO FORMS. LiteLLM hard-codes `sk-` (key_management_endpoints.py:
//  `if data.key is not None and not data.key.startswith("sk-")`), and that
//  prefix is load-bearing in AUTH, not decoration. In `_types.py` the
//  normalizer calls `hash_token()` ONLY when the value starts with `sk-`;
//  anything else is treated as an already-hashed token and looked up
//  verbatim, so a `zn-` value can never match the sha256 the gateway
//  stores. `sk-` is additionally branched on in key-block, key-info, and
//  two spend-tracking paths.
//
//  So the prefix cannot be changed in the credential. Instead the PORTAL
//  chooses the random body, shows the customer `zn-<body>`, registers
//  `sk-<body>` at the gateway, and the auth edge (edge/server.mjs) rewrites
//  the leading `zn-` back to `sk-` on the way in. The body — the part that
//  is actually secret — is identical in both, so this is a prefix
//  substitution rather than a second credential.
//
//  The alternative, forking the gateway's key normalization, would put a
//  patch in the exact code that enforces budgets. This does not.
// ───────────────────────────────────────────────────────────────────────

/** What the customer sees and pastes. */
export const CUSTOM_KEY_PREFIX = 'zn-';
/** What the gateway stores. Fixed by LiteLLM; not ours to change. */
export const GATEWAY_KEY_PREFIX = 'sk-';

/**
 * Body entropy: 32 random bytes → 43 base64url characters, so a key is 46
 * characters long. The gateway requires 16–100 characters matching
 * `^sk-[A-Za-z0-9_-]+$`, and base64url is exactly that alphabet, so the
 * body needs no further filtering.
 */
const KEY_BODY_BYTES = 32;

/** Shortest body accepted; the edge re-checks this before forwarding. */
export const MIN_KEY_BODY_LENGTH = 16;

export interface MintedKey {
  /** `zn-…` — handed to the customer, shown once, hashed for storage. */
  customerKey: string;
  /** `sk-…` — what the gateway is told to store. Never shown. */
  gatewayKey: string;
}

/**
 * Mint one random body and express it in both forms.
 *
 * The body is generated HERE rather than by the gateway, because the
 * customer form must be derivable from what the gateway stores. Had the
 * gateway chosen it, the two forms would be unrelated and the edge could not
 * translate between them.
 */
export function mintKey(): MintedKey {
  const body = randomBytes(KEY_BODY_BYTES).toString('base64url');
  return {
    customerKey: `${CUSTOM_KEY_PREFIX}${body}`,
    gatewayKey: `${GATEWAY_KEY_PREFIX}${body}`,
  };
}

/**
 * `zn-<body>` → `sk-<body>`. The edge's whole job.
 *
 * Anything that is not a `zn-` key comes back UNCHANGED on purpose: the
 * gateway's own master key, and any key issued before this format existed,
 * must keep working. A value we do not recognise is the gateway's to
 * reject — the edge must not invent an answer for it.
 */
export function toGatewayKey(customerKey: string): string {
  if (!customerKey.startsWith(CUSTOM_KEY_PREFIX)) return customerKey;
  return GATEWAY_KEY_PREFIX + customerKey.slice(CUSTOM_KEY_PREFIX.length);
}

/**
 * `sk-<body>` → `zn-<body>`.
 *
 * Used when the gateway hands back a plaintext we did not supply (an
 * auto-generated key), so a customer never receives an `sk-` string.
 */
export function toCustomerKey(gatewayKey: string): string {
  if (!gatewayKey.startsWith(GATEWAY_KEY_PREFIX)) return gatewayKey;
  return CUSTOM_KEY_PREFIX + gatewayKey.slice(GATEWAY_KEY_PREFIX.length);
}

/** Is this credential's customer-key body long enough to be real? */
export function isWellFormedCustomerKey(value: string): boolean {
  // Not one of ours: the gateway's call, not the edge's.
  if (!value.startsWith(CUSTOM_KEY_PREFIX)) return true;
  return value.length >= CUSTOM_KEY_PREFIX.length + MIN_KEY_BODY_LENGTH;
}

/**
 * Display prefix. Never contains the whole key — a prefix equal to the
 * key would leak the secret in every list response.
 */
export function keyPrefixFor(plaintext: string): string {
  return plaintext.slice(0, KEY_PREFIX_LENGTH);
}

/**
 * Storage hash. SHA-256 hex: we only ever need to answer "is this the
 * key we issued?", never "what was the key", so a fast unsalted hash is
 * the right primitive here (the input is already high-entropy).
 */
export function keyHashFor(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Human-readable alias for the gateway record.
 *
 * Unique per key (random suffix) so two keys named "laptop" in one org
 * do not collide on `api_keys_litellm_name_idx`, and traceable back to
 * the org in LiteLLM's own key list.
 */
export function buildKeyAlias(input: { orgSlug: string; name: string }): string {
  const suffix = crypto.randomUUID().slice(0, 8);
  const base = slugify(input.name) || 'key';
  return `${slugify(input.orgSlug)}-${base}-${suffix}`.slice(0, 64);
}

// ───────────────────────────────────────────────────────────────────────
//  Creation rules — IMPLEMENTATION.md §1.2
// ───────────────────────────────────────────────────────────────────────

const ORG_RANK: Record<OrgRole, number> = {
  viewer: 0,
  billing: 1,
  developer: 2,
  admin: 3,
  owner: 4,
};

export function roleAtLeast(role: OrgRole, required: OrgRole): boolean {
  return ORG_RANK[role] >= ORG_RANK[required];
}

/**
 * Who may mint keys: developer and above. viewer and billing cannot —
 * a viewer reading dashboards has no reason to hold a credential, and a
 * billing contact has no reason to touch the data plane.
 */
export function canCreateKey(role: OrgRole): boolean {
  return roleAtLeast(role, 'developer');
}

/**
 * Who may revoke a SPECIFIC key.
 *
 * `isOwn` is `key.createdBy === callerId` — a developer may only revoke
 * their own keys, admin and owner may revoke anyone's. This is the §1.2
 * row "Revoke keys: developer own only; admin ✅; owner ✅".
 */
export function canRevokeKey(role: OrgRole, isOwn: boolean): boolean {
  if (role === 'owner' || role === 'admin') return true;
  if (role === 'developer') return isOwn;
  return false;
}

// ───────────────────────────────────────────────────────────────────────
//  Plan limits
// ───────────────────────────────────────────────────────────────────────

export interface ModelCheck {
  ok: boolean;
  error?: string;
  /** Deduplicated, order-preserving selection that passed the check. */
  models: string[];
}

/**
 * A requested key's models must be a subset of the plan's allowlist.
 *
 * Exact matches only: plan models are already the canonical aliases
 * (`fast` / `smart` / `frontier`, never upstream names — MASTER_PROMPT
 * §3), so fuzzy matching here would let a near-miss alias through to a
 * gateway that rejects it with a 404 the customer cannot interpret.
 */
export function assertModelsAllowed(
  requested: string[],
  planModels: string[],
  /** Aliases currently out of tokens (quota-narrowed). When a requested
   * model is entitled but exhausted, the error says "out of tokens"
   * instead of the misleading "not included in your plan". */
  exhaustedModels: string[] = [],
): ModelCheck {
  const allowed = new Set(planModels);
  const exhausted = new Set(exhaustedModels);

  const seen = new Set<string>();
  const models: string[] = [];
  for (const m of requested) {
    if (typeof m !== 'string' || m.length === 0) {
      return { ok: false, error: 'Each model must be a non-empty name.', models };
    }
    if (!allowed.has(m)) {
      if (exhausted.has(m)) {
        return {
          ok: false,
          error: `Model "${m}" is out of tokens for this period — renews next cycle. Available now: ${
            planModels.filter((p) => !exhausted.has(p)).join(', ') || 'none'
          }.`,
          models,
        };
      }
      return {
        ok: false,
        error: `Model "${m}" is not included in your plan. Available: ${
          planModels.length ? planModels.join(', ') : 'none'
        }.`,
        models,
      };
    }
    if (!seen.has(m)) {
      seen.add(m);
      models.push(m);
    }
  }

  if (models.length === 0) {
    return { ok: false, error: 'Select at least one model.', models: [] };
  }
  return { ok: true, models };
}

export interface KeyLimitState {
  canCreate: boolean;
  remaining: number;
  error?: string;
}

/**
 * Plan key ceiling. `activeCount` counts keys that are not revoked —
 * a revoked key frees its slot immediately, so a customer at the limit
 * can always rotate rather than being stuck.
 */
export function keyLimitState(activeCount: number, maxKeys: number): KeyLimitState {
  const remaining = Math.max(0, maxKeys - activeCount);
  if (remaining === 0) {
    return {
      canCreate: false,
      remaining: 0,
      error: `Your plan allows ${maxKeys} key${maxKeys === 1 ? '' : 's'}. Revoke one to free a slot.`,
    };
  }
  return { canCreate: true, remaining };
}
