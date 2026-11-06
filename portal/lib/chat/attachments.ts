/**
 * What may be attached to a turn, and how many — the one definition.
 *
 * WHY A MODULE AND NOT A CONSTANT IN THE ROUTE. This policy is enforced in
 * four places that must never disagree: the route that accepts the bytes,
 * the schema that validates the ids, the `<input accept>` the browser
 * offers, and the counter that turns the "+" off. They previously each
 * carried their own copy, which is how a client could offer a `.webp` the
 * server refused, or count to ten against a server that capped at five.
 *
 * THE ENGINE IS THE AUTHORITY ON PARSING, NOT ON POLICY. Rust decides
 * whether a file actually parses (magic bytes, zip internals); this decides
 * what we are willing to hand it. Both must agree, so the list below mirrors
 * `ExtractedKind` in `engine/src/extract.rs` — a format there without an
 * entry here is a format users cannot upload.
 */

/** Extensions the engine can parse, grouped by what it does with them. */
export const ATTACHMENT_TYPES = {
  /** Text layer extracted server-side, then read as text. */
  document: ['pdf', 'docx', 'xlsx', 'xls', 'xlsm', 'ods', 'csv', 'tsv'],
  /** Encoding-agnostic: the engine sniffs UTF-8 and reads it verbatim. */
  text: ['txt', 'md', 'markdown', 'json', 'log', 'yml', 'yaml', 'xml', 'html', 'css', 'js', 'ts'],
  /** Passed as pixels to a vision model. No text extraction applies. */
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
} as const;

/** Every extension, flat. Used by the route's allow-list and the accept attr. */
export const ALLOWED_EXTENSIONS: readonly string[] = Object.values(ATTACHMENT_TYPES).flat();

/**
 * Files per turn.
 *
 * Five, not ten. Every attachment is re-sent as text on EVERY subsequent
 * turn of the conversation, so the cost of a file is paid again on each
 * follow-up: ten 200k-char documents is two million characters of context
 * before the user types anything. Five is what fits a working session
 * without the sixth file silently pushing the first out of the window.
 */
export const MAX_ATTACHMENTS = 5;

/** A human sentence for a refusal, so the route and the UI say the same thing. */
export const ATTACHMENT_TYPES_HINT =
  'PDF, Word, Excel, CSV, text, or an image (PNG, JPEG, WebP, GIF)';

/** Mirrors `MAX_EXTRACTED_CHARS` in the engine; used only to phrase the notice. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

export function isAllowedFile(filename: string): boolean {
  return ALLOWED_EXTENSIONS.includes(extensionOf(filename));
}

/**
 * The `accept` attribute, derived rather than hand-written.
 *
 * Browsers treat `accept` as a filter only — a user can always switch to
 * "All files" — so this is a convenience, never a check. The route is the
 * check. Deriving it here means adding a format above cannot leave the
 * picker still offering the old set.
 */
export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',');
