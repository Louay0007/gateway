/** 
 * The image must survive into the HISTORY, not only the turn it arrived on.
 *
 * THE BUG: `historyForModel` selected `role, content` and nothing else.
 * `messages.content` is what the user TYPED, so on the turn an image was
 * attached the route sent it inline (correct), and on every FOLLOW-UP the
 * rebuilt history contained only text. The model that had just described a
 * picture could not see it one question later — "and what about the red
 * one?" answered blind, with no error anywhere.
 *
 * This is the test that would have caught it. It exercises the shaping
 * function over the exact rows the query returns, so the contract is pinned
 * without a database: text and pixels must both come back, in that order.
 */
import { describe, it, expect } from 'vitest';
import { buildHistoryMessages } from '@/lib/chat/history';
import { needsAnthropicWire } from '@/lib/chat/gateway';

/** A 1x1 PNG's first bytes; the value is irrelevant, its presence is not. */
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');

type Row = Parameters<typeof buildHistoryMessages>[0][number];

function row(over: Partial<Row>): Row {
  return { role: 'user', content: '', images: [], ...over };
}

describe('buildHistoryMessages — pixels replayed from the transcript', () => {
  it('attaches a past image to its user turn', () => {
    const out = buildHistoryMessages([
      row({
        content: 'what is this?',
        images: [{ filename: 'shot.png', media_type: 'image/png', data: PNG_B64 }],
      }),
    ]);

    expect(out).toHaveLength(1);
    const content = out[0]!.content;
    expect(Array.isArray(content)).toBe(true);
    const parts = content as { type: string }[];
    // Text first, then the picture — the same order the live turn uses.
    expect(parts[0]!.type).toBe('text');
    expect(parts[1]!.type).toBe('image');
  });

  it('makes the whole conversation speak the Anthropic wire', () => {
    // Without this the request goes to /v1/chat/completions, which strips
    // images and answers about a picture it never received.
    const out = buildHistoryMessages([
      row({ content: 'what is this?', images: [{ filename: 'a.png', media_type: 'image/png', data: PNG_B64 }] }),
      { role: 'assistant', content: 'A red square.', images: [] },
      row({ content: 'and now?' }),
    ]);
    expect(needsAnthropicWire(out)).toBe(true);
  });

  it('leaves a text-only history as plain strings', () => {
    // The common case must not become a parts array: it would change the
    // body shape for every conversation in the product.
    const out = buildHistoryMessages([
      row({ content: 'hello' }),
      { role: 'assistant', content: 'hi', images: [] },
    ]);
    expect(typeof out[0]!.content).toBe('string');
    expect(needsAnthropicWire(out)).toBe(false);
  });

  it('keeps an image turn whose text is empty', () => {
    // A user who sends a picture with no words. The old `content <> ''`
    // filter dropped this row entirely, losing the image silently.
    const out = buildHistoryMessages([
      row({ content: '', images: [{ filename: 'a.png', media_type: 'image/png', data: PNG_B64 }] }),
    ]);
    expect(out).toHaveLength(1);
    expect((out[0]!.content as { type: string }[]).some((p) => p.type === 'image')).toBe(true);
  });

  it('drops an image the wire cannot carry, rather than the whole turn', () => {
    const out = buildHistoryMessages([
      row({
        content: 'look',
        images: [
          { filename: 'ok.png', media_type: 'image/png', data: PNG_B64 },
          { filename: 'weird.heic', media_type: 'image/heic', data: PNG_B64 },
        ],
      }),
    ]);
    const parts = out[0]!.content as { type: string; source?: { media_type: string } }[];
    const images = parts.filter((p) => p.type === 'image');
    // Only the one with a supported type survives.
    expect(images).toHaveLength(1);
    expect(images[0]!.source!.media_type).toBe('image/png');
    // And the text is still there.
    expect(parts.some((p) => p.type === 'text')).toBe(true);
  });

  it('falls back to mime_type when the filename has no usable extension', () => {
    const out = buildHistoryMessages([
      row({ content: 'x', images: [{ filename: 'blob', media_type: 'image/jpeg', data: PNG_B64 }] }),
    ]);
    const parts = out[0]!.content as { type: string; source?: { media_type: string } }[];
    expect(parts.find((p) => p.type === 'image')!.source!.media_type).toBe('image/jpeg');
  });

  it('never attaches images to an assistant turn', () => {
    // Only the user sends pictures; an assistant row with a join would be a
    // data bug, not a turn to replay.
    const out = buildHistoryMessages([
      { role: 'assistant', content: 'answer', images: [{ filename: 'a.png', media_type: 'image/png', data: PNG_B64 }] },
    ]);
    expect(typeof out[0]!.content).toBe('string');
  });

  it('drops an empty assistant row from the context', () => {
    // Created `streaming`, then failed before any token. It teaches nothing
    // and costs a turn of window.
    const out = buildHistoryMessages([
      row({ content: 'hello' }),
      { role: 'assistant', content: '', images: [] },
    ]);
    expect(out).toHaveLength(1);
  });
});
