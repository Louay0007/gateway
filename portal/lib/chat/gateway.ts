/**
 * The only place the portal POSTs an inference request.
 *
 * WHY NOT `lib/litellm/client.ts` `call()`. That helper is built for
 * management calls and sets `AbortSignal.timeout(30_000)`. A management
 * endpoint answers in milliseconds; a four-minute generation does not, and
 * the 30-second cap would sever the stream mid-sentence with no error the
 * user could act on. This file opens its own `fetch` with no timeout and
 * passes the body through as a raw `ReadableStream`.
 *
 * WHY `:4000` AND NOT THE AUTH EDGE. `edge/server.mjs` exists to rewrite
 * `zn-` → `sk-`. An internal caller already holds the `sk-` form, so going
 * through the edge would add a hop and a rewriting rule for nothing.
 *
 * WHY NOT UPSTREAM DIRECTLY. Metering, the token wall and the spend ceiling
 * all live in LiteLLM. A direct upstream call would be unmetered by
 * construction — the exact failure the edge exists to prevent.
 *
 * THIN ON PURPOSE, like `lib/keys/gateway.ts`: every decision (which alias,
 * whether it is allowed, what gets persisted) is made by the caller. This
 * translates our vocabulary into the gateway's and back, and nothing else.
 */

import { LITELLM_BASE } from '@/lib/litellm/endpoint';
import type { ContentPart } from '@/lib/chat/vision';

/**
 * A message as either wire format takes it.
 *
 * `content` is a string for the overwhelming majority of turns. It becomes
 * an array of parts when the turn carries an image, because pixels cannot
 * travel as text — see lib/chat/vision.ts for why that also forces the
 * Anthropic wire format for this turn.
 */
export interface WireMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentPart[];
}

export interface GatewayStreamRequest {
  /** `fast | smart | frontier` — the alias, straight into `model`. */
  alias: string;
  /** `sk-` plaintext from lib/chat/key.ts. Never logged, never returned. */
  gatewayKey: string;
  messages: WireMessage[];
  /**
   * Per-turn overrides from `lib/chat/settings.ts`. Omitted when the plan
   * has no preset: the deployment's own defaults (max effort, low
   * temperature — config/litellm.yaml) must win over an empty object, and
   * sending `temperature: undefined` would serialise as absent anyway.
   */
  temperature?: number;
  maxOutputTokens?: number;
  /**
   * `reasoning_effort` passthrough (audit #14). LiteLLM accepts the
   * provider-native spelling, so this is forwarded unchanged rather than
   * translated — the config pins a floor, and a value the deployment
   * forbids is the gateway's to reject, not ours to guess at.
   */
  reasoningEffort?: string;
  /**
   * Override where the request is sent, defaulting to the internal LiteLLM
   * port.
   *
   * WHY THIS EXISTS. `gatewayKey` is normally an `sk-` credential minted by
   * `lib/chat/key.ts`, so the internal port understands it. A route that
   * forwards a CUSTOMER's `zn-` key cannot use that port: LiteLLM hashes
   * only `sk-` values, so the key authenticates as nothing and comes back
   * 401. Passing the credential edge's origin here routes the call through
   * the one component that restores the prefix — the same path an SDK
   * takes. Omitted everywhere else, so the chat route keeps its direct hop.
   */
  gatewayBase?: string;
  /** Aborted when the client disconnects, so a closed tab stops billing. */
  signal: AbortSignal;
}

export interface GatewayStreamResult {
  /** The raw SSE body. Never collected into a string on this path. */
  body: ReadableStream<Uint8Array>;
  /** LiteLLM's `x-litellm-call-id` — joins `usage_records.gateway_request_id`. */
  requestId: string | null;
  /**
   * `x-litellm-response-cost`, when the gateway reports it. A header is
   * available before the stream opens, so this survives an abort; the SSE
   * usage block is the fallback and arrives only on a clean finish.
   */
  costUsd: number | null;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    /** Upstream status, or 0 when the gateway was unreachable. */
    readonly status: number,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

/**
 * The call id, per LiteLLM's documented response headers.
 *
 * `x-litellm-call-id` is the real name; the previous list
 * (`x-litellm-request-id`, `llm_provider-request-id`) matched nothing that
 * LiteLLM sends, so `requestId` was always null and the cost join never
 * resolved. The others stay as cheap fallbacks for a gateway behind a
 * proxy that renames headers.
 */
const CALL_ID_HEADERS = ['x-litellm-call-id', 'x-request-id'];

/** Documented cost headers. Absent when the deployment does not price calls. */
const COST_HEADERS = ['x-litellm-response-cost'];

/**
 * Does this turn need the Anthropic wire format?
 *
 * Only images force it, and only because the alternative is silent: the
 * same picture sent to `/v1/chat/completions` returns 200 and the model
 * answers "Blue" about a solid red square. There is no error to catch — the
 * pixels simply are not forwarded — so the choice has to be made before the
 * request rather than after a failure.
 */
export function needsAnthropicWire(messages: WireMessage[]): boolean {
  return messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image'),
  );
}

