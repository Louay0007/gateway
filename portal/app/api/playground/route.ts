/**
 * POST /api/playground — one streamed completion for the public playground.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE METERING INVARIANT
 * ══════════════════════════════════════════════════════════════════════
 *
 * This route NEVER mints, borrows or falls back to a server-side key. The
 * caller must supply their own `zn-` key, it is resolved against
 * `api_keys.key_hash` exactly like `/api/device/usage`, and the request is
 * forwarded to the gateway AS that key. Every consequence follows:
 *
 *   - usage lands in the same `usage_records` rows the dashboard reads, so
 *     the playground's "cost of this call" is the real ledger number, not
 *     an estimate printed next to it;
 *   - a spent pool returns the real 403 here, which is the honest demo;
 *   - there is no path where the playground can consume tokens an org did
 *     not pay for. A "demo key" would break that, so there is none.
 *
 * WHY NOT /api/chat. That route is session-authenticated, rebuilds the
 * transcript from `messages` rows, persists every turn and charges the
 * org's minted chat credential. The playground is stateless by design — a
 * visitor should be able to try a prompt without creating a conversation —
 * so it reuses the gateway CLIENT (`streamChatCompletion`) rather than the
 * chat route. The metering path is identical because it is the same
 * gateway key and the same LiteLLM spend log underneath.
 *
 * SSE FRAMES (same dialect as /api/chat, minus persistence):
 *
 *   data: {"delta":"…"}                    one answer chunk
 *   data: {"usage":{…}}                    final token + cost block
 *   data: {"finish":"stop"}                terminal
 *   data: {"error":{"message":…}}          mid-stream failure
 *
 * Failures BEFORE the stream opens are the normal JSON envelope: a client
 * that has already received SSE headers cannot render an error card.
 */

import { z } from 'zod';

import { errorResponse, jsonError } from '@/lib/api/errors';
import { MINUTE, rateLimit } from '@/lib/api/ratelimit';
import { bearerKey, keyDigest, keyInfoFor } from '@/lib/device/auth';
import { getAllowedModels } from '@/lib/entitlements/allowed-models';
import { wallRefusal } from '@/lib/chat/wall';
import {
  streamChatCompletion,
  GatewayError,
  type WireMessage,
} from '@/lib/chat/gateway';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The four aliases. Anything else is a validation error, not a 403. */
const ALIASES = ['fast', 'smart', 'frontier', 'fable'] as const;

