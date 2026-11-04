/**
 * Sanitising web results — the largest injection surface in the product.
 *
 * A search snippet is text a stranger wrote, and it goes into a prompt.
 * The tests below assert the three properties that keep that safe: only
 * http(s) urls survive (a `javascript:` citation is an XSS vector), bidi
 * and zero-width characters are stripped (they make hostile text render as
 * something else), and nothing is unbounded.
 */
import { describe, expect, it } from 'vitest';

import { clean, normalise, searchQueryFrom, shouldSearch } from '@/lib/chat/web-search';

describe('normalise', () => {
  it('drops non-http urls', () => {
    const out = normalise(
      [
        { title: 'js', url: 'javascript:alert(1)', snippet: 'x' },
        { title: 'data', url: 'data:text/html,<script>', snippet: 'y' },
        { title: 'ok', url: 'https://example.com', snippet: 'z' },
      ],
      5,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.url).toBe('https://example.com');
  });

  it('dedupes by url', () => {
    const out = normalise(
      [
        { title: 'a', url: 'https://example.com/x', snippet: 'one' },
        { title: 'b', url: 'https://example.com/x', snippet: 'two' },
      ],
      5,
    );
    expect(out).toHaveLength(1);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      title: `t${i}`,
      url: `https://example.com/${i}`,
      snippet: 's',
    }));
    expect(normalise(many, 3)).toHaveLength(3);
  });

  it('drops a result with no title and no snippet', () => {
    expect(normalise([{ title: '', url: 'https://example.com', snippet: '' }], 5)).toEqual([]);
  });

  it('caps snippet length', () => {
    const out = normalise(
      [{ title: 't', url: 'https://example.com', snippet: 'x'.repeat(10_000) }],
      5,
    );
    expect(out[0]?.snippet.length).toBeLessThanOrEqual(800);
  });
});

describe('clean', () => {
  it('strips bidi overrides that disguise text', () => {
    // U+202E reverses rendering; it has no legitimate place in a snippet.
    expect(clean('abc\u202edef')).toBe('abcdef');
    expect(clean('a\u200fb')).toBe('ab');
  });

  it('strips zero-width characters that hide payloads', () => {
    expect(clean('ig\u200bnore')).toBe('ignore');
  });

  it('collapses whitespace and control characters', () => {
    expect(clean('a\n\n\tb\u0000c')).toBe('a b c');
  });

  it('keeps ordinary unicode text intact', () => {
    // fr/ar content must survive: this product ships three languages.
    expect(clean('Bonjour, ça va?')).toBe('Bonjour, ça va?');
    expect(clean('مرحبا')).toBe('مرحبا');
  });
});

describe('shouldSearch', () => {
  it('is off unless asked', () => {
    // A search is untrusted text entering the prompt, so it is opt-in.
    expect(shouldSearch('anything', undefined)).toBe(false);
    expect(shouldSearch('anything', false)).toBe(false);
    expect(shouldSearch('anything', true)).toBe(true);
  });
});

describe('searchQueryFrom', () => {
  it('drops leading pleasantries that rank worse', () => {
    expect(searchQueryFrom('please explain rust lifetimes')).toBe('explain rust lifetimes');
    expect(searchQueryFrom('Can you find the docs?')).toBe('find the docs?');
  });

  it('caps a pasted wall of text', () => {
    expect(searchQueryFrom('x'.repeat(1000)).length).toBeLessThanOrEqual(300);
  });
});
