/**
 * API key administration, and desktop sign-in revocation.
 *
 * THE GAP. The drill-down shows key PREFIXES and cannot revoke one, so during
 * a leak the customer has to be talked through their own dashboard while the
 * key is live. `device_codes` — one row per `zn-` key minted through the
 * desktop flow — was read by no screen at all.
 *
 * KEY MATERIAL IS NEVER READ. `key_hash` is not selected by any query here,
 * the same discipline `lib/admin/orgs.ts` states for the roster: revoking
 * needs the id, not the secret.
 *
 * THE GATEWAY SIDE IS REUSED, not reimplemented. `revokeApiKey()`
 * (lib/keys/service.ts) already deletes the LiteLLM key and writes its own
 * audit row; this adds the staff-actor path, because a staff caller has no
 * `requireActiveOrg()` to prove ownership with.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { apiKeys, deviceCodes } from '@/db/schema';
import { appendAudit } from '@/lib/audit';
import { revokeKey } from '@/lib/keys';
import { log } from '@/lib/log';

export interface AdminKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  kind: string;
  deviceName: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** Every key for an org, including revoked ones — an operator needs history. */
export async function listKeysForOrg(orgId: string): Promise<AdminKeyRow[]> {
  const rows = (await db.execute(sql`
    SELECT id::text, name, key_prefix, kind, device_name,
           revoked_at, last_used_at, expires_at, created_at
      FROM api_keys
     WHERE organization_id = ${orgId}::uuid
     ORDER BY revoked_at NULLS FIRST, created_at DESC
     LIMIT 200
  `)) as unknown as {
    id: string;
    name: string;
    key_prefix: string;
    kind: string;
    device_name: string | null;
    revoked_at: Date | string | null;
    last_used_at: Date | string | null;
    expires_at: Date | string | null;
    created_at: Date | string;
  }[];

  // `key_hash` is deliberately absent from the projection above: it cannot
  // leak from this read even by accident.
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    keyPrefix: r.key_prefix,
    kind: r.kind,
    deviceName: r.device_name,
    revokedAt: iso(r.revoked_at),
    lastUsedAt: iso(r.last_used_at),
    expiresAt: iso(r.expires_at),
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export type KeyActionResult = { ok: true } | { ok: false; error: string; message: string };

/**
 * Revoke a key on an org's behalf.
 *
 * TWO GUARDS BEFORE THE GATEWAY CALL, both about not acting on the wrong
 * thing: the key must belong to the org in the URL (so a staff id from one
 * drill-down cannot revoke another account's credential), and it must not
 * already be revoked (so a double click is a clear answer rather than a
 * confusing upstream error).
 *
 * `revokeApiKey` takes a userId for its own ownership check. A staff member is
 * not a member of the org, so the check is bypassed by passing the key's own
 * creator — which is honest: the actor recorded in the audit row is the
 * OPERATOR, not that creator.
 */
export async function adminRevokeKey(
  staffId: string,
  orgId: string,
  keyId: string,
  reason: string,
): Promise<KeyActionResult> {
  const key = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.id, keyId), eq(apiKeys.organizationId, orgId)),
  });

  // A key in another org must be indistinguishable from one that does not
  // exist — the same 404-not-403 rule `requireOrgMembership` applies.
  if (!key) return { ok: false, error: 'not_found', message: 'No such key on this account.' };
  if (key.revokedAt) {
    return { ok: false, error: 'conflict', message: 'That key is already revoked.' };
  }

  try {
    // `revokeKey` is the production wrapper (lib/keys/index.ts): it binds the
    // real Postgres store and the real LiteLLM gateway, and it is the same
    // call the customer's own DELETE /api/keys/[id] makes. One implementation
    // of "revoke a key", so the gateway side cannot drift.
    await revokeKey({
      organizationId: orgId,
      keyId,
      // The key's own creator satisfies the service's ownership check without
      // pretending a staff member belongs to the org. The audit row below
      // names the OPERATOR, which is the fact that matters.
      userId: key.createdBy,
      role: 'owner',
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'The gateway refused the revocation.';
    log.error('admin: key revocation failed', { orgId, keyId, error: message });
    return { ok: false, error: 'upstream', message };
  }

  await appendAudit({
    actorType: 'user',
    actorId: staffId,
    organizationId: orgId,
    action: 'key.admin_revoked',
    targetType: 'api_key',
    targetId: keyId,
    before: { name: key.name, prefix: key.keyPrefix, revoked: false },
    after: { revoked: true, reason: reason.trim() || null },
  });

  return { ok: true };
}

// ───────────────────────────────────────────────────────────────────────
//  Devices
// ───────────────────────────────────────────────────────────────────────

export interface AdminDeviceRow {
  id: string;
  userCode: string;
  status: string;
  deviceName: string | null;
  userName: string | null;
  userEmail: string | null;
  keyId: string | null;
  keyRevoked: boolean;
  expiresAt: string;
  createdAt: string;
}

/** Desktop sign-ins for an org, newest first. */
export async function listDevicesForOrg(orgId: string): Promise<AdminDeviceRow[]> {
  const rows = (await db.execute(sql`
    SELECT d.id::text, d.user_code, d.status::text AS status, d.device_name,
           u.name AS user_name, u.email AS user_email,
           d.key_id::text AS key_id,
           (k.revoked_at IS NOT NULL) AS key_revoked,
           d.expires_at, d.created_at
      FROM device_codes d
      LEFT JOIN users    u ON u.id = d.user_id
      LEFT JOIN api_keys k ON k.id = d.key_id
     WHERE d.organization_id = ${orgId}::uuid
     ORDER BY d.created_at DESC
     LIMIT 100
  `)) as unknown as {
    id: string;
    user_code: string;
    status: string;
    device_name: string | null;
    user_name: string | null;
    user_email: string | null;
    key_id: string | null;
    key_revoked: boolean | null;
    expires_at: Date | string;
    created_at: Date | string;
  }[];

  return rows.map((r) => ({
    id: r.id,
    userCode: r.user_code,
    status: r.status,
    deviceName: r.device_name,
    userName: r.user_name,
    userEmail: r.user_email,
    keyId: r.key_id,
    keyRevoked: Boolean(r.key_revoked),
    expiresAt: new Date(r.expires_at).toISOString(),
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/**
 * Sign a machine out.
 *
 * BOTH ROWS, always. The `device_codes` row is the approval record; the
 * `api_keys` row is what actually authenticates a request. Revoking only the
 * approval leaves a working credential behind a dead record — the same half-fix
 * shape as any "disable" that does not disable.
 *
 * `key_plaintext` is cleared as well: it exists only between approval and the
 * app's first poll, and a revoke is a statement that it must never be handed
 * out.
 */
export async function adminRevokeDevice(
  staffId: string,
  orgId: string,
  deviceCodeId: string,
): Promise<KeyActionResult> {
  const device = await db.query.deviceCodes.findFirst({
    where: and(eq(deviceCodes.id, deviceCodeId), eq(deviceCodes.organizationId, orgId)),
  });
  if (!device) return { ok: false, error: 'not_found', message: 'No such device on this account.' };
  if (device.status === 'revoked') {
    return { ok: false, error: 'conflict', message: 'That device is already revoked.' };
  }

  const now = new Date();

  await db
    .update(deviceCodes)
    .set({ status: 'revoked', keyPlaintext: null })
    .where(eq(deviceCodes.id, deviceCodeId));

  // The credential itself, when the flow got far enough to mint one. A
  // 'pending' code has no key yet — nothing to revoke, and the status change
  // above is enough to stop it being approved.
  if (device.keyId) {
    await db
      .update(apiKeys)
      .set({ revokedAt: now })
      .where(and(eq(apiKeys.id, device.keyId), isNull(apiKeys.revokedAt)));
  }

  await appendAudit({
    actorType: 'user',
    actorId: staffId,
    organizationId: orgId,
    action: 'device.admin_revoked',
    targetType: 'device_code',
    targetId: deviceCodeId,
    before: { status: device.status, deviceName: device.deviceName, keyId: device.keyId },
    after: { status: 'revoked', keyRevoked: Boolean(device.keyId) },
  });

  return { ok: true };
}

function iso(v: Date | string | null | undefined): string | null {
  return v == null ? null : new Date(v).toISOString();
}
