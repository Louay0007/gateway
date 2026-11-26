/**
 * Request proxy — the portal's default-deny front door.
 *
 * TWO JOBS, both here because this is the only code that runs before every
 * route is rendered:
 *
 *  1. ACCESS. Every `/api` request must carry the credential that path is
 *     defined to need — the PORTAL session for tenant routes, the CONSOLE
 *     session for `/api/admin/*` — unless it is on the published list in
 *     `lib/security/route-policy.ts`. Unknown paths are refused, so a route
 *     added later is private until someone says otherwise. This is a front
 *     door, not authorization: the handler re-reads membership and role from
 *     Postgres on every call (lib/auth/authorize.ts) and that remains the
 *     decision. This layer keeps unauthenticated callers out of routes that
 *     were never meant to answer them — including the ones whose only guard
 *     was a shell layout, a `notFound()`, or nothing at all.
 *
 *  2. TWO CREDENTIALS, NEVER INTERCHANGEABLE. The portal cookie and the
 *     console cookie are different names, and `session-token.ts` derives its
 *     key by HKDF over the name — so they do not decrypt as each other. This
 *     file reads the portal name on tenant routes and the staff name on
 *     `/api/admin/*`; neither can stand in for the other, which is what makes
 *     "an operator's console cookie is not a customer credential" a property
 *     rather than a promise.
 *
 * WHY THE TOKEN IS DECRYPTED AND NOT LOOKED UP. It is an Auth.js JWE
 * (`A256CBC-HS512`, salt = the cookie name). Decrypting proves it was minted
 * here and has not expired; anything else — tampered, foreign, absent — is
 * refused. That is deliberately NOT a database check: revoking a role is
 * `requireStaff`/`currentUser`'s job on the next request, and a DB round trip
 * here would sit on every request to make a decision this layer is not
 * allowed to make anyway. `lib/auth/session-token.ts` holds the decode, and
 * `tests/proxy-session.test.ts` proves it agrees with Auth.js's own.
 *
 * FAIL CLOSED. No `AUTH_SECRET` means no request can be proven authentic, so
 * private API routes answer 500 rather than being served unauthenticated.
 * compose requires that variable at startup (`${AUTH_SECRET:?}`), so this
 * only fires on a broken deployment — which is exactly when serving the
 * dashboard unauthenticated would be worst.
 *
 * THE MATCHER IS NOT THE POLICY. It must not be narrowed to make something
 * work: a matcher change silently removes coverage (Next's own docs warn
 * about exactly this), which is how the previous version of this file came
 * to govern a single path. The buckets live in route-policy.ts, and
 * `tests/route-auth.test.ts` asserts the matcher still covers `/api`.
 */

import { NextResponse, type NextRequest } from 'next/server';

import {
  isPublicApi,
  isPublicPage,
  isStaffApi,
  isStaffAuthApi,
} from '@/lib/security/route-policy';
import { sessionFromHeaders, staffSessionFromHeaders } from '@/lib/auth/session-token';

/** The shared error envelope (lib/api/errors.ts), built without importing
 *  the DB-backed error module into the request hot path. */
function deny(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── 1. API access ────────────────────────────────────────────────────
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    // ── 1a. The console's auth surface ────────────────────────────────
    // Sign-in cannot require a session — that is the whole point of it —
    // and these handlers verify their own CSRF and session state. Narrow
    // because the prefix is narrow: `/api/admin-auth/*` is the console's
    // Auth.js mount, not a general escape hatch.
    if (isStaffAuthApi(pathname)) return NextResponse.next();

    // ── 1b. The console's API — the STAFF cookie, not the portal one ──
    //
    // THIS BRANCH IS A FIX, not a refactor. `/api/admin/*` used to fall
    // through to the session check below, so the proxy demanded a PORTAL
    // session for it. The console's pages call their services in-process and
    // rendered fine, but every mutating `fetch('/api/admin/…')` behind a
    // button was answered 401: an operator clicked Suspend, the row did not
    // change, and the only clue was an envelope in devtools.
    //
    // The two credentials are different cookies that decrypt under different
    // HKDF keys (lib/auth/session-token.ts), so this is a real separation
    // and not a naming convention — a portal session cannot pass here, and a
    // console session cannot pass below.
    //
    // This layer still decides only whether the request REACHES the handler.
    // The rank is `requireStaff()`'s job on every route.
    if (isStaffApi(pathname)) {
      if (!process.env.AUTH_SECRET) {
        console.error('[proxy] AUTH_SECRET is not set — refusing every console API route');
        return deny(500, 'internal', 'Something went wrong. Please try again.');
      }
      const staff = await staffSessionFromHeaders(request.headers);
      if (!staff) {
        return deny(401, 'unauthorized', 'Sign in to the operations console to continue.');
      }
      return NextResponse.next();
    }

    if (isPublicApi(pathname)) return NextResponse.next();

    if (!process.env.AUTH_SECRET) {
      // Server-side only: the client must learn nothing about the config.
      console.error('[proxy] AUTH_SECRET is not set — refusing every private API route');
      return deny(500, 'internal', 'Something went wrong. Please try again.');
    }

    const session = await sessionFromHeaders(request.headers);
    if (!session) {
      return deny(401, 'unauthorized', 'Sign in to continue.');
    }

    return NextResponse.next();
  }

  // ── 2. Private pages ─────────────────────────────────────────────────
  // `/chat`, `/dashboard/*` — the session, here, instead of a redirect
  // rendered 40 KB of chat shell. `/admin` is deliberately public at THIS
  // layer because it has its own credential: requiring a PORTAL session
  // would mean an operator holds two logins to reach a staff console. The
  // console pages are gated by `currentStaffSession()` in
  // `app/admin/layout.tsx`, and `/api/admin/*` is decided separately in 1b.
  if (!isPublicPage(pathname)) {
    const session = process.env.AUTH_SECRET
      ? await sessionFromHeaders(request.headers)
      : null;
    if (!session) {
      const signIn = new URL('/sign-in', request.url);
      // `callbackUrl` is the parameter /sign-in reads, and it only honours a
      // same-site relative path (`raw.startsWith('/') && !raw.startsWith('//')`)
      // — which is exactly what is built here.
      signIn.searchParams.set('callbackUrl', `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(signIn);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Pass-through ONLY for assets that carry no data and must load without a
  // session: Next's build output, the favicon/icon, and the image/logo
  // directories. Everything else — every page, every API route, `robots.txt`
  // and the sitemap — goes through the checks above. Keep this list minimal:
  // a matcher exclusion is an access-control decision, and
  // `tests/route-auth.test.ts` asserts `/api` is not one of them.
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png|partnership\\.html|partnership-email\\.html|images/|logo/|logos/|hero/).*)',
  ],
};
