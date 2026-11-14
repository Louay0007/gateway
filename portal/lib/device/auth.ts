/**
 * Device-endpoint authentication, shared by every `/api/device/*` route.
 *
 * The desktop agent holds a `zn-` gateway key but no browser session, so it
 * cannot call `/api/subscription` (which needs requireActiveOrg). Every
 * device route resolves its organization the same way: hash the bearer,
 * match `api_keys.key_hash`, require a live key on an active org.
 *
 * ONE COPY ON PURPOSE. Two routes had two copies of this lookup and one of
 * them compared the plaintext against `key_hash`, which can never match —
 * that endpoint answered 401 for every caller, including valid keys, for
 * as long as it shipped.
 */

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

/**
 * SHA-256 hex of the presented key, which is what `api_keys.key_hash`
 * stores (lib/keys/policy.ts keyHashFor). Also the only safe thing to put
 * in a throttle bucket: the table then holds no credential.
 */
export function keyDigest(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** The org that owns this key, or null when it is unknown or revoked. */
export async function orgIdForKey(key: string): Promise<string | null> {
  const [row] = (await db.execute(sql`
    SELECT ak.organization_id
      FROM api_keys ak
      JOIN organizations o ON o.id = ak.organization_id
     WHERE ak.key_hash = ${keyDigest(key)}
       AND ak.revoked_at IS NULL
       AND o.status = 'active'
     LIMIT 1
  `)) as unknown as { organization_id: string }[];
  return row?.organization_id ?? null;
}

/**
 * The key's own expiry, in the same round trip as the org lookup.
 *
 * Both device routes already resolve the key; a second query for one column
 * would be a second chance for the two to disagree. NULL means the row has
 * no expiry — a key minted before device TTLs existed, or an org key.
 *
 * EXPIRED KEYS ARE REJECTED HERE, not left for the gateway wall to catch.
 *
 * The device flow mints a 30-day key. Until this check existed, an expired
 * key still resolved here: `/api/device/usage` answered 200, so the desktop
 * looked signed in, and the failure surfaced only when a prompt reached
 * LiteLLM and came back 401/403 — indistinguishable from a revoked key, a
 * wrong alias or a spent pool. The app could not tell "your key expired,
 * sign in again" from "something is broken", which is the one message a
 * metered product must never fumble.
 *
 * Kept in SQL rather than as a JS comparison on `expiry` so the database and
 * this function cannot disagree about what "now" means.
 */
export async function keyInfoFor(
  key: string,
): Promise<{ organizationId: string; expiresAt: string | null } | null> {
  const [row] = (await db.execute(sql`
    SELECT ak.organization_id, ak.expires_at
      FROM api_keys ak
      JOIN organizations o ON o.id = ak.organization_id
     WHERE ak.key_hash = ${keyDigest(key)}
       AND ak.revoked_at IS NULL
       AND o.status = 'active'
       AND (ak.expires_at IS NULL OR ak.expires_at > now())
     LIMIT 1
  `)) as unknown as { organization_id: string; expires_at: Date | string | null }[];
  if (!row) return null;
  const expiry = row.expires_at ? new Date(row.expires_at) : null;
  return {
    organizationId: row.organization_id,
    expiresAt: expiry && !Number.isNaN(expiry.getTime()) ? expiry.toISOString() : null,
  };
}

/**
 * The `zn-` key from an Authorization header, or null.
 *
 * The `zn-` prefix check is not cosmetic: it is what keeps a portal session
 * cookie or a random bearer from being hashed and looked up as a key.
 */
export function bearerKey(request: Request): string | null {
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const key = auth.slice(7).trim();
  return key.startsWith('zn-') ? key : null;
}
