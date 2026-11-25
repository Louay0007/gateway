/**
 * Astryx must stay additive: it may add components, never repaint the app.
 *
 * WHY THIS TEST EXISTS. Astryx sets 268 tokens on `:root`, and four of them
 * share a name with ours (`--color-accent`, `--color-border`,
 * `--color-success`, `--color-warning`). The integration is only safe because
 * those are `@theme inline` aliases here, so our utilities compile to
 * `var(--border)` and friends instead of `var(--color-border)`. Verified in
 * the built CSS rather than assumed — and asserted below so a future token
 * rename cannot quietly hand our palette to another library.
 *
 * The second half is the cascade-layer rule. `@layer` orders only the names a
 * page has not seen yet, so a layer statement placed BELOW
 * `@import "tailwindcss"` inverts the cascade: the Astryx reset would outrank
 * every utility in the app and strip the borders and padding on controls.
 * Nothing reports it — the build and the console stay clean and the line still
 * looks right in the source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const rawCss = readFileSync(resolve(ROOT, 'app/globals.css'), 'utf8');

/**
 * Comments are stripped before ordering anything.
 *
 * The header explains the layer rule in prose and quotes both statements, so a
 * raw `indexOf` finds the mention in the comment first and reports an inverted
 * order that does not exist. Same trap `marketing-theme.test.ts` documents for
 * a `}` inside a comment.
 */
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

/** Position of the first match, or -1. */
const at = (needle: string) => css.indexOf(needle);

describe('cascade layer order', () => {
  it('declares every layer BEFORE the Tailwind import', () => {
    const layer = at('@layer reset, theme, base, astryx-base, astryx-theme, components, utilities;');
    const tailwind = at('@import "tailwindcss"');
    expect(layer, 'the @layer statement exists').toBeGreaterThan(-1);
    expect(tailwind, 'the Tailwind import exists').toBeGreaterThan(-1);
    expect(
      layer,
      'the @layer line must come first: below the Tailwind import it can only append astryx layers after utilities, which inverts the cascade',
    ).toBeLessThan(tailwind);
  });

  it('is the very first rule in the file, above every @import', () => {
    const firstImport = css.search(/@import/m);
    const layer = at('@layer reset, theme, base');
    expect(layer).toBeGreaterThan(-1);
    expect(firstImport).toBeGreaterThan(-1);
    expect(layer).toBeLessThan(firstImport);
    // Nothing but whitespace may precede it.
    expect(css.slice(0, layer).trim()).toBe('');
  });
});

describe('Astryx stylesheets', () => {
  it('imports the reset, the system CSS and a theme', () => {
    for (const sheet of [
      '@astryxdesign/core/reset.css',
      '@astryxdesign/core/astryx.css',
      '@astryxdesign/theme-neutral/theme.css',
    ]) {
      expect(css, `${sheet} is imported`).toContain(sheet);
    }
  });

  it('does NOT import the Tailwind bridge', () => {
    // tailwind-theme.css remaps Tailwind theme names (rounded-lg, shadow-md,
    // text-primary) onto Astryx tokens. This app already uses those names
    // through its own @theme inline, so the bridge would change what our
    // existing classes paint.
    expect(css).not.toContain('@astryxdesign/core/tailwind-theme.css');
  });

  it('imports Astryx sheets AFTER Tailwind, so utilities stay last', () => {
    const tailwind = at('@import "tailwindcss"');
    const astryx = at('@import "@astryxdesign/core/astryx.css"');
    expect(astryx).toBeGreaterThan(tailwind);
  });
});

describe('token safety', () => {
  it('keeps our @theme inline aliases, which is what shields the palette', () => {
    // The aliases are the mechanism: without `inline`, Tailwind would emit
    // --color-border into :root where Astryx overwrites it.
    expect(css).toMatch(/@theme\s+inline\s*\{/);
    expect(css).toContain('--color-border: var(--border)');
    expect(css).toContain('--color-warning: var(--warning)');
    expect(css).toContain('--color-success: var(--success)');
  });

  it('keeps the app @theme block marked inline', () => {
    // If this ever becomes a plain `@theme`, Astryx's :root values win and
    // the app repaints. There is no build error for that.
    const block = css.slice(at('@theme inline'), at('@theme inline') + 40);
    expect(block.startsWith('@theme inline')).toBe(true);
  });
});

describe('package wiring', () => {
  it('lists the Astryx packages as dependencies', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    for (const dep of [
      '@astryxdesign/core',
      '@astryxdesign/theme-neutral',
      '@astryxdesign/cli',
      '@stylexjs/stylex',
    ]) {
      expect(pkg.dependencies?.[dep], `${dep} is a dependency`).toBeTruthy();
    }
  });

  it('generates the theme module the docs describe', () => {
    const mod = readFileSync(resolve(ROOT, 'astryx-themes.ts'), 'utf8');
    expect(mod).toContain('export const themes');
    expect(mod).toContain('defaultThemeSlug');
    expect(mod).toContain('neutral');
  });

  it('ships an agent cheat sheet so the conventions are discoverable', () => {
    expect(existsSync(resolve(ROOT, 'AGENTS.md'))).toBe(true);
    const agents = readFileSync(resolve(ROOT, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('ASTRYX:START');
  });
});
