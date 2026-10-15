/**
 * The Responses→Chat shim.
 *
 * These cases are the ones that actually break this kind of translator, so
 * each one is pinned deliberately:
 *   - a tool call must survive the round trip with its arguments intact and
 *     its `call_id` matched, or an agent loops forever;
 *   - reasoning must NOT leak into the visible answer;
 *   - a stream must always terminate on `response.completed`, or the client
 *     waits until it times out;
 *   - `previous_response_id` must be refused, not silently dropped.
 */
import { describe, it, expect } from 'vitest';
import {
  responsesToChat,
  chatToResponses,
  ResponsesStreamTranslator,
  toResponsesUsage,
  encodeSse,
} from '../../edge/responses-shim.mjs';

describe('responsesToChat — request direction', () => {
  it('converts a string input', () => {
    const r = responsesToChat({ model: 'fast', input: 'hello' });
    expect(r.ok).toBe(true);
    expect(r.body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(r.body.model).toBe('fast');
  });

  it('puts `instructions` first as a system message', () => {
    const r = responsesToChat({ model: 'fast', instructions: 'Be terse.', input: 'hi' });
    expect(r.body.messages[0]).toEqual({ role: 'system', content: 'Be terse.' });
    expect(r.body.messages[1].role).toBe('user');
  });

  it('converts content parts into text', () => {
    const r = responsesToChat({
      model: 'fast',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'part one' }, { type: 'input_text', text: 'part two' }] }],
    });
    expect(r.body.messages[0].content).toBe('part onepart two');
  });

  it('flattens Responses tools into the Chat shape', () => {
    const r = responsesToChat({
      model: 'fast',
      input: 'hi',
      tools: [{ type: 'function', name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }],
    });
    expect(r.body.tools).toEqual([
      { type: 'function', function: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } } },
    ]);
  });

  it('maps max_output_tokens to max_tokens', () => {
    expect(responsesToChat({ model: 'fast', input: 'x', max_output_tokens: 4096 }).body.max_tokens).toBe(4096);
  });

  it('reassembles a prior tool call and its result — the agentic loop', () => {
    const r = responsesToChat({
      model: 'fast',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'weather?' }] },
        { type: 'function_call', call_id: 'call_abc', name: 'get_weather', arguments: '{"city":"Paris"}' },
        { type: 'function_call_output', call_id: 'call_abc', output: '12C' },
      ],
    });
    expect(r.ok).toBe(true);
    const [user, assistant, tool] = r.body.messages;
    expect(user.role).toBe('user');
    // The assistant turn must carry the call back, or the tool result is orphaned.
    expect(assistant.tool_calls[0].id).toBe('call_abc');
    expect(assistant.tool_calls[0].function.name).toBe('get_weather');
    expect(JSON.parse(assistant.tool_calls[0].function.arguments)).toEqual({ city: 'Paris' });
    expect(tool).toEqual({ role: 'tool', tool_call_id: 'call_abc', content: '12C' });
  });

  it('stringifies non-string arguments rather than sending an object', () => {
    const r = responsesToChat({
      model: 'fast',
      input: [{ type: 'function_call', call_id: 'c1', name: 'f', arguments: { a: 1 } }],
    });
    expect(typeof r.body.messages[0].tool_calls[0].function.arguments).toBe('string');
  });

  it('REFUSES previous_response_id instead of dropping it silently', () => {
    // Dropping it would truncate the history while still returning 200 — the
    // model would answer from partial context and look like it worked.
    const r = responsesToChat({ model: 'fast', input: 'x', previous_response_id: 'resp_123' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.message).toMatch(/previous_response_id/);
  });

  it('drops multimodal parts rather than forwarding an unsupported shape', () => {
    const r = responsesToChat({
      model: 'fast',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'look' }, { type: 'input_image', image_url: 'http://x/y.png' }] }],
    });
    expect(r.body.messages[0].content).toBe('look');
  });

  it('rejects a body with nothing usable in it', () => {
    expect(responsesToChat({ model: 'fast', input: [] }).ok).toBe(false);
    expect(responsesToChat(null).ok).toBe(false);
  });
});

describe('toResponsesUsage', () => {
  it('renames Chat token fields to Responses ones', () => {
    expect(toResponsesUsage({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 })).toEqual({
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 4,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 14,
    });
  });

  it('surfaces cached and reasoning tokens when the backend reports them', () => {
    const u = toResponsesUsage({ prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 80 }, completion_tokens_details: { reasoning_tokens: 30 } });
    expect(u.input_tokens_details.cached_tokens).toBe(80);
    expect(u.output_tokens_details.reasoning_tokens).toBe(30);
  });

  it('is total-safe on a missing usage block', () => {
    expect(toResponsesUsage(undefined).input_tokens).toBe(0);
  });
});

