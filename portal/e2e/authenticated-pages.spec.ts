/**
 * Authenticated surfaces — the check that was impossible before local
 * sign-in worked.
 *
 * Every product page sits behind `currentUser()` and redirects to /sign-in
 * when it is absent, so `public-pages.spec.ts` can only ever prove the
 * front door. This spec signs in with a REAL account and walks the product,
 * which is the only way to catch a page that 500s once it has a user — the
 * class of bug the anonymous tests cannot see.
 *
 * SKIPPED, not failed, when the environment does not provide an account.
 * A test that requires a seeded database would break `npm run test:e2e` on
 * a clean checkout, and a permanently-red suite is worse than none.
 *
 * Locally:
 *   make accounts                      # seeds customer@example.test
 *   E2E_BASE_URL=http://portal.localhost \
 *   E2E_EMAIL=customer@example.test E2E_PASSWORD=local-dev-password-1 \
 *     npx playwright test
 */

import { expect, test } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

const PRODUCT_PAGES = [
  '/chat',
  '/dashboard',
  '/settings',
  '/dashboard/settings',
  '/dashboard/keys',
  '/dashboard/billing',
  '/dashboard/usage',
];

test.describe('authenticated product surfaces', () => {
  test.skip(!EMAIL || !PASSWORD, 'set E2E_EMAIL and E2E_PASSWORD to run');

  test('signs in and renders every product page', async ({ page }) => {
    await page.goto('/sign-in');
    await page.fill('input[name="email"], input[type="email"]', EMAIL!);
    await page.fill('input[name="password"], input[type="password"]', PASSWORD!);
    await page.click('button[type="submit"]');

    // Landing route differs by which shell won the redirect; both are valid.
    await page.waitForURL(/\/(chat|dashboard)/, { timeout: 20_000 });

    for (const path of PRODUCT_PAGES) {
      const res = await page.goto(path);
      // 200 AND still on the path: a redirect back to /sign-in would also
      // "succeed" as a navigation, so the URL is the real assertion.
      expect(res?.status(), `${path} status`).toBe(200);
      expect(page.url(), `${path} stayed put`).toContain(path);
    }
  });
});