/**
 * Anthropic's `/v1/messages` body from our messages.
 *
 * The differences from chat completions are all mechanical: the system
 * prompt is a top-level `system` field rather than a message, there is no
 * `stream_options` (usage is on every stream by default), and `max_tokens`
 * is REQUIRED rather than optional — so a missing value gets a generous
 * default instead of the upstream's 400.
 */
function anthropicBody(input: GatewayStreamRequest): Record<string, unknown> {
  const system = input.messages
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : partsToText(m.content)))
    .filter((s) => s.length > 0)
    .join('\n\n');

  const messages = input.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role,
      content:
        typeof m.content === 'string'
          ? [{ type: 'text', text: m.content }]
          : m.content,
    }));

  return {
    model: input.alias,
    messages,
    ...(system.length > 0 ? { system } : {}),
    max_tokens: input.maxOutputTokens ?? 8192,
    stream: true,
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
  };
}

/** A parts array flattened back to text, for the rare role that needs it. */
function partsToText(parts: ContentPart[]): string {
  return parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n\n');
}

export async function streamChatCompletion(
  input: GatewayStreamRequest,
): Promise<GatewayStreamResult> {
  if (needsAnthropicWire(input.messages)) {
    return streamAnthropic(input);
  }

  let res: Response;
  try {
    res = await fetch(`${input.gatewayBase ?? LITELLM_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.gatewayKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: input.alias,
        messages: input.messages,
        stream: true,
        // Without this, LiteLLM may omit the final usage block, and the
        // difference between "cost is knowable" and "cost is estimated"
        // is exactly that block.
        stream_options: { include_usage: true },
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        ...(input.maxOutputTokens !== undefined ? { max_tokens: input.maxOutputTokens } : {}),
        ...(input.reasoningEffort !== undefined
          ? { reasoning_effort: input.reasoningEffort }
          : {}),
      }),
      signal: input.signal,
      // No `cache` knob: this is a POST, and Next's fetch patch is not in
      // play for a server-side call outside a route's own caching layer.
    });
  } catch (e) {
    if (input.signal.aborted) throw e;
    // "fetch failed" alone is undiagnosable; the cause distinguishes
    // ECONNREFUSED (gateway down) from EAI_AGAIN (DNS) from a reset.
    const cause =
      e instanceof Error && e.cause
        ? ` (${(e.cause as { code?: string }).code ?? String(e.cause)})`
        : '';
    throw new GatewayError(
      `The gateway is unreachable${cause}. Try again in a moment.`,
      0,
    );
  }

  if (!res.ok) {
    // Read the body only on the ERROR path — it is small, and the message
    // LiteLLM returns ("model not allowed", "budget exceeded") is the one
    // the user needs. Success bodies are never collected.
    const detail = await safeErrorDetail(res);
    throw new GatewayError(detail ?? sentenceForStatus(res.status), res.status);
  }

  if (!res.body) {
    throw new GatewayError('The gateway returned no stream. Try again in a moment.', res.status);
  }

  return { body: res.body, requestId: headerFrom(res, CALL_ID_HEADERS), costUsd: costFrom(res) };
}

/**
 * The same call, spoken in Anthropic's dialect.
 *
 * Split from the chat path rather than folded into it because the two
 * differ in shape, not just in a header: a different endpoint, a different
 * body, `anthropic-version` required, and a different SSE vocabulary
 * downstream. An `if` in the middle of one function would leave the reader
 * tracking two protocols at once.
 *
 * Errors are translated back to the same `GatewayError`, so the route's
 * existing handling — including the key-rotation retry on a 401 — works
 * unchanged on this path.
 */
async function streamAnthropic(
  input: GatewayStreamRequest,
): Promise<GatewayStreamResult> {
  let res: Response;
  try {
    res = await fetch(`${input.gatewayBase ?? LITELLM_BASE}/v1/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.gatewayKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        // Required by the wire format; the gateway defaults it, but an
        // explicit value is what keeps a future gateway default from
        // silently changing the response shape under us.
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicBody(input)),
      signal: input.signal,
    });
  } catch (e) {
    if (input.signal.aborted) throw e;
    const cause =
      e instanceof Error && e.cause
        ? ` (${(e.cause as { code?: string }).code ?? String(e.cause)})`
        : '';
    throw new GatewayError(
      `The gateway is unreachable${cause}. Try again in a moment.`,
      0,
    );
  }

  if (!res.ok) {
    const detail = await safeErrorDetail(res);
    throw new GatewayError(detail ?? sentenceForStatus(res.status), res.status);
  }
  if (!res.body) {
    throw new GatewayError('The gateway returned no stream. Try again in a moment.', res.status);
  }

  return { body: res.body, requestId: headerFrom(res, CALL_ID_HEADERS), costUsd: costFrom(res) };
}

function headerFrom(res: Response, names: string[]): string | null {
  for (const name of names) {
    const value = res.headers.get(name);
    if (value) return value;
  }
  return null;
}

