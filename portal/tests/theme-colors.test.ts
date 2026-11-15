/**
 * Hardcoded colours that break one theme.
 *
 * THE BUG THIS PREVENTS. `bg-white` on a themed surface is invisible while
 * the theme is light and turns into a white box under near-white text the
 * moment `class="dark"` lands on <html>. It shipped on the sign-in fields,
 * the D17 instruction bubbles and the dashboard billing table, and it is
 * invisible in review because the reviewer's default theme is light.
 *
 * THE RULE, and it is narrow on purpose: inside the AUTHENTICATED app and
 * the interactive payment surfaces, a background must come from a token.
 * Marketing and docs are exempt — those pages are deliberately white in
 * both themes (`.light-surface`, `html.light` force the light token set with
 * `!important`), so `bg-white` there is accurate rather than a bug.
 *
 * Side benefit: this test also catches a `bg-white` added to a NEW auth
 * component, which is where the next one would appear.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'node:fs';

const ROOT = resolve(__dirname, '..');

/**
 * Surfaces that must follow the theme.
 *
 * Explicit list, not a heuristic: a path-based rule ("anything in app/")
 * would swallow the marketing routes, which are legitimately white.
 */
const THEMED_ROOTS = [
  'components/auth/',
  'components/dashboard/',
  'components/d17/',
  'components/chat/',
  'components/admin/',
  'components/settings/',
  'app/(app)/',
  'app/admin/',
  'app/checkout/',
  'app/sign-in/',
  'app/sign-up/',
];

/**
 * `bg-white` with no `dark:` companion in the same class string.
 *
 * A `dark:bg-white` is fine (an element that IS white in dark mode by
 * design); `bg-white dark:bg-muted` is fine (explicit pair). A bare
 * `bg-white` in a themed surface is the bug.
 */
const BARE_WHITE = /(?<!dark:)bg-white(?![\w-])/;

function files(): string[] {
  return THEMED_ROOTS.flatMap((root) => {
    try {
      return globSync(`${root}**/*.tsx`, { cwd: ROOT }).map((f) => `${root}${f.replace(root, '')}`);
    } catch {
      return [];
    }
  });
}

/**
 * Strip comments before matching.
 *
 * Several of these files DOCUMENT the bug (`// bg-white would leave a white
 * box`) and a naive grep flags the explanation as an occurrence — which
 * would push the next person to delete the explanation.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*\{?\/\*[\s\S]*?\*\/\}?$/gm, '');
}

describe('no bare bg-white on a themed surface', () => {
  const list = files();

  it('finds the themed files at all (the glob is not silently empty)', () => {
    // A broken glob would make every assertion below vacuously pass.
    expect(list.length).toBeGreaterThan(10);
    expect(list).toContain('components/auth/auth-fields.tsx');
  });

  it.each(list)('%s uses tokens, not bg-white', (rel) => {
    const source = stripComments(readFileSync(resolve(ROOT, rel), 'utf8'));
    const offenders = source
      .split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => BARE_WHITE.test(line))
      // `file:bg-white` is a file-input pseudo-element; `dark:` is paired.
      .filter(({ line }) => !line.includes('file:bg-white'));

    expect(offenders, `${rel} has bare bg-white at:\n${offenders.map((o) => `  ${o.n}: ${o.line}`).join('\n')}`).toEqual([]);
  });
});

describe('no bare text-black on a themed surface', () => {
  it.each(['app/sign-in/page.tsx', 'app/sign-up/page.tsx'])('%s', (rel) => {
    const source = stripComments(readFileSync(resolve(ROOT, rel), 'utf8'));
    const offenders = source
      .split('\n')
      .filter((line) => /(?<!dark:)text-black(?![\w-])/.test(line));
    expect(offenders).toEqual([]);
  });
});

describe('the autofill override exists', () => {
  it('globals.css neutralises Chrome autofill on the auth surface', () => {
    const css = readFileSync(resolve(ROOT, 'app/globals.css'), 'utf8');
    // Without this, Chrome paints autofilled fields its own blue-grey while
    // every neighbour is white — on the first screen a customer sees.
    expect(css).toContain('input:-webkit-autofill');
    expect(css).toContain('-webkit-text-fill-color');
  });
});
