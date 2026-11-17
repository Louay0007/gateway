/**
 * Request proxy — the portal's default-deny front door.
 *
 * TWO JOBS, both here because this is the only code that runs before every
 * route is rendered:
 *
 *  1. ACCESS. Every `/api` request must carry a session token this
 *     deployment minted, unless its path is on the published list in
 *     `lib/security/route-policy.ts`. Unknown paths are refused, so a route
 *     added later is private until someone says otherwise. This is a front
 *     door, not authorization: the handler re-reads membership and role from
 *     Postgres on every call (lib/auth/authorize.ts) and that remains the
 *     decision. This layer keeps unauthenticated callers out of routes that
 *     were never meant to answer them — including the ones whose only guard
 *     was a shell layout, a `notFound()`, or nothing at all.
 *
 *  2. ONE FACT THE ADMIN LAYOUT CANNOT OBSERVE. `app/admin/layout.tsx`
 *     wraps both the gate form (`/admin`) and the console pages
 *     (`/admin/ops`, …) and has to treat them differently. A layout
 *     receives no pathname, so this stamps `x-admin-gate-path: 1` on
 *     requests whose pathname is exactly `/admin`, and nothing else: the
 *     header's ABSENCE is what marks a console page.
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

import { isPublicApi, isPublicPage } from '@/lib/security/route-policy';
import { sessionFromHeaders } from '@/lib/auth/session-token';

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
  // layer: its gate form has to be reachable, and the console behind it is
  // protected by the gate cookie plus `requireStaff` (app/admin/layout.tsx).
  // The API under /admin is NOT public, so the gate opens a form and no data.
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

  // ── 3. The admin gate-page stamp (app/admin/layout.tsx contract) ──────
  // Exact match. A trailing slash is normalised by Next before this runs
  // (`/admin/` arrives as `/admin`), and `/admin/ops` must NOT match: the
  // header's ABSENCE is what marks a console page.
  if (pathname === '/admin') {
    const headers = new Headers(request.headers);
    headers.set('x-admin-gate-path', '1');
    // `request: { headers }` forwards them to the render tree. The bare
    // `{ headers }` form would send them to the CLIENT instead.
    return NextResponse.next({ request: { headers } });
  }

  return NextResponse.next();
}

export const config = {
  // Pass-through ONLY for assets that carry no data and must load without a
  // session: Next's build output, the favicon/icon, the public document that
  // serves the gate form, and the image/logo directories. Everything else —
  // every page, every API route, `robots.txt` and the sitemap — goes through
  // the checks above. Keep this list minimal: a matcher exclusion is an
  // access-control decision, and `tests/route-auth.test.ts` asserts `/api`
  // is not one of them.
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png|partnership\\.html|partnership-email\\.html|images/|logo/|logos/|hero/).*)',
  ],
};