describe('chatToResponses — non-streaming response', () => {
  it('produces a well-formed response object', () => {
    const r = chatToResponses(
      { id: 'chatcmpl-1', created: 1700000000, model: 'space-bunny-free', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'hello' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } },
      'fast',
    );
    expect(r.object).toBe('response');
    expect(r.status).toBe('completed');
    // Echo the model the client ASKED for, not the provider's internal id.
    expect(r.model).toBe('fast');
    expect(r.output_text).toBe('hello');
    expect(r.output[0].type).toBe('message');
    expect(r.output[0].content[0]).toEqual({ type: 'output_text', text: 'hello', annotations: [] });
    expect(r.usage.input_tokens).toBe(5);
  });

  it('emits a function_call item alongside the text', () => {
    const r = chatToResponses(
      { id: 'c1', created: 1, choices: [{ finish_reason: 'tool_calls', message: { content: 'checking', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }] } }] },
      'fast',
    );
    const kinds = r.output.map((o) => o.type);
    expect(kinds).toEqual(['message', 'function_call']);
    expect(r.output[1].call_id).toBe('call_1');
    expect(JSON.parse(r.output[1].arguments)).toEqual({ city: 'Paris' });
  });

  it('marks a length-truncated turn incomplete, not completed', () => {
    const r = chatToResponses({ id: 'c', created: 1, choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }, 'fast');
    expect(r.status).toBe('incomplete');
    expect(r.incomplete_details.reason).toBe('max_output_tokens');
  });
});

describe('ResponsesStreamTranslator — streaming', () => {
  const chunk = (o) => ({ id: 'x', created: 1, model: 'm', choices: [{ index: 0, delta: o }], ...(o.__usage ? { usage: o.__usage } : {}) });

  it('opens with created + in_progress before any content', () => {
    const tr = new ResponsesStreamTranslator({ model: 'fast' });
    const events = tr.push({ choices: [{ delta: { role: 'assistant' } }] });
    expect(events.map((e) => e.event).slice(0, 2)).toEqual(['response.created', 'response.in_progress']);
  });

  it('emits text deltas and a content_part, then terminates', () => {
    const tr = new ResponsesStreamTranslator({ model: 'fast' });
    tr.push({ choices: [{ delta: { content: 'Hel' } }] });
    const evs = tr.push({ choices: [{ delta: { content: 'lo' } }] });
    const deltas = evs.filter((e) => e.event === 'response.output_text.delta').map((e) => e.data.delta);
    expect(deltas).toEqual(['lo']);
    const done = tr.finish();
    expect(done[done.length - 1].event).toBe('response.completed');
    expect(done.find((e) => e.event === 'response.output_text.done').data.text).toBe('Hello');
  });

  it('NEVER puts reasoning into the visible text', () => {
    // The classic corruption: the model's scratchpad gets spliced into the
    // answer it is about to give.
    const tr = new ResponsesStreamTranslator({ model: 'fast' });
    const all = [
      ...tr.push({ choices: [{ delta: { reasoning_content: 'let me think about this' } }] }),
      ...tr.push({ choices: [{ delta: { content: 'The answer is 4.' } }] }),
    ];
    // Reasoning is routed to its own item, never to output_text.
    expect(all.some((e) => e.event === 'response.output_text.delta' && e.data.delta.includes('think'))).toBe(false);
    const reasoning = all.filter((e) => e.event === 'response.reasoning_summary_text.delta');
    expect(reasoning[0].data.delta).toBe('let me think about this');
    // …and the visible text holds only the answer.
    expect(tr.text).toBe('The answer is 4.');
    expect(tr.finish().find((e) => e.event === 'response.output_item.done' && e.data.item.type === 'reasoning')).toBeTruthy();
  });

  it('assembles streamed tool-call argument fragments', () => {
    const tr = new ResponsesStreamTranslator({ model: 'fast' });
    tr.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', function: { name: 'write_file', arguments: '{"pa' } }] } }] });
    tr.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.py"}' } }] } }] });
    const done = tr.finish();
    const item = done.find((e) => e.event === 'response.output_item.done' && e.data.item.type === 'function_call');
    expect(item.data.item.arguments).toBe('{"path":"a.py"}');
    expect(item.data.item.call_id).toBe('call_9');
    expect(item.data.item.name).toBe('write_file');
  });

  it('handles two tool calls in one turn', () => {
    const tr = new ResponsesStreamTranslator({ model: 'fast' });
    tr.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c0', function: { name: 'a', arguments: '{}' } }, { index: 1, id: 'c1', function: { name: 'b', arguments: '{}' } }] } }] });
    const calls = tr.finish().filter((e) => e.event === 'response.output_item.done' && e.data.item.type === 'function_call');
    expect(calls.map((c) => c.data.item.name)).toEqual(['a', 'b']);
    expect(new Set(calls.map((c) => c.data.item.call_id)).size).toBe(2);
  });

  it('terminates even when the upstream produced no chunks at all', () => {
    // Otherwise the client blocks until its own timeout.
    const tr = new ResponsesStreamTranslator({ model: 'fast' });
    const done = tr.finish();
    expect(done[done.length - 1].event).toBe('response.completed');
  });

  it('emits response.completed exactly once even if finish() is called twice', () => {
    const tr = new ResponsesStreamTranslator({ model: 'fast' });
    tr.push({ choices: [{ delta: { content: 'hi' } }] });
    tr.finish();
    const second = tr.finish();
    expect(second).toEqual([]);
  });

  it('carries usage into the completed snapshot', () => {
    const tr = new ResponsesStreamTranslator({ model: 'fast' });
    tr.push({ choices: [{ delta: { content: 'hi' } }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } });
    const done = tr.finish();
    const completed = done[done.length - 1];
    expect(completed.data.response.usage.input_tokens).toBe(12);
    expect(completed.data.response.usage.output_tokens).toBe(3);
  });

  it('encodes SSE with an event line and a blank-line terminator', () => {
    const s = encodeSse({ event: 'response.completed', data: { a: 1 } });
    expect(s.startsWith('event: response.completed\ndata: ')).toBe(true);
    expect(s.endsWith('\n\n')).toBe(true);
  });
});