function costFrom(res: Response): number | null {
  const raw = headerFrom(res, COST_HEADERS);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * A message a customer can act on.
 *
 * Deliberately NOT the upstream body verbatim: it can name the model behind
 * an alias, and an alias that leaks its upstream is a promise we can no
 * longer keep (lib/pricing/alias.ts). The status is the reliable signal;
 * the body is only used when it is already customer-safe.
 */
async function safeErrorDetail(res: Response): Promise<string | null> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return null;
  }
  if (res.status === 429) return 'Too many requests. Wait a moment and try again.';
  // 401/403 from the gateway means OUR key is wrong or narrowed — a deploy
  // problem, not something the user caused. Say so generically.
  if (res.status === 401 || res.status === 403) return sentenceForStatus(res.status);
  if (!text) return null;

  try {
    const body = JSON.parse(text) as {
      error?: { message?: string } | string;
      message?: string;
    };
    const raw =
      typeof body.error === 'string'
        ? body.error
        : (body.error?.message ?? body.message ?? '');
    const cleaned = stripUpstreamNames(raw);
    return cleaned.length > 0 && cleaned.length < 300 ? cleaned : null;
  } catch {
    return null;
  }
}

function sentenceForStatus(status: number): string {
  if (status === 401 || status === 403) {
    return 'The gateway refused this request. If it keeps happening, contact support.';
  }
  if (status === 400) return 'That message could not be sent. Try rephrasing it.';
  if (status === 404) return 'That model is not available right now.';
  if (status === 429) return 'Too many requests. Wait a moment and try again.';
  if (status >= 500) return 'The gateway could not complete the request. Try again in a moment.';
  return 'The gateway refused the request.';
}

/**
 * Remove anything that looks like an upstream model identifier.
 *
 * The alias map lives in `prices/models.yaml` and is loaded per-request
 * elsewhere; pulling it in here would put file I/O on the failure path of
 * a stream. This is the cheap version: an upstream id always contains a
 * `/` (provider-qualified) or a version-ish suffix, and both read as noise
 * to a customer anyway.
 */
function stripUpstreamNames(text: string): string {
  return text
    .replace(/\b[a-z0-9_.-]+\/[a-z0-9_.:-]+/gi, 'the model')
    .replace(/\b(model|deployment)\s+['"]?[a-z0-9_.:-]{8,}['"]?/gi, 'the model')
    .trim();
}

export interface GatewayCompletion {
  content: string;
  requestId: string | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * One non-streaming completion, for callers that need the WHOLE answer
 * before doing anything with it.
 *
 * Separate from `streamChatCompletion` rather than a flag on it: the
 * streaming path is deliberately never collected into a string (a
 * four-minute answer is not something to hold in memory twice), and the
 * callers here — memory extraction, a scheduled prompt — want a short
 * structured reply, not a transcript. Sharing one function would mean the
 * hot path carries the cold path's buffering.
 *
 * Still metered: same endpoint, same gateway, same key. A background
 * extraction that bypassed LiteLLM would be an unmetered model path, which
 * the platform invariant forbids outright.
 *
 * `timeoutMs` is a hard AbortSignal — this is called from a job and a
 * fire-and-forget task, where a hung upstream must not pin a worker.
 */
export async function completeOnce(input: {
  alias: string;
  gatewayKey: string;
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: string;
  timeoutMs?: number;
}): Promise<GatewayCompletion> {
  let res: Response;
  try {
    res = await fetch(`${LITELLM_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.gatewayKey}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        model: input.alias,
        messages: input.messages,
        stream: false,
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        ...(input.maxOutputTokens !== undefined ? { max_tokens: input.maxOutputTokens } : {}),
        ...(input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 60_000),
    });
  } catch (e) {
    const cause =
      e instanceof Error && e.cause
        ? ` (${(e.cause as { code?: string }).code ?? String(e.cause)})`
        : '';
    throw new GatewayError(`The gateway is unreachable${cause}.`, 0);
  }

  if (!res.ok) {
    const detail = await safeErrorDetail(res);
    throw new GatewayError(detail ?? sentenceForStatus(res.status), res.status);
  }

  const body = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string | null } }[];
    usage?: {
      prompt_tokens?: number | null;
      completion_tokens?: number | null;
      prompt_tokens_details?: { cached_tokens?: number | null } | null;
      response_cost?: number | null;
      cost?: number | null;
    } | null;
  } | null;

  const content = body?.choices?.[0]?.message?.content ?? '';
  const prompt = body?.usage?.prompt_tokens ?? null;
  const cached = body?.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const cost = body?.usage?.response_cost ?? body?.usage?.cost ?? null;

  return {
    content,
    requestId: headerFrom(res, CALL_ID_HEADERS),
    costUsd: typeof cost === 'number' && Number.isFinite(cost) ? cost : null,
    inputTokens: prompt === null ? null : Math.max(prompt - (cached ?? 0), 0),
    outputTokens: body?.usage?.completion_tokens ?? null,
  };
}
