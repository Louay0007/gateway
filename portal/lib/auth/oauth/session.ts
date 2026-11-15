/**
 * Mint the session cookie after a successful OAuth callback.
 *
 * WHY WE MINT IT OURSELVES. Auth.js's `signIn()` is designed around ITS
 * callback route, its CSRF token and its own account adapter. Called from
 * our own callback it re-runs the whole dance and, with a Credentials
 * provider present and no adapter, throws `CallbackRouteError` — the exact
 * failure `auth.ts` documents. The session format, however, is just a JWT
 * encrypted with the same secret under the same salt, so we produce exactly
 * what `auth()` already knows how to read. One writer of identity, one
 * consumer of sessions, no second auth stack.
 *
 * The token MUST carry `sub` and `email`, and `pwdAt` must be present —
 * `lib/auth/jwt.ts` copies `pwdAt` at sign-in and `authorize.ts` compares
 * it to the live row (rejecting a mismatch). An OAuth identity has no
 * password, so its `password_changed_at` (defaulted at row creation,
 * 0006) is the value that gets copied. If it were omitted the session
 * would look stale on the first protected request.
 */
import { encode } from '@auth/core/jwt';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';

/** Auth.js's own 7-day maxAge (auth.ts `session.maxAge`). Kept in step by hand. */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Whether the cookie name carries the `__Secure-` prefix.
 *
 * Auth.js derives this from whether the site URL is https. `localhost` over
 * http is a secure context in browsers but is NOT https, so the prefix is
 * absent there — and a mismatch means the browser stores a cookie under a
 * name `auth()` never reads, producing a silent "signed in but not".
 */
export function useSecureCookie(authUrl: string | undefined = process.env.AUTH_URL): boolean {
  return (authUrl ?? '').trim().toLowerCase().startsWith('https://');
}

export function sessionCookieName(secure: boolean = useSecureCookie()): string {
  return `${secure ? '__Secure-' : ''}authjs.session-token`;
}

export interface MintSessionInput {
  /** auth_users.id — what `authorize.ts` resolves the session to. */
  authUserId: string;
  email: string;
  /** From `users.password_changed_at`, the freshness stamp. */
  passwordChangedAt: Date | null;
}

/**
 * Encrypt and set the session cookie. Throws when AUTH_SECRET is absent —
 * far better than writing a cookie nobody can decrypt.
 */
export async function mintSession(input: MintSessionInput): Promise<void> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('mintSession: AUTH_SECRET is not set');
  }

  const secure = useSecureCookie();
  const cookieName = sessionCookieName(secure);

  const token = await encode({
    token: {
      sub: input.authUserId,
      email: input.email,
      // Mirrors auth.ts's `jwt` callback, which writes `token.pwdAt` from
      // `user.passwordChangedAt`. `authorize.ts` compares this value, so it
      // must be an ISO string, not a Date.
      pwdAt: input.passwordChangedAt ? input.passwordChangedAt.toISOString() : null,
      name: null,
    },
    // The salt is the cookie name — this is how @auth/core derives the
    // encryption key (lib/actions/session.js). Getting it wrong produces a
    // cookie that exists and never decrypts.
    salt: cookieName,
    secret,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  const jar = await cookies();
  jar.set(cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/**
 * The freshness stamp for an auth identity, read from the DOMAIN mirror —
 * the same row `authorize.ts` compares against. A NULL row (an account
 * pre-dating 0002) yields NULL, which `sessionIsFresh` treats as "nothing
 * to invalidate".
 */
export async function passwordChangedAtFor(authUserId: string): Promise<Date | null> {
  const row = await db.query.users.findFirst({
    where: eq(users.authId, authUserId),
    columns: { passwordChangedAt: true },
  });
  return row?.passwordChangedAt ?? null;
}
