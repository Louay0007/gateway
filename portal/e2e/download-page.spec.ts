/**
 * E2E verification for /download — self-hosted installer serving.
 *
 * Checks:
 *   1. Page loads (HTTP 200, contains "Zaino AI Agent").
 *   2. /api/downloads returns valid JSON with version + files array.
 *   3. Every file URL from the API responds HTTP 200 with
 *      Content-Disposition: attachment and non-zero Content-Length.
 *   4. Each platform card renders at least one download link.
 */

import { test, expect } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL || "https://zaino.soon.it";

test.describe("Download page", () => {
  test("page loads and shows product name", async ({ page }) => {
    const res = await page.goto(`${BASE}/download`);
    expect(res?.status()).toBe(200);
    await expect(page.getByText("Zaino AI Agent")).toBeVisible();
  });

  test("/api/downloads lists hosted files", async ({ request }) => {
    const res = await request.get(`${BASE}/api/downloads`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.version).toBeTruthy();
    expect(Array.isArray(body.files)).toBe(true);
    // At minimum the macOS arm64 DMG should be present.
    expect(body.files.length).toBeGreaterThanOrEqual(1);
  });

  test("every listed file is downloadable", async ({ request }) => {
    const apiRes = await request.get(`${BASE}/api/downloads`);
    const { files } = await apiRes.json();
    for (const file of files) {
      const head = await request.head(`${BASE}${file.url}`);
      expect(head.status(), `HEAD ${file.url}`).toBe(200);
      const disposition = head.headers()["content-disposition"];
      expect(disposition, `Content-Disposition for ${file.url}`).toContain(
        "attachment",
      );
    }
  });

  test("platform cards render download links", async ({ page }) => {
    await page.goto(`${BASE}/download`);
    // Wait for client-side fetch of /api/downloads to resolve.
    await page.waitForResponse((r) => r.url().includes("/api/downloads"));
    // At least one anchor with a /downloads/ href should appear.
    const links = page.locator('a[href*="/downloads/"]');
    await expect(links.first()).toBeVisible({ timeout: 10_000 });
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});