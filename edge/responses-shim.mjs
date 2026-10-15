/**
 * Responses → Chat translator.
 *
 * WHY THIS EXISTS. codex-cli 0.156 dropped `wire_api = "chat"` and speaks the
 * OpenAI Responses API exclusively. The upstream model (`space-bunny` via
 * api.howtofix.id) serves `/v1/chat/completions` and `/v1/messages` but
 * returns 404 for `/v1/responses`. LiteLLM does not translate here — it
 * forwards `/v1/responses` verbatim, so the alias reaches the upstream and
 * 404s (verified through the gateway, not inferred).
 *
 * So the translation happens at the edge, in front of LiteLLM. That placement
 * is deliberate:
 *   - Metering is unaffected. LiteLLM prices and logs `/v1/chat/completions`,
 *     which is the shape the upstream is actually paid for. Translating in
 *     front of LiteLLM means the money path stays on the endpoint LiteLLM
 *     already handles correctly, rather than inventing a second priced shape.
 *   - Every other path through the edge is untouched — this is a pure
 *     pre/post processor on one route.
 *
 * SCOPE, stated honestly:
 *   - `previous_response_id` is REJECTED, not ignored. Resolving it needs
 *     server-side conversation state we do not keep; silently dropping it
 *     would hand the model a truncated history and it would answer from
 *     partial context while appearing to work. Codex uses `store:false` and
 *     sends full `input` each turn, so this should not fire in practice.
 *   - `reasoning` effort/summary knobs are accepted and dropped. The upstream
 *     decides its own reasoning depth.
 *   - Multimodal input parts (image_url, input_audio) are dropped, because
 *     the upstream models probed here are text-only. Dropping a part is
 *     better than forwarding a shape that would 400 mid-stream.
 *
 * No dependencies: node built-ins only.
 */

// ── Request: Responses → Chat ─────────────────────────────────────────────

/** Flatten Responses content parts into plain text. */
function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const p of content) {
    if (typeof p === 'string') { parts.push(p); continue; }
    if (!p || typeof p !== 'object') continue;
    if (p.type === 'input_text' || p.type === 'output_text' || p.type === 'text') {
      parts.push(p.text ?? '');
    } else if (p.type === 'input_image' || p.type === 'input_audio' || p.type === 'refusal') {
      // Unsupported media — deliberately dropped, see SCOPE above.
    } else if (typeof p.text === 'string') {
      parts.push(p.text);
    }
  }
  return parts.filter(Boolean).join('');
}

/**
 * One Responses input item → zero or more Chat messages.
 *
 * A single Responses item can become several Chat messages (a function_call
 * plus a function_call_output), which is why this returns an array.
 */
function itemToMessages(item) {
  if (typeof item === 'string') return [{ role: 'user', content: item }];
  if (!item || typeof item !== 'object') return [];

  switch (item.type) {
    case 'message':
    case undefined: {
      const role = item.role ?? 'user';
      const content = contentToText(item.content);
      // An empty assistant turn confuses some backends; drop it rather than
      // send content:null with no purpose.
      if (content === '' && role === 'assistant') return [];
      return [{ role, content }];
    }
    case 'function_call':
      return [{
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: item.call_id ?? item.id ?? 'call_0',
          type: 'function',
          function: {
            name: item.name ?? '',
            // Responses carries arguments as a JSON *string* already.
            arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
          },
        }],
      }];
    case 'function_call_output':
      return [{
        role: 'tool',
        tool_call_id: item.call_id ?? '',
        content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? ''),
      }];
    case 'reasoning':
      // Model-authored reasoning from a prior turn. Not sent back: Chat
      // providers reject it, and the model does not need its own scratchpad
      // restated as an instruction.
      return [];
    default:
      return [];
  }
}

/**
 * Convert a Responses request body into a Chat completions body.
 *
 * Returns `{ ok: true, body }` or `{ ok: false, status, message }` for the
 * cases we refuse rather than mangle.
 */
