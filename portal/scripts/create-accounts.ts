/**
 * Create a customer account and a staff account on this environment.
 *
 *   docker compose run --rm --no-deps jobs \
 *     node --experimental-transform-types \
 *          --import ./scripts/register-ts-resolve.mjs scripts/create-accounts.ts
 *
 * Both emails and both passwords come from the environment. Nothing is
 * hard-coded and nothing is printed in full, so the script is safe to run
 * from a shell history or a CI log:
 *
 *   CUSTOMER_EMAIL=... CUSTOMER_PASSWORD=... STAFF_EMAIL=... \
 *   STAFF_PASSWORD=... STAFF_ROLE=admin \
 *   docker compose run --rm --no-deps -e CUSTOMER_EMAIL -e CUSTOMER_PASSWORD \
 *     -e STAFF_EMAIL -e STAFF_PASSWORD -e STAFF_ROLE jobs ...
 *
 * WHY A SCRIPT AND NOT SQL. `auth_credentials.password` holds a scrypt
 * hash, so an INSERT has to reproduce lib/auth/password.ts exactly —
 * parameters, salt encoding, and all. Getting that subtly wrong produces
 * an account that exists, cannot sign in, and gives no error at insert
 * time. createLocalUser() is the same code the sign-up form runs, so the
 * credentials it writes are correct by construction.
 *
 * STAFF ROWS ARE SEPARATE BY DESIGN. A staff identity gets a `staff_users`
 * row and NO org membership, because PLATFORM.md §1.2 forbids staff from
 * acting as customers. This script deliberately does not call
 * ensurePersonalOrg for the staff account: it creates the identity so the
 * person can authenticate, and nothing else.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { staffUsers } from '@/db/schema';
import { createLocalUser } from '@/lib/auth/create-user';
import { validatePassword } from '@/lib/auth/password';
import type { StaffRole } from '@/lib/auth/authorize';

const ROLES: StaffRole[] = ['read_only', 'support', 'admin', 'owner'];

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`FATAL: ${name} is not set.`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const customerEmail = need('CUSTOMER_EMAIL');
  const customerPassword = need('CUSTOMER_PASSWORD');
  const staffEmail = need('STAFF_EMAIL');
  const staffPassword = need('STAFF_PASSWORD');
  const staffRole = (process.env.STAFF_ROLE ?? 'admin') as StaffRole;

  if (!ROLES.includes(staffRole)) {
    console.error(`FATAL: STAFF_ROLE must be one of ${ROLES.join(', ')}.`);
    process.exit(1);
  }
  for (const [label, pw] of [
    ['CUSTOMER_PASSWORD', customerPassword],
    ['STAFF_PASSWORD', staffPassword],
  ] as const) {
    const verdict = validatePassword(pw);
    if (!verdict.ok) {
      console.error(`FATAL: ${label} rejected by policy — ${verdict.error}`);
      process.exit(1);
    }
  }

  // ── Customer: verified, because these accounts exist to be used, and a
  //    local `EMAIL_TRANSPORT=dev` can never deliver the confirmation link
  //    a real signup depends on. Verified up front is the only way the
  //    account can pass the checkout/key-creation gate at all.
  const customer = await createLocalUser({
    email: customerEmail,
    name: process.env.CUSTOMER_NAME ?? 'Customer',
    password: customerPassword,
    emailVerified: true,
  });
  console.log(`  customer  ${customerEmail}  domainUserId=${customer.domainUserId}`);

  // ── Staff: identity only. No org, no membership — see the header.
  const staff = await createLocalUser({
    email: staffEmail,
    name: process.env.STAFF_NAME ?? 'Staff',
    password: staffPassword,
    emailVerified: true,
  });
  console.log(`  staff     ${staffEmail}  authUserId=${staff.userId}`);

  const [row] = await db
    .insert(staffUsers)
    .values({
      email: staffEmail.toLowerCase(),
      name: process.env.STAFF_NAME ?? 'Staff',
      role: staffRole,
    })
    .onConflictDoUpdate({
      target: staffUsers.email,
      set: { role: staffRole },
    })
    .returning({ id: staffUsers.id, role: staffUsers.role });

  console.log(`  staff row ${row?.id}  role=${row?.role}`);
  console.log('  done — sign in at /sign-in; /admin and /admin/d17 need the staff role.');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`FATAL: ${(e as Error)?.message ?? e}`);
    process.exit(1);
  },
);