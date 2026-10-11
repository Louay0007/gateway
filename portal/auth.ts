/**
 * Auth.js (NextAuth v5) — fully self-hosted.
 *
 * DECISION: Clerk → Auth.js. PLATFORM.md §2.1 names Auth.js as the
 * alternative "if self-hosting is mandatory", and §14 open decision #2 is
 * explicitly ours to answer. No external identity provider is contacted:
 * credentials are verified against our own Postgres, hashes are scrypt,
 * and no identity data leaves the VPS.
 *
 * Sessions are JWTs because Auth.js v5 does not permit the Credentials
 * provider with the database strategy — see the note on `session` below
 * for how revocation is handled as a result.
 *
 * Version note: Auth.js v5 is still published as 5.0.0-beta.32. It is
 * pinned EXACTLY (no caret) so rollbacks are deterministic, mirroring the
 * "never pin :latest" discipline in docker-compose.yml. Auth is not on
 * the data path — the gateway serves API traffic independently — so the
 * beta's blast radius is the control plane. Revisit on v5 stable.
 *
 * IMPORTANT: the session cookie alone is NOT authorization. Every mutation
 * re-checks membership or staff role server-side via
 * lib/auth/authorize.ts. UI hiding is not authorization.
 */

import NextAuth, { type DefaultSession, type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db';
import { authCredentials, authUsers, users } from '@/db/schema';
import { verifyPassword, hashPassword, needsRehash } from '@/lib/auth/password';
import { checkThrottle, recordFailure, recordSuccess } from '@/lib/auth/throttle';
import { log } from '@/lib/log';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
    } & DefaultSession['user'];
  }
  interface User {
    emailVerified?: Date | null;
  }
}

const credentialsSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
});

/**
 * Key used for the login throttle.
 *
 * We throttle on the normalized identity only, not on IP, because the
 * request arrives here before any proxy header can be trusted (no CDN,
 * DESIGN.md §6.1) and a fabricated X-Forwarded-For would let an attacker
 * sidestep an IP-keyed limit. Identity-keyed throttling is the reliable
 * signal; IP-based defence is handled at Caddy, where the TCP peer is
 * knowable.
 */
function throttleKey(email: string): string {
  return email.toLowerCase().trim();
}

