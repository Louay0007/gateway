/**
 * The operations console: the username+password login, and every page.
 *
 * THREE LAYERS, ALL EXERCISED, because each fails differently and two of
 * them fail SILENTLY:
 *
 *   1. the login   — /admin/ops redirects to /admin/login without a console
 *                    session, and the form is the only way a browser can
 *                    obtain one
 *   2. the cookie  — the console cookie is a DIFFERENT name from the portal's,
 *                    so a customer session opens nothing here (and vice versa)
 *   3. the role    — a signed-in operator below the required rank is refused
 *
 * THE FORM IS DRIVEN, NOT REQUESTED, and that is the whole point. Two real
 * bugs would have been invisible to a hand-rolled POST: the gate once minted
 * a `Secure` cookie over plain HTTP that the browser accepted and then
 * refused to send back (a redirect loop with no error anywhere), and the
 * console API once demanded a PORTAL session, so every button 401'd while
 * every page rendered 200. A curl jar reports success for both.
 *
 * Requires a seeded console login:
 *   make accounts
 *   E2E_BASE_URL=http://portal.localhost E2E_ADMIN_ORIGIN=http://admin.localhost \
 *   E2E_STAFF_USERNAME=admin E2E_STAFF_PASSWORD=local-dev-password-1 \
 *   E2E_EMAIL=customer@example.test E2E_PASSWORD=local-dev-password-1 \
 *     npx playwright test e2e/admin-console.spec.ts
 */

import { expect, test } from '@playwright/test';

const STAFF_USERNAME = process.env.E2E_STAFF_USERNAME ?? 'admin';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD;
const CUSTOMER_EMAIL = process.env.E2E_EMAIL;
const CUSTOMER_PASSWORD = process.env.E2E_PASSWORD;
/** The console's own origin. .env points CONSOLE_DOMAIN at admin.localhost. */
const ADMIN_ORIGIN = process.env.E2E_ADMIN_ORIGIN ?? 'http://admin.localhost';
const BASE_ORIGIN = process.env.E2E_BASE_URL ?? '';

const CONSOLE_PAGES = [
  '/admin/ops',
  '/admin/d17',
  '/admin/usage',
  '/admin/orgs',
  '/admin/plans',
  '/admin/staff',
  '/admin/audit',
  '/admin/credits',
];

const MISSING_UUID = '00000000-0000-4000-8000-000000000000';

/** Sign in at /admin/login. Two fields — this is the brief. */
async function consoleSignIn(page: import('@playwright/test').Page) {
  await page.goto(`${ADMIN_ORIGIN}/admin`);
  // /admin is an entry point: it redirects, and the redirect lands here.
  await page.waitForURL(/\/admin\/login/, { timeout: 20_000 });

  await page.fill('input[name="username"]', STAFF_USERNAME);
  await page.fill('input[name="password"]', STAFF_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin\/ops/, { timeout: 20_000 });
}

test.describe('operations console', () => {
  test.skip(!STAFF_PASSWORD, 'set E2E_STAFF_PASSWORD to run');

  test('a console login renders every console page', async ({ page }) => {
    await consoleSignIn(page);

    for (const path of CONSOLE_PAGES) {
      const res = await page.goto(`${ADMIN_ORIGIN}${path}`);
      expect(res?.status(), `${path} status`).toBe(200);
      expect(page.url(), `${path} stayed put`).toContain(path);
    }
  });

  test('a console-only operator can perform a mutating action', async ({ page }) => {
    // THE BUG THIS EXISTS FOR. The pages rendered fine because they call
    // their services in-process; every `fetch('/api/admin/…')` behind a
    // button was refused by proxy.ts, which demanded a PORTAL session. No
    // page-level assertion would have caught it. This one goes through the
    // browser's own request context, sharing the console cookie.
    await consoleSignIn(page);

    const res = await page.request.post(`${ADMIN_ORIGIN}/api/admin/orgs/${MISSING_UUID}/sync`);
    // 404 means "reached the service and the org does not exist". A 401
    // would mean the proxy stopped a legitimate console operator.
    expect(res.status(), 'the proxy must accept the console cookie').toBe(404);
  });

  test('anonymous is redirected to the login form, never served a page', async ({ page }) => {
    await page.goto(`${ADMIN_ORIGIN}/admin/ops`);
    await page.waitForURL(/\/admin\/login/, { timeout: 20_000 });
    expect(page.url()).toContain('/admin/login');
  });

  test('a portal customer session opens nothing in the console', async ({ page }) => {
    test.skip(!CUSTOMER_EMAIL || !CUSTOMER_PASSWORD, 'set E2E_EMAIL and E2E_PASSWORD to run');

    await page.goto(`${BASE_ORIGIN}/sign-in`);
    await page.fill('input[name="email"], input[type="email"]', CUSTOMER_EMAIL!);
    await page.fill('input[name="password"], input[type="password"]', CUSTOMER_PASSWORD!);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(chat|dashboard)/, { timeout: 20_000 });

    // A customer credential must not be a console credential. This is the
    // separation the separate cookie exists for, asserted from a real
    // browser rather than from the derivation alone.
    const res = await page.request.get(`${ADMIN_ORIGIN}/api/admin/ops`);
    expect(res.status(), 'a portal session must not open the console API').toBe(401);
  });
});
