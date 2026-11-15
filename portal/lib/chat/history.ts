/**
 * Shaping the stored transcript into what the model reads.
 *
 * PURE, and separated from `service.ts` on purpose: the query needs a
 * database, and the RULE that decides whether a past image is replayed must
 * be testable without one. That rule shipped broken once — `historyForModel`
 * selected only `role, content`, so an image reached the model on the turn it
 * was attached and vanished from the history on the very next follow-up.
 *
 * The rule in one sentence: a user turn replays as content PARTS when it
 * carries sendable image bytes, and as a plain string otherwise.
 */
import { imageMediaTypeFor, MAX_INLINE_IMAGE_BYTES, type ContentPart } from './vision';
import type { ImageMediaType } from './attachments';
import type { WireMessage } from './gateway';

/** One row as the history query returns it. */
export interface HistoryRow {
  role: 'user' | 'assistant';
  content: string;
  /** Base64 image payloads linked to this turn, in attachment order. */
  images: { filename: string; media_type: string; data: string }[];
}

/**
 * The media type, when the filename has no usable extension.
 *
 * `attachments.mime_type` is the BROWSER's claim, which the upload route
 * already ignores for its own decisions — so this is a fallback only,
 * narrowed to the four types an Anthropic image block accepts. Anything else
 * is indeterminate rather than guessed: a wrong media type is a 400 at send
 * time that names no field.
 */
function normaliseMediaType(raw: string): ImageMediaType | null {
  const t = raw.trim().toLowerCase();
  return t === 'image/png' || t === 'image/jpeg' || t === 'image/webp' || t === 'image/gif'
    ? t
    : null;
}

export function buildHistoryMessages(rows: HistoryRow[]): WireMessage[] {
  const out: WireMessage[] = [];

  for (const row of rows) {
    // Only the user sends pictures. An assistant row carrying a join is a
    // data bug, not a turn to replay.
    if (row.role !== 'user' || !Array.isArray(row.images) || row.images.length === 0) {
      // An empty assistant row is normal (created streaming, then finished
      // by finishMessage). It teaches the model nothing and costs a turn of
      // window, so it stays out.
      if (row.role === 'assistant' && row.content.length === 0) continue;
      out.push({ role: row.role, content: row.content });
      continue;
    }

    // Text first, then pictures — the order `toContentParts` produces, so a
    // replayed turn is shaped identically to the live one.
    const parts: ContentPart[] = [];
    if (row.content.trim().length > 0) parts.push({ type: 'text', text: row.content });

    for (const img of row.images) {
      const media = imageMediaTypeFor(img.filename) ?? normaliseMediaType(img.media_type);
      // Drop an image the wire cannot carry rather than failing the turn:
      // the rest of the conversation is still answerable.
      if (!media) continue;
      // Base64 inflates by a third, so the cap is compared on the ENCODED
      // length. Over the ceiling the upstream would downscale anyway.
      if (img.data.length > MAX_INLINE_IMAGE_BYTES * 1.4) continue;
      if (img.data.length === 0) continue;
      parts.push({ type: 'image', source: { type: 'base64', media_type: media, data: img.data } });
    }

    // No usable image survived: fall back to the plain string, so a
    // conversation never silently changes body shape for nothing.
    out.push(parts.length > 1 || (parts.length === 1 && parts[0]!.type === 'image')
      ? { role: 'user', content: parts }
      : { role: 'user', content: row.content });
  }

  return out;
}
