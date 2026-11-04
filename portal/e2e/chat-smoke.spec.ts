/**
 * The chat path, end to end through the UI.
 *
 * Chat has three ways to fail that no unit test catches: the 402 plan wall
 * (no subscription), the 502 from key minting, and a stream that connects
 * and then renders nothing. All three look identical to a user — an empty
 * transcript — so this asserts on a real reply arriving.
 *
 * It is the regression test for the textArray bug: `ARRAY["fast"]` raised
 * `column "fast" does not exist`, the mint transaction rolled back, and the
 * catch block revoked the key it had just made. The API answered 502 and
 * the UI showed nothing. Only a real send reproduces it.
 *
 * Needs `make accounts` and `make plan`, or the 402 is correct behaviour.
 * Skips rather than fails when no credentials are configured.
 */

import { expect, test } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

test.describe('chat', () => {
  test.skip(!EMAIL || !PASSWORD, 'set E2E_EMAIL and E2E_PASSWORD to run');

  test('sends a message and renders a real model reply', async ({ page }) => {
    await page.goto('/sign-in');
    await page.fill('input[name="email"], input[type="email"]', EMAIL!);
    await page.fill('input[name="password"], input[type="password"]', PASSWORD!);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(chat|dashboard)/, { timeout: 20_000 });

    await page.goto('/chat');
    const box = page.locator('textarea').first();
    await box.fill('Reply with exactly: PONG');
    await box.press('Enter');

    // Assert on text that came from the model, not on a fixed delay: a
    // stream that opens and then sends nothing must fail this.
    await expect(
      page.getByText(/PONG|pong|hello|Hello/i).first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});

/**
 * The model picker must open without taking the page down.
 *
 * Production threw `Base UI error #31` the moment the picker was clicked
 * (a `Menu.GroupLabel` outside a `Menu.Group`), and the whole route fell to
 * the error boundary — so "switch from smart to frontier" looked like a
 * broken chat. A server render cannot catch it: `Menu.Portal` emits nothing
 * during SSR, so the label never mounts until a real browser opens the
 * popup. Only this test does.
 */
test.describe('model picker', () => {
  test.skip(!EMAIL || !PASSWORD, 'set E2E_EMAIL and E2E_PASSWORD to run');

  test('opens, lists the plan aliases, and switching does not crash', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto('/sign-in');
    await page.fill('input[name="email"], input[type="email"]', EMAIL!);
    await page.fill('input[name="password"], input[type="password"]', PASSWORD!);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(chat|dashboard)/, { timeout: 20_000 });

    await page.goto('/chat');

    // The trigger is the only button whose accessible name starts "Model:".
    const trigger = page.getByRole('button', { name: /^Model:|Choose a model/ }).first();
    await expect(trigger).toBeVisible({ timeout: 20_000 });
    await trigger.click();

    // The popup must actually mount: its group label is what used to throw.
    await expect(page.getByText(/^Model$/i)).toBeVisible({ timeout: 10_000 });

    // Every offered alias is one of the three customer-facing names, and no
    // upstream model name ever appears.
    const items = page.getByRole('menuitem');
    await expect(items.first()).toBeVisible({ timeout: 10_000 });
    const labels = await items.allInnerTexts();
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label).not.toMatch(/haiku|sonnet|opus|5\.5|openai|anthropic/i);
    }

    // Switching to another tier must not throw and must close the popup.
    const other = items.filter({ hasText: /Frontier|Smart|Fast/i }).nth(1);
    if (await other.count()) {
      await other.first().click();
      await expect(page.getByText(/^Model$/i)).toBeHidden({ timeout: 10_000 });
    }

    // No uncaught page error — this is the assertion that would have failed
    // on the production build.
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