export const authConfig = {
  // NO ADAPTER — deliberately.
  //
  // An adapter exists to persist OAuth accounts, sessions, and verification
  // tokens. This deployment has no OAuth provider and uses JWT sessions, so
  // an adapter would have nothing to do except break: with Credentials
  // active it attempts account linking and surfaces `CallbackRouteError`.
  // Verified by running it, not by reading docs.
  //
  // Identity is stored in our own tables and written directly:
  //   auth_users / auth_credentials  (written by lib/auth/signup-actions.ts)
  //   users                          (the domain mirror)
  //
  session: {
    // JWT is REQUIRED here, not a preference.
    //
    // Auth.js v5 supports the Credentials provider ONLY with the JWT
    // strategy — "Signing in with credentials only supported if JWT
    // strategy is enabled". Database sessions and Credentials cannot be
    // combined. (Found by running the app; the docs do not lead with it.)
    //
    // Consequence, stated plainly: a JWT is self-contained, so deleting a
    // "session" cannot revoke a token that was copied beforehand.
    // Immediate revocation is therefore NOT delegated to the session
    // store. It is enforced one level up, in lib/auth/authorize.ts, where
    // every protected action re-reads `users` / `staff_users` from
    // Postgres:
    //
    //   - delete or alter `users`     → org access dies on the next request
    //   - delete `staff_users` row    → staff access dies immediately
    //   - change `users.email`        → the session no longer resolves
    //
    // That is strictly stronger than dropping a session row: it cannot be
    // sidestepped by a token minted before the change. The short maxAge
    // bounds how long a stolen cookie is useful by itself.
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60,
  },

  pages: {
    signIn: '/sign-in',
    error: '/sign-in',
  },

  // Host is taken from the request unless the deployment says otherwise.
  // Set AUTH_TRUST_HOST=true only behind a proxy that rewrites Host
  // reliably.
  trustHost: process.env.AUTH_TRUST_HOST === 'true',

  // Auth.js's own stack traces, gated. These CAN contain request details,
  // so they stay off unless explicitly enabled while debugging.
  debug: process.env.AUTH_DEBUG === 'true',

  providers: [
    Credentials({
      id: 'credentials',
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },

      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const email = parsed.data.email.toLowerCase().trim();
        const { password } = parsed.data;
        const key = throttleKey(email);

        // Throttle BEFORE any lookup, so a blocked attempt costs one
        // indexed probe and cannot be used to enumerate accounts.
        const throttle = await checkThrottle(key, key);
        if (throttle.blocked) {
          log.warn('login throttled', { identity: email });
          return null;
        }

        const rows = await db
          .select({
            id:       authCredentials.userId,
            password: authCredentials.password,
            name:     authUsers.name,
          })
          .from(authCredentials)
          .innerJoin(authUsers, eq(authUsers.id, authCredentials.userId))
          .where(eq(authUsers.email, email))
          .limit(1);

        const found = rows[0];

        // The KDF runs even when no user exists (see verifyPassword), so
        // response time never distinguishes the two cases.
        const ok = await verifyPassword(password, found?.password);
        if (!found || !ok) {
          const after = await recordFailure(key, key);
          log.warn('login failed', { identity: email, blocked: after.blocked });
          return null;
        }

        if (needsRehash(found.password)) {
          const upgraded = await hashPassword(password);
          await db
            .update(authCredentials)
            .set({ password: upgraded, updatedAt: new Date() })
            .where(eq(authCredentials.userId, found.id));
        }

        await recordSuccess(key, key);

        // Keep the domain mirror in step. Authorization always reads
        // `users` (the mirror), never authUsers — so the two must agree.
        await db
          .insert(users)
          .values({ authProvider: 'authjs', authId: found.id, email, name: found.name })
          .onConflictDoNothing({ target: users.email });

        return { id: found.id, email, name: found.name ?? undefined };
      },
    }),
  ],

  callbacks: {
    /**
     * Copy identity into the token ONCE, at sign-in.
     *
     * `user` is present only on the initial sign-in call; on every later
     * request Auth.js passes the existing token. Writing `token.sub` and
     * `token.email` here (not in every request) is what keeps the callback
     * cheap and the token stable.
     */
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.email = user.email;
      }
      return token;
    },

    /**
     * Materialise the session for server components.
     *
     * Trimmed to id/email/name — anything left here is visible to every
     * component that renders on a request. NOTE: this is identity only,
     * NOT authorization. `requireOrgMembership` / `requireStaff` re-check
     * the database on every protected action.
     */
    async session({ session, token, user }) {
      if (user) {
        session.user.id = user.id;
        session.user.email = user.email ?? '';
      } else {
        // JWT path: `user` is undefined on subsequent requests.
        session.user.id = token.sub ?? '';
        session.user.email = typeof token.email === 'string' ? token.email : '';
      }
      return session;
    },
  },

  events: {
    async signIn({ user }) {
      log.info('sign-in', { authId: user.id });
    },
    async signOut(message) {
      // Auth.js types this as a union because it supports both session
      // strategies. We configure JWT (see `session` above), so `token` is
      // the populated branch — but narrowing defensively keeps this
      // correct if the strategy ever changes.
      const subject = 'token' in message ? message.token?.sub : undefined;
      log.info('sign-out', { subject: subject ?? 'unknown' });
    },
  },

  logger: {
    error(error) {
      // Auth.js hands us an Error; the AuthError classification lives on
      // `.code`. Never log the error object itself — it can embed request
      // headers and credential material. The message is included only
      // under AUTH_DEBUG, and is still scrubbed by the logger's redactor.
      const code = typeof (error as unknown as { code?: unknown }).code === 'string'
        ? String((error as unknown as { code: string }).code)
        : '';
      // Auth.js wraps the real failure in `cause` (CallbackRouteError is
      // just a shell). Log it under AUTH_DEBUG only — it can carry request
      // detail, and debug mode itself leaks the POST body, so the two
      // gates travel together.
      const cause = (error as unknown as { cause?: unknown }).cause;
      log.error('auth error', {
        code,
        name: error.name,
        ...(process.env.AUTH_DEBUG === 'true'
          ? {
              message: error.message,
              cause: cause instanceof Error
                ? { name: cause.name, message: cause.message, stack: cause.stack?.split('\n').slice(0, 6).join(' | ') }
                : cause,
            }
          : {}),
      });
    },
    warn(code) {
      log.warn('auth warn', { code });
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);