/**
 * Request proxy — one job: tell the admin layout which path it is serving.
 *
 * `app/admin/layout.tsx` wraps both the gate form (`/admin`) and the
 * console pages (`/admin/ops`, `/admin/orgs`, ...) and has to treat them
 * differently. A layout receives no pathname, so it cannot make that
 * distinction on its own, and the previous attempt at it — redirecting
 * every ungated request to `/admin` — turned `/admin` itself into an
 * infinite redirect loop. The console was unreachable from the portal
 * host because of it.
 *
 * This sets `x-admin-gate-path: 1` on requests whose pathname is exactly
 * `/admin`, and nothing else. It is deliberately not a matcher-scoped
 * header on the whole `/admin` tree: the header's ABSENCE is what marks
 * a console page, so stamping it everywhere would defeat it.
 *
 * No auth decision happens here. Authorization lives in the layout and
 * in `requireStaff`; this file only supplies the fact the layout cannot
 * observe for itself.
 */

import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  // Exact match. A trailing slash is normalised by Next before this runs
  // (`/admin/` arrives as `/admin`), and `/admin/ops` must NOT match.
  if (request.nextUrl.pathname !== '/admin') return NextResponse.next();

  const headers = new Headers(request.headers);
  headers.set('x-admin-gate-path', '1');

  // `request: { headers }` forwards them to the render tree. The bare
  // `{ headers }` form would send them to the CLIENT instead.
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Only the two shapes that matter: the gate page itself and everything
  // beneath it. Static assets and the rest of the marketing site never
  // need the header, and running the proxy on every request would add a
  // hop to pages that do not read it.
  matcher: ['/admin', '/admin/:path*'],
};
