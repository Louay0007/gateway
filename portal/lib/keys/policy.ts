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

import { createHash } from 'node:crypto';
import { slugify } from '@/lib/org/slug';
import type { OrgRole } from '@/db/schema';

/** How much of the key we keep for display. Enough to identify a key in
 *  a table, too short to be useful to anyone who never sees the full
 *  value. */
export const KEY_PREFIX_LENGTH = 12;

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
export function assertModelsAllowed(requested: string[], planModels: string[]): ModelCheck {
  const allowed = new Set(planModels);

  const seen = new Set<string>();
  const models: string[] = [];
  for (const m of requested) {
    if (typeof m !== 'string' || m.length === 0) {
      return { ok: false, error: 'Each model must be a non-empty name.', models };
    }
    if (!allowed.has(m)) {
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
