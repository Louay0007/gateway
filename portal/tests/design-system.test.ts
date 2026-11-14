/**
 * Design-system acceptance — the three counts the plan set as "done".
 *
 * These are the tests that make Phase 4 a durable state rather than a
 * one-off sweep. Without them the next component added with
 * `text-gray-600 dark:text-gray-400` silently reopens the problem, and
 * nobody notices until a theme bug ships.
 *
 * The numbers are deliberately ceilings, not zero, where zero would be
 * wrong: `dark:` still appears legitimately for structural overrides
 * (a shadow, a border on one side), and forcing those to zero would push a
 * developer to the wrong abstraction.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PORTAL = new URL('../', import.meta.url).pathname;
const SCOPES = ['components', 'app'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.tsx') || name.endsWith('.css')) out.push(full);
  }
  return out;
}

const files = SCOPES.flatMap((s) => walk(join(PORTAL, s)));
const source = files
  .map((f) => ({ path: f, text: readFileSync(f, 'utf8') }))
  .filter((f) => !f.path.includes('/components/ui/')); // primitives own their palette

describe('design system — semantic tokens', () => {
  it('no component hard-codes a gray/zinc palette class', () => {
    // `gray-*` and `zinc-*` are the same neutral ramp; both must come from
    // --foreground / --muted-foreground / --border.
    const offenders: string[] = [];
    for (const { path, text } of source) {
      const hits = text.match(/(?:bg|text|border|ring|from|to|via)-(?:gray|zinc|neutral|slate|stone)-\d{2,3}/g);
      if (hits) offenders.push(`${path.replace(PORTAL, '')}: ${hits.slice(0, 3).join(', ')}`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('declares the status tokens in both themes', () => {
    const css = readFileSync(join(PORTAL, 'app/globals.css'), 'utf8');
    for (const token of ['--warning', '--warning-foreground', '--success', '--success-foreground']) {
      // Light (:root) plus dark (.dark) = two declarations each.
      const count = (css.match(new RegExp(`${token}:`, 'g')) ?? []).length;
      expect(count, `${token} declared ${count} time(s)`).toBeGreaterThanOrEqual(2);
    }
  });

  it('maps the status tokens to Tailwind utilities', () => {
    const css = readFileSync(join(PORTAL, 'app/globals.css'), 'utf8');
    for (const util of ['--color-warning', '--color-success']) {
      expect(css).toContain(util);
    }
  });

  it('keeps hand-written dark: variants under the agreed ceiling', () => {
    // 469 before Phase 4; tokens removed the colour ones. What is left is
    // structural. A jump past the ceiling means a component bypassed the
    // token layer again.
    let total = 0;
    for (const { text } of source) {
      total += (text.match(/dark:/g) ?? []).length;
    }
    expect(total).toBeLessThan(100);
  });

  it('routes status colour through the semantic tokens, not the palette', () => {
    const offenders: string[] = [];
    for (const { path, text } of source) {
      // globals.css NAMES the palette in the comments that introduce the
      // tokens ("the amber already used by hand in bg-amber-500"). That is
      // the documentation of the migration, not a usage of it.
      if (path.endsWith('globals.css')) continue;
      const hits = text.match(/(?:bg|text|border)-(?:emerald|amber|orange|green|red)-\d{2,3}/g);
      if (hits) offenders.push(`${path.replace(PORTAL, '')}: ${hits.slice(0, 3).join(', ')}`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

describe('design system — shared primitives', () => {
  it('ships one EmptyState and one PageHeader', () => {
    expect(() => readFileSync(join(PORTAL, 'components/ui/empty-state.tsx'))).not.toThrow();
    expect(() => readFileSync(join(PORTAL, 'components/ui/page-header.tsx'))).not.toThrow();
  });

  it('has exactly one marketing footer', () => {
    // The second implementation was deleted in Phase 0; re-adding it is how
    // two footers with different Pricing targets happened the first time.
    expect(() => readFileSync(join(PORTAL, 'components/marketing/footer.tsx'))).toThrow();
    expect(() => readFileSync(join(PORTAL, 'components/marketing/zaino-footer.tsx'))).not.toThrow();
  });

  it('has no raw <button> outside the three cases that require one', () => {
    // THE PLAN'S TARGET WAS ZERO. It is three, and each is a native
    // requirement rather than an oversight:
    //
    //   1. components/dashboard/app-sidebar.tsx — a DropdownMenuTrigger
    //      `render` slot. Base UI composes its own props onto the element it
    //      is handed, so it must be a real <button>.
    //   2. components/chat/chat-sidebar.tsx — the same trigger slot.
    //   3. app/admin/page.tsx — the access-code gate is static HTML with
    //      inline CSS and a raw <script>; it never mounts React.
    //
    // Everything else was converted, including the five that looked
    // structural (conversation rows, project rows, search hits, suggestion
    // chips, tier pickers) — Button handles them with variant + size instead
    // of a bespoke class string. A new bare <button> fails here and the
    // author has to say why.
    const names = source
      .filter((f) => f.text.includes('<button'))
      .map((f) => f.path.replace(PORTAL, ''))
      .sort();
    expect(names).toEqual([
      'app/admin/page.tsx',
      'components/chat/chat-sidebar.tsx',
      'components/dashboard/app-sidebar.tsx',
    ]);
  });
;
});
