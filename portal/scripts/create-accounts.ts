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
 * IDEMPOTENT, and that is the point. The first version refused to run if
 * the account existed (`createLocalUser` raises on a duplicate email),
 * which made it a one-shot: forget the password you generated, or change
 * STAFF_ROLE, and the only way forward was hand-written SQL against
 * password hashes. Re-running now CONVERGES the account to the requested
 * state — password included — so `make accounts` is the supported way to
 * reset a local login.
 *
 * WHY A SCRIPT AND NOT SQL. `auth_credentials.password` holds a scrypt
 * hash, so an INSERT has to reproduce lib/auth/password.ts exactly —
 * parameters, salt encoding, and all. Getting that subtly wrong produces
 * an account that exists, cannot sign in, and gives no error at insert
 * time. createLocalUser() is the same code the sign-up form runs, so the
 * credentials it writes are correct by construction.
 *
 * STAFF ROWS ARE SEPARATE BY DESIGN. A staff identity gets a `staff_users`
 * row and NO org membership: nothing may allow staff to act as customers.
 * This script deliberately does not call
 * ensurePersonalOrg for the staff account: it creates the identity so the
 * person can authenticate, and nothing else.
 *
 * TWO STAFF CREDENTIALS, since 0053, and they are not the same thing:
 *
 *   auth_users + auth_credentials   the PORTAL login (email + password),
 *                                   unchanged, so /sign-in still works.
 *   staff_users.username + staff_credentials
 *                                   the CONSOLE login at /admin/login
 *                                   (username + password).
 *
 * The console password is deliberately a separate secret. The console
 * cookie is a different cookie under a different derived key
 * (lib/auth/admin-auth.ts), and a portal session grants nothing on the
 * console — so sharing one password would only mean sharing one weakness.
 */

import { and, eq, or } from 'drizzle-orm';
import { db } from '@/db';
import { authCredentials, authUsers, staffCredentials, staffUsers, users } from '@/db/schema';
import { createLocalUser } from '@/lib/auth/create-user';
import { hashPassword, validatePassword } from '@/lib/auth/password';
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

/**
 * Create the account, or reset it to the requested state.
 *
 * The password change stamps `users.password_changed_at`, which is what
 * invalidates sessions already issued against the old password
 * (lib/auth/authorize.ts compares that stamp with the one in the JWT).
 * Without the stamp, a browser still holding a cookie from before the
 * reset would keep working — and after a reset that is precisely the
 * thing you are trying to stop.
 */
async function ensureAccount(input: {
  email: string;
  password: string;
  name: string;
}): Promise<{ userId: string; domainUserId: string; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  const existing = await db.query.authUsers.findFirst({
    where: eq(authUsers.email, email),
  });

  if (!existing) {
    const result = await createLocalUser({
      email,
      name: input.name,
      password: input.password,
      // Verified because these accounts exist to be used, and a local
      // transport can never deliver the confirmation link a real signup
      // depends on. Unverified cannot create keys or check out, so the
      // account would be useless for testing the product.
      emailVerified: true,
    });
    return { ...result, created: true };
  }

  const hash = await hashPassword(input.password);
  const now = new Date();

  const domainUserId = await db.transaction(async (tx) => {
    await tx
      .insert(authCredentials)
      .values({ userId: existing.id, password: hash, updatedAt: now })
      .onConflictDoUpdate({
        target: authCredentials.userId,
        set: { password: hash, updatedAt: now },
      });

    await tx
      .update(authUsers)
      .set({ emailVerified: now, name: input.name })
      .where(eq(authUsers.id, existing.id));

    // The domain mirror is authoritative for all product logic, so it is
    // brought in step here too (authorize.ts resolves by email, and a
    // mirror left unverified shows the "confirm your email" banner even
    // though the identity is verified).
    //
    // UPDATE-then-INSERT rather than ON CONFLICT: `users` has TWO unique
    // keys — unique(email) and unique(auth_provider, auth_id) — and an
    // upsert can only name one conflict target. A row whose email changed
    // but whose auth id still matches would fall through the email target
    // and abort the transaction on the other constraint instead.
    const mirrorSet = {
      email,
      name: input.name,
      emailVerifiedAt: now,
      passwordChangedAt: now,
      updatedAt: now,
    };

    const updated = await tx
      .update(users)
      .set(mirrorSet)
      .where(
        and(
          eq(users.authProvider, 'authjs'),
          or(eq(users.authId, existing.id), eq(users.email, email)),
        ),
      )
      .returning({ id: users.id });

    const found = updated[0];
    if (found) return found.id;

    const [inserted] = await tx
      .insert(users)
      .values({ authProvider: 'authjs', authId: existing.id, ...mirrorSet })
      .returning({ id: users.id });

    if (!inserted) throw new Error('create-accounts: domain mirror insert returned no row');
    return inserted.id;
  });

  return { userId: existing.id, domainUserId, created: false };
}

