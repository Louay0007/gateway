/**
 * Staff management — the roster, and the powers over it.
 *
 * UNTIL 0015 THIS WAS A CLI SCRIPT. `scripts/create-accounts.ts` was
 * the only writer of `staff_users`, so adding an operator meant a shell
 * on the VPS. That is unacceptable for a role that can suspend a paying
 * customer and approve their payment: access to the admin console had to
 * be granted out-of-band, which means it could also be REVOKED only
 * out-of-band, and only by someone with database access.
 *
 * Two deliberate constraints:
 *
 *   1. REVOCATION IS NOT DELETION. `revoked_at` is a column, and
 *      `requireStaff` refuses a revoked account. Deleting the row would
 *      leave `credit_notes.created_by` and `audit_log.actor_id` pointing
 *      at an id that no longer exists — destroying the evidence of who
 *      moved money. A revoked operator stays in the roster forever.
 *
 *   2. NOBODY EDITS THEMSELVES. Changing your own role, or revoking
 *      your own account, is the last-action-wins footgun: an operator
 *      promoting themselves to `owner` then locking out the only other
 *      owner is unrecoverable without a shell. Both are refused.
 *
 * Staff cannot be created with a password here. `create-accounts.ts`
 * owns credential creation because it must hash with the same scrypt
 * parameters the sign-in path verifies against; this module grants the
 * ACCESS, and a staff account without a credential signs in only after
 * that script has run.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { staffUsers } from '@/db/schema';
import { appendAudit } from '@/lib/audit';
import { STAFF_ROLES, staffAtLeast, type StaffRole } from '@/lib/auth/staff-roles';

export interface StaffRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  revokedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  /** Whether this account has a usable credential (a `users` mirror row). */
  hasCredential: boolean;
}

export async function listStaff(): Promise<StaffRow[]> {
  const rows = (await db.execute(sql`
    SELECT s.id::text, s.email, s.name, s.role, s.revoked_at,
           s.created_at, s.created_by,
           EXISTS (SELECT 1 FROM users u WHERE u.email = s.email) AS has_credential
      FROM staff_users s
     ORDER BY s.revoked_at NULLS FIRST, s.created_at DESC
  `)) as unknown as {
    id: string;
    email: string;
    name: string | null;
    role: string;
    revoked_at: Date | string | null;
    created_at: Date | string;
    created_by: string | null;
    has_credential: boolean;
  }[];

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    revokedAt: r.revoked_at == null ? null : new Date(r.revoked_at).toISOString(),
    createdAt: new Date(r.created_at).toISOString(),
    createdBy: r.created_by,
    hasCredential: r.has_credential,
  }));
}

export type StaffActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string; message: string };

/**
 * Grant staff access to an existing account's email.
 *
 * Requires `owner`. `support` can answer customers and `admin` can
 * suspend them, but granting access to the console is the power that
 * makes every other power reachable — it is the owner's alone.
 *
 * The email must already exist in `users`: this grants ACCESS to a
 * person who has signed up, it does not create an identity. A typo'd
 * address here would otherwise mint access for an address nobody owns.
 */
export async function grantStaffAccess(
  actorId: string,
  input: { email: string; name?: string | null; role: StaffRole },
): Promise<StaffActionResult> {
  const email = input.email.trim().toLowerCase();

  const mirror = await db.execute(sql`
    SELECT 1 FROM users WHERE lower(email) = ${email} LIMIT 1
  `);
  if (!mirror.length) {
    return {
      ok: false,
      error: 'unknown_user',
      message: 'No account exists with that email. Staff access is granted to an existing account.',
    };
  }

  const existing = await db.query.staffUsers.findFirst({
    where: eq(staffUsers.email, email),
  });
  if (existing && !existing.revokedAt) {
    return { ok: false, error: 'exists', message: 'That account already has staff access.' };
  }

  // Re-granting to a revoked row REACTIVATES it rather than inserting a
  // second one — `staff_users.email` is UNIQUE, so an insert would fail,
  // and the audit trail of the original grant must survive anyway.
  const [row] = existing
    ? await db
        .update(staffUsers)
        .set({ role: input.role, revokedAt: null, createdBy: actorId })
        .where(eq(staffUsers.id, existing.id))
        .returning({ id: staffUsers.id })
    : await db
        .insert(staffUsers)
        .values({
          email,
          name: input.name?.trim() || null,
          role: input.role,
          createdBy: actorId,
        })
        .returning({ id: staffUsers.id });

  await appendAudit({
    actorType: 'user',
    actorId,
    action: existing ? 'staff.reactivated' : 'staff.granted',
    targetType: 'staff_user',
    targetId: row?.id ?? null,
    organizationId: null,
    before: existing ? { role: existing.role, revoked: true } : null,
    after: { email, role: input.role },
  });

  return { ok: true, id: row?.id ?? '' };
}

