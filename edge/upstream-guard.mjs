/**
 * Upstream-capability guard.
 *
 * WHY THIS EXISTS. The upstream answers a malformed-but-valid-JSON body with
 * one opaque 400 — `La requête a été rejetée par le modèle.` — and no field
 * name. Some of those rejections are recoverable at the edge without asking
 * the customer to change anything, and one of them is *permanent*:
 *
 *   A `document` block carrying `application/pdf` is refused. Agents (Cowork,
 *   Claude Code) attach a PDF once, and that block is then REPLAYED in every
 *   later turn of the conversation. One PDF poisons the whole session: every
 *   subsequent request 400s, so the client shows "Something went wrong" and
 *   the user cannot continue without abandoning the thread. Verified live
 *   against the upstream, 2026-11-13 (see upstream-guard.test.ts).
 *
 * WHAT IT DOES. Walks the request body and rewrites only the shapes the
 * upstream cannot serve into a text note the model can act on, instead of
 * forwarding a request that is guaranteed to fail. Everything else passes
 * through untouched — this is a narrow capability filter, not a translator.
 *
 * RULES, each verified against the live upstream:
 *
 *   document, source.type=base64, media_type=application/pdf   → refused
 *   document, source.type=base64, any OTHER media_type         → refused
 *   document, source.type=text | content                       → accepted
 *   image,    source.type=base64                               → accepted
 *   image,    source.type=url                                  → refused
 *
 * The walk is RECURSIVE and that is the whole point: the PDF that broke the
 * Cowork session sat inside `tool_result.content[]`, not at the top level of
 * the message. A top-level-only scan silently misses it.
 *
 * A refusal here is better than a 400: the model keeps the conversation and
 * can ask the user for the text, which is what the user wanted anyway.
 */

/** What replaces a block the upstream cannot read. */
export const PDF_NOTE =
  '[PDF attachment removed by the gateway: this model cannot read PDF files. ' +
  'Ask the user to paste the text, or to send the pages as images.]';

export const IMAGE_URL_NOTE =
  '[Image link removed by the gateway: only inline (base64) images reach this model. ' +
  'Ask the user to attach the image file.]';

/**
 * Does this object describe a document block the upstream refuses?
 *
 * Both `base64` and any other source type are refused because the accepted
 * forms (`text`, `content`) carry their payload inline and are the only ones
 * the upstream actually serves — an unknown `source.type` would fail the same
 * way, so it is folded into the same rewrite.
 */
function isUnservableDocument(node) {
  if (node.type !== 'document') return false;
  const source = node.source;
  if (!source || typeof source !== 'object') return false;
  return source.type === 'base64';
}

/** An `image` block whose source is a URL rather than inline bytes. */
function isUnservableImage(node) {
  if (node.type !== 'image') return false;
  const source = node.source;
  if (!source || typeof source !== 'object') return false;
  return source.type === 'url';
}

/**
 * Rewrite one node, descending into arrays and plain objects.
 *
 * Returns a NEW tree; the caller's body is never mutated, so a caller that
 * still needs the original (logging, a retry in another dialect) keeps it.
 */
export function sanitizeUpstreamBody(node) {
  if (Array.isArray(node)) return node.map(sanitizeUpstreamBody);
  if (!node || typeof node !== 'object') return node;

  if (isUnservableDocument(node)) {
    return { type: 'text', text: PDF_NOTE };
  }
  if (isUnservableImage(node)) {
    return { type: 'text', text: IMAGE_URL_NOTE };
  }

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = sanitizeUpstreamBody(value);
  }
  return out;
}

/**
 * `sanitizeUpstreamBody` plus a report of whether anything changed.
 *
 * The callers only need to know "did I have to rewrite this?" so they can log
 * it once per request; computing that from a whole-tree deep-equal would cost
 * more than the walk itself.
 */
export function sanitizeRequest(node) {
  let changed = false;

  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;

    if (isUnservableDocument(value) || isUnservableImage(value)) {
      changed = true;
      return isUnservableDocument(value)
        ? { type: 'text', text: PDF_NOTE }
        : { type: 'text', text: IMAGE_URL_NOTE };
    }

    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = walk(item);
    return out;
  };

  const body = walk(node);
  return { body, changed };
}
