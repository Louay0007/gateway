/**
 * The access policy for every route the portal serves.
 *
 * WHY A POLICY MODULE AND NOT A FLAG PER ROUTE. The exposure this closes was
 * not one missing check — every `/api` handler already re-checks
 * membership or staff role server-side. It was the CATEGORY: nothing
 * asserted that the set of routes reachable without a session is the set
 * we meant to publish. A new `route.ts` with no guard inherited whatever
 * the router did, and nobody could see the surface whole.
 *
 * So the rule is stated once, here, and enforced twice:
 *
 *   1. `proxy.ts` applies it to every live request (default-deny).
 *   2. `tests/route-auth.test.ts` asserts that every handler on disk is in
 *      exactly one bucket — so a new route fails CI until someone decides
 *      what it is, and a public route cannot appear by omission.
 *
 * The buckets are closed. There is no "unknown" case: a path that matches
 * none of these is PRIVATE, which is the only safe default.
 *
 * WHAT THIS IS NOT. It is not authorization. Proving a caller HOLDS a
 * session says nothing about which org, which role, or whose rows — that
 * stays in `lib/auth/authorize.ts`, re-read from Postgres on every
 * protected action (docs/ROUTING.md, DESIGN.md §6.2). This layer only
 * decides whether the request reaches that code at all.
 */

/** Paths anyone may call, with the reason each one is safe to publish. */
export interface PublicRoute {
  /** Exact pathname, or a prefix when it ends in `/*`. */
  path: string;
  why: string;
}

/**
 * Public API routes. Every entry is one of:
 *
 *   - authentication itself (a sign-in route that required a session is a
 *     sign-in route nobody could use),
 *   - a provider callback whose signature IS the authentication, or
 *   - a deliberately published surface: the plan catalog, the installer
 *     list, liveness, a token-scoped share stream, the opt-in playground
 *     (which authenticates with the caller's OWN `zn-` key).
 *
 * Tenant data never appears on this list.
 */
export const PUBLIC_API: readonly PublicRoute[] = [
  // ── Auth.js: sign-in/out, CSRF, session, social callbacks ──────────
  { path: '/api/auth/*', why: 'Auth.js mounts every sign-in, sign-out, CSRF and social callback here' },

  // ── Social sign-in (our own namespace, not Auth.js) ─────────────────
  { path: '/api/oauth/*', why: 'OAuth start/callback: redirected to the provider before a session exists; state + PKCE cookie is the proof' },

  // ── Device-code flow (RFC 8628) ────────────────────────────────────
  { path: '/api/auth/device', why: 'device code issuance: the desktop app has no session yet' },
  { path: '/api/auth/device/token', why: 'device token poll: the device code IS the credential' },
  {
    path: '/api/auth/device/verify',
    why: 'approves a device from a signed-in browser — requireActiveOrg() inside the handler is the auth',
  },

  // ── Money, arriving from a provider ────────────────────────────────
  {
    path: '/api/billing/callback',
    why: 'payment webhook: HMAC signature over raw bytes is verified before any state change (lib/billing)',
  },

  // ── Liveness ───────────────────────────────────────────────────────
  {
    path: '/api/health',
    why: 'container healthcheck: two booleans, no version, no hostname, no counts (see the route)',
  },

  // ── Catalog and installers: no tenant data ─────────────────────────
  { path: '/api/plans', why: 'public plan catalogue: prices, not tenant state' },
  { path: '/api/downloads', why: 'desktop installer list: the same files the /download page links' },

  // ── Token-scoped public surfaces ───────────────────────────────────
  {
    path: '/api/share/*',
    why: 'shared transcript stream: the share token is re-resolved on every poll and can be revoked',
  },
  {
    path: '/api/playground',
    why: 'public playground: the caller supplies their OWN zn- key, resolved against api_keys and metered as them',
  },

  // ── Device data, authenticated by a gateway key ────────────────────
  {
    path: '/api/device/*',
    why: 'desktop panel: Bearer zn- key hashed against api_keys, org resolved from the key (lib/device/auth)',
  },

  // ── Agent surfaces, authenticated by a service token ───────────────
  {
    path: '/api/agent/*',
    // No session can exist: the caller is n8n, not a browser. The handler's
    // `requireAgentToken()` is the auth, and it fails CLOSED — an unset
    // D17_AGENT_TOKEN makes every route here answer 503, unlike the admin
    // gate whose unset secret disables the gate. The bucket is narrow on
    // purpose: it reads one payment queue and records one reading, and it
    // can approve only through `scoreVerification()`'s verdict.
    why: 'service token (D17_AGENT_TOKEN), verified constant-time in every handler; no tenant identity crosses it',
  },
] as const;

