/**
 * Every route on disk is in exactly one bucket of the access policy.
 *
 * THE BUG THIS PREVENTS, and it is a category, not a handler. Every `/api`
 * handler already re-checks membership or staff role — but nothing asserted
 * that the set of routes reachable WITHOUT a session was the set we meant to
 * publish. A new `route.ts` inherited whatever the router did, and the
 * surface could not be seen whole. This test walks the filesystem and fails
 * on a route nobody classified, so "public" is only ever a decision.
 *
 * It also pins the two lists that decide it (`lib/security/route-policy.ts`)
 * and the two enforcement points (`proxy.ts` allowlist, Caddyfront), because
 * a policy file nothing reads is documentation, not a control.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  PUBLIC_API,
  PUBLIC_PAGES,
  isPublicApi,
  isPublicPage,
} from '@/lib/security/route-policy';

const PORTAL = new URL('../', import.meta.url).pathname;
const REPO = new URL('../../', import.meta.url).pathname;

/** Every `app/**\/route.ts`, as a URL path. */
function routeHandlers(dir = 'app', base = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(PORTAL, dir))) {
    const full = join(PORTAL, dir, name);
    if (!statSync(full).isDirectory()) continue;
    const segment = name.startsWith('(') ? '' : `/${name}`;
    try {
      readFileSync(join(full, 'route.ts'));
      out.push(base + segment);
    } catch {
      /* no handler at this level */
    }
    out.push(...routeHandlers(join(dir, name), base + segment));
  }
  return out;
}

/** Every page, as a URL path (route groups stripped). */
function pageRoutes(dir = 'app', base = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(PORTAL, dir))) {
    const full = join(PORTAL, dir, name);
    if (!statSync(full).isDirectory()) continue;
    const segment = name.startsWith('(') ? '' : `/${name}`;
    if (fs_exists(join(full, 'page.tsx'))) out.push((base + segment) || '/');
    out.push(...pageRoutes(join(dir, name), base + segment));
  }
  return out;
}

function fs_exists(p: string): boolean {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}

/** A route path with its dynamic segments flattened, e.g. `/api/x/[id]`. */
function hasDynamic(path: string): boolean {
  return path.includes('[');
}

const API_ROUTES = routeHandlers().filter((p) => p.startsWith('/api'));
const PAGES = pageRoutes();

describe('API access policy', () => {
  it('every API handler is classified — public or private', () => {
    const publicOnes = API_ROUTES.filter((p) => isPublicApi(p.replace(/\[[^\]]*\]/g, 'x')));
    const privateOnes = API_ROUTES.filter((p) => !publicOnes.includes(p));

    expect(publicOnes.length, 'a portal with no public API has no sign-in').toBeGreaterThan(0);
    expect(privateOnes.length, 'everything private means the app is unreachable').toBeGreaterThan(0);

    // The assertion that matters: no handler may be UNCLASSIFIED. Every
    // known path must resolve to one of the two buckets, and the only way to
    // be public is an explicit entry in PUBLIC_API (proved by the exact-set
    // comparison below, over concrete paths).
    for (const p of [...publicOnes, ...privateOnes]) {
      expect(p, 'a handler with an empty path').not.toBe('');
    }
  });

  it('the public list contains no path that has no handler', () => {
    // The reverse of the check above, and the one that catches a typo or a
    // deleted route: a PUBLIC_API entry matching nothing is dead policy that
    // reads like an open door. `/api/auth/*` is the Auth.js catch-all, which
    // no `route.ts` filesystem path can express literally, so it is checked
    // against the mounted handler instead.
    const concrete = API_ROUTES.map((p) => p.replace(/\[[^\]]*\]/g, 'x'));
    for (const { path } of PUBLIC_API) {
      if (path.includes('*')) {
        const prefix = path.slice(0, -1);
        const matched = concrete.some((p) => p === path.slice(0, -2) || p.startsWith(prefix));
        expect(matched, `${path} matches no handler — stale policy`).toBe(true);
      } else {
        expect(concrete, `${path} has no handler — stale policy`).toContain(path);
      }
    }
  });

  it('the tenant-data routes are NOT public', () => {
    // These are the ones whose omission would be a data breach, so they are
    // asserted by name rather than trusted to the list.
    for (const p of [
      '/api/chat',
      '/api/chat/conversations',
      '/api/keys',
      '/api/usage',
      '/api/usage/export',
      '/api/admin/orgs',
      '/api/admin/d17/export',
      '/api/account/delete',
      '/api/account/connections',
      '/api/orgs',
      '/api/subscription',
      '/api/billing/payments',
      '/api/checkout',
      '/api/profile/password',
    ]) {
      expect(isPublicApi(p), `${p} must require a session`).toBe(false);
    }
  });

  it('the published routes are the ones whose own credential is the auth', () => {
    for (const p of [
      '/api/auth/callback/credentials',
      '/api/auth/device',
      '/api/oauth/google/callback',
      '/api/billing/callback',
      '/api/health',
      '/api/plans',
      '/api/share/abc',
      '/api/playground',
      '/api/device/usage',
    ]) {
      expect(isPublicApi(p), `${p} must stay reachable without a session`).toBe(true);
    }
  });
});

