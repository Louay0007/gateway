/**
 * The console login's invariants — the ones whose violation is SILENT.
 *
 * A console cookie that decrypts under the portal's cookie name is not a
 * failing test anywhere else: every screen still renders, the ranks still
 * resolve, and the only symptom is that ONE stolen cookie is TWO
 * credentials. That is the property this file exists to hold down.
 *
 * Nothing here needs a database. The cookie-name/derivation agreement is
 * proved against tokens `next-auth/jwt` itself mints, not against a
 * re-implementation — the same discipline `tests/proxy-session.test.ts`
 * applies to the portal cookie.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SECRET = 'console-isolation-test-secret-not-a-real-deployment-key';
const PREVIOUS = { AUTH_SECRET: process.env.AUTH_SECRET, AUTH_URL: process.env.AUTH_URL };

const PORTAL = process.cwd();

beforeAll(() => {
  process.env.AUTH_SECRET = SECRET;
  process.env.AUTH_URL = 'https://portal.test';
});

afterAll(() => {
  if (PREVIOUS.AUTH_SECRET === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = PREVIOUS.AUTH_SECRET;
  if (PREVIOUS.AUTH_URL === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = PREVIOUS.AUTH_URL;
});

/** Mint a token under an arbitrary cookie name, exactly as Auth.js would. */
async function mintUnder(salt: string, payload: Record<string, unknown>) {
  const { encode } = await import('next-auth/jwt');
  return encode({ token: payload, secret: SECRET, salt, maxAge: 3600 });
}

// ───────────────────────────────────────────────────────────────────────
//  Cookie isolation
// ───────────────────────────────────────────────────────────────────────

describe('console session isolation', () => {
  it('the console cookie is a different name from the portal cookie', async () => {
    const { sessionCookieName, staffSessionCookieName } = await import('@/lib/auth/session-token');
    expect(staffSessionCookieName()).not.toBe(sessionCookieName());
    // The distinguishing token, so a future rename cannot quietly collide.
    expect(staffSessionCookieName()).toContain('staff');
  });

  it('a token minted for the console does NOT decode as a portal session', async () => {
    const { decodeSessionToken, sessionCookieName, staffSessionCookieName } = await import(
      '@/lib/auth/session-token'
    );

    const consoleToken = await mintUnder(staffSessionCookieName(), {
      sub: 'staff-1',
      email: 'admin',
    });

    // The key is HKDF over the cookie name, so the portal name yields a
    // different key and the token is refused. This is the isolation.
    expect(await decodeSessionToken(consoleToken, sessionCookieName())).toBeNull();
    // ...and it still decodes under its own name, so the isolation did not
    // come at the cost of the login working.
    expect((await decodeSessionToken(consoleToken, staffSessionCookieName()))?.sub).toBe('staff-1');
  });

  it('a token minted for the portal does NOT decode as a console session', async () => {
    const { decodeSessionToken, sessionCookieName, staffSessionCookieName } = await import(
      '@/lib/auth/session-token'
    );

    const portalToken = await mintUnder(sessionCookieName(), { sub: 'user-1', email: 'a@b.test' });

    expect(await decodeSessionToken(portalToken, staffSessionCookieName())).toBeNull();
    expect((await decodeSessionToken(portalToken, sessionCookieName()))?.sub).toBe('user-1');
  });

  it('each header reader accepts only its own cookie', async () => {
    const { sessionFromHeaders, staffSessionFromHeaders, sessionCookieName, staffSessionCookieName } =
      await import('@/lib/auth/session-token');

    const consoleCookie = `${staffSessionCookieName()}=${await mintUnder(
      staffSessionCookieName(),
      { sub: 'staff-1' },
    )}`;
    const headers = new Headers({ cookie: consoleCookie });

    expect(await staffSessionFromHeaders(headers)).not.toBeNull();
    // The portal reader looks for a DIFFERENT name, so it finds nothing at
    // all rather than finding something it must then reject.
    expect(await sessionFromHeaders(headers)).toBeNull();
  });

  it('joins chunked cookies under whichever name it was given', async () => {
    const { staffSessionFromHeaders, staffSessionCookieName } = await import(
      '@/lib/auth/session-token'
    );
    const name = staffSessionCookieName();
    const token = await mintUnder(name, { sub: 'staff-2' });

    // A long token is written as `.0`, `.1`… and must be re-joined in
    // NUMERIC order — `.10` after `.2`. Reversed parts must still resolve.
    const half = Math.floor(token.length / 2);
    const headers = new Headers({
      cookie: `${name}.0=${token.slice(0, half)}; ${name}.1=${token.slice(half)}`,
    });

    expect((await staffSessionFromHeaders(headers))?.sub).toBe('staff-2');
  });
});

