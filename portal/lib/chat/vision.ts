/**
 * Turning stored image bytes into something the model can see.
 *
 * WHY THIS EXISTS AT ALL. Until 0034 an attachment was text or nothing:
 * the engine returns an empty string for an image, the upload route threw
 * the bytes away, and `buildUserTurn` silently skipped the file. An image
 * reached the model as a filename, which reads as a model that ignored the
 * picture. The whole chain had to change for the pixels to arrive:
 *
 *   upload → store bytes → build an image content part → a wire format that
 *   carries it → an SSE parser that understands the reply.
 *
 * WHAT THE GATEWAY ACTUALLY ACCEPTS. Measured against the live upstream:
 * `/v1/chat/completions` accepts an `image_url` part, returns 200, and
 * answers "Blue" about a solid red image — the images are stripped
 * somewhere between the edge and the model. `/v1/messages` and
 * `/v1/responses` both read pixels correctly (red → "Red", green →
 * "Green"). Vision is therefore reachable only by speaking Anthropic's
 * wire format, which is why this module emits Anthropic image blocks and
 * `buildUserTurn` emits Anthropic content blocks.
 *
 * WHY A SIZE CEILING. Every image is re-sent as base64 on every later turn
 * that has history, and base64 inflates by a third. A 20MB photo would be
 * billed on every turn of the conversation, so an image too large to be
 * worth that is refused at upload rather than silently making every
 * subsequent answer more expensive.
 */

import type { ImageMediaType } from './attachments';

/**
 * The largest image we will send inline, before base64.
 *
 * 5MB is roughly a 12-megapixel JPEG — above that the upstream downscales
 * anyway, so paying for the extra bytes buys no accuracy.
 */
export const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

/** The media types an Anthropic image block accepts. */
const MEDIA_TYPES: Record<string, ImageMediaType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

/**
 * The media type for a filename, or null when this is not an image we can
 * send.
 *
 * Derived from the EXTENSION, not from the browser-supplied MIME: the
 * upload route already trusts the extension for its allow-list, and a
 * browser that sends `application/octet-stream` for a `.png` would
 * otherwise make a perfectly good image unsendable.
 */
export function imageMediaTypeFor(filename: string): ImageMediaType | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MEDIA_TYPES[ext] ?? null;
}

/** An Anthropic image block. The only shape the upstream actually reads. */
export interface ImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: ImageMediaType; data: string };
}

/**
 * The image block for stored bytes, or null when this file cannot be sent
 * as pixels.
 *
 * Returns null rather than throwing: a caller is a prompt builder that
 * must always produce a turn, and an image it cannot send is a fact to
 * report in the prompt (see `buildUserTurn`), not an exception that costs
 * the user their whole message.
 */
export function imageBlockFor(
  filename: string,
  bytes: Uint8Array | null,
): ImageBlock | null {
  if (!bytes || bytes.byteLength === 0) return null;
  if (bytes.byteLength > MAX_INLINE_IMAGE_BYTES) return null;
  const mediaType = imageMediaTypeFor(filename);
  if (!mediaType) return null;
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mediaType,
      data: Buffer.from(bytes).toString('base64'),
    },
  };
}

/** Anthropic's content-part union, narrowed to what this product sends. */
export type ContentPart =
  | { type: 'text'; text: string }
  | ImageBlock;

/**
 * A user turn as content parts.
 *
 * A single text part is still an array: the upstream treats a bare string
 * and a one-part array identically, and emitting one shape everywhere
 * keeps the caller from branching on "did this turn have an image".
 */
export function toContentParts(text: string, images: ImageBlock[]): ContentPart[] {
  const parts: ContentPart[] = [];
  if (text.trim().length > 0) parts.push({ type: 'text', text });
  parts.push(...images);
  return parts;
}
