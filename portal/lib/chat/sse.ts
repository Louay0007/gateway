/**
 * Reading OpenAI-shaped SSE without losing a token at a chunk boundary.
 *
 * This is pure and separated from the route because it is the one piece of
 * streaming logic that fails SILENTLY: a parser that drops the tail of a
 * chunk produces a plausible answer with words missing, which reads like
 * the model being bad rather than the transport being wrong. `splitFrames`
 * is therefore unit-tested directly, including the case where a frame is
 * cut in half by the network.
 */

export interface ChatSseEvent {
  /** The token(s) this frame adds, if any. */
  delta?: string;
  /**
   * Chain-of-thought text. Kept separate from `delta` on purpose: it is not
   * the answer, it must not be concatenated into `content` (0027
   * `messages.reasoning` is its own column), and a UI that mixes them
   * shows the customer the model talking to itself.
   */
  reasoning?: string;
  /** Set when the upstream reported an error as a frame. */
  error?: string;
  /** Per-frame usage — LiteLLM sends one final block with stream_options. */
  usage?: SseUsage;
  /** Why the model stopped: `stop`, `length`, `tool_calls`, … */
  finishReason?: string;
}

export interface SseUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  /** Upstream's own dollar figure when the provider reports one. */
  costUsd: number | null;
}

export interface ParsedFrames {
  events: ChatSseEvent[];
  /** Whatever came after the last complete frame. MUST be kept. */
  remainder: string;
}

/**
 * Split a buffer into complete SSE frames and a remainder.
 *
 * Frames are separated by a blank line. Only the first `data:` line of each
 * frame is read, which is sufficient for chat completions (the other lines
 * are `event:` and `id:`, which we generate ourselves downstream).
 */
export function splitFrames(buffer: string): ParsedFrames {
  const { payloads, remainder } = splitPayloads(buffer);
  const events: ChatSseEvent[] = [];
  for (const payload of payloads) {
    events.push(...parseOpenAiFrame(payload));
  }
  return { events, remainder };
}

/**
 * Split a buffer into JSON payloads and the unconsumed tail.
 *
 * Shared by both wire formats because the framing is identical — only the
 * body of a frame differs — and a second copy of this is a second place
 * for the chunk-boundary bug to reappear.
 */
function splitPayloads(buffer: string): { payloads: string[]; remainder: string } {
  // SSE permits CRLF as the line terminator, and a `\r\n\r\n` separator
  // contains no `\n\n` — so without this the frames never split, nothing is
  // parsed, and the user sees a blank answer with no error anywhere. Raw
  // CR/LF cannot occur inside a JSON string (they are `\r`/`\n` escapes),
  // so rewriting them cannot corrupt a payload.
  const frames = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const remainder = frames.pop() ?? '';
  const payloads: string[] = [];
  for (const frame of frames) {
    const line = frame.split('\n').find((l) => l.startsWith('data:'));
    if (!line) continue;
    const payload = line.slice(5).trim();
    // `[DONE]` is the OpenAI convention for "no more frames"; it carries no
    // content and is not an error.
    if (!payload || payload === '[DONE]') continue;
    payloads.push(payload);
  }
  return { payloads, remainder };
}

/**
 * One OpenAI chat-completions frame, as zero or more events.
 *
 * An ARRAY, not one event, because LiteLLM puts the final `finish_reason`
 * and the final `usage` block in the SAME frame. A parser that returns one
 * event per frame drops whichever it checked second — which is the usage
 * block, so the turn is persisted with no token count and bills nothing.
 */
function parseOpenAiFrame(payload: string): ChatSseEvent[] {
  let raw: {
    choices?: {
      delta?: {
        content?: string | null;
        reasoning_content?: string | null;
        /** Anthropic-shaped blocks arrive under reasoning too. */
        reasoning?: string | null;
      } | null;
      finish_reason?: string | null;
    }[];
    usage?: {
      prompt_tokens?: number | null;
      completion_tokens?: number | null;
      /**
       * Cached reads. `prompt_tokens` above INCLUDES these (OpenAI
       * semantics), so the fresh input is `prompt_tokens - cached`.
       * Reporting `prompt_tokens` to the UI as "input tokens" made a
       * cache-heavy turn look twice as expensive as the meter charged it for.
       */
      prompt_tokens_details?: { cached_tokens?: number | null } | null;
      response_cost?: number | null;
      cost?: number | null;
    } | null;
    error?: { message?: string } | string;
  };
  try {
    raw = JSON.parse(payload);
  } catch {
    // A malformed frame is dropped rather than thrown: one bad frame in a
    // stream that is otherwise fine must not abort the answer.
    return [];
  }

  if (raw.error) {
    return [
      {
        error:
          typeof raw.error === 'string'
            ? raw.error
            : (raw.error.message ?? 'The gateway stopped mid-answer.'),
      },
    ];
  }

  const events: ChatSseEvent[] = [];
  const choice = raw.choices?.[0];
  const delta = choice?.delta?.content;
  // `null` is a real value here (role-only opening frames, tool-call frames)
  // and must not be coerced into the string "null".
  if (typeof delta === 'string' && delta.length > 0) events.push({ delta });

  // Thinking models stream deliberation before the answer. Both spellings are
  // accepted because LiteLLM normalises providers inconsistently.
  const reasoning = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
  if (typeof reasoning === 'string' && reasoning.length > 0) events.push({ reasoning });

  if (typeof choice?.finish_reason === 'string' && choice.finish_reason.length > 0) {
    events.push({ finishReason: choice.finish_reason });
  }

  // The final usage block is the difference between a known cost and an
  // estimate. LiteLLM puts `response_cost` on it when it is configured to.
  if (raw.usage) {
    const cost = raw.usage.response_cost ?? raw.usage.cost ?? null;
    const prompt = raw.usage.prompt_tokens ?? null;
    const cached = raw.usage.prompt_tokens_details?.cached_tokens ?? 0;
    // Normalise to FRESH input, exclusive of cache reads, so this frame
    // matches the number the quota wall charges. A consumer that adds
    // `inputTokens` to a cache figure must never be given the inclusive
    // value; `prompt_tokens` remains recoverable as input + cache.
    const fresh = prompt === null ? null : Math.max(prompt - (cached ?? 0), 0);
    events.push({
      usage: {
        inputTokens: fresh,
        outputTokens: raw.usage.completion_tokens ?? null,
        costUsd: typeof cost === 'number' && Number.isFinite(cost) ? cost : null,
      },
    });
  }

  return events;
}