export function responsesToChat(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, message: 'Malformed Responses request body.' };
  }
  if (body.previous_response_id) {
    return {
      ok: false,
      status: 400,
      message:
        'previous_response_id is not supported: this gateway does not retain conversation state. ' +
        'Send the full conversation in `input` on every turn.',
    };
  }

  const messages = [];

  if (typeof body.instructions === 'string' && body.instructions.trim()) {
    messages.push({ role: 'system', content: body.instructions });
  }

  if (typeof body.input === 'string') {
    messages.push({ role: 'user', content: body.input });
  } else if (Array.isArray(body.input)) {
    for (const item of body.input) messages.push(...itemToMessages(item));
  } else {
    return { ok: false, status: 400, message: '`input` must be a string or an array of items.' };
  }

  if (messages.length === 0) {
    return { ok: false, status: 400, message: 'No usable messages in `input`.' };
  }

  const chat = {
    model: body.model,
    messages,
    stream: Boolean(body.stream),
  };

  // Responses nests tools under `function`; Chat flattens them.
  if (Array.isArray(body.tools) && body.tools.length) {
    const tools = [];
    for (const t of body.tools) {
      if (t?.type === 'function' && t.name) {
        tools.push({
          type: 'function',
          function: {
            name: t.name,
            ...(t.description ? { description: t.description } : {}),
            // Some clients use strict JSON Schema here; Chat wants the same.
            ...(t.parameters ? { parameters: t.parameters } : {}),
          },
        });
      } else if (t?.type === 'function' && t.function) {
        tools.push(t); // already Chat-shaped
      }
      // Non-function tools (web_search, file_search, …) have no Chat
      // equivalent and are dropped rather than forwarded as garbage.
    }
    if (tools.length) chat.tools = tools;
  }

  if (typeof body.max_output_tokens === 'number') chat.max_tokens = body.max_output_tokens;
  else if (typeof body.max_tokens === 'number') chat.max_tokens = body.max_tokens;

  if (typeof body.temperature === 'number') chat.temperature = body.temperature;
  if (typeof body.top_p === 'number') chat.top_p = body.top_p;
  if (body.parallel_tool_calls === false) chat.parallel_tool_calls = false;
  if (body.user) chat.user = body.user;

  return { ok: true, body: chat };
}

// ── Response: Chat → Responses ────────────────────────────────────────────

