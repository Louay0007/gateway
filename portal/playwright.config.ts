import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — the file that was missing.
 *
 * `package.json` advertised `test:e2e` and `@playwright/test` was already a
 * devDependency, but there was no config and no `e2e/` directory: the one
 * spec that existed was deleted in `2cb3949` ("remove untracked e2e
 * directory to allow deploy") because it was untracked and broke `rsync
 * --delete`. So `npm run test:e2e` printed "No tests found" and nobody
 * noticed for a week.
 *
 * Against localhost, NOT production. The deleted spec hit
 * `https://zaino.soon.it`, which makes a red test mean "the internet is
 * down" as often as it means "the code is broken".
 *
 * `webServer` builds and starts the app itself, so a bare `npm run
 * test:e2e` is the whole command — no "start the server first" folklore.
 */
export default defineConfig({
  testDir: './e2e',
  // Public pages only. Anything behind auth needs a seeded session, which
  // is a fixture this project does not have yet.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // A port of its own so this never fights `next dev` on 3000, and
    // `reuseExistingServer` so a second run is fast.
    command: 'npx next start -p 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
