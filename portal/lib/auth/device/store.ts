/**
 * Device-code store — Drizzle over the `portal` database.
 *
 * This is the ONLY file in lib/auth/device that touches our schema. The
 * service layer is wired to this port so it can be tested with fakes.
 *
 * The two lookups use raw SQL: drizzle namespaces joined-table columns
 * unpredictably across versions, and raw SQL here keeps the shape explicit.
 * The snake_case rows are mapped manually.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { deviceCodes, organizations, users } from '@/db/schema';
import { parseDeviceStatus } from '@/lib/auth/device/policy';

/** Identity joined onto a code so the token response can name the account. */
export interface DeviceCodeIdentity {
  id: string;
  userCode: string;
  userId: string | null;
  organizationId: string | null;
  status: 'pending' | 'approved' | 'consumed' | 'expired' | 'revoked';
  intervalSeconds: number;
  expiresAt: Date | null;
  approvedAt: Date | null;
  consumedAt: Date | null;
  keyId: string | null;
  keyPlaintext: string | null;
  models: string[];
  lastPolledAt: Date | null;
  userEmail: string | null;
  userName: string | null;
  organizationSlug: string | null;
  organizationName: string | null;
  createdAt: Date | null;
}

export interface DeviceStore {
  insert(input: {
    deviceCodeHash: string;
    userCode: string;
    expiresAt: Date;
    intervalSeconds: number;
  }): Promise<{ id: string }>;

  /** Look up a code by the stored device-code hash (the token poll path). */
  findByDeviceCodeHash(deviceCodeHash: string): Promise<DeviceCodeIdentity | null>;

  /** Look up by user code (the /device approval page reads the row this way). */
  findByUserCode(userCode: string): Promise<DeviceCodeIdentity | null>;

  /**
   * Mark a code approved: bind it to the signing-in user's organization and
   * remember which key (and its one-time plaintext) the app is about to
   * collect. Plaintext is held only until the app consumes the code.
   */
  approve(input: {
    id: string;
    userId: string;
    organizationId: string;
    keyId: string;
    keyPlaintext: string;
    at: Date;
  }): Promise<void>;

  /** Null the held plaintext and flip the row to consumed. */
  consume(id: string, at: Date): Promise<void>;

  /** Flip every pending code past its expiry to expired (idempotent cleanup). */
  expirePending(): Promise<number>;

  /** Mark every non-consumed code for an organization revoked (re-login). */
  revokeForOrganization(organizationId: string): Promise<number>;

  /** Remember the entitled model set on an approved code (non-secret). */
  updateModels(id: string, models: string[]): Promise<void>;

  /** Record the time of a token poll (enforces the server interval). */
  touchPolledAt(id: string, at: Date): Promise<void>;
}

/** Map a snake_case joined row onto the identity view. */
function toIdentity(row: Record<string, unknown>): DeviceCodeIdentity {
  return {
    id: String(row.id),
    userCode: String(row.user_code),
    userId: row.user_id ? String(row.user_id) : null,
    organizationId: row.organization_id ? String(row.organization_id) : null,
    status: parseDeviceStatus(String(row.status ?? 'expired')),
    intervalSeconds:
      typeof row.interval_seconds === 'number'
        ? row.interval_seconds
        : Number(row.interval_seconds),
    expiresAt: row.expires_at ? new Date(String(row.expires_at)) : null,
    approvedAt: row.approved_at ? new Date(String(row.approved_at)) : null,
    consumedAt: row.consumed_at ? new Date(String(row.consumed_at)) : null,
    keyId: row.key_id ? String(row.key_id) : null,
    keyPlaintext: row.key_plaintext as string | null,
    models: Array.isArray(row.models) ? row.models : [],
    lastPolledAt: row.last_polled_at ? new Date(String(row.last_polled_at)) : null,
    userEmail: row.user_email as string | null,
    userName: row.user_name as string | null,
    organizationSlug: row.organization_slug as string | null,
    organizationName: row.organization_name as string | null,
    createdAt: row.created_at ? new Date(String(row.created_at)) : null,
  };
}

/** Device codes joined to their user and organization, once. */
const IDENTITY_SELECT = `
  SELECT device_codes.id AS id,
         device_codes.user_code AS user_code,
         device_codes.user_id AS user_id,
         device_codes.organization_id AS organization_id,
         device_codes.status AS status,
         device_codes.interval_seconds AS interval_seconds,
         device_codes.expires_at AS expires_at,
         device_codes.approved_at AS approved_at,
         device_codes.consumed_at AS consumed_at,
         device_codes.key_id AS key_id,
         device_codes.key_plaintext AS key_plaintext,
         device_codes.models AS models,
         device_codes.last_polled_at AS last_polled_at,
         users.email AS user_email,
         users.name AS user_name,
         organizations.slug AS organization_slug,
         organizations.name AS organization_name
  FROM device_codes
  LEFT JOIN users ON users.id = device_codes.user_id
  LEFT JOIN organizations ON organizations.id = device_codes.organization_id
`;

/** Device codes joined to their user and organization, once. */
async function queryIdentity(where: 'device_code_hash' | 'user_code', value: string): Promise<DeviceCodeIdentity | null> {
  // `where` accepts only one of the two indexed lookup columns. It is a
  // compile-time constant at both call sites, never any caller input.
  let rows: Record<string, unknown>[];
  if (where === 'device_code_hash') {
    rows = (await db.execute(sql`
      ${sql.raw(IDENTITY_SELECT)}
      WHERE device_codes.device_code_hash = ${value}
    `)) as unknown as Record<string, unknown>[];
  } else {
    rows = (await db.execute(sql`
      ${sql.raw(IDENTITY_SELECT)}
      WHERE device_codes.user_code = ${value}
    `)) as unknown as Record<string, unknown>[];
  }

  const row = rows[0];
  return row ? toIdentity(row) : null;
}

export const store: DeviceStore = {
  async insert(input) {
    const [inserted] = await db
      .insert(deviceCodes)
      .values({
        deviceCodeHash: input.deviceCodeHash,
        userCode: input.userCode,
        expiresAt: input.expiresAt,
        intervalSeconds: input.intervalSeconds,
      })
      .returning({ id: deviceCodes.id });

    if (!inserted) throw new Error('device code insert returned no row');
    return { id: inserted.id };
  },

  async findByDeviceCodeHash(deviceCodeHash) {
    return queryIdentity('device_code_hash', deviceCodeHash);
  },

  async findByUserCode(userCode) {
    return queryIdentity('user_code', userCode);
  },

  async approve(input) {
    await db
      .update(deviceCodes)
      .set({
        userId: input.userId,
        organizationId: input.organizationId,
        status: 'approved',
        approvedAt: input.at,
        keyId: input.keyId,
        keyPlaintext: input.keyPlaintext,
      })
      .where(
        and(
          eq(deviceCodes.id, input.id),
          eq(deviceCodes.status, 'pending'),
          // Only an unexpired code can be approved: an expired code that an
          // approval request races past must stay expired.
          sql`device_codes.expires_at > ${input.at.toISOString()}`,
        ),
      );
  },

  async consume(id, at) {
    await db
      .update(deviceCodes)
      .set({ status: 'consumed', consumedAt: at, keyPlaintext: null })
      .where(eq(deviceCodes.id, id));
  },

  async expirePending() {
    const result = await db.execute(sql`
      UPDATE device_codes
      SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= now()
    `);
    return Number((result as unknown as { rowCount: number }).rowCount ?? 0);
  },

  async revokeForOrganization(organizationId) {
    const result = await db.execute(sql`
      UPDATE device_codes
      SET status = 'revoked'
      WHERE organization_id = ${organizationId}
        AND status IN ('pending', 'approved')
    `);
    return Number((result as unknown as { rowCount: number }).rowCount ?? 0);
  },

  async updateModels(id, models) {
    await db.update(deviceCodes).set({ models }).where(eq(deviceCodes.id, id));
  },

  async touchPolledAt(id, at) {
    await db.update(deviceCodes).set({ lastPolledAt: at }).where(eq(deviceCodes.id, id));
  },
};
