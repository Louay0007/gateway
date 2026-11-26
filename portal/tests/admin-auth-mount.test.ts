/**
 * The console's Auth.js mount — the bug that shipped and could not be seen
 * statically.
 *
 * `next-auth` defaults `basePath` to `/api/auth`, the CUSTOMER mount, and
 * derives every action by stripping that prefix from the request path. Our
 * instance is served from `/api/admin-auth`, so a request to
 * `/api/admin-auth/csrf` matched no action: @auth/core threw `UnknownAction`
 * and answered 400 "Bad request" — while the route existed, the build passed,
 * the proxy let it through, and the login page rendered.
 *
 * WHY THIS IS A SOURCE ASSERTION, NOT A LIVE CALL. Importing the config pulls
 * `next-auth` → `next/server`, which Vitest cannot resolve outside a Next
 * runtime (`Cannot find module 'next/server'`). Spinning a Next server inside a
 * unit test would be a different, slower file. So the property is pinned at the
 * source — the ONE line whose absence produced the 400 — and the live behaviour
 * is covered by the e2e specs and by the production smoke test in the
 * walkthrough.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PORTAL = process.cwd();
const read = (rel: string) => readFileSync(join(PORTAL, rel), 'utf8');

describe('console Auth.js mount', () => {
  it('declares the mount it is served from, not the default', () => {
    const src = read('lib/auth/admin-auth.ts');
    // The default is `/api/auth`. Relying on it is exactly what produced the
    // UnknownAction → 400 on every console login attempt.
    expect(src).toMatch(/basePath:\s*['"]\/api\/admin-auth['"]/);
  });

  it('the route file, the config and the proxy agree on one mount', () => {
    // Three places must name the same path; a rename in any one silently
    // 400s the login, and nothing else in CI would notice.
    const MOUNT = '/api/admin-auth';

    // 1. the config
    expect(read('lib/auth/admin-auth.ts')).toContain(`basePath: '${MOUNT}'`);

    // 2. the route directory that serves it
    const route = `app${MOUNT}/[...adminAuth]/route.ts`;
    expect(existsSync(join(PORTAL, route)), `${route} must exist`).toBe(true);
    expect(read(route)).toContain('adminHandlers');

    // 3. the proxy's public bucket (a sign-in route nobody can reach is
    //    still a sign-in route nobody can use)
    const policy = read('lib/security/route-policy.ts');
    expect(policy).toContain(`'/api/admin-auth'`);
  });

  it('is not mistaken for the customer auth mount', () => {
    const policy = read('lib/security/route-policy.ts');
    // `isStaffAuthApi` must not swallow `/api/auth/*`, which is the portal's.
    expect(policy).toMatch(/STAFF_AUTH_API\s*=\s*'\/api\/admin-auth'/);
  });
});
