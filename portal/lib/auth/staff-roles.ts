/**
 * Staff roles — the one definition, shared by the gates and the UI.
 *
 * Extracted from `authorize.ts` so `lib/admin/staff.ts` can validate a
 * role WITHOUT importing authorize.ts. That import would be circular:
 * authorize imports the rank table to gate requests, and the staff
 * service needs the same table to validate a POST body. Two copies of a
 * rank table is how a console ends up offering `superadmin` to a role
 * check that has never heard of it.
 *
 * The order is fixed and total: `read_only` can look, `support` can
 * answer customers and clear payments, `admin` can stop an account and
 * move money, `owner` can grant and revoke every other power — including
 * the ones above. `staffAtLeast` is the only comparison anywhere; there
 * is no per-route bespoke check to drift out of sync.
 */

export const STAFF_ROLES = ['read_only', 'support', 'admin', 'owner'] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_RANK: Record<StaffRole, number> = {
  read_only: 0,
  support: 1,
  admin: 2,
  owner: 3,
};

/**
 * Is `role` at least `required`?
 *
 * Rank-based, not set-membership, so the gates compose: `support` passes
 * a `read_only` check without anyone enumerating every valid pair.
 */
export function staffAtLeast(role: StaffRole, required: StaffRole): boolean {
  return STAFF_RANK[role] >= STAFF_RANK[required];
}

/** Narrowing guard for untrusted input (a POST body, a CSV, a query param). */
export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}

/** What each tier may do — rendered in the staff console so the
 *  ladder is documented where it is used rather than only in a table. */
export const STAFF_ROLE_SUMMARY: Record<StaffRole, string> = {
  read_only: 'View every account, payment and audit entry. Cannot change anything.',
  support: 'Everything read_only can do, plus approve D17 payments and retry entitlement syncs.',
  admin: 'Everything support can do, plus suspend accounts and record credit notes.',
  owner: 'Everything admin can do, plus grant, change and revoke staff access.',
};