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

  test('/faq is readable — the shared FAQ section is not white-on-white', async ({ page }) => {
    // FaqSection is rendered by both `/` and `/faq`. It was hardcoded
    // `text-white` + `bg-white/[0.04]`, so on /faq's white canvas the answers
    // were white on white — invisible, and invisible in review because the
    // reviewer's default theme was dark.
    //
    // The assertion compares the heading against the surface it actually sits
    // on (the card behind it), not `document.body`: next-themes makes the body
    // `bg-background`, but the FAQ card has its own `--mkt-surface`, and that
    // is the pair a reader's eye has to resolve. Colours are read through
    // `color`/`backgroundColor` and converted from whatever colour space the
    // browser reports (`lab()`, `oklch()`, `rgb()`) by painting them into a
    // canvas, so the check does not depend on the serialisation.
    await page.goto('/faq');
    const heading = page.getByRole('heading', { name: /frequently asked questions/i });
    await expect(heading).toBeVisible();

    const pair = await page.evaluate(() => {
      const h = Array.from(document.querySelectorAll('h2')).find((el) =>
        /frequently asked questions/i.test(el.textContent ?? ''),
      ) as HTMLElement | undefined;
      if (!h) return null;

      // Resolve any CSS colour string to sRGB by painting one pixel.
      const cv = document.createElement('canvas');
      cv.width = cv.height = 1;
      const ctx = cv.getContext('2d')!;
      const toRgb = (css: string): [number, number, number] => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 1, 1);
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return [r!, g!, b!];
      };

      // Walk up to the first ancestor with a non-transparent background.
      let node: HTMLElement | null = h;
      let surface = 'rgb(255, 255, 255)';
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && !/rgba?\(\s*0,?\s*0,?\s*0,?\s*0\s*\)|transparent/.test(bg)) {
          surface = bg;
          break;
        }
        node = node.parentElement;
      }

      return {
        fg: toRgb(getComputedStyle(h).color),
        bg: toRgb(surface),
      };
    });

    expect(pair).not.toBeNull();
    const [r, g, b] = pair!.fg;
    const [br, bgc, bb] = pair!.bg;

    // WCAG contrast, the same formula the unit test uses.
    const lum = ([rr, gg, bbb]: [number, number, number]) => {
      const ch = (c: number) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * ch(rr) + 0.7152 * ch(gg) + 0.0722 * ch(bbb);
    };
    const la = lum([r, g, b]);
    const lb = lum([br, bgc, bb]);
    const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);

    expect(
      Math.round(ratio * 100) / 100,
      `FAQ heading rgb(${r},${g},${b}) on rgb(${br},${bgc},${bb})`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  test('pricing page shows all five tiers from the fallback, no DB', async ({ page }) => {
    // The reason for this one: /api/plans failed with a 500 on a machine
    // without Postgres, and the homepage's hardcoded fallback still listed
    // an "Enterprise / Let's Talk" card that no longer exists and hid
    // Solo, Team and Business. A visitor with a slow network sees exactly
    // that fallback, so it is a customer surface and it has to be right.
    const res = await page.goto('/pricing');
    expect(res?.status()).toBe(200);
    for (const tier of ['Solo', 'Starter', 'Pro', 'Team', 'Business']) {
      await expect(page.getByRole('heading', { name: tier, exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText("Let's Talk")).toHaveCount(0);
  });

  test('pricing is two audience bands, and no card is orphaned', async ({ page }) => {
    // The previous layout put all five tiers in one row of a 1024px container,
    // which measured 176px per card — narrow enough that every plan
    // description wrapped to two words a line. The ladder is now two bands
    // because it has two audiences, and three-then-two means neither row
    // trails an orphan. Asserting CARD WIDTH is the part that would have
    // caught the old layout: at 1440px a card under 300px is unreadable.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/pricing');

    await expect(
      page.getByRole('heading', { name: /for one person/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /for a team on one invoice/i }),
    ).toBeVisible();

    const widths = await page.evaluate(() =>
      Array.from(document.querySelectorAll('article')).map((el) =>
        Math.round(el.getBoundingClientRect().width),
      ),
    );
    expect(widths).toHaveLength(5);
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(300);
  });

  test('pricing never advertises seats', async ({ page }) => {
    // 0044 removed per-seat pricing because no request path can grant a second
    // person a key. A "Priced per seat" line shipped in the Pro description
    // anyway, because tests/pricing-facts.test.ts only guarded the FAQ. The
    // unit test now covers the whole facts module; this asserts the rendered
    // page, which is what a customer actually reads.
    await page.goto('/pricing');
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/seat/i);
  });

  test('pricing page does not scroll sideways on a phone', async ({ page }) => {
    // Five price columns plus a label do not fit 375px, so the comparison
    // table scrolls inside its own box. The whole PAGE scrolling instead
    // means a grid child kept `min-width: auto` and pushed the layout —
    // which is what happened until 2026-11-19.
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/pricing');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('download page renders with the product name', async ({ page }) => {
    const res = await page.goto('/download');
    expect(res?.status()).toBe(200);
    // 8d44c63 replaced the desktop-installer page with a "Zaino Agent CLI —
    // coming soon" note, and this assertion kept looking for the retired
    // "Zaino AI Agent" title, so it failed on every run from then until now.
    await expect(page.getByText(/Zaino Agent CLI/i).first()).toBeVisible();
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
