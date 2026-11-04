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
  const events: ChatSseEvent[] = [];
  // SSE permits CRLF as the line terminator, and a `\r\n\r\n` separator
  // contains no `\n\n` — so without this the frames never split, nothing is
  // parsed, and the user sees a blank answer with no error anywhere. Raw
  // CR/LF cannot occur inside a JSON string (they are `\r`/`\n` escapes),
  // so rewriting them cannot corrupt a payload.
  const frames = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const remainder = frames.pop() ?? '';

  for (const frame of frames) {
    const line = frame.split('\n').find((l) => l.startsWith('data:'));
    if (!line) continue;
    const payload = line.slice(5).trim();
    // `[DONE]` is the OpenAI convention for "no more frames"; it carries no
    // content and is not an error.
    if (!payload || payload === '[DONE]') continue;

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
         * cache-heavy turn look twice as expensive as the meter charged
         * it for.
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
      continue;
    }

    if (raw.error) {
      events.push({
        error:
          typeof raw.error === 'string'
            ? raw.error
            : (raw.error.message ?? 'The gateway stopped mid-answer.'),
      });
      continue;
    }

    const choice = raw.choices?.[0];
    const delta = choice?.delta?.content;
    // `null` is a real value here (role-only opening frames, tool-call
    // frames) and must not be coerced into the string "null".
    if (typeof delta === 'string' && delta.length > 0) events.push({ delta });

    // Thinking models stream deliberation before the answer. Both spellings
    // are accepted because LiteLLM normalises providers inconsistently.
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
      const fresh =
        prompt === null ? null : Math.max(prompt - (cached ?? 0), 0);
      events.push({
        usage: {
          inputTokens: fresh,
          outputTokens: raw.usage.completion_tokens ?? null,
          costUsd: typeof cost === 'number' && Number.isFinite(cost) ? cost : null,
        },
      });
    }
  }

  return { events, remainder };
}
