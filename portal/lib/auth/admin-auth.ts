/**
 * The console's own Auth.js instance — a SEPARATE cookie from the portal's.
 *
 * WHY A SECOND INSTANCE rather than a second provider on `auth.ts`.
 *
 * The console lives on its own host (`CONSOLE_DOMAIN`) but shares this
 * process, and `createActionURL()` forces the `AUTH_URL` origin for every
 * action — so a console sign-in would otherwise mint a cookie identical in
 * name and key to a customer's. One stolen console cookie would then be a
 * portal credential.
 *
 * THE COOKIE NAME IS THE ISOLATION, not a convention.
 * `lib/auth/session-token.ts` derives its key by HKDF over
 * `Auth.js Generated Encryption Key (<cookie name>)`, so
 * `authjs.staff-session-token` decrypts under a DIFFERENT key than
 * `authjs.session-token` for the same AUTH_SECRET:
 *
 *   - `proxy.ts` reads only the portal name, so a console session
 *     structurally cannot reach a tenant route;
 *   - `currentStaffSession()` reads only the console name, so a customer
 *     session can never open the console.
 *
 * Both directions are proven in `tests/admin-login.test.ts` rather than
 * asserted here, because "the two cookies are different strings" is not the
 * property that matters — "they do not decrypt as each other" is.
 *
 * IDENTITY ONLY. The role in this token is a display hint. `requireStaff()`
 * re-reads `staff_users` on every request, because a JWT cannot be revoked
 * when a role is demoted or an operator is revoked.
 */

