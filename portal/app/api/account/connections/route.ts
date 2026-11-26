/**
 * GET /api/account/connections — which providers are linked to MY account.
 *
 * READ ONLY, and self-scoped: the list is resolved from `users.auth_id` for
 * the caller in the session, so there is no id in the request to tamper
 * with. Nothing here links, unlinks, or writes — the linking itself happens
 * in the OAuth callback (lib/auth/oauth/resolve.ts), which is the only place
 * that has a provider-verified identity to act on.
 *
 * WHY IT EXISTS. `auth_accounts` has been the record of "how this person can
 * sign in" since 0002, but nothing could read it back: a customer who linked
 * GitHub in March had no way to see that, and support had no non-SQL answer.
 * This is that answer.
 *
 * WHAT IT NEVER RETURNS: `access_token`, `refresh_token`, `id_token`,
 * `session_state`. Those are bearer credentials; a settings page needs to
 * know a link EXISTS, not to hold the key to it. The columns are simply not
 * selected.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { authAccounts, users } from '@/db/schema';
import { currentUser } from '@/lib/auth/authorize';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One linked provider, as a caller needs to see it. */
interface ConnectionView {
  provider: string;
  /** The provider's immutable account id. Not a cookie; safe to display. */
  providerAccountId: string;
  /** The handle the provider shows (GitHub login). NULL elsewhere. */
  login: string | null;
  /** The address the provider reported, for "is this the right account?". */
  email: string | null;
  /** Whether THAT address was proven by the provider. */
  emailVerified: boolean;
}

export async function GET(): Promise<Response> {
  try {
    const user = await currentUser();
    if (!user) {
      return jsonError('unauthorized', 'Your session has expired. Sign in again to continue.');
    }

    // `auth_accounts.user_id` is the AUTH identity (`auth_users.id`), not the
    // domain id. `authorize.ts` resolves the session to `users`, so the
    // bridge is made explicitly here — one read of `users.auth_id`, then a
    // query on the table that actually holds the links.
    const domain = await db.query.users.findFirst({
      where: eq(users.id, user.id),
      columns: { authId: true, authProvider: true },
    });
    if (!domain || domain.authProvider !== 'authjs') {
      // A row that is not an Auth.js identity has no `auth_accounts` rows to
      // read. An empty list is the honest answer, not an error.
      return Response.json({ connections: [] });
    }

    const rows = await db
      .select({
        provider: authAccounts.provider,
        providerAccountId: authAccounts.providerAccountId,
        login: authAccounts.provider_login,
        email: authAccounts.provider_email,
        emailVerified: authAccounts.provider_email_verified,
      })
      .from(authAccounts)
      .where(eq(authAccounts.userId, domain.authId));

    const connections: ConnectionView[] = rows.map((r) => ({
      provider: r.provider,
      providerAccountId: r.providerAccountId,
      login: r.login ?? null,
      email: r.email ?? null,
      emailVerified: r.emailVerified === true,
    }));

    return Response.json({ connections });
  } catch (e) {
    return errorResponse(e);
  }
}
