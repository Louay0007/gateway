/**
 * The preview sandbox and CSP — plan §8 items 7–9, and §11's rules.
 *
 * This is the file that stands between model-authored JavaScript and a
 * customer's session. Every assertion here is a control, not a preference:
 *
 *   - `allow-same-origin` absent  → the frame is an opaque origin
 *   - `connect-src 'none'`        → it cannot exfiltrate what it reads
 *   - `form-action 'none'`        → a drawn form cannot submit
 *   - `base-uri 'none'`           → no injected <base> retargets links
 *   - the meta precedes resources → or the CSP is not honoured at all
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PREVIEW_CSP,
  PREVIEW_SANDBOX,
  isTooLarge,
  previewTitle,
  srcdocFor,
  standaloneDocument,
} from '@/lib/chat/preview-template';

const COMPONENT = resolve(__dirname, '../components/chat/preview-frame.tsx');

describe('§4.1 the sandbox attribute', () => {
  it('never grants allow-same-origin', () => {
    // MDN: with allow-scripts, allow-same-origin lets the embedded document
    // REMOVE the sandbox attribute — "no more secure than not using the
    // sandbox attribute at all". This is the one word that must never be
    // added, so it is asserted on the constant.
    expect(PREVIEW_SANDBOX).not.toContain('allow-same-origin');
  });

  it('grants allow-scripts, so a preview can be interactive', () => {
    expect(PREVIEW_SANDBOX).toContain('allow-scripts');
  });

  it('does not grant top-level navigation or popups', () => {
    // A popup escapes the sandbox flags of its opener; top navigation
    // would let a preview replace the app the user is signed into.
    expect(PREVIEW_SANDBOX).not.toContain('allow-top-navigation');
    expect(PREVIEW_SANDBOX).not.toContain('allow-popups');
  });

  it('is only ever built from this constant — the component has no inline sandbox', () => {
    // A second literal is a second place to regress.
    const source = readFileSync(COMPONENT, 'utf8');
    const literals = source.match(/sandbox=["'`]([^"'`]*)["'`]/g) ?? [];
    for (const lit of literals) {
      expect(lit, `inline sandbox literal found: ${lit}`).toContain('{PREVIEW_SANDBOX}');
    }
    expect(source).not.toMatch(/sandbox="allow/);
  });
});

describe('§4.3 the Content-Security-Policy', () => {
  it("opens with default-src 'none'", () => {
    expect(PREVIEW_CSP).toContain("default-src 'none'");
  });

  it("closes connect-src — nothing can be exfiltrated", () => {
    // The load-bearing line. Without it a preview reads what it can and
    // posts it to a server it controls; the opaque origin does not stop a
    // network request, only access to our storage.
    expect(PREVIEW_CSP).toContain("connect-src 'none'");
  });

  it("forbids form submission and injected <base>", () => {
    expect(PREVIEW_CSP).toContain("form-action 'none'");
    expect(PREVIEW_CSP).toContain("base-uri 'none'");
  });

  it('allows inline styles and inline scripts, which is what a model writes', () => {
    expect(PREVIEW_CSP).toContain("style-src 'unsafe-inline'");
    expect(PREVIEW_CSP).toContain("script-src 'unsafe-inline'");
  });

  it('restricts every other directive by default', () => {
    // Anything not named falls back to default-src 'none', so a directive
    // added later is denied rather than silently allowed.
    expect(PREVIEW_CSP.startsWith("default-src 'none'")).toBe(true);
  });

  it('ends with a semicolon so concatenation cannot merge directives', () => {
    expect(PREVIEW_CSP.trimEnd().endsWith(';')).toBe(true);
  });
});

describe('srcdocFor — the CSP actually reaches the document', () => {
  it('wraps a bare fragment in a standards-mode document', () => {
    const doc = srcdocFor('<p>hi</p>');
    expect(doc).toContain('<!DOCTYPE html>');
    expect(doc).toContain('<p>hi</p>');
    expect(doc).toContain('Content-Security-Policy');
  });

  it('inserts the meta AFTER <head> — the only position a meta CSP applies', () => {
    const doc = srcdocFor('<!DOCTYPE html><html><head><title>x</title></head><body>hi</body></html>');
    const headAt = doc.toLowerCase().indexOf('<head>');
    const metaAt = doc.indexOf('Content-Security-Policy');
    const titleAt = doc.indexOf('<title>');
    expect(metaAt).toBeGreaterThan(headAt);
    // And BEFORE the first resource the CSP governs.
    expect(metaAt).toBeLessThan(titleAt);
  });

  it('synthesises a <head> for an <html> without one', () => {
    const doc = srcdocFor('<html><body>hi</body></html>');
    expect(doc).toContain('<head>');
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<body>'));
  });

  it('preserves the model document byte for byte around the meta', () => {
    // The preview IS the model's document; inserting the meta must not
    // otherwise alter it, or a layout renders differently in the panel than
    // in a tab.
    const original = '<!DOCTYPE html><html><head></head><body><p id="x">hi</p></body></html>';
    const doc = srcdocFor(original);
    const stripped = doc.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
    expect(stripped).toBe(original);
  });

  it('never injects a <base> element', () => {
    // A <base href="https://evil.example/"> would retarget every relative
    // link in the preview. base-uri 'none' forbids one, and we never add one.
    expect(srcdocFor('<p>x</p>')).not.toContain('<base');
  });

  it('is idempotent enough to survive being called twice', () => {
    const once = srcdocFor('<p>x</p>');
    const twice = srcdocFor(once);
    // A second pass must not lose the CSP, even if it duplicates the meta.
    expect(twice).toContain('Content-Security-Policy');
  });
});

describe('standaloneDocument — the new-tab path', () => {
  it('carries the same CSP as the panel', () => {
    // MDN: sandboxing is useless if the content can be displayed outside a
    // sandboxed iframe. A tab cannot carry the sandbox attribute, so the
    // CSP is the only control that survives — it must not be forgotten.
    expect(standaloneDocument('<p>x</p>')).toContain('Content-Security-Policy');
    expect(standaloneDocument('<p>x</p>')).toContain("connect-src 'none'");
  });

  it('is built by the same function, so the two cannot diverge', () => {
    const html = '<!DOCTYPE html><html><head></head><body>x</body></html>';
    expect(standaloneDocument(html)).toBe(srcdocFor(html));
  });
});

describe('size ceiling', () => {
  it('refuses a block over 512 KB', () => {
    expect(isTooLarge('x'.repeat(512 * 1024))).toBe(false);
    expect(isTooLarge('x'.repeat(512 * 1024 + 1))).toBe(true);
  });

  it('accepts a custom ceiling', () => {
    expect(isTooLarge('xxxx', 3)).toBe(true);
    expect(isTooLarge('xxx', 3)).toBe(false);
  });
});

describe('previewTitle', () => {
  it('escapes, because a filename is content the model influenced', () => {
    expect(previewTitle('<img onerror=alert(1)>.html')).toBe(
      'Preview of &lt;img onerror=alert(1)&gt;.html',
    );
  });

  it('produces a non-empty accessible name', () => {
    // Plan §11 rule 7: the frame is real content, so it needs a title, and
    // aria-hidden must NOT be used.
    expect(previewTitle('index.html')).toBe('Preview of index.html');
  });
});