/**
 * The same split, for Anthropic's `/v1/messages` stream.
 *
 * WHY A SECOND PARSER. Vision works on that wire format and nowhere else
 * (see lib/chat/vision.ts), so a conversation carrying an image is spoken
 * in Anthropic's dialect for that turn. The framing is identical and
 * shared; the frame BODY is not — text arrives as
 * `content_block_delta` with a `text_delta`, thinking as `thinking_delta`,
 * and usage on `message_start`/`message_delta` rather than a trailing
 * OpenAI usage block.
 *
 * The ranges are normalised to the same `ChatSseEvent` shape, so the route
 * relays, persists and meters one kind of event regardless of which wire
 * format produced it.
 */
export function splitAnthropicFrames(buffer: string): ParsedFrames {
  const { payloads, remainder } = splitPayloads(buffer);
  const events: ChatSseEvent[] = [];
  for (const payload of payloads) {
    const parsed = parseAnthropicFrame(payload);
    if (parsed) events.push(parsed);
  }
  return { events, remainder };
}

/** One Anthropic stream frame, or null when it carries no answer text. */
function parseAnthropicFrame(payload: string): ChatSseEvent | null {
  let raw: {
    type?: string;
    delta?: {
      type?: string;
      text?: string | null;
      thinking?: string | null;
      stop_reason?: string | null;
    } | null;
    message?: { usage?: AnthropicUsage | null } | null;
    usage?: AnthropicUsage | null;
    error?: { message?: string; type?: string } | string;
  };
  try {
    raw = JSON.parse(payload);
  } catch {
    return null;
  }

  if (raw.error) {
    return {
      error:
        typeof raw.error === 'string'
          ? raw.error
          : (raw.error.message ?? 'The gateway stopped mid-answer.'),
    };
  }

  const type = raw.type;
  if (type === 'error') {
    return { error: 'The gateway stopped mid-answer.' };
  }

  // The answer text. `error` and `thinking` deltas arrive on the same event
  // with a different `delta.type`, so they must be distinguished before the
  // text is read — a `thinking_delta` has no `text` field, and treating an
  // empty one as a token would emit thousands of empty frames.
  if (type === 'content_block_delta') {
    const dt = raw.delta?.type;
    if (dt === 'text_delta') {
      const text = raw.delta?.text;
      if (typeof text === 'string' && text.length > 0) return { delta: text };
      return null;
    }
    if (dt === 'thinking_delta') {
      const thinking = raw.delta?.thinking;
      if (typeof thinking === 'string' && thinking.length > 0) {
        return { reasoning: thinking };
      }
      return null;
    }
    return null;
  }

  // `message_delta` carries the stop reason AND the final usage in the SAME
  // frame. Returning only one of them drops the output-token count, which is
  // the only place this wire format reports it — the turn would be metered
  // as free. The opening `message_start` usage is input-only.
  if (type === 'message_delta') {
    const stop = raw.delta?.stop_reason;
    const event: ChatSseEvent = {};
    if (typeof stop === 'string' && stop.length > 0) {
      event.finishReason = anthropicStopToOpenAi(stop);
    }
    if (raw.usage) event.usage = usageFromAnthropic(raw.usage);
    return event.finishReason || event.usage ? event : null;
  }

  if (type === 'message_start' && raw.message?.usage) {
    const usage = usageFromAnthropic(raw.message.usage);
    // Output is always 0 here, and reporting it would overwrite a real
    // count on a later frame. Only the input side is meaningful now.
    return { usage: { ...usage, outputTokens: null } };
  }

  return null;
}

interface AnthropicUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/**
 * Anthropic counts cached reads INSIDE `input_tokens`, exactly like OpenAI
 * counts them inside `prompt_tokens` — so the same subtraction applies and
 * the quota wall sees one meaning for "input tokens" on both wires.
 */
function usageFromAnthropic(usage: AnthropicUsage): SseUsage {
  const prompt = usage.input_tokens ?? null;
  const cached = usage.cache_read_input_tokens ?? 0;
  return {
    inputTokens: prompt === null ? null : Math.max(prompt - cached, 0),
    outputTokens: usage.output_tokens ?? null,
    // The upstream reports no dollar figure on this wire format; the
    // gateway header and the ledger collector supply cost instead.
    costUsd: null,
  };
}

/** `end_turn` → `stop`, `max_tokens` → `length`, as the client already reads. */
function anthropicStopToOpenAi(stop: string): string {
  if (stop === 'max_tokens') return 'length';
  if (stop === 'refusal') return 'refusal';
  return 'stop';
}
