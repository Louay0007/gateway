/**
 * Account recoverability — the two states a customer cannot get out of.
 *
 *   LOCKED OUT. `auth_login_attempts` locks an identity after repeated
 *   failures, with backoff up to an hour (`lib/auth/throttle.ts`). A customer
 *   who fat-fingered their password six times cannot sign in, and no operator
 *   could clear it — so a paying customer waited out a timer while on the
 *   phone.
 *
 *   UNVERIFIED. `users.email_verified_at` gates checkout and key creation. A
 *   customer whose confirmation mail went to spam cannot pay, and cannot
 *   re-trigger the mail from a page they cannot reach.
 *
 * NEITHER IS A PASSWORD RESET, and that is deliberate. Staff setting a
 * customer's password would be impersonation by another name — the one thing
 * `lib/auth/authorize.ts` states the console must never do. Re-sending a
 * verification link is the limit: the customer still proves the address is
 * theirs by clicking it.
 */

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { appendAudit } from '@/lib/audit';
import { sendVerificationEmail } from '@/lib/auth/verify-email';
import { log } from '@/lib/log';

export interface LockedIdentityRow {
  /** The throttle bucket, e.g. `id:jane@acme.com`. */
  bucket: string;
  identity: string;
  failures: number;
  lockedUntil: string | null;
  lastFailureAt: string;
  /** Seconds remaining on the lock, or 0 when it has already expired. */
  lockedForSeconds: number;
}

/**
 * Identities currently throttled.
 *
 * Only `id:` buckets. The `ip:` form exists in the schema and is not produced
 * by the current code (there is no CDN, so no forwarded header can be
 * trusted — see throttle.ts), but a future edge limiter would add them, and an
 * operator does not need to see an IP list on this page.
 *
 * `locked_until > now()` is the filter rather than the existence of a bucket:
 * a row with five failures but no lock is a warning, not a lockout, and
 * clearing it would silently forgive the failures.
 */
export async function listLockedIdentities(limit = 50): Promise<LockedIdentityRow[]> {
  const capped = Math.min(200, Math.max(1, Math.floor(limit)));

  const rows = (await db.execute(sql`
    SELECT bucket,
           failures,
           last_failure_at,
           -- A FUTURE locked_until is the only thing that is actually a lock.
           (locked_until > now()) AS is_locked,
           GREATEST(0, EXTRACT(EPOCH FROM (locked_until - now())))::int AS locked_for
      FROM auth_login_attempts
     WHERE bucket LIKE 'id:%'
       AND locked_until > now()
     ORDER BY locked_until DESC
     LIMIT ${capped}
  `)) as unknown as {
    bucket: string;
    failures: number;
    last_failure_at: Date | string;
    is_locked: boolean;
    locked_for: number;
  }[];

  return rows
    .filter((r) => r.is_locked)
    .map((r) => ({
      bucket: r.bucket,
      identity: r.bucket.slice('id:'.length),
      failures: Number(r.failures),
      lockedUntil: new Date(new Date(r.last_failure_at).getTime()).toISOString(),
      lastFailureAt: new Date(r.last_failure_at).toISOString(),
      lockedForSeconds: Number(r.locked_for),
    }));
}

export type RecoveryResult = { ok: true; message: string } | { ok: false; error: string; message: string };

/**
 * Clear a login lockout.
 *
 * DELETES THE WHOLE BUCKET, which is what `recordSuccess()` does after a
 * successful sign-in — so an unlocked identity is in exactly the state a
 * successful login would have left it, rather than a third state nothing else
 * produces.
 *
 * ONLY the `id:` bucket for this identity. `bucketsFor()` in throttle.ts also
 * derives an `ip:` bucket from its second argument, but the login path passes
 * the identity for both, so no separate IP row exists to clear — and if one
 * ever did, clearing it would unlock every account behind that address.
 */