/**
 * Change a staff member's role.
 *
 * Refuses self-edits and refuses to remove the LAST owner: both turn a
 * misclick into an unrecoverable lockout that needs a shell on the box.
 */
export async function setStaffRole(
  actorId: string,
  targetId: string,
  role: StaffRole,
): Promise<StaffActionResult> {
  if (targetId === actorId) {
    return {
      ok: false,
      error: 'self_edit',
      message: 'You cannot change your own role. Ask another owner.',
    };
  }

  const target = await db.query.staffUsers.findFirst({
    where: eq(staffUsers.id, targetId),
  });
  if (!target) return { ok: false, error: 'not_found', message: 'No such staff account.' };
  if (target.revokedAt) {
    return { ok: false, error: 'revoked', message: 'That account is revoked. Grant access again instead.' };
  }
  if (target.role === role) {
    return { ok: false, error: 'unchanged', message: 'That is already their role.' };
  }

  // Demoting the final owner would leave nobody able to grant access,
  // which is the one thing that cannot be undone from the product.
  if (target.role === 'owner' && role !== 'owner') {
    const owners = await db.execute(sql`
      SELECT count(*)::int AS n FROM staff_users
       WHERE role = 'owner' AND revoked_at IS NULL
    `);
    if (Number((owners[0] as { n: number })?.n ?? 0) <= 1) {
      return {
        ok: false,
        error: 'last_owner',
        message: 'This is the only owner. Promote another account first.',
      };
    }
  }

  await db
    .update(staffUsers)
    .set({ role })
    .where(eq(staffUsers.id, targetId));

  await appendAudit({
    actorType: 'user',
    actorId,
    action: 'staff.role_changed',
    targetType: 'staff_user',
    targetId: targetId,
    organizationId: null,
    before: { role: target.role },
    after: { role },
  });

  return { ok: true, id: targetId };
}

/**
 * Revoke access. The row survives so its audit trail does not.
 *
 * Same two guards as `setStaffRole`: not yourself, and not the last
 * owner. Revocation takes effect on the NEXT request — `requireStaff`
 * re-reads `staff_users` on every call rather than trusting a role
 * cached in the JWT, so there is no session to wait out.
 */
export async function revokeStaffAccess(
  actorId: string,
  targetId: string,
): Promise<StaffActionResult> {
  if (targetId === actorId) {
    return {
      ok: false,
      error: 'self_revoke',
      message: 'You cannot revoke your own access. Ask another owner.',
    };
  }

  const target = await db.query.staffUsers.findFirst({
    where: eq(staffUsers.id, targetId),
  });
  if (!target) return { ok: false, error: 'not_found', message: 'No such staff account.' };
  if (target.revokedAt) {
    return { ok: false, error: 'already_revoked', message: 'That account is already revoked.' };
  }

  if (target.role === 'owner') {
    const owners = await db.execute(sql`
      SELECT count(*)::int AS n FROM staff_users
       WHERE role = 'owner' AND revoked_at IS NULL
    `);
    if (Number((owners[0] as { n: number })?.n ?? 0) <= 1) {
      return {
        ok: false,
        error: 'last_owner',
        message: 'This is the only owner. Promote another account first.',
      };
    }
  }

  await db
    .update(staffUsers)
    .set({ revokedAt: new Date() })
    .where(eq(staffUsers.id, targetId));

  await appendAudit({
    actorType: 'user',
    actorId,
    action: 'staff.revoked',
    targetType: 'staff_user',
    targetId: targetId,
    organizationId: null,
    before: { role: target.role, email: target.email },
    after: { revoked: true },
  });

  return { ok: true, id: targetId };
}

export { STAFF_ROLES, staffAtLeast };