import NextAuth, { type DefaultSession, type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';

import { log } from '@/lib/log';
import { verifyPassword } from '@/lib/auth/password';
import { checkThrottle, recordFailure, recordSuccess } from '@/lib/auth/throttle';
import { staffByUsername, verifyStaffPassword } from '@/lib/auth/staff-credentials';

declare module 'next-auth' {
  interface Session {
    staff?: {
      id: string;
      username: string;
      /** Display hint only — the gates re-read staff_users. */
      role: string;
      passwordChangedAt: string | null;
    };
  }
  interface User {
    /** Carried from authorize() into the jwt callback, once, at sign-in. */
    staffRole?: string;
    passwordChangedAt?: string | null;
  }
}

/**
 * Cookie names come from `lib/auth/session-token.ts`, which READS them.
 *
 * Not defined here, because this module is the writer and that one is the
 * reader: two copies of a cookie name is how a session silently stops being
 * found, and the failure looks like "logged out at random".
 *
 * A `__Secure-`/`__Host-` prefix over plain HTTP is a cookie the browser
 * accepts and then silently refuses to send back — a redirect loop with no
 * error anywhere, because nothing is actually broken. The old gate had
 * exactly that bug; `staffCookieName` applies the same rule @auth/core does.
 */
import { staffCookieName, staffSessionCookieName } from '@/lib/auth/session-token';

const credentialsSchema = z.object({
  // NOT z.string().email(): the point is a username. Bounded so a 1 MB body
  // cannot reach an index scan.
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

export const adminAuthConfig = {
  /**
   * THE MOUNT THIS INSTANCE IS SERVED FROM, and it is NOT optional.
   *
   * `next-auth` defaults `basePath` to `/api/auth` — the CUSTOMER mount. Every
   * action is derived by stripping that prefix from the request path, so a
   * request to `/api/admin-auth/csrf` had no matching action and @auth/core
   * threw `UnknownAction`, answered 400 "Bad request", and the console login
   * could never have worked. Found by driving the deployed endpoint; every
   * static check passed because the route resolves, it just resolves to a 400.
   */
  basePath: '/api/admin-auth',

  // No adapter, for the same reason auth.ts documents: Credentials + JWT
  // means an adapter has nothing to persist except OAuth accounts we have.
  session: {
    strategy: 'jwt' as const,
    // 12 hours, sliding. Shorter than the portal's 7 days on purpose: a
    // console session can suspend a paying customer and approve money, and
    // an operator does not need a week-long cookie to work a shift.
    maxAge: 12 * 60 * 60,
    updateAge: 60 * 60,
  },

  pages: {
    signIn: '/admin/login',
    error: '/admin/login',
  },

  trustHost: process.env.AUTH_TRUST_HOST === 'true',

  /**
   * Every cookie this instance touches is namespaced, not just the session.
   *
   * `@auth/core` merges this over `defaultCookies()`, so anything left out
   * keeps the DEFAULT name — which is the PORTAL's name for that cookie. The
   * session token is the one that matters for authorization, but a shared
   * CSRF or callback-url cookie name would mean two instances reading each
   * other's scratch state on any origin that ever served both. Cheap to
   * prevent; confusing to debug.
   */
  cookies: {
    sessionToken: {
      name: staffCookieName(),
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        secure: staffSessionCookieName().startsWith('__Secure-'),
      },
    },
    csrfToken: {
      // `__Host-` is the stricter prefix Auth.js uses by default for CSRF:
      // it requires Secure, Path=/ and no Domain, so it cannot be set by a
      // sibling host. Kept consistent with the default rather than relaxing it.
      name: staffCookieName('csrf-token'),
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        secure: staffSessionCookieName().startsWith('__Secure-'),
      },
    },
    callbackUrl: {
      name: staffCookieName('callback-url'),
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        secure: staffSessionCookieName().startsWith('__Secure-'),
      },
    },
  },

  providers: [
    Credentials({
      id: 'staff',
      name: 'Username and password',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },

      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { username, password } = parsed.data;

        // Throttle BEFORE any lookup, so a blocked attempt costs one indexed
        // probe and cannot be used to enumerate usernames. Keyed on the
        // identity, not the IP: there is no CDN here, so no forwarded header
        // can be trusted, and an IP-keyed limit is one an attacker sidesteps
        // by varying the header. Prefixed `staff:` so a console username and
        // a customer email sharing a string do not share a bucket.
        const key = `staff:${username.toLowerCase()}`;
        const throttle = await checkThrottle(key, key);
        if (throttle.blocked) {
          log.warn('staff login throttled', { username });
          return null;
        }

        const staff = await staffByUsername(username);

        // verifyStaffPassword spends the KDF even when the row is missing
        // (verifyPassword's documented dummy run), so an unknown username
        // and a wrong password are indistinguishable by timing — the same
        // guarantee auth.ts makes for customers.
        const ok = staff
          ? (await verifyStaffPassword(staff.staffUserId, password)).ok
          : await verifyPassword(password, null);

        if (!staff || !ok || staff.revokedAt) {
          await recordFailure(key, key);
          log.warn('staff login failed', {
            username,
            reason: !staff ? 'unknown' : staff.revokedAt ? 'revoked' : 'bad_password',
          });
          return null;
        }

        await recordSuccess(key, key);

        return {
          id: staff.staffUserId,
          // `email` is Auth.js's identity field; here it carries the
          // username, because a console session has no email concept. The
          // session callback below renames it rather than leaking an email.
          email: staff.username,
          name: staff.name ?? staff.username,
          staffRole: staff.role,
          passwordChangedAt: staff.passwordChangedAt.toISOString(),
        };
      },
    }),
  ],

  callbacks: {
    /**
     * Copy identity into the token ONCE, at sign-in.
     *
     * `user` is present only on the initial call; every later request comes
     * with the existing token. Writing here rather than per-request keeps
     * the callback cheap and the token stable.
     */
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.username = user.email;
        token.staffRole = user.staffRole ?? null;
        token.pwdAt = user.passwordChangedAt ?? null;
      }
      return token;
    },

    /**
     * Materialise the session for server components.
     *
     * Trimmed to id/username/role + the freshness stamp. NOTE: this is
     * identity, NOT authorization — `currentStaffSession()` re-reads
     * `staff_users` on every request and that is what decides a rank.
     */
    async session({ session, token, user }) {
      if (user) {
        session.staff = {
          id: user.id,
          username: (user.email as string | undefined) ?? '',
          role: (user as { staffRole?: string }).staffRole ?? '',
          passwordChangedAt: user.passwordChangedAt ?? null,
        };
      } else {
        session.staff = {
          id: token.sub ?? '',
          username: typeof token.username === 'string' ? token.username : '',
          role: typeof token.staffRole === 'string' ? token.staffRole : '',
          passwordChangedAt: typeof token.pwdAt === 'string' ? token.pwdAt : null,
        };
      }
      return session;
    },
  },

  events: {
    async signIn({ user }) {
      log.info('staff sign-in', { staffId: user.id });
    },
    async signOut(message) {
      // Auth.js types this as a union across session strategies. We
      // configure JWT, so `token` is the populated branch — narrowed
      // defensively so a strategy change cannot break the log.
      const subject = 'token' in message ? message.token?.sub : undefined;
      log.info('staff sign-out', { subject: subject ?? 'unknown' });
    },
  },

  logger: {
    error(error) {
      // Never the error object: it can embed request headers and credential
      // material. Same policy as auth.ts.
      const code =
        typeof (error as unknown as { code?: unknown }).code === 'string'
          ? String((error as unknown as { code: string }).code)
          : '';
      log.error('staff auth error', { code, name: error.name });
    },
    warn(code) {
      log.warn('staff auth warn', { code });
    },
  },
} satisfies NextAuthConfig;

export const {
  handlers: adminHandlers,
  auth: adminAuth,
  signIn: adminSignIn,
  signOut: adminSignOut,
} = NextAuth(adminAuthConfig);
