/**
 * The SSE framing rule — one implementation, both sides of the wire.
 *
 * `splitPayloads` is the function that decides where a frame ends. It is
 * imported by the server relay (via `splitFrames` / `splitAnthropicFrames`)
 * AND by the browser (`components/chat/chat-view.tsx`), which used to carry
 * its own inline copy of exactly this logic.
 *
 * WHY THAT MATTERED. The failure mode is silent: drop the tail of a read and
 * the answer arrives with words missing, which reads as the model being poor
 * rather than the transport being wrong. A second copy is a second place for
 * the bug, and the two copies then drift — the server fixing CRLF while the
 * client keeps splitting on "\n\n" produces a blank answer in one direction
 * only.
 */
import { describe, it, expect } from 'vitest';
import { splitPayloads, splitFrames, splitAnthropicFrames } from '@/lib/chat/sse';

describe('splitPayloads — the framing rule', () => {
  it('splits on a blank line', () => {
    const { payloads, remainder } = splitPayloads('data: {"a":1}\n\ndata: {"b":2}\n\n');
    expect(payloads).toEqual(['{"a":1}', '{"b":2}']);
    expect(remainder).toBe('');
  });

  it('keeps an incomplete frame as the remainder', () => {
    // The token-drop case: the network cut mid-frame.
    const { payloads, remainder } = splitPayloads('data: {"a":1}\n\ndata: {"b":');
    expect(payloads).toEqual(['{"a":1}']);
    expect(remainder).toBe('data: {"b":');
  });

  it('normalises CRLF — a \\r\\n\\r\\n separator contains no \\n\\n', () => {
    // Without the normalisation nothing splits, nothing parses, and the user
    // sees a blank answer with no error anywhere.
    const { payloads } = splitPayloads('data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n');
    expect(payloads).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('drops [DONE], which carries no content and is not an error', () => {
    const { payloads } = splitPayloads('data: {"a":1}\n\ndata: [DONE]\n\n');
    expect(payloads).toEqual(['{"a":1}']);
  });

  it('ignores a frame with no data: line (event:/id: only)', () => {
    const { payloads } = splitPayloads('event: ping\nid: 1\n\ndata: {"a":1}\n\n');
    expect(payloads).toEqual(['{"a":1}']);
  });

  it('reads only the FIRST data: line of a frame', () => {
    // Multi-line data is legal SSE; chat completions never uses it, and
    // concatenating lines would corrupt the JSON rather than help.
    const { payloads } = splitPayloads('data: line-one\ndata: line-two\n\n');
    expect(payloads).toEqual(['line-one']);
  });

  it('survives a chunk split at every byte boundary', () => {
    // The property the whole file exists for: feeding the same stream in
    // arbitrarily-sized pieces must produce the same payloads.
    const stream = 'data: {"x":1}\n\ndata: {"y":2}\n\ndata: {"z":3}\n\n';
    for (let cut = 1; cut < stream.length; cut++) {
      let buffer = '';
      const collected: string[] = [];
      for (const piece of [stream.slice(0, cut), stream.slice(cut)]) {
        buffer += piece;
        const { payloads, remainder } = splitPayloads(buffer);
        collected.push(...payloads);
        buffer = remainder;
      }
      expect(collected, `split at ${cut}`).toEqual(['{"x":1}', '{"y":2}', '{"z":3}']);
      expect(buffer, `leftover at ${cut}`).toBe('');
    }
  });

  it('treats an empty buffer as no frames and no remainder', () => {
    expect(splitPayloads('')).toEqual({ payloads: [], remainder: '' });
  });
});

describe('the two wire parsers share the framing', () => {
  it('splitFrames and splitAnthropicFrames agree on frame boundaries', () => {
    // Different bodies, identical framing — that is why the split is shared.
    const openAi = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n';
    const anthropic =
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n';

    expect(splitFrames(openAi).events.map((e) => e.delta)).toEqual(['hi']);
    expect(splitAnthropicFrames(anthropic).events.map((e) => e.delta)).toEqual(['hi']);
  });

  it('keeps the remainder on both paths', () => {
    const cut = 'data: {"choices":[{"delta":{"content":"h';
    expect(splitFrames(cut).remainder).toBe(cut);
    expect(splitAnthropicFrames(cut).remainder).toBe(cut);
  });
});