async function main() {
  const customerEmail = need('CUSTOMER_EMAIL');
  const customerPassword = need('CUSTOMER_PASSWORD');
  const staffEmail = need('STAFF_EMAIL');
  const staffPassword = need('STAFF_PASSWORD');
  const staffRole = (process.env.STAFF_ROLE ?? 'admin') as StaffRole;
  const staffUsername = (process.env.STAFF_USERNAME ?? 'admin').trim().toLowerCase();

  // No spaces, no empty: it is typed into a form and compared on a lower()
  // index, so anything else is a login nobody can reproduce.
  if (!/^\S{1,64}$/.test(staffUsername)) {
    console.error('FATAL: STAFF_USERNAME must be 1–64 characters with no spaces.');
    process.exit(1);
  }

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

  const customer = await ensureAccount({
    email: customerEmail,
    password: customerPassword,
    name: process.env.CUSTOMER_NAME ?? 'Customer',
  });
  console.log(
    `  customer  ${customerEmail}  domainUserId=${customer.domainUserId}  ${customer.created ? 'created' : 'password reset'}`,
  );

  // ── Staff: identity only. No org, no membership — see the header.
  const staff = await ensureAccount({
    email: staffEmail,
    password: staffPassword,
    name: process.env.STAFF_NAME ?? 'Staff',
  });
  console.log(
    `  staff     ${staffEmail}  authUserId=${staff.userId}  ${staff.created ? 'created' : 'password reset'}`,
  );

  // Role is converged, not inserted blindly: re-running with a different
  // STAFF_ROLE must actually change the role, and a revoked row must come
  // back to active — otherwise a revoked operator silently stays revoked
  // and the console answers 403 with no explanation.
  // Converge the roster row: role, revocation and the console username.
  const [row] = await db
    .insert(staffUsers)
    .values({
      email: staffEmail.toLowerCase(),
      username: staffUsername,
      name: process.env.STAFF_NAME ?? 'Staff',
      role: staffRole,
    })
    .onConflictDoUpdate({
      target: staffUsers.email,
      set: {
        role: staffRole,
        revokedAt: null,
        username: staffUsername,
        name: process.env.STAFF_NAME ?? 'Staff',
      },
    })
    .returning({ id: staffUsers.id, role: staffUsers.role });

  if (!row) {
    console.error('FATAL: staff row upsert returned no row.');
    process.exit(1);
  }

  // ── The console credential (0053) ─────────────────────────────────
  //
  // CONVERGED, not created once, for the same reason the password above is:
  // a re-run is the supported way to reset a console login without SQL. The
  // KDF is lib/auth/password.ts — the same one the login verifies against,
  // because a second hashing scheme is a second bug.
  const consoleHash = await hashPassword(staffPassword);
  const now = new Date();
  await db
    .insert(staffCredentials)
    .values({
      staffUserId: row.id,
      password: consoleHash,
      passwordChangedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: staffCredentials.staffUserId,
      set: { password: consoleHash, passwordChangedAt: now, updatedAt: now },
    });

  console.log(`  staff row ${row.id}  role=${row.role}  username=${staffUsername}`);
  console.log(
    '  done — portal sign-in at /sign-in (email); console sign-in at /admin/login (username).',
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`FATAL: ${(e as Error)?.message ?? e}`);
    process.exit(1);
  },
);