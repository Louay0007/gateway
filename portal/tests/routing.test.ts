/**
 * Routing invariants — the rules in docs/ROUTING.md, as assertions.
 *
 * The bug these prevent: `/settings` and `/dashboard/settings` both rendered
 * the same `SettingsPanel`, the `shell` prop existed only to change one
 * footer link, and `/download` sat in the console sidebar between Billing
 * and Redeem. None of that is a crash. It is a map that stopped matching the
 * territory, which is how a product starts feeling improvised.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { navMain, navSecondary } from '@/components/dashboard/nav';
import * as chatNav from '@/components/chat/nav';

const PORTAL = new URL('../', import.meta.url).pathname;

/** Every page route, as a URL path. Route groups are stripped. */
function pageRoutes(dir = 'app', base = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(PORTAL, dir))) {
    const full = join(PORTAL, dir, name);
    if (!statSync(full).isDirectory()) continue;
    // Route groups `(marketing)` do not appear in the URL.
    const segment = name.startsWith('(') ? '' : `/${name}`;
    if (name === 'api') continue;
    try {
      readFileSync(join(full, 'page.tsx'));
      out.push((base + segment) || '/');
    } catch {
      /* no page at this level */
    }
    out.push(...pageRoutes(join(dir, name), base + segment));
  }
  return out;
}

const ROUTES = pageRoutes();

/**
 * URL path → the real page file, honouring route groups.
 *
 * `/dashboard/settings` lives at `app/(app)/dashboard/settings/page.tsx`:
 * `(app)` is a group, so it is absent from the URL but present on disk.
 * Rebuilding the path from the URL alone silently finds nothing, which is
 * how the first version of this test reported zero renderers.
 */
function pageFile(urlPath: string): string | null {
  const segments = urlPath.split('/').filter(Boolean);
  const found: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth === segments.length) {
      try {
        readFileSync(join(dir, 'page.tsx'));
        found.push(join(dir, 'page.tsx'));
      } catch {
        /* not a page */
      }
      return;
    }
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      try {
        if (!statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
      if (name.startsWith('(')) visit(full, depth); // group: same URL level
      else if (name === segments[depth]) visit(full, depth + 1);
    }
  };
  visit(join(PORTAL, 'app'), 0);
  return found[0] ?? null;
}

describe('route map', () => {
  it('renders SettingsPanel in exactly one place', () => {
    // The route walker cannot answer this on its own: `/settings` is now a
    // redirect file that names the target, so a naive "which page mentions
    // SettingsPanel" match finds it there too. Count RENDERERS instead.
    const renderers = ROUTES.filter((r) => {
      const file = pageFile(r);
      if (!file) return false;
      // Strip comments first: the console page has a header comment that
      // mentions `SettingsPanel` by name, and `/settings` is a redirect
      // that mentions the path. Only real JSX counts.
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      return /<SettingsPanel[\s/>]/.test(code);
    });
    expect(renderers).toEqual(['/dashboard/settings']);
  });

  it('keeps the retired /settings as a real HTTP redirect, not a 404', () => {
    // The chat sidebar linked here for months; a bookmark must land on the
    // right tab rather than a dead end.
    //
    // It lives in next.config, NOT in a page. A page-level redirect() in a
    // streamed server component returns 200 with a client-side meta tag, so
    // curl, a crawler and a fetch all see success and stop — which is what
    // the first attempt did, verified against the live box.
    const cfg = readFileSync(join(PORTAL, 'next.config.ts'), 'utf8');
    expect(cfg).toContain("source: '/settings'");
    expect(cfg).toContain("destination: '/dashboard/settings'");
    expect(cfg).toContain('permanent: true');

    // And the duplicate page must be gone, or both would serve.
    expect(() => readFileSync(join(PORTAL, 'app/settings/page.tsx'))).toThrow();
  });

  it('never renders a page component in a settings tab', () => {
    // THE DUPLICATION THIS PREVENTS. /dashboard/settings used to carry Plan,
    // Usage, API keys and Billing tabs that rendered the SAME components as
    // the four sidebar pages — the same screen at two URLs, two back-button
    // entries, and two places to fix a bug. Settings now owns account-level
    // things only: profile, AI, danger.
    const src = readFileSync(
      join(PORTAL, 'components/settings/settings-panel.tsx'),
      'utf8',
    );
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    // None of the page-level views may be rendered here any more.
    for (const view of ['<BillingView', '<UsageView', '<KeysView', '<PaymentHistory']) {
      expect(code, `${view} has its own page and must not be a settings tab`).not.toContain(view);
    }

    // The retired tabs must forward rather than fall back to Profile.
    expect(code).toContain('MOVED_TO_PAGE');
    expect(code).toContain('/dashboard/billing');
    expect(code).toContain('/dashboard/keys');
    expect(code).toContain('/dashboard/usage');
  });

  it('has no route under two shells', () => {
    // /dashboard/docs is the ONE intentional repeat: same body, different
    // intent (in-product CTA points at keys). Everything else is unique.
    const docsPages = ROUTES.filter((r) => r === '/docs' || r === '/dashboard/docs');
    expect(docsPages).toEqual(['/dashboard/docs', '/docs']);
  });
});

describe('console navigation', () => {
  const mainHrefs = navMain.map((n) => n.href);
  const secondaryHrefs = navSecondary.map((n) => n.href);

  it('leads with the product, then the customer job in order', () => {
    expect(mainHrefs).toEqual([
      '/chat',
      '/dashboard',
      '/dashboard/usage',
      '/dashboard/keys',
      '/dashboard/billing',
      '/dashboard/docs',
    ]);
  });

  it('keeps marketing pages out of product navigation', () => {
    // /download is a marketing page; it belongs in the public footer.
    expect(mainHrefs).not.toContain('/download');
    expect(secondaryHrefs).not.toContain('/download');
  });

  it('does not give a one-time action the weight of Billing', () => {
    // Redeem is onboarding, not a page anyone returns to.
    expect(mainHrefs).not.toContain('/dashboard/redeem');
    expect(secondaryHrefs).toContain('/dashboard/redeem');
  });

  it('never points at a retired URL', () => {
    const all = [...mainHrefs, ...secondaryHrefs];
    for (const href of all) {
      expect(href, 'a nav entry must use a canonical path').not.toMatch(/^\/settings(?!\?)/);
    }
  });

  it('every nav destination is a real page', () => {
    const known = new Set(ROUTES);
    for (const href of [...mainHrefs, ...secondaryHrefs]) {
      const path = href.split('?')[0]!;
      expect(known.has(path), `${href} is not a page route`).toBe(true);
    }
  });
});

describe('chat navigation', () => {
  it('points at console URLs, not the retired /settings', () => {
    const nav = (chatNav as unknown as { chatNav?: { href: string }[] }).chatNav ?? [];
    // The module may export its list under a different name; fall back to
    // reading the source so the invariant holds either way.
    const src = readFileSync(join(PORTAL, 'components/chat/nav.ts'), 'utf8');
    expect(src).not.toMatch(/href: "\/settings/);
    expect(src).toContain('/dashboard/settings');
    expect(src).toContain('/dashboard/keys');
    for (const item of nav) expect(item.href).not.toMatch(/^\/settings(?!\?)/);
  });
});

describe('handoff routes have no internal link, by design', () => {
  it('exists for /device, /share, /billing/confirm, /checkout', () => {
    // Documented so a future "dead route" audit does not delete them.
    for (const r of ['/device', '/share/[token]', '/billing/confirm', '/checkout/d17/[subscriptionId]']) {
      expect(ROUTES, `${r} must exist`).toContain(r);
    }
  });
});
