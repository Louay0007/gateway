/**
 * Pixels: what may be sent, and what the model is told when it cannot be.
 *
 * The failure these guard is silent in both directions. A wrong media type is
 * a 400 at send time naming no field; an image silently dropped is a model
 * confidently describing a picture it never received.
 */
import { describe, it, expect } from 'vitest';

import {
  MAX_INLINE_IMAGE_BYTES,
  imageBlockFor,
  imageMediaTypeFor,
  toContentParts,
} from '@/lib/chat/vision';
import { needsAnthropicWire } from '@/lib/chat/gateway';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe('imageMediaTypeFor', () => {
  it('maps the four extensions the allow-list offers', () => {
    expect(imageMediaTypeFor('a.png')).toBe('image/png');
    expect(imageMediaTypeFor('a.JPG')).toBe('image/jpeg');
    expect(imageMediaTypeFor('a.jpeg')).toBe('image/jpeg');
    expect(imageMediaTypeFor('a.webp')).toBe('image/webp');
    expect(imageMediaTypeFor('a.gif')).toBe('image/gif');
  });

  it('refuses a document rather than guessing a media type', () => {
    expect(imageMediaTypeFor('report.pdf')).toBeNull();
    expect(imageMediaTypeFor('noextension')).toBeNull();
  });
});

describe('imageBlockFor', () => {
  it('base64s the bytes and declares the type', () => {
    const block = imageBlockFor('shot.png', png);
    expect(block).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: Buffer.from(png).toString('base64') },
    });
  });

  it('returns null, not a throw, when there is nothing to send', () => {
    expect(imageBlockFor('shot.png', null)).toBeNull();
    expect(imageBlockFor('shot.png', new Uint8Array())).toBeNull();
    expect(imageBlockFor('report.pdf', png)).toBeNull();
  });

  it('refuses bytes over the inline cap', () => {
    // Re-sent on every turn of the conversation, so the ceiling is about
    // the cost of the whole thread, not one request.
    const big = new Uint8Array(MAX_INLINE_IMAGE_BYTES + 1);
    expect(imageBlockFor('shot.png', big)).toBeNull();
  });
});

describe('needsAnthropicWire', () => {
  it('is false for a text-only conversation', () => {
    expect(needsAnthropicWire([{ role: 'user', content: 'hello' }])).toBe(false);
  });

  it('is true when any message carries an image part', () => {
    expect(
      needsAnthropicWire([
        { role: 'user', content: [{ type: 'text', text: 'what is this?' }] },
        { role: 'user', content: toContentParts('x', [imageBlockFor('a.png', png)!]) },
      ]),
    ).toBe(true);
  });
});

describe('toContentParts', () => {
  it('puts the text first, then the pictures', () => {
    const parts = toContentParts('look', [imageBlockFor('a.png', png)!]);
    expect(parts[0]).toEqual({ type: 'text', text: 'look' });
    expect(parts[1]?.type).toBe('image');
  });

  it('drops an empty text part so the body is not a blank block', () => {
    expect(toContentParts('   ', [imageBlockFor('a.png', png)!])).toHaveLength(1);
  });
});
