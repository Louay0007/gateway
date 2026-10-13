/**
 * Local account creation — the ONE code path that creates a user.
 *
 * Extracted from the sign-up server action so that anything else which
 * needs a real account (today: scripts/verify-metering.ts, which must
 * provision through the same transaction a browser sign-up runs) calls
 * this instead of a lookalike. Two code paths for "create a user" drift;
 * the meter only ever bills the accounts the product can actually make.
 *
 * Order, and why it is one transaction:
 *   1. auth identity + credentials row (scrypt hash — lib/auth/password.ts)
 *   2. domain `users` mirror — authoritative for ALL product logic
 *      (PLATFORM.md §2.1: authorization reads this table, never auth_users)
 *
 * An auth identity with no domain mirror is a user who can sign in but
 * has no product row; the reverse is a dead account. Neither is
 * recoverable by hand, so they commit together or not at all.
 */

import { eq } from 'drizzle-orm';
import { hashPassword } from '@/lib/auth/password';
import { db } from '@/db';
import { authUsers, authCredentials, users } from '@/db/schema';

export interface CreateLocalUserInput {
  email: string;
  name?: string | null;
  /** Plaintext. Hashed here; never stored, logged, or returned. */
  password: string;
}

export interface CreateLocalUserResult {
  /** auth_users.id — the identity NextAuth signs in. */
  userId: string;
  /**
   * users.id — the domain mirror row. NOT the same value, and every
   * product read (provisioning, memberships, keys) needs THIS one: the
   * request path bridges the two by email (authorize.ts userByEmail).
   * Returned explicitly so no caller has to guess which id it holds.
   */
  domainUserId: string;
}

export async function createLocalUser(
  input: CreateLocalUserInput,
): Promise<CreateLocalUserResult> {
  const email = input.email.trim().toLowerCase();

  // The server action checks first so it can answer without leaking; this
  // second check is the race guard that keeps the unique index from
  // aborting the transaction halfway.
  const existing = await db.query.authUsers.findFirst({
    where: eq(authUsers.email, email),
  });
  if (existing) {
    throw new Error(`createLocalUser: an account already exists for ${email}`);
  }

  const hash = await hashPassword(input.password);
  const userId = crypto.randomUUID();

  const domainUserId = await db.transaction(async (tx) => {
    await tx.insert(authUsers).values({
      id: userId,
      name: input.name ?? null,
      email,
      emailVerified: null,   // no mail transport yet; Phase 6 adds verification
    });
    await tx.insert(authCredentials).values({ userId, password: hash });
    // Domain mirror (authoritative for product logic).
    const [mirror] = await tx
      .insert(users)
      .values({
        authProvider: 'authjs',
        authId: userId,
        email,
        name: input.name ?? null,
      })
      .returning({ id: users.id });
    if (!mirror) throw new Error('createLocalUser: domain mirror insert returned no row');
    return mirror.id;
  });

  return { userId, domainUserId };
}