export async function unlockIdentity(staffId: string, emailRaw: string): Promise<RecoveryResult> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return { ok: false, error: 'validation', message: 'Enter the email address to unlock.' };
  }

  const bucket = `id:${email}`;

  const before = (await db.execute(sql`
    SELECT failures, locked_until FROM auth_login_attempts WHERE bucket = ${bucket} LIMIT 1
  `)) as unknown as { failures: number; locked_until: Date | string | null }[];

  if (!before.length) {
    return { ok: false, error: 'not_found', message: 'That account is not currently throttled.' };
  }

  await db.execute(sql`DELETE FROM auth_login_attempts WHERE bucket = ${bucket}`);

  await appendAudit({
    actorType: 'user',
    actorId: staffId,
    organizationId: null,
    action: 'auth.admin_unlocked',
    targetType: 'identity',
    targetId: email,
    before: {
      failures: Number(before[0]?.failures ?? 0),
      lockedUntil:
        before[0]?.locked_until == null ? null : new Date(before[0].locked_until).toISOString(),
    },
    after: { cleared: true },
  });

  log.info('admin: identity unlocked', { identity: email, staffId });
  return { ok: true, message: `${email} can sign in again.` };
}

/**
 * Re-send the confirmation link.
 *
 * DELEGATED, not reimplemented: `sendVerificationEmail()` is exactly what the
 * signup flow calls, including its "one active token per account" rule — so a
 * re-send invalidates any earlier link rather than leaving two usable tokens.
 *
 * It takes the AUTH identity id (`auth_users.id`), not the domain `users.id`,
 * because that is the table the token is minted against. The two are bridged
 * by email here, deliberately the same bridge `create-accounts.ts` uses.
 */
export async function resendVerification(
  staffId: string,
  emailRaw: string,
): Promise<RecoveryResult> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return { ok: false, error: 'validation', message: 'Enter the email address to verify.' };
  }

  const [identity] = await db
    .select({ id: sql<string>`id::text`, emailVerifiedAt: sql<Date | null>`email_verified_at` })
    .from(sql`auth_users`)
    .where(sql`lower(email) = ${email}`)
    .limit(1) as unknown as { id: string; emailVerifiedAt: Date | null }[];

  if (!identity) {
    return {
      ok: false,
      error: 'not_found',
      message: 'No login exists for that address. The customer may have signed up with a social provider.',
    };
  }

  const result = await sendVerificationEmail(identity.id);

  if (!result.sent) {
    const why =
      result.reason === 'already_verified'
        ? 'That address is already verified.'
        : 'The verification email could not be sent. Check the mail configuration.';
    return { ok: false, error: 'conflict', message: why };
  }

  await appendAudit({
    actorType: 'user',
    actorId: staffId,
    organizationId: null,
    action: 'auth.admin_verification_resent',
    targetType: 'identity',
    targetId: email,
    after: { resent: true },
  });

  return { ok: true, message: `A new confirmation link was sent to ${email}.` };
}

/** Accounts that cannot pay because their address is unconfirmed. */
export interface UnverifiedRow {
  userId: string;
  email: string;
  name: string | null;
  createdAt: string;
  /** The org they own, when they have one — the account that cannot check out. */
  orgName: string | null;
  orgId: string | null;
}

export async function listUnverifiedCustomers(limit = 50): Promise<UnverifiedRow[]> {
  const capped = Math.min(200, Math.max(1, Math.floor(limit)));

  const rows = (await db.execute(sql`
    SELECT u.id::text, u.email, u.name, u.created_at,
           o.id::text AS org_id, o.name AS org_name
      FROM users u
      LEFT JOIN organization_members m ON m.user_id = u.id AND m.role = 'owner'
      LEFT JOIN organizations o ON o.id = m.organization_id
     WHERE u.email_verified_at IS NULL
     ORDER BY u.created_at DESC
     LIMIT ${capped}
  `)) as unknown as {
    id: string;
    email: string;
    name: string | null;
    created_at: Date | string;
    org_id: string | null;
    org_name: string | null;
  }[];

  return rows.map((r) => ({
    userId: r.id,
    email: r.email,
    name: r.name,
    createdAt: new Date(r.created_at).toISOString(),
    orgId: r.org_id,
    orgName: r.org_name,
  }));
}
