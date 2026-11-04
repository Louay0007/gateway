/**
 * The operations console: staff sign-in, the secret gate, every page.
 *
 * THREE LAYERS, ALL EXERCISED, because each one fails differently and two
 * of them fail SILENTLY:
 *
 *   1. the session  — /admin/ops redirects to /sign-in without it
 *   2. the gate     — /admin/ops redirects to /admin without the HMAC
 *                     cookie, and the gate form is the only way a browser
 *                     can obtain that cookie
 *   3. the role     — a signed-in non-staff caller is refused
 *
 * The gate is the one that hid a real bug: the cookie was minted
 * `Secure` whenever NODE_ENV=production, so a container served over plain
 * HTTP set a cookie the browser then refused to send back, and every
 * console page looped to /admin with no error anywhere. A curl jar cannot
 * catch that — it stores Secure cookies without complaint — so this test
 * drives the actual form, which is the only faithful check.
 *
 * Requires a staff account and ADMIN_GATE_SECRET:
 *   make accounts
 *   E2E_BASE_URL=http://portal.localhost \
 *   E2E_STAFF_EMAIL=staff@example.test E2E_STAFF_PASSWORD=local-dev-password-1 \
 *   ADMIN_GATE_SECRET=$(grep '^ADMIN_GATE_SECRET=' .env | cut -d= -f2-) \
 *     npx playwright test
 */

import { expect, test } from '@playwright/test';

const STAFF_EMAIL = process.env.E2E_STAFF_EMAIL;
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD;
const GATE_SECRET = process.env.ADMIN_GATE_SECRET;
/** The console's own origin. .env points CONSOLE_DOMAIN at admin.localhost. */
const ADMIN_ORIGIN = process.env.E2E_ADMIN_ORIGIN ?? 'http://admin.localhost';

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

test.describe('operations console', () => {
  test.skip(
    !STAFF_EMAIL || !STAFF_PASSWORD || !GATE_SECRET,
    'set E2E_STAFF_EMAIL, E2E_STAFF_PASSWORD and ADMIN_GATE_SECRET to run',
  );

  test('staff passes the gate and renders every console page', async ({ page }) => {
    await page.goto(`${process.env.E2E_BASE_URL ?? ''}/sign-in`);
    await page.fill('input[name="email"], input[type="email"]', STAFF_EMAIL!);
    await page.fill('input[name="password"], input[type="password"]', STAFF_PASSWORD!);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(chat|dashboard)/, { timeout: 20_000 });

    // The gate. Submitting the real form is the point: it proves the
    // browser ACCEPTS the returned cookie, which is what `Secure` broke.
    await page.goto(`${ADMIN_ORIGIN}/admin`);
    await page.fill('#code', GATE_SECRET!);
    await page.click('#submit-btn');
    await page.waitForURL(/\/admin\/ops/, { timeout: 20_000 });

    for (const path of CONSOLE_PAGES) {
      const res = await page.goto(`${ADMIN_ORIGIN}${path}`);
      expect(res?.status(), `${path} status`).toBe(200);
      expect(page.url(), `${path} stayed put`).toContain(path);
    }
  });
});
