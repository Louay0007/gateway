/**
 * D17 checkout — the transfer values must be legible.
 *
 * THE BUG THIS PREVENTS, seen in a customer screenshot. The amount and the
 * receiver number carried `text-success-foreground text-success` — two
 * contradictory colour classes on one element. Both are real utilities, so it
 * compiled; and `--success-foreground` is `oklch(0.99 0 0)`, near-white,
 * while the element sat on `bg-card` = `oklch(1 0 0)`, pure white in the
 * light theme. Measured: **1.03:1**.
 *
 * Which of the two won depended on the ORDER Tailwind emits them in the built
 * stylesheet (`.text-success-foreground` came later, so it won) — i.e. the
 * single most important value on the page, the number a customer has to
 * retype into a banking app, was invisible because of a bundle-ordering
 * accident. Nothing in review would catch it: reviewers use dark mode, where
 * white on `#171717` happens to read fine.
 *
 * The fix set the value to ink and moved the success semantic to the border
 * and the label tick. These assertions pin that shape.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

const D17_SOURCES = [
  'components/d17/d17-instructions.tsx',
  'components/d17/d17-proof-form.tsx',
  'components/d17/d17-status-card.tsx',
  'components/d17/copy-button.tsx',
  'app/checkout/d17/[subscriptionId]/page.tsx',
];

const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

/** Comments quote the offending strings; only code counts. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Every `text-<colour-token>` in a class string.
 *
 * Narrow on purpose: `text-sm|lg|xl|base|[13px]|balance|center|…` are size or
 * behaviour, not colour. Matches are the COLOUR tokens only.
 */
const TEXT_COLOUR =
  /\btext-(foreground|background|card|card-foreground|popover-foreground|primary|primary-foreground|secondary-foreground|muted-foreground|accent-foreground|destructive|destructive-foreground|success|success-foreground|warning|warning-foreground|white|black|inherit|transparent|current)\b/g;

/**
 * Every quoted class string in the file, with `${…}` expressions reduced to
 * EACH of their branches separately, because a ternary applies exactly one.
 *
 *   `${active ? "text-foreground" : "text-muted-foreground"}`
 *     → ["", "text-foreground", "text-muted-foreground"]
 *
 * That is the distinction the original bug violates: `text-success-foreground
 * text-success` are both applied, simultaneously, always.
 */
function classSegments(source: string): string[] {
  const out: string[] = [];

  /*
   * Backtick and double-quoted strings are scanned as ONE LEXER PASS with
   * separate alternatives, in source order.
   *
   * The obvious `"…"|`…`` regex is wrong here: a template literal contains
   * double-quoted strings in its interpolations, so the double-quote
   * alternative matches first and swallows the head of the template — which
   * is exactly how the original defect slipped past this test.
   */
  const STRING = /`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"/g;
  for (const m of source.matchAll(STRING)) {
    const raw = m[0].slice(1, -1);
    if (!m[0].startsWith('`')) {
      out.push(raw);
      continue;
    }
    // A template: keep the literal text, then each interpolation branch on its
    // own, because a ternary applies exactly one branch per render.
    out.push(raw.replace(/\$\{[^}]*\}/g, ' '));
    for (const e of raw.matchAll(/\$\{([^}]*)\}/g)) {
      for (const alt of e[1]!.split(/\?|:/)) {
        const quoted = [...alt.matchAll(/"([^"]*)"/g)].map((x) => x[1]!);
        if (quoted.length) out.push(quoted.join(' '));
      }
    }
  }
  return out;
}

describe('no element carries two disagreeing text colours', () => {
  it.each(D17_SOURCES)('%s', (rel) => {
    const code = stripComments(read(rel));
    const offenders: string[] = [];

    for (const segment of classSegments(code)) {
      const tokens = segment
        .split(/\s+/)
        .filter((t) => !/^(dark|hover|focus|focus-visible|group-hover|group-aria|aria-|data-\[|file:|placeholder:)/.test(t));
      const colours = new Set([...tokens.join(' ').matchAll(TEXT_COLOUR)].map((m) => m[1]!));
      if (colours.size > 1) {
        offenders.push(`${segment.trim().slice(0, 80)}  →  ${[...colours].join(' + ')}`);
      }
    }

    expect(
      offenders,
      `${rel} sets more than one text colour on one element. Only the last one Tailwind emits wins, and which that is depends on bundle order:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

describe('success-foreground is only used on a success fill', () => {
  it.each(D17_SOURCES)('%s', (rel) => {
    const code = stripComments(read(rel));
    const offenders: string[] = [];

    for (const segment of classSegments(code)) {
      if (!segment.includes('text-success-foreground')) continue;
      // The one legitimate pair: ink on a solid `bg-success` disc (not a tint).
      if (/bg-success(?![\w/-])/.test(segment)) continue;
      offenders.push(segment.trim().slice(0, 90));
    }

    expect(
      offenders,
      `${rel} puts text-success-foreground on a non-success surface (near-white on white):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

describe('the transfer value keeps its size and selectability', () => {
  it('sets the amount and the number at a size a customer can read off', () => {
    const src = read('components/d17/d17-instructions.tsx');
    expect(src).toContain('text-lg');
    expect(src).toContain('select-all');
  });

  it('keeps a copy control beside each value', () => {
    // A typo in either value produces a transfer nobody can match to a
    // payment — the single most common D17 failure mode.
    expect(read('components/d17/d17-instructions.tsx')).toContain('CopyButton');
  });
});