/**
 * Paths that LOOK public but are not, kept explicit so a reader cannot
 * mistake one for an omission — and so the CI assertion below proves the
 * list is deliberate rather than long.
 */
export const PRIVATE_NOTES: readonly { path: string; why: string }[] = [
  {
    path: '/api/admin/*',
    // NOT "private" in the session sense: it is authenticated by the CONSOLE
    // cookie (see isStaffApi below), not by the portal one. Listing it here
    // as well would hide that difference, which is the bug this bucket
    // exists to prevent.
    why: 'staff only: console session (isStaffApi) + requireStaff() role-gated per route',
  },
  { path: '/api/chat/*', why: 'tenant data: requireActiveOrg() + conversation ownership' },
  { path: '/api/keys/*', why: 'credentials: requireActiveOrg() + owner role' },
  { path: '/api/account/delete', why: 'irreversible: requireActiveOrg() + owner role + slug confirmation' },
  { path: '/api/usage/*', why: 'tenant ledger: requireActiveOrg()' },
];

/**
 * The console's own auth surface — sign-in cannot require a session.
 *
 * A separate prefix from `/api/auth/*` so the console's CSRF/session surface
 * is never reachable under the customer auth namespace, and so this list can
 * say why it is narrow rather than inheriting "sign-in must be public".
 */
export const STAFF_AUTH_API = '/api/admin-auth';

export function isStaffAuthApi(pathname: string): boolean {
  return pathname === STAFF_AUTH_API || pathname.startsWith(`${STAFF_AUTH_API}/`);
}

/**
 * The console's API — authenticated by the STAFF cookie, not the portal one.
 *
 * WHY THIS IS ITS OWN BUCKET AND NOT FOLDED INTO "PRIVATE". Until 0053 this
 * prefix was private, so `proxy.ts` demanded a PORTAL session for it. The
 * console's pages call their services in-process and rendered fine, but every
 * mutating `fetch('/api/admin/…')` behind a button was answered 401 — an
 * operator clicked Suspend, the row did not change, and the only clue was an
 * envelope in devtools. The two credentials are different cookies that
 * decrypt under different keys (`lib/auth/session-token.ts`), so they have to
 * be different decisions here.
 */
export const STAFF_API = '/api/admin';

export function isStaffApi(pathname: string): boolean {
  return pathname === STAFF_API || pathname.startsWith(`${STAFF_API}/`);
}

/** True when `pathname` is on the published list. */
export function isPublicApi(pathname: string): boolean {
  return PUBLIC_API.some(({ path }) =>
    path.endsWith('/*')
      ? pathname === path.slice(0, -2) || pathname.startsWith(path.slice(0, -1))
      : pathname === path,
  );
}

/**
 * The portal pages that render without a session, by prefix.
 *
 * Everything not listed here needs a live session — including `/admin`,
 * which is gated on its own but is checked here too so a signed-out
 * caller never reaches the staff gate form through a route that forgot
 * it. Static assets are excluded by the matcher in `proxy.ts`, not here.
 */
export const PUBLIC_PAGES: readonly string[] = [
  '/',
  '/pricing',
  '/models',
  '/playground',
  '/connect',
  '/docs',
  '/changelog',
  '/changelog.xml',
  // Crawler metadata. Public by definition: a robots.txt behind a sign-in is
  // an invitation to index everything, and a sitemap nobody can fetch is a
  // file with no effect.
  '/robots.txt',
  '/sitemap.xml',
  '/download',
  '/faq',
  '/contact',
  '/status',
  '/privacy',
  '/terms',
  '/sign-in',
  '/sign-up',
  '/reset-password',
  '/verify-email',
  '/device',
  '/share',
  '/billing',
  '/checkout',
  // The console. Public AT THIS LAYER on purpose: it has its own credential
  // (the console session, lib/auth/staff-session.ts) and requiring a PORTAL
  // session here would mean an operator had to hold two logins to reach a
  // staff console. The proxy only decides whether the request reaches the
  // layout; `app/admin/layout.tsx` redirects to /admin/login without a
  // console session, and `/api/admin/*` is decided separately below.
  '/admin',
];

/** True when `pathname` is a published page (including its subpaths). */
export function isPublicPage(pathname: string): boolean {
  if (pathname === '/') return true;
  return PUBLIC_PAGES.some(
    (base) => base !== '/' && (pathname === base || pathname.startsWith(`${base}/`)),
  );
}
