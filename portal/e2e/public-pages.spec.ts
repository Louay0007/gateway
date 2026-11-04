/**
 * E2E smoke for the public surfaces a visitor actually lands on.
 *
 * Deliberately small and unauthenticated. The point of this file is not
 * coverage — it is that `npm run test:e2e` runs something real against a
 * locally started build, so a broken marketing page or a route that only
 * fails in production mode is caught before deploy.
 *
 * The previous spec tested `/api/downloads` file serving against a hosted
 * domain and was deleted because it could not pass on a clean checkout
 * (no downloads directory, no DNS). These assertions hold with an empty
 * `DOWNLOADS_DIR`, which is the state of every dev machine.
 */

import { expect, test } from '@playwright/test';

test.describe('public pages', () => {
  test('marketing home renders', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.status()).toBe(200);
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('download page renders with the product name', async ({ page }) => {
    const res = await page.goto('/download');
    expect(res?.status()).toBe(200);
    await expect(page.getByText(/Zaino AI Agent/i).first()).toBeVisible();
  });

  test('/api/downloads answers JSON, empty directory included', async ({ request }) => {
    const res = await request.get('/api/downloads');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { version?: unknown; files?: unknown };
    // The version is a constant in the route; `files` is [] when nothing
    // is hosted yet. Both are contract, not coincidence.
    expect(body.version).toBeTruthy();
    expect(Array.isArray(body.files)).toBe(true);
  });

  test('a protected page redirects to sign-in instead of rendering', async ({ page }) => {
    // /settings is the one page both shells share; anonymous must bounce.
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
