/**
 * The wordmark on a forced-light surface.
 *
 * THE BUG, seen on the live auth pages: the logo showed only a grey "AI"
 * beside a correct mark — "Zaino" was invisible. Cause:
 *
 *   tone === "light" ? "text-black dark:text-white" : "text-foreground"
 *
 * `tone="light"` means "this surface is white in BOTH themes" (AuthShell,
 * the D17 checkout, the marketing hero). The auth pages render inside
 * `.light-surface`, which re-declares the light CSS VARIABLES with
 * `!important` — but a `dark:` utility is not a variable. It reads
 * `--color-white` and applies whenever <html> has class="dark". So the
 * wordmark went white on white the moment the visitor had ever flipped the
 * dashboard toggle, while the grey "AI" (a token, correctly overridden)
 * stayed visible.
 *
 * Asserted by reading the component, because the failure is only observable
 * in a browser with a persisted dark preference — the light-mode review
 * path shows nothing wrong.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOGO = readFileSync(resolve(__dirname, '../assets/logo/logo.tsx'), 'utf8');

/** Comments explain the bug and contain the offending strings. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('Logo wordmark on tone="light"', () => {
  const code = stripComments(LOGO);

  it('does not pair `dark:` with a forced-light wordmark', () => {
    // The exact expression that shipped the bug.
    expect(code).not.toMatch(/tone === "light"\s*\?\s*"text-black dark:text-white"/);
  });

  it('gives the forced-light case a fixed colour, not a dark: variant', () => {
    const match = /tone === "light"\s*\?\s*"([^"]*)"/.exec(code);
    expect(match, 'the tone="light" class expression is missing').not.toBeNull();
    expect(match![1]).not.toContain('dark:');
    expect(match![1]).toMatch(/text-black/);
  });

  it('keeps the token path for the themed case', () => {
    // Outside a forced-light surface the logo must still follow the theme.
    expect(code).toContain('text-foreground');
  });
});