// ───────────────────────────────────────────────────────────────────────
//  The shared secret is gone
// ───────────────────────────────────────────────────────────────────────

/** Every .ts/.tsx under a directory, skipping build output and deps. */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'test-results') continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) sources(path, found);
    else if (/\.(ts|tsx)$/.test(entry)) found.push(path);
  }
  return found;
}

describe('no shared access code remains', () => {
  it('ADMIN_GATE_SECRET is referenced nowhere in the application source', () => {
    // Documentation of WHY it was removed is allowed (and desirable) in
    // comments; a live `process.env.ADMIN_GATE_SECRET` is not. So the
    // assertion is on the env READ, not the string.
    const offenders = sources(PORTAL)
      .filter((f) => readFileSync(f, 'utf8').includes('process.env.ADMIN_GATE_SECRET'))
      .filter((f) => !f.includes('tests/admin-login.test.ts'));
    expect(offenders, `still reading the removed secret: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the gate route and the static gate page are both gone', () => {
    expect(existsSync(join(PORTAL, 'app/api/admin/gate/route.ts'))).toBe(false);
    // Served by Caddy, outside the portal tree — a second implementation of
    // the same screen, which is why it had to go with the first.
    expect(existsSync(join(PORTAL, '../config/admin-gate.html'))).toBe(false);
  });

  it('the console gate cookie is not read anywhere', () => {
    const offenders = sources(PORTAL)
      .filter((f) => {
        const src = readFileSync(f, 'utf8');
        // `admin_gate` as an identifier, not as prose in a header comment.
        return /(cookieStore|headers)\.(get|set)\(['"]admin_gate['"]/.test(src);
      });
    expect(offenders).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────
//  Route buckets
// ───────────────────────────────────────────────────────────────────────

describe('the console API is decided by the console cookie alone', () => {
  it('/api/admin/* is neither public nor portal-private', async () => {
    const { isPublicApi, isStaffApi, isStaffAuthApi } = await import(
      '@/lib/security/route-policy'
    );

    expect(isStaffApi('/api/admin/orgs')).toBe(true);
    expect(isStaffApi('/api/admin')).toBe(true);
    // A prefix match must not swallow a sibling namespace.
    expect(isStaffApi('/api/administrator')).toBe(false);
    expect(isStaffApi('/api/admin-auth/callback/staff')).toBe(false);

    // NOT public — the proxy refuses it without a console session.
    expect(isPublicApi('/api/admin/orgs')).toBe(false);
    expect(isStaffAuthApi('/api/admin/orgs')).toBe(false);
  });

  it('/api/admin-auth/* is reachable with no session, and is not the console API', async () => {
    const { isStaffAuthApi, isStaffApi, isPublicApi } = await import(
      '@/lib/security/route-policy'
    );

    // Sign-in cannot require a session — that is the point of it.
    expect(isStaffAuthApi('/api/admin-auth/callback/staff')).toBe(true);
    expect(isStaffAuthApi('/api/admin-auth')).toBe(true);

    // ...but it must not be mistaken for the data surface.
    expect(isStaffApi('/api/admin-auth/callback/staff')).toBe(false);
    // And the CUSTOMER auth mount is not the console's.
    expect(isStaffAuthApi('/api/auth/callback/credentials')).toBe(false);
    expect(isPublicApi('/api/auth/callback/credentials')).toBe(true);
  });

  it('/admin stays reachable without a portal session', async () => {
    // Requiring a PORTAL session here would mean an operator held two logins
    // to reach a staff console. The credential is the console session, and
    // the layout redirects to /admin/login without one.
    const { isPublicPage } = await import('@/lib/security/route-policy');
    expect(isPublicPage('/admin')).toBe(true);
    expect(isPublicPage('/admin/ops')).toBe(true);
    expect(isPublicPage('/admin/login')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────
//  The proxy actually applies the buckets
// ───────────────────────────────────────────────────────────────────────

describe('proxy.ts enforces the two credentials', () => {
  const src = readFileSync(join(PORTAL, 'proxy.ts'), 'utf8');

  it('reads the staff cookie for the console API and the portal cookie elsewhere', () => {
    expect(src).toContain('isStaffApi');
    expect(src).toContain('staffSessionFromHeaders');
    expect(src).toContain('sessionFromHeaders');
    // The staff branch must come BEFORE the portal session check, or the
    // console API is answered 401 by the wrong credential.
    expect(src.indexOf('isStaffApi(pathname)')).toBeLessThan(
      src.indexOf('const session = await sessionFromHeaders(request.headers)'),
    );
  });

  it('lets the console auth endpoints through without a session', () => {
    expect(src).toContain('isStaffAuthApi');
    expect(src.indexOf('isStaffAuthApi(pathname)')).toBeLessThan(
      src.indexOf('isStaffApi(pathname)'),
    );
  });

  it('no longer stamps a gate-page header nobody reads', () => {
    expect(src).not.toContain('x-admin-gate-path');
  });
});

// ───────────────────────────────────────────────────────────────────────
//  The redirect loop — a layout that guards the page it redirects to
// ───────────────────────────────────────────────────────────────────────

describe('the console layout must not wrap the login page', () => {
  /**
   * THE BUG THIS EXISTS FOR, and why nothing else caught it.
   *
   * `app/admin/layout.tsx` applies to EVERY descendant route, including
   * `app/admin/login/page.tsx`. So an unauthenticated request to
   * /admin/login entered the layout, found no session, and redirected to
   * /admin/login — the page it was already rendering. Infinite loop,
   * ERR_TOO_MANY_REDIRECTS, every operator locked out, no error in any log.
   *
   * Every other check passed: the build succeeded, the pages compiled, the
   * proxy allowed the path, and a `curl` that follows redirects reports the
   * final 200 without ever showing the cycle. The nesting is the only place
   * the loop is visible, so it is asserted here.
   */
  const admin = join(PORTAL, 'app/admin');

  it('has no layout at app/admin/layout.tsx', () => {
    // A layout at this level covers /admin/login. It must live in a route
    // group so its scope excludes the login page.
    expect(existsSync(join(admin, 'layout.tsx'))).toBe(false);
  });

  it('puts the shell in a route group, so URLs are unchanged', () => {
    expect(existsSync(join(admin, '(console)/layout.tsx'))).toBe(true);
  });

  it('leaves the login page outside that group', () => {
    expect(existsSync(join(admin, 'login/page.tsx'))).toBe(true);
    // ...and there is no login INSIDE the group that would be shadowed.
    expect(existsSync(join(admin, '(console)/login'))).toBe(false);
  });

  it('the guarded layout redirects only to a route it does not wrap', () => {
    const layout = readFileSync(join(admin, '(console)/layout.tsx'), 'utf8');
    const redirects = [...layout.matchAll(/redirect\("([^"]+)"\)/g)]
      .map((m) => m[1])
      // `matchAll` is typed as possibly-undefined capture groups under
      // noUncheckedIndexedAccess; every match here has group 1 by construction.
      .filter((t): t is string => typeof t === 'string');
    expect(redirects.length).toBeGreaterThan(0);
    for (const target of redirects) {
      // Every redirect target must resolve OUTSIDE `(console)`, or it is a
      // loop by construction.
      const inner = join(admin, '(console)', target.replace(/^\/admin\/?/, ''), 'page.tsx');
      expect(existsSync(inner), `layout must not redirect to a route it wraps: ${target}`).toBe(false);
    }
  });

  it('keeps every console page inside the group', () => {
    // A page left outside would render with no shell and, worse, no session
    // check — an unauthenticated console screen.
    for (const seg of [
      'ops', 'orgs', 'customers', 'subscriptions', 'payments',
      'd17', 'usage', 'credits', 'trials', 'audit', 'system', 'plans', 'staff',
    ]) {
      expect(
        existsSync(join(admin, '(console)', seg, 'page.tsx')),
        `${seg} must be inside (console) so the guard applies`,
      ).toBe(true);
      expect(
        existsSync(join(admin, seg, 'page.tsx')),
        `${seg} must NOT be at the unguarded level`,
      ).toBe(false);
    }
  });
});