/** Deterministic, collision-resistant ids without pulling in a uuid dep. */
function makeId(prefix, seed) {
  const s = String(seed ?? '');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = ((h1 ^ s.charCodeAt(i)) * 0x01000193) >>> 0;
    h2 = ((h2 + s.charCodeAt(i) * (i + 7)) * 0x85ebca6b) >>> 0;
  }
  return `${prefix}${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export function toResponsesUsage(usage) {
  const u = usage ?? {};
  const input = u.prompt_tokens ?? u.input_tokens ?? 0;
  const output = u.completion_tokens ?? u.output_tokens ?? 0;
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  const reasoning =
    u.completion_tokens_details?.reasoning_tokens ??
    // Some backends put reasoning tokens only in the top level.
    (typeof u.reasoning_tokens === 'number' ? u.reasoning_tokens : 0);
  return {
    input_tokens: input,
    input_tokens_details: { cached_tokens: cached },
    output_tokens: output,
    output_tokens_details: { reasoning_tokens: reasoning },
    total_tokens: u.total_tokens ?? input + output,
  };
}

/** Text-only assistant turns plus function calls → a Responses `output` array. */
export function chatMessageToOutput(message, seed) {
  const out = [];
  const content = message?.content ?? '';

  if (typeof content === 'string' && content !== '') {
    out.push({
      type: 'message',
      id: makeId('msg_', `${seed}:message`),
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: content, annotations: [] }],
    });
  }

  for (const call of message?.tool_calls ?? []) {
    const fn = call?.function ?? {};
    out.push({
      type: 'function_call',
      id: makeId('fc_', `${seed}:${fn.name}:${call?.id ?? ''}`),
      call_id: call?.id ?? makeId('call_', `${seed}:${fn.name}`),
      name: fn.name ?? '',
      arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
      status: 'completed',
    });
  }

  return out;
}

/** A Chat completion → a complete, non-streamed Responses object. */
export function chatToResponses(chat, requestedModel) {
  const seed = chat?.id ?? makeId('resp_', String(chat?.created ?? Date.now()));
  const choice = (chat?.choices ?? [])[0] ?? {};
  const message = choice.message ?? {};
  const output = chatMessageToOutput(message, seed);

  const text = output
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content.map((c) => c.text))
    .join('');

  return {
    id: seed.startsWith('resp_') ? seed : makeId('resp_', seed),
    object: 'response',
    created_at: chat?.created ?? Math.floor(Date.now() / 1000),
    status: choice.finish_reason === 'length' ? 'incomplete' : 'completed',
    model: requestedModel ?? chat?.model ?? '',
    output,
    output_text: text,
    // The upstream reports a `-free` suffixed id; echo what was ASKED for, so
    // the client sees the alias it used rather than a provider-internal name.
    parallel_tool_calls: true,
    tool_choice: 'auto',
    tools: [],
    usage: toResponsesUsage(chat?.usage),
    error: null,
    incomplete_details: choice.finish_reason === 'length'
      ? { reason: 'max_output_tokens' }
      : null,
  };
}

// ── Streaming: Chat SSE → Responses SSE ───────────────────────────────────

/**
 * A stateful Chat-chunk → Responses-event translator.
 *
 * Streaming translation is where this kind of shim usually breaks, so the
 * rules are explicit:
 *   - The event SEQUENCE is fixed and complete: created → in_progress →
 *     (output items) → completed. A client that reads events in order must
 *     always terminate on `response.completed`, never on a dangling item.
 *   - Text deltas and function-call deltas are separate output items, so a
 *     turn that does both (text + tool_calls) emits two items with their own
 *     added/done pairs.
 *   - Reasoning deltas become a reasoning item carrying
 *     `reasoning_summary_text.delta`. They must NOT be emitted as
 *     `output_text.delta`: that would splice the model's scratchpad into the
 *     answer it is about to give.
 *   - Idempotent `finish()`: the upstream may deliver a terminal chunk and
 *     then close, and we must emit `response.completed` exactly once.
 */
export class ResponsesStreamTranslator {
  constructor({ model, responseId }) {
    this.model = model ?? '';
    this.responseId = responseId ?? makeId('resp_', String(Date.now()));
    this.created = Math.floor(Date.now() / 1000);

    this.started = false;
    this.completed = false;

    this.textItemId = null;
    this.reasoningItemId = null;
    this.text = '';
    this.reasoning = '';
    /** call_id → { itemId, name, arguments } */
    this.calls = new Map();
    this.usage = null;
    this.finishReason = null;
  }

  /** The skeleton echoed in response.created / in_progress / completed. */
  snapshot(status) {
    return {
      id: this.responseId,
      object: 'response',
      created_at: this.created,
      status,
      model: this.model,
      output: this.outputItems(status),
      parallel_tool_calls: true,
      tool_choice: 'auto',
      tools: [],
      usage: status === 'completed' ? this.usage ?? null : null,
      error: null,
      incomplete_details: status === 'completed' && this.finishReason === 'length'
        ? { reason: 'max_output_tokens' }
        : null,
    };
  }

  outputItems(status) {
    const items = [];
    if (this.reasoningItemId) {
      items.push({
        type: 'reasoning',
        id: this.reasoningItemId,
        summary: this.reasoning
          ? [{ type: 'summary_text', text: this.reasoning }]
          : [],
      });
    }
    if (this.textItemId) {
      items.push({
        type: 'message',
        id: this.textItemId,
        status: status === 'in_progress' ? 'in_progress' : 'completed',
        role: 'assistant',
        content: [{
          type: 'output_text',
          text: this.text,
          annotations: [],
        }],
      });
    }
    for (const c of this.calls.values()) {
      items.push({
        type: 'function_call',
        id: c.itemId,
        call_id: c.callId,
        name: c.name,
        arguments: c.arguments,
        status: status === 'in_progress' ? 'in_progress' : 'completed',
      });
    }
    return items;
  }

  event(type, payload) {
    return { event: type, data: payload };
  }

  /** Feed one Chat SSE chunk; returns the Responses events it produces. */
  push(chunk) {
    if (this.completed) return [];
    const events = [];

    if (!this.started) {
      this.started = true;
      events.push(this.event('response.created', { type: 'response.created', response: this.snapshot('in_progress') }));
      events.push(this.event('response.in_progress', { type: 'response.in_progress', response: this.snapshot('in_progress') }));
    }

    const delta = chunk?.choices?.[0]?.delta ?? {};

    // Reasoning first, and into its OWN item. Interleaving it into the text
    // item is the classic way to corrupt an answer.
    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoning === 'string' && reasoning !== '') {
      if (!this.reasoningItemId) {
        this.reasoningItemId = makeId('rs_', `${this.responseId}:reasoning`);
        events.push(this.event('response.output_item.added', {
          type: 'response.output_item.added',
          output_index: this.outputItems('in_progress').length - 1,
          item: { type: 'reasoning', id: this.reasoningItemId, summary: [] },
        }));
      }
      this.reasoning += reasoning;
      events.push(this.event('response.reasoning_summary_text.delta', {
        type: 'response.reasoning_summary_text.delta',
        item_id: this.reasoningItemId,
        output_index: 0,
        summary_index: 0,
        delta: reasoning,
      }));
    }

    const text = delta.content;
    if (typeof text === 'string' && text !== '') {
      if (!this.textItemId) {
        this.textItemId = makeId('msg_', `${this.responseId}:message`);
        events.push(this.event('response.output_item.added', {
          type: 'response.output_item.added',
          output_index: this.outputItems('in_progress').length - 1,
          item: {
            type: 'message',
            id: this.textItemId,
            status: 'in_progress',
            role: 'assistant',
            content: [],
          },
        }));
        events.push(this.event('response.content_part.added', {
          type: 'response.content_part.added',
          item_id: this.textItemId,
          output_index: 0,
          content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] },
        }));
      }
      this.text += text;
      events.push(this.event('response.output_text.delta', {
        type: 'response.output_text.delta',
        item_id: this.textItemId,
        output_index: 0,
        content_index: 0,
        delta: text,
      }));
    }

    for (const call of delta.tool_calls ?? []) {
      // A call arrives in fragments: index/name first, then argument deltas.
      const key = call.index ?? 0;
      if (!this.calls.has(key)) {
        const name = call.function?.name ?? call.name ?? '';
        const callId = call.id ?? makeId('call_', `${this.responseId}:${key}:${name}`);
        const entry = {
          callId,
          name,
          itemId: makeId('fc_', `${this.responseId}:${key}:${name}`),
          arguments: '',
          openedArgs: false,
        };
        this.calls.set(key, entry);
        events.push(this.event('response.output_item.added', {
          type: 'response.output_item.added',
          output_index: this.outputItems('in_progress').length - 1,
          item: {
            type: 'function_call',
            id: entry.itemId,
            call_id: callId,
            name,
            arguments: '',
            status: 'in_progress',
          },
        }));
      }
      const entry = this.calls.get(key);

      // Some backends send the name late, on a later fragment.
      if (!entry.name && (call.function?.name ?? call.name)) {
        entry.name = call.function?.name ?? call.name;
      }
      const args = call.function?.arguments;
      if (typeof args === 'string' && args !== '') {
        if (!entry.openedArgs) {
          entry.openedArgs = true;
          events.push(this.event('response.function_call_arguments.delta', {
            type: 'response.function_call_arguments.delta',
            item_id: entry.itemId,
            output_index: this.outputIndexOf(entry.itemId),
            delta: '',
          }));
        }
        entry.arguments += args;
        events.push(this.event('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          item_id: entry.itemId,
          output_index: this.outputIndexOf(entry.itemId),
          delta: args,
        }));
      }
    }

    if (chunk?.usage) this.usage = toResponsesUsage(chunk.usage);
    if (chunk?.choices?.[0]?.finish_reason) this.finishReason = chunk.choices[0].finish_reason;

    return events;
  }

  outputIndexOf(itemId) {
    return this.outputItems('in_progress').findIndex((o) => o.id === itemId);
  }

  /**
   * Close out the stream: emit every `done` and the terminal `completed`.
   * Idempotent, because an upstream can send a terminal chunk and then also
   * close the socket — emitting `response.completed` twice confuses clients
   * that treat it as the end of the stream.
   */
  finish() {
    if (this.completed || !this.started) {
      // Even a stream that produced nothing must produce a valid, terminated
      // Responses stream, or the client waits forever.
      if (!this.started) {
        this.started = true;
        const boot = [
          this.event('response.created', { type: 'response.created', response: this.snapshot('in_progress') }),
          this.event('response.in_progress', { type: 'response.in_progress', response: this.snapshot('in_progress') }),
        ];
        return boot.concat(this.finish());
      }
      return [];
    }
    this.completed = true;

    const events = [];

    if (this.reasoningItemId) {
      events.push(this.event('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'reasoning',
          id: this.reasoningItemId,
          summary: this.reasoning ? [{ type: 'summary_text', text: this.reasoning }] : [],
        },
      }));
    }

    if (this.textItemId) {
      events.push(this.event('response.content_part.done', {
        type: 'response.content_part.done',
        item_id: this.textItemId,
        output_index: this.outputIndexOf(this.textItemId),
        content_index: 0,
        part: { type: 'output_text', text: this.text, annotations: [] },
      }));
      events.push(this.event('response.output_text.done', {
        type: 'response.output_text.done',
        item_id: this.textItemId,
        output_index: this.outputIndexOf(this.textItemId),
        content_index: 0,
        text: this.text,
      }));
      events.push(this.event('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: this.outputIndexOf(this.textItemId),
        item: {
          type: 'message',
          id: this.textItemId,
          status: 'completed',
          role: 'assistant',
          content: [{ type: 'output_text', text: this.text, annotations: [] }],
        },
      }));
    }

    for (const c of this.calls.values()) {
      events.push(this.event('response.function_call_arguments.done', {
        type: 'response.function_call_arguments.done',
        item_id: c.itemId,
        output_index: this.outputIndexOf(c.itemId),
        arguments: c.arguments,
      }));
      events.push(this.event('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: this.outputIndexOf(c.itemId),
        item: {
          type: 'function_call',
          id: c.itemId,
          call_id: c.callId,
          name: c.name,
          arguments: c.arguments,
          status: 'completed',
        },
      }));
    }

    events.push(this.event('response.completed', {
      type: 'response.completed',
      response: this.snapshot('completed'),
    }));

    return events;
  }
}

/** Serialise one Responses event into SSE wire format. */
export function encodeSse({ event, data }) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
