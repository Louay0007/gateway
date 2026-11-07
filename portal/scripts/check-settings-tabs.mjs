/**
 * Settings tabs — the one runnable check for this page.
 *
 * Not a Playwright project spec: this walks the REAL settings page in the
 * REAL shell on a dev server, which is the only place the bugs it guards
 * (URL sync, panel remount, mobile tab clipping) actually show up. Run:
 *
 *   node scripts/check-settings-tabs.mjs [baseURL]
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:3111';
const EMAIL = process.env.E2E_EMAIL ?? 'customer@example.test';
const PASSWORD = process.env.E2E_PASSWORD ?? 'local-dev-password-1';
const TABS = [
  ['plan', 'Plan'],
  ['usage', 'Usage'],
  ['keys', 'API keys'],
  ['billing', 'Billing'],
  ['profile', 'Profile'],
  ['ai', 'AI'],
  ['danger', 'Danger'],
];
const PATHS = ['/settings', '/dashboard/settings'];

// The settings strip is named; nested strips (Usage's Table/By model) are not.
const LIST = '[role="tablist"][aria-label="Settings sections"]';

const fails = [];
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) fails.push(msg);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.goto(`${BASE}/sign-in`);
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/\/(chat|dashboard)/, { timeout: 30_000 });

for (const path of PATHS) {
  await page.goto(`${BASE}${path}?tab=plan`);
  await page.waitForSelector(LIST);

  for (const [tab, label] of TABS) {
    await page.click(`${LIST} [role="tab"]:text-is("${label}")`);
    await page.waitForTimeout(150);
    ok(page.url().includes(`tab=${tab}`), `${path} → ${tab}: URL kept the tab`);
    ok(
      // Scoped to the settings strip: Usage keeps a Table/By-model strip of
      // its own, and a kept-mounted panel leaves that one selected too.
      (await page.locator(`${LIST} [role="tab"][aria-selected="true"]`).count()) === 1,
      `${path} → ${tab}: exactly one tab selected`,
    );
    ok(
      // The FIRST tabs root is the settings one; Usage nests a second root
      // (Table / By model) inside its own panel, legitimately visible too.
      (await page.locator('[data-slot="tabs"]').first().locator('> [role="tabpanel"]:visible').count()) === 1,
      `${path} → ${tab}: exactly one panel visible`,
    );
  }

  // A reload must land back on the tab the URL names.
  await page.goto(`${BASE}${path}?tab=ai`);
  await page.waitForSelector('[role="tabpanel"]');
  const selected = await page.locator(`${LIST} [role="tab"][aria-selected="true"]`).innerText();
  ok(selected.trim() === 'AI', `${path}: ?tab=ai deep link selects AI (got "${selected.trim()}")`);

  // A half-typed name must survive a trip to another tab and back.
  const name = page.locator('#profile-name');
  await page.goto(`${BASE}${path}?tab=profile`);
  await page.waitForSelector('#profile-name');
  await page.fill('#profile-name', 'half-typed');
  await page.click(`${LIST} [role="tab"]:text-is("Usage")`);
  await page.waitForTimeout(150);
  await page.click(`${LIST} [role="tab"]:text-is("Profile")`);
  await page.waitForTimeout(150);
  ok(
    (await name.inputValue().catch(() => '')) === 'half-typed',
    `${path}: typed input survives a tab switch`,
  );
  await page.goto(`${BASE}${path}?tab=plan`);
}

// Mobile: every label must be fully inside the viewport, none clipped.
await page.setViewportSize({ width: 375, height: 780 });
for (const path of PATHS) {
  await page.goto(`${BASE}${path}?tab=plan`);
  await page.waitForSelector(LIST);
  const clipped = await page.evaluate((sel) =>
    [...document.querySelectorAll(`${sel} [role="tab"]`)]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < -0.5 || r.right > window.innerWidth + 0.5 || el.scrollWidth > el.clientWidth + 1;
      })
      .map((el) => el.textContent.trim()),
    LIST);
  ok(clipped.length === 0, `${path} @375px: no clipped tabs (${clipped.join(', ') || 'none'})`);
}

await page.screenshot({ path: '/tmp/settings-mobile.png', fullPage: true });
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${BASE}/dashboard/settings?tab=plan`);
await page.screenshot({ path: '/tmp/settings-desktop.png', fullPage: true });

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
