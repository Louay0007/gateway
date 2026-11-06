/**
 * The SSE frame parser, including the failure mode that has no symptom.
 *
 * A stream is delivered in arbitrary chunks, so a frame routinely arrives
 * in two pieces. The tests below assert the property that matters: no token
 * is lost at a boundary and no fabricated token appears.
 */
import { describe, it, expect } from 'vitest';

import { splitAnthropicFrames, splitFrames } from '@/lib/chat/sse';

const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

describe('splitFrames', () => {
  it('reads one delta out of one frame', () => {
    const { events, remainder } = splitFrames(frame({ choices: [{ delta: { content: 'Hel' } }] }));
    expect(events).toEqual([{ delta: 'Hel' }]);
    expect(remainder).toBe('');
  });

  it('keeps a frame that arrived without its blank-line terminator', () => {
    // This is the half-frame case: it MUST come back as a remainder, not be
    // parsed (the JSON is incomplete) and not be dropped.
    const { events, remainder } = splitFrames('data: {"choices":[{"delta":{"con');
    expect(events).toEqual([]);
    expect(remainder).toBe('data: {"choices":[{"delta":{"con');
  });

  it('completes a frame split across two reads', () => {
    const whole = frame({ choices: [{ delta: { content: '世界' } }] });
    const cut = Math.floor(whole.length / 2);

    const first = splitFrames(whole.slice(0, cut));
    expect(first.events).toEqual([]);

    const second = splitFrames(first.remainder + whole.slice(cut));
    expect(second.events).toEqual([{ delta: '世界' }]);
    expect(second.remainder).toBe('');
  });

  it('never drops or duplicates a token across every possible split point', () => {
    const whole =
      frame({ choices: [{ delta: { content: 'abc' } }] }) +
      frame({ choices: [{ delta: { content: 'def' } }] }) +
      frame({ choices: [{ delta: { content: 'ghi' } }] });

    // Every two-way split of the same stream must produce the same text.
    for (let cut = 0; cut <= whole.length; cut++) {
      const seen: string[] = [];
      let buffer = '';
      for (const chunk of [whole.slice(0, cut), whole.slice(cut)]) {
        buffer += chunk;
        const parsed = splitFrames(buffer);
        buffer = parsed.remainder;
        for (const e of parsed.events) if (e.delta) seen.push(e.delta);
      }
      expect(seen.join('')).toBe('abcdefghi');
    }
  });

  it('ignores [DONE] without treating it as content or an error', () => {
    const { events } = splitFrames('data: [DONE]\n\n');
    expect(events).toEqual([]);
  });

  it('reads an error frame as an error, not a delta', () => {
    const { events } = splitFrames(frame({ error: { message: 'budget exceeded' } }));
    expect(events).toEqual([{ error: 'budget exceeded' }]);
  });

  it('accepts a string error payload', () => {
    const { events } = splitFrames(frame({ error: 'rate limited' }));
    expect(events).toEqual([{ error: 'rate limited' }]);
  });

  it('treats a null delta as no content, not the string "null"', () => {
    // Opening frames carry `delta: {role: "assistant"}` with no content, and
    // tool-call frames carry `content: null`. Coercing either to a string is
    // how the literal word "null" appears mid-answer.
    const { events } = splitFrames(frame({ choices: [{ delta: { content: null } }] }));
    expect(events).toEqual([]);
  });

  it('drops a malformed frame instead of aborting the stream', () => {
    const { events } = splitFrames('data: {not json}\n\n' + frame({ choices: [{ delta: { content: 'ok' } }] }));
    expect(events).toEqual([{ delta: 'ok' }]);
  });

  it('reads multiple frames in one chunk', () => {
    const { events } = splitFrames(
      frame({ choices: [{ delta: { content: 'a' } }] }) +
        frame({ choices: [{ delta: { content: 'b' } }] }),
    );
    expect(events).toEqual([{ delta: 'a' }, { delta: 'b' }]);
  });

  it('skips frames that carry no data line at all', () => {
    const { events } = splitFrames(': keep-alive comment\n\n');
    expect(events).toEqual([]);
  });

  it('reads CRLF-framed streams', () => {
    // SSE allows \r\n as the line terminator. A `\r\n\r\n` separator has no
    // `\n\n` in it, so a parser that only splits on "\n\n" reads nothing and
    // the user gets an empty answer with no error to report.
    const { events } = splitFrames(
      'data: {"choices":[{"delta":{"content":"hi"}}]}\r\n\r\n',
    );
    expect(events).toEqual([{ delta: 'hi' }]);
  });

  it('completes a CRLF frame whose separator is split across reads', () => {
    const whole = 'data: {"choices":[{"delta":{"content":"x"}}]}\r\n\r\n';
    const cut = whole.indexOf('\n\r') + 1; // between \r and \n
    const first = splitFrames(whole.slice(0, cut));
    expect(first.events).toEqual([]);
    const second = splitFrames(first.remainder + whole.slice(cut));
    expect(second.events).toEqual([{ delta: 'x' }]);
  });
});