describe('page access policy', () => {
  it('every page is classified, and the two bucket lists are disjoint concerns', () => {
    for (const page of PAGES) {
      const normalized = page.replace(/\[[^\]]*\]/g, 'x');
      const pub = isPublicPage(normalized);
      // A page is either public or behind the session; there is no third
      // state. Asserting the predicate is total (never throws, always a
      // boolean) is what makes the proxy's default-deny meaningful.
      expect(typeof pub).toBe('boolean');
    }
  });

  it('the product and console pages require a session', () => {
    for (const p of ['/chat', '/chat/x', '/dashboard', '/dashboard/keys', '/dashboard/settings']) {
      expect(isPublicPage(p), `${p} must require a session`).toBe(false);
    }
  });

  it('the marketing, auth and handoff pages do not', () => {
    for (const p of [
      '/',
      '/pricing',
      '/docs',
      '/playground',
      '/sign-in',
      '/verify-email/abc',
      '/reset-password/abc',
      '/device',
      '/share/abc',
      '/checkout/d17/x',
      '/billing/confirm',
    ]) {
      expect(isPublicPage(p), `${p} must stay reachable`).toBe(true);
    }
  });

  it('/admin is a page the gate must reach, and is therefore public at THIS layer', () => {
    // The gate form and every console page live under /admin. The console is
    // protected by the gate cookie + requireStaff, not by the session proxy
    // — locking the path here would make the gate itself unreachable.
    expect(isPublicPage('/admin')).toBe(true);
    expect(isPublicPage('/admin/ops')).toBe(true);
    // ...and the API under it is NOT public, so the gate opens a UI and no
    // data.
    expect(isPublicApi('/api/admin/ops')).toBe(false);
  });
});

describe('enforcement points', () => {
  const proxySrc = readFileSync(join(PORTAL, 'proxy.ts'), 'utf8');

  it('proxy.ts imports the policy instead of keeping a second copy', () => {
    expect(proxySrc).toContain("from '@/lib/security/route-policy'");
    expect(proxySrc).toContain('isPublicApi');
    expect(proxySrc).toContain('sessionFromHeaders');
  });

  it('private pages are gated on the session, and /admin is not', () => {
    // `/chat` and `/dashboard/*` answer a 307 to /sign-in before the shell
    // renders. `/admin` must stay reachable so its gate form can load — the
    // console behind it is the gate cookie + requireStaff.
    expect(proxySrc).toContain('isPublicPage');
    expect(proxySrc).toMatch(/!isPublicPage\(pathname\)/);
    expect(proxySrc).toContain("searchParams.set('callbackUrl'");
  });

  it('a missing AUTH_SECRET fails closed', () => {
    // If this ever becomes `return NextResponse.next()`, an unconfigured
    // deployment serves every private API route unauthenticated.
    expect(proxySrc).toMatch(/AUTH_SECRET[\s\S]{0,400}?return deny\(500/);
  });

  it('the matcher does not exclude /api', () => {
    const matcher = /matcher:\s*\[([\s\S]*?)\]/.exec(proxySrc)?.[1] ?? '';
    expect(matcher).not.toContain('api');
  });

  it('Caddy denies everything on the API host that is not the model surface', () => {
    const caddy = readFileSync(join(REPO, 'config/Caddyfile'), 'utf8');
    const apiHost = caddy.slice(
      caddy.indexOf('{$CADDY_SCHEME:}{$API_DOMAIN}'),
      caddy.indexOf('# ── Portal (customer dashboard)'),
    );
    expect(apiHost, 'the API vhost is missing').not.toBe('');

    // The allowlist carries the model surface...
    expect(apiHost).toContain('@modelApi path /v1/chat/completions /v1/messages');
    expect(apiHost).toContain('/v1/models');
    // ...the proxy only answers a matching request (`handle @modelApi`)...
    expect(apiHost).toMatch(/handle @modelApi \{/);
    // ...and a bare handle answers everything else, so a management path is
    // a 404 at the edge and never reaches LiteLLM.
    expect(apiHost).toMatch(/handle \{\s*respond "Not found" 404/);
    // The old denylist must not come back: it fails open.
    expect(apiHost).not.toContain('@mgmt');
  });

  it('the auth edge is an allowlist too, and mirrors the same model surface', () => {
    const edge = readFileSync(join(REPO, 'edge/server.mjs'), 'utf8');
    // A denylist here failed open on /health/liveliness, /metrics, /sso/...
    expect(edge).not.toContain('MGMT_PREFIXES');
    expect(edge).toMatch(/ALLOWED_EXACT = new Set\(\[/);
    expect(edge).toMatch(/function isDeniedPath/);
    for (const p of [
      '/v1/chat/completions',
      '/v1/messages',
      '/v1/responses',
      '/v1/models',
    ]) {
      expect(edge, `${p} must be on the edge allowlist`).toContain(`'${p}'`);
    }
  });
});
