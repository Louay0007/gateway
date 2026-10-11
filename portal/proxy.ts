/**
 * Proxy (Next 16's rename of `middleware`) — coarse, edge-safe gate.
 *
 * Named `proxy` because Next.js 16 deprecated the `middleware` file
 * convention in favour of `proxy`, which is more accurate: it runs on the
 * edge before routing, not as application middleware.
 *
 * This runs on every request before a page renders, but it CANNOT do
 * database work: it executes in the Edge runtime, and Postgres is not
 * reachable from there. So it deliberately does the cheap thing only
 * — bounce users who have no session cookie away from protected routes.
 *
 * The authoritative checks happen server-side on every page and mutation:
 *   - lib/auth/authorize.ts  → requireOrgMembership / requireStaff
 * That is what makes this safe. Treat the cookie as a hint that reduces
 * pointless work, never as proof of identity. A forged cookie gets past
 * this file and is then rejected by the session lookup in `auth()`.
 */

import { NextResponse, type NextRequest } from 'next/server';

/**
 * Auth.js session cookie names. Listed explicitly rather than by prefix
 * scan so a future cookie (e.g. a flash-message cookie) cannot
 * accidentally satisfy the gate.
 */
const SESSION_COOKIES = [
  '__Secure-authjs.session-token',
  'authjs.session-token',
  '__Host-authjs.session-token',
];

const PUBLIC_PREFIXES = [
  '/',            // landing
  '/pricing',
  '/docs',
  '/sign-in',
  '/sign-up',
  '/api/auth',
  '/api/webhooks',
  '/api/health',
  '/legal',
];

function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIES.some((name) => req.cookies.has(name));
}

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic = PUBLIC_PREFIXES.some(
    (p) => p === '/' ? pathname === '/' : pathname.startsWith(p),
  );
  if (isPublic) return NextResponse.next();

  // API routes are NOT gated here.
  //
  // This gate exists to save pointless page renders, but an API caller
  // cannot follow a redirect to an HTML sign-in page: it expects
  // `{ error: { code, message } }` (IMPLEMENTATION.md §3), and a fetch()
  // handed a sign-in page fails to parse it as JSON — turning "your
  // session expired" into an opaque parse error, and a POST redirected by
  // 307 into a GET against a page that should never receive it.
  //
  // Every API route authorizes itself and answers 401 in-band via
  // requireActiveOrg()/requireStaff(). That check is real; this one is a
  // hint.
  if (isApiPath(pathname)) return NextResponse.next();

  // Anything not public requires a session. Absence is enough to
  // redirect — presence is proven later, not here.
  if (!hasSessionCookie(req)) {
    const url = req.nextUrl.clone();
    url.pathname = '/sign-in';
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Excluding _next
     * internals keeps the middleware off the hot path for asset requests.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};