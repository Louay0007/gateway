/**
 * The image has to survive ALL THE WAY to the request body.
 *
 * WHY THIS FILE EXISTS. chat-vision.test.ts proves `imageBlockFor` builds a
 * correct block, and chat-prompt.test.ts proves `buildUserTurnParts` places
 * it. Neither proves the block is still there in the JSON that leaves the
 * server — and that is the segment with the most ways to lose it silently:
 *
 *   imageBlockFor  →  buildUserTurnParts  →  WireMessage.content[]
 *                  →  anthropicBody()     →  fetch body
 *
 * A regression at any of those produces a turn that reads "the user attached
 * an image" with no pixels, and a model that answers confidently about the
 * filename. There is no error anywhere: `/v1/messages` accepts a text-only
 * body, and the reply is a normal answer.
 *
 * So these assert on the ACTUAL body handed to fetch, captured by stubbing
 * it — the same boundary the network sees.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { imageBlockFor, type ImageBlock } from '@/lib/chat/vision';
import { buildUserTurnParts } from '@/lib/chat/prompt';
import { streamChatCompletion, needsAnthropicWire, type WireMessage } from '@/lib/chat/gateway';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A tiny real PNG header — enough for the media-type path. */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

/** Capture the request `streamChatCompletion` makes, and answer with SSE. */
function captureFetch() {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'x-litellm-call-id': 'call-1' }),
        body: new ReadableStream({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(
                'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Red"}}\n\n',
              ),
            );
            c.close();
          },
        }),
      } as unknown as Response;
    }),
  );
  return calls;
}

describe('the image block reaches the outgoing request body', () => {
  it('appears as an image part in /v1/messages after the full chain', async () => {
    const block = imageBlockFor('shot.png', PNG_BYTES);
    expect(block, 'imageBlockFor refused a valid PNG').not.toBeNull();

    // Exactly what the route assembles.
    const messages: WireMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      {
        role: 'user',
        content: buildUserTurnParts({
          text: 'What colour is this?',
          attachments: [
            { filename: 'shot.png', kind: 'image', text: '', truncated: false, image: block },
          ],
        }),
      },
    ];

    // The wire choice must follow from the content, not a flag.
    expect(needsAnthropicWire(messages)).toBe(true);

    const calls = captureFetch();
    await streamChatCompletion({
      alias: 'smart',
      gatewayKey: 'sk-test',
      messages,
      signal: new AbortController().signal,
    });

    expect(calls).toHaveLength(1);
    // The Anthropic endpoint, not chat/completions.
    expect(calls[0]!.url).toContain('/v1/messages');

    const parts = (
      calls[0]!.body as { messages: { role: string; content: { type: string }[] }[] }
    ).messages.find((m) => m.role === 'user')!.content;

    const image = parts.find((p) => p.type === 'image') as unknown as ImageBlock;
    expect(image, 'the image part was LOST in the body').toBeDefined();
    expect(image.source.type).toBe('base64');
    expect(image.source.media_type).toBe('image/png');
    // And the bytes are the ones we sent, not an empty string.
    expect(image.source.data).toBe(Buffer.from(PNG_BYTES).toString('base64'));
    expect(image.source.data.length).toBeGreaterThan(0);
  });

  it('keeps the text part alongside the image', async () => {
    const block = imageBlockFor('shot.png', PNG_BYTES)!;
    const messages: WireMessage[] = [
      {
        role: 'user',
        content: buildUserTurnParts({
          text: 'What colour is this?',
          attachments: [
            { filename: 'shot.png', kind: 'image', text: '', truncated: false, image: block },
          ],
        }),
      },
    ];

    const calls = captureFetch();
    await streamChatCompletion({
      alias: 'smart',
      gatewayKey: 'sk-test',
      messages,
      signal: new AbortController().signal,
    });

    const parts = (
      calls[0]!.body as { messages: { content: { type: string; text?: string }[] }[] }
    ).messages[0]!.content;

    // The question must survive; an image-only turn is a model asked nothing.
    expect(parts.some((p) => p.type === 'text' && p.text?.includes('What colour'))).toBe(true);
    expect(parts.some((p) => p.type === 'image')).toBe(true);
  });

  it('sends max_tokens, which /v1/messages REQUIRES', async () => {
    const block = imageBlockFor('shot.png', PNG_BYTES)!;
    const messages: WireMessage[] = [
      { role: 'user', content: buildUserTurnParts({ text: 'hi', attachments: [{ filename: 'a.png', kind: 'image', text: '', truncated: false, image: block }] }) },
    ];

    const calls = captureFetch();
    await streamChatCompletion({
      alias: 'smart',
      gatewayKey: 'sk-test',
      messages,
      signal: new AbortController().signal,
    });

    // Omitting it is a 400 from the upstream with no field named.
    const maxTokens = (calls[0]!.body as { max_tokens?: number }).max_tokens;
    expect(typeof maxTokens).toBe('number');
    expect(maxTokens).toBeGreaterThan(0);
  });

  it('lifts the system prompt to the top-level field, not a message', async () => {
    const block = imageBlockFor('shot.png', PNG_BYTES)!;
    const messages: WireMessage[] = [
      { role: 'system', content: 'SYSTEM-MARKER' },
      { role: 'user', content: buildUserTurnParts({ text: 'hi', attachments: [{ filename: 'a.png', kind: 'image', text: '', truncated: false, image: block }] }) },
    ];

    const calls = captureFetch();
    await streamChatCompletion({
      alias: 'smart',
      gatewayKey: 'sk-test',
      messages,
      signal: new AbortController().signal,
    });

    const body = calls[0]!.body as { system?: string; messages: { role: string }[] };
    expect(body.system).toBe('SYSTEM-MARKER');
    // Anthropic rejects a `system` role inside `messages`.
    expect(body.messages.some((m) => m.role === 'system')).toBe(false);
  });

  it('an unsendable image produces a note, never a silent drop', () => {
    // imageBlockFor returns null above the cap / for a non-image. The turn
    // must still SAY so, or the model answers as if the file were fine.
    const parts = buildUserTurnParts({
      text: 'What colour is this?',
      attachments: [
        { filename: 'huge.png', kind: 'image', text: '', truncated: false, image: null },
      ],
    });

    const text = parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('');
    expect(text).toContain('huge.png');
    expect(text).toMatch(/could not be decoded/i);
    // And no image part pretending to be there.
    expect(parts.some((p) => p.type === 'image')).toBe(false);
  });
});