const Body = z.object({
  alias: z.enum(ALIASES),
  /** One prompt. The playground is single-turn by design (v1). */
  prompt: z.string().trim().min(1).max(32_000),
  system: z.string().trim().max(8_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(1).max(65_536).optional(),
  /** `data:image/...;base64,…` — passed to /v1/messages so pixels survive. */
  image: z.string().max(8_000_000).optional(),
});

/**
 * Per-key ceiling. The playground calls the model, which costs real tokens,
 * so the throttle is the second thing that stands between a script and a
 * drained pool (the first is the plan's own token wall).
 *
 * 20/min: faster than a human can read a streamed answer, and a burst of
 * retries still fits.
 */
const PLAYGROUND_MAX_PER_MINUTE = 20;

function frame(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function POST(request: Request): Promise<Response> {
  // ── The key. No session, no cookie, no server-side default. ──────────
  const key = bearerKey(request);
  if (!key) {
    return jsonError(
      'unauthorized',
      'Add your zn- API key in the Authorization header. The playground runs on your own key so the usage you see is your real usage.',
    );
  }

  let info;
  try {
    info = await keyInfoFor(key);
  } catch (e) {
    return errorResponse(e);
  }
  if (!info) {
    return jsonError('unauthorized', 'That key is unknown, revoked, or its organization is inactive.');
  }

  const limit = await rateLimit(`playground:${keyDigest(key).slice(0, 32)}`, {
    max: PLAYGROUND_MAX_PER_MINUTE,
    windowMs: MINUTE,
  });
  if (!limit.allowed) {
    // 429 with the `rate_limited` code, NOT `quota_exhausted`: the client
    // must not render "out of tokens" for a throttle.
    return jsonError('rate_limited', 'Too many playground calls. Retry in a moment.', {
      'retry-after': String(limit.retryAfterSeconds),
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError('validation', 'Request body must be JSON.');
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return jsonError('validation', parsed.error.issues[0]?.message ?? 'Invalid request.');
  }
  const { alias, prompt, system, temperature, maxOutputTokens, image } = parsed.data;

  // ── The wall. Same function the cron pushes to the gateway. ──────────
  let wall;
  try {
    wall = await getAllowedModels(info.organizationId);
  } catch (e) {
    return errorResponse(e);
  }

  // A refusal here is the SAME copy the gateway would return, so the
  // playground cannot claim a model works and then 403 on the stream.
  // `wallRefusal` already builds the envelope Response.
  const refusal = wallRefusal(wall, alias);
  if (refusal) return refusal;

  // ── Build the turn. ─────────────────────────────────────────────────
  const messages: WireMessage[] = [];
  if (system && system.length > 0) {
    messages.push({ role: 'system', content: system });
  }

  if (image) {
    // An image goes through the Anthropic wire format, where the body is
    // forwarded verbatim and the model sees pixels. On chat/completions the
    // same picture is stripped before it reaches the model — measured, not
    // assumed (`needsAnthropicWire` picks the path from the parts array).
    const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(image);
    if (!match) {
      return jsonError('validation', 'Image must be a data URL: data:image/png;base64,…');
    }
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        {
          type: 'image',
          source: { type: 'base64', media_type: match[1]!, data: match[2]! },
        },
      ] as unknown as WireMessage['content'],
    });
  } else {
    messages.push({ role: 'user', content: prompt });
  }

  const started = Date.now();

  let upstream;
  try {
    upstream = await streamChatCompletion({
      alias,
      messages,
      gatewayKey: key,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      signal: request.signal,
    });
  } catch (e) {
    if (e instanceof GatewayError) {
      log.warn('playground: gateway rejected the turn', {
        alias,
        status: e.status,
        detail: e.message.slice(0, 200),
      });
      // Pass the gateway's own status through. A 403 here means the plan
      // does not include the alias or the pool is spent; a 429 means the
      // key is throttled. Collapsing them into 500 would hide the only
      // information the visitor can act on.
      return jsonError(
        e.status === 403 ? 'forbidden' : e.status === 429 ? 'rate_limited' : 'upstream',
        e.message,
        e.status === 403 ? {} : { 'retry-after': '5' },
      );
    }
    if (request.signal.aborted) {
      // The visitor closed the tab. Nothing to report.
      return new Response(null, { status: 499 });
    }
    throw e;
  }

  // ── Stream. ─────────────────────────────────────────────────────────
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        let inputTokens: number | null = null;
        let outputTokens: number | null = null;
        let costUsd: number | null = upstream.costUsd;

        try {
          const reader = upstream.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // Upstream frames are `data: {...}` lines separated by blank
            // lines. Parse, never forward: the raw stream carries the
            // upstream model name and a usage object the customer should
            // not see verbatim.
            let idx: number;
            while ((idx = buffer.indexOf('\n\n')) !== -1) {
              const chunk = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);

              for (const line of chunk.split('\n')) {
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (payload === '[DONE]') continue;

                let event: Record<string, unknown>;
                try {
                  event = JSON.parse(payload) as Record<string, unknown>;
                } catch {
                  continue;
                }

                // Reasoning is deliberately NOT streamed into the answer
                // box: it is deliberation, not the reply, and mixing the
                // two makes the output look like a model talking to itself.
                const choices = event.choices as
                  | { delta?: { content?: string } }[]
                  | undefined;
                const delta = choices?.[0]?.delta?.content;
                if (typeof delta === 'string' && delta.length > 0) {
                  controller.enqueue(frame({ delta }));
                }

                const usage = event.usage as
                  | {
                      prompt_tokens?: number;
                      completion_tokens?: number;
                      cost?: number;
                    }
                  | undefined;
                if (usage) {
                  if (typeof usage.prompt_tokens === 'number') inputTokens = usage.prompt_tokens;
                  if (typeof usage.completion_tokens === 'number') outputTokens = usage.completion_tokens;
                  if (typeof usage.cost === 'number') costUsd = usage.cost;
                }
              }
            }
          }
        } catch (e) {
          if (!request.signal.aborted) {
            log.warn('playground: stream failed', {
              alias,
              error: e instanceof Error ? e.message : String(e),
            });
            controller.enqueue(
              frame({ error: { message: 'The stream ended early. Check usage for what was billed.' } }),
            );
          }
        } finally {
          controller.enqueue(
            frame({
              usage: {
                inputTokens,
                outputTokens,
                costUsd,
                latencyMs: Date.now() - started,
              },
            }),
          );
          controller.enqueue(frame({ finish: 'stop' }));
          controller.close();
        }
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Caddy buffers a proxied response unless told not to; the vhost
        // already sets flush_interval -1 for SSE, and this is the belt.
        'X-Accel-Buffering': 'no',
      },
    },
  );
}