/**
 * The frames 0027's columns were added for: reasoning, usage, finish reason.
 *
 * Each of these has one failure mode that no renderer would catch — text
 * merged into the answer, a cost silently dropped, a truncated reply shown
 * as complete — so they are asserted at the parser, where the decision is.
 */
describe('splitFrames — reasoning, usage, finish reason', () => {
  it('keeps reasoning out of the answer', () => {
    const { events } = splitFrames(
      frame({ choices: [{ delta: { reasoning_content: 'let me think' } }] }),
    );
    expect(events).toEqual([{ reasoning: 'let me think' }]);
    expect(events.some((e) => e.delta !== undefined)).toBe(false);
  });

  it('accepts the Anthropic-shaped `reasoning` field too', () => {
    const { events } = splitFrames(frame({ choices: [{ delta: { reasoning: 'hm' } }] }));
    expect(events).toEqual([{ reasoning: 'hm' }]);
  });

  it('reports the finish reason so a truncated answer is not shown as complete', () => {
    const { events } = splitFrames(frame({ choices: [{ delta: {}, finish_reason: 'length' }] }));
    expect(events).toEqual([{ finishReason: 'length' }]);
  });

  it('reads the final usage block, including LiteLLM response_cost', () => {
    const { events } = splitFrames(
      frame({
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 34, response_cost: 0.00042 },
      }),
    );
    expect(events).toContainEqual({
      usage: { inputTokens: 120, outputTokens: 34, costUsd: 0.00042 },
    });
  });

  it('treats a missing cost as null rather than zero', () => {
    // Zero would render as "free"; null renders as "no cost reported". A
    // deployment without pricing must not look like a free tier.
    const { events } = splitFrames(
      frame({ choices: [{ delta: {} }], usage: { prompt_tokens: 4, completion_tokens: 2 } }),
    );
    expect(events).toEqual([{ usage: { inputTokens: 4, outputTokens: 2, costUsd: null } }]);
  });

  it('ignores a usage block that is present but null', () => {
    const { events } = splitFrames(
      frame({ choices: [{ delta: { content: 'x' } }], usage: null }),
    );
    expect(events).toEqual([{ delta: 'x' }]);
  });
});

/**
 * Anthropic's `/v1/messages` dialect.
 *
 * This is the wire format an image turn is spoken in, so a bug here is the
 * same class of failure as the chunk-boundary one above: an answer that
 * arrives blank or a turn that bills nothing, with no error anywhere.
 */
describe('splitAnthropicFrames', () => {
  const a = (payload: unknown) => `event: x\ndata: ${JSON.stringify(payload)}\n\n`;

  it('reads answer text from a text_delta', () => {
    const { events } = splitAnthropicFrames(
      a({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } }),
    );
    expect(events).toEqual([{ delta: 'Hi' }]);
  });

  it('separates thinking from the answer', () => {
    // A thinking_delta has no `text` field. Reading it as one would emit
    // empty frames forever; mixing it into `content` shows the customer the
    // model talking to itself.
    const { events } = splitAnthropicFrames(
      a({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } }),
    );
    expect(events).toEqual([{ reasoning: 'hmm' }]);
  });

  it('keeps stop_reason AND usage from the same message_delta', () => {
    // Both live in one frame. Returning only the first drops the output
    // token count, which is the only place this format reports it.
    const { events } = splitAnthropicFrames(
      a({
        type: 'message_delta',
        delta: { stop_reason: 'max_tokens' },
        usage: { input_tokens: 10, output_tokens: 7 },
      }),
    );
    expect(events).toEqual([
      { finishReason: 'length', usage: { inputTokens: 10, outputTokens: 7, costUsd: null } },
    ]);
  });

  it('reports input tokens at message_start but never output', () => {
    const { events } = splitAnthropicFrames(
      a({ type: 'message_start', message: { usage: { input_tokens: 50, output_tokens: 1 } } }),
    );
    expect(events).toEqual([{ usage: { inputTokens: 50, outputTokens: null, costUsd: null } }]);
  });

  it('subtracts cache reads so input means the same on both wires', () => {
    const { events } = splitAnthropicFrames(
      a({
        type: 'message_start',
        message: { usage: { input_tokens: 100, cache_read_input_tokens: 90 } },
      }),
    );
    expect(events[0]?.usage?.inputTokens).toBe(10);
  });

  it('completes a frame split across two reads', () => {
    const whole = a({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } });
    const cut = Math.floor(whole.length / 2);
    const first = splitAnthropicFrames(whole.slice(0, cut));
    expect(first.events).toEqual([]);
    const second = splitAnthropicFrames(first.remainder + whole.slice(cut));
    expect(second.events).toEqual([{ delta: 'ok' }]);
    expect(second.remainder).toBe('');
  });

  it('surfaces an error frame', () => {
    const { events } = splitAnthropicFrames(
      a({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }),
    );
    expect(events).toEqual([{ error: 'busy' }]);
  });

  it('ignores ping and content_block_start/stop', () => {
    expect(splitAnthropicFrames(a({ type: 'ping' })).events).toEqual([]);
    expect(splitAnthropicFrames(a({ type: 'content_block_stop' })).events).toEqual([]);
    expect(splitAnthropicFrames(a({ type: 'message_stop' })).events).toEqual([]);
  });
});
