/**
 * POST /api/chat — proxy chat completions to the LiteLLM gateway.
 *
 * The portal calls LiteLLM internally (LITELLM_INTERNAL_URL) using the
 * master key. The customer's org context is inferred from the session, so
 * spend is attributed through the gateway's own key/team budget
 * enforcement. The client never sees the master key.
 *
 * TWO THINGS THIS ROUTE MUST NOT GET WRONG, because both fail silently:
 *
 *   1. The master key bypasses gateway budgets, so the SUBSCRIPTION GATE
 *      below is the only thing stopping a paywalled account from burning
 *      upstream spend for free. Removing it reopens free unlimited access
 *      for anyone with an account but no plan.
 *
 *   2. Prices are keyed by MODEL, not by alias (`resolvePrice` matches
 *      `nemotron-…`, never `fast`). Resolving the alias directly prices
 *      every request at $0 and the ledger fills with zero-cost rows that
 *      look metered but are not. The alias → representative-model step in
 *      `resolveCosts` exists for exactly this reason.
 *
 * Supports SSE streaming (default) and non-streaming responses.
 */

import { requireActiveOrg } from "@/lib/auth/authorize";
import { LITELLM_BASE } from "@/lib/litellm/endpoint";
import { errorResponse, jsonError } from "@/lib/api/errors";
import {
  loadPriceTable,
  resolvePrice,
  priceUsage,
  customerCost,
  type TokenCounts,
  type PriceTable,
} from "@/lib/pricing";
import {
  loadAliasMap,
  TIER_ALIASES,
  type AliasMap,
} from "@/lib/pricing/alias";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

const bodySchema = z.object({
  // Derived from TIER_ALIASES, never hand-listed: a second copy of the
  // catalog is exactly how the playground ends up offering an alias the
  // gateway will 403. An alias the gateway does not deploy must fail here
  // rather than reach LiteLLM and come back as a 403 the playground
  // renders as a raw error string.
  model: z.enum(TIER_ALIASES),
  messages: z.array(messageSchema).min(1),
  stream: z.boolean().optional().default(true),
});

function authHeaders(): Record<string, string> {
  const key = process.env.LITELLM_MASTER_KEY;
  if (!key) throw new Error("LITELLM_MASTER_KEY is not set");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

interface OrgSpend {
  /** Upstream cost in USD (pre-multiplier). */
  upstreamUsd: number;
  /** Customer cost in USD (post-multiplier). */
  customerUsd: number;
}

/**
 * Price one request's tokens.
 *
 * `alias` is what the customer asked for (`fast`); the price table knows
 * only models (`nemotron-…`). The alias map is inverted to find the
 * representative model for the alias — the same mapping reconcile.sh uses,
 * so the two money paths cannot disagree on what an alias costs.
 */
async function resolveCosts(
  alias: string,
  counts: TokenCounts,
  orgId: string,
  prices: PriceTable,
  aliasMap: AliasMap
): Promise<OrgSpend> {
  const modelKey =
    Object.entries(aliasMap).find(([, a]) => a === alias)?.[0] ?? alias;
  const price = resolvePrice(prices, modelKey);
  if (!price) return { upstreamUsd: 0, customerUsd: 0 };

  const [row] = (await db.execute(sql`
    SELECT p.rate_multiplier_bps
      FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
     WHERE s.organization_id = ${orgId}
       AND s.status IN ('trialing','active','past_due','paused')
     LIMIT 1
  `)) as unknown as { rate_multiplier_bps: number }[];

  const multiplierBps = row?.rate_multiplier_bps ?? 10_000;
  const upstreamUsd = priceUsage(counts, price).total;
  const customerUsd = customerCost(counts, price, multiplierBps, "pass_through");
  return { upstreamUsd, customerUsd };
}

async function writeLedgerRow(input: {
  orgId: string;
  model: string;
  route: string;
  counts: TokenCounts;
  upstreamUsd: number;
  customerUsd: number;
}): Promise<void> {
  const billingPeriod = new Date();
  billingPeriod.setHours(0, 0, 0, 0);
  // Random, not derived: two playground turns in the same millisecond for
  // the same org+model must not collide on the UNIQUE dedupe index (a
  // timestamp-derived hash would), and a playground turn is never retried
  // from a spend log, so there is no cross-retry identity to preserve —
  // unlike collect-usage.ts, whose hash is stable across retries on purpose.
  const dedupeHash = randomUUID();
  await db.execute(sql`
    INSERT INTO usage_records (
      organization_id, model, route, input_tokens,
      output_tokens, cache_write_5m_tokens,
      cache_write_1h_tokens, cache_read_tokens,
      cost_upstream_usd, cost_customer_usd,
      occurred_at, billing_period, dedupe_hash
    ) VALUES (
      ${input.orgId}, ${input.model}, ${input.route},
      ${input.counts.inputTokens}, ${input.counts.outputTokens},
      ${input.counts.cacheWrite5m}, ${input.counts.cacheWrite1h},
      ${input.counts.cacheRead},
      ${input.upstreamUsd}, ${input.customerUsd}, ${new Date()},
      ${billingPeriod}, ${dedupeHash}
    )
  `);
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("validation", "Request body must be JSON.");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "validation",
      parsed.error.issues[0]?.message ?? "Invalid request."
    );
  }

  const { model, messages, stream } = parsed.data;

  try {
    const ctx = await requireActiveOrg();

    // SUBSCRIPTION GATE. The portal calls LiteLLM with the master key,
    // which bypasses every gateway budget — key budgets, team budgets, all
    // of it. Without this check, an account at the paywall (org + team at
    // CUT_BUDGET, no subscription, no key) can still burn upstream spend
    // through this route with nothing to stop it. An active subscription
    // is what makes "every token counts against your plan budget" true.
    const [sub] = (await db.execute(sql`
      SELECT 1 FROM subscriptions s
       WHERE s.organization_id = ${ctx.orgId}
         AND s.status IN ('trialing','active','past_due','paused')
       LIMIT 1
    `)) as unknown as { "?column?": number }[];
    if (!sub) {
      return jsonError(
        "forbidden",
        "Playground requires an active subscription. Choose a plan first."
      );
    }

    const gatewayModel = model;

    const liteLLMBody = {
      model: gatewayModel,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: stream ?? true,
      // Without this, the upstream sends no `usage` in the stream and every
      // token count below stays 0 — the ledger fills with zero-token rows
      // that look metered but record nothing.
      stream_options: { include_usage: true },
      temperature: 0.7,
      max_tokens: 4096,
    };

    const res = await fetch(`${LITELLM_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(liteLLMBody),
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) {
      const text = await res.text();
      return jsonError(
        "upstream",
        `LiteLLM ${res.status}: ${text.slice(0, 200)}`
      );
    }

    const [prices, aliasMap] = await Promise.all([
      loadPriceTable(),
      loadAliasMap(),
    ]);

    const toCounts = (promptTokens: number, completionTokens: number): TokenCounts => ({
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheRead: 0,
    });

    if (!stream || !res.body) {
      const data = await res.json();
      const promptTokens = data?.usage?.prompt_tokens ?? 0;
      const completionTokens = data?.usage?.completion_tokens ?? 0;
      const counts = toCounts(promptTokens, completionTokens);
      const { upstreamUsd, customerUsd } = await resolveCosts(
        gatewayModel,
        counts,
        ctx.orgId,
        prices,
        aliasMap
      );
      try {
        await writeLedgerRow({
          orgId: ctx.orgId,
          model: gatewayModel,
          route: "chat",
          counts,
          upstreamUsd,
          customerUsd,
        });
      } catch {
        // ledger write is non-fatal for the chat response
      }
      // Sanitize: the upstream answers with its own model id, which is not
      // customer-facing. The client asked for an alias and gets one back.
      if (data && typeof data === "object") {
        data.model = gatewayModel;
        data.costUsd = customerUsd;
      }
      return Response.json(data);
    }

    const encoder = new TextEncoder();
    let promptTokens = 0;
    let completionTokens = 0;
    let terminalSent = false;

    const streamResult = new ReadableStream({
      async start(controller) {
        const finalize = async () => {
          if (terminalSent) return;
          terminalSent = true;
          const counts = toCounts(promptTokens, completionTokens);
          const { upstreamUsd, customerUsd } = await resolveCosts(
            gatewayModel,
            counts,
            ctx.orgId,
            prices,
            aliasMap
          );
          const terminal = JSON.stringify({
            done: true,
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
            },
            costUsd: customerUsd,
          });
          controller.enqueue(encoder.encode(`data: ${terminal}\n\n`));
          try {
            await writeLedgerRow({
              orgId: ctx.orgId,
              model: gatewayModel,
              route: "chat",
              counts,
              upstreamUsd,
              customerUsd,
            });
          } catch {
            // ledger write is non-fatal for the chat response
          }
        };

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();

        try {
          // Frames are split on the `\n\n` SSE delimiter, NOT on a bare
          // newline and NOT per TCP chunk. A chunk boundary lands wherever
          // the network puts it, so splitting each chunk independently
          // produces fragments like `data: {"choi` that JSON.parse rejects —
          // and the rejection is swallowed below, so the model silently
          // drops tokens mid-answer. Buffering on the delimiter is the same
          // rule edge/responses-shim.mjs uses for the same reason.
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            let sep: number;
            while ((sep = buffer.indexOf("\n\n")) !== -1) {
              const frame = buffer.slice(0, sep);
              buffer = buffer.slice(sep + 2);

              for (const line of frame.split("\n")) {
                if (!line.startsWith("data: ")) continue;
                const data = line.slice(6);
                // `[DONE]` is the OpenAI stream terminator — the ONLY
                // reliable end-of-stream signal. There is no `parsed.done`
                // field in this shape; waiting for one means the terminal
                // frame, the cost, and the ledger row never happen.
                if (data === "[DONE]") {
                  await finalize();
                  controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                  continue;
                }

                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta?.content;
                  if (delta) {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ delta: { content: delta } })}\n\n`
                      )
                    );
                  }

                  // `usage` arrives in a final pre-[DONE] chunk (enabled by
                  // stream_options.include_usage above), not on every frame.
                  if (parsed.usage) {
                    promptTokens = parsed.usage.prompt_tokens ?? 0;
                    completionTokens = parsed.usage.completion_tokens ?? 0;
                  }
                } catch {
                  // An unparseable frame is skipped, not fatal — same rule
                  // as the shim. Losing one frame must not kill the stream.
                }
              }
            }
          }
          // The upstream closed without [DONE]. Tokens already counted are
          // still billable — finalize rather than dropping them.
          await finalize();
        } catch (e) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: String(e) })}\n\n`)
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(streamResult, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * GET /api/chat — list available model aliases for the playground.
 */
export async function GET(): Promise<Response> {
  try {
    await requireActiveOrg();

    // Derived from TIER_ALIASES, never hand-listed: a second copy of the
    // catalog is exactly how the dashboard ends up offering an alias the
    // gateway will 403. `models` is deliberately empty — the upstream model
    // behind an alias is not customer-facing.
    return Response.json({
      aliases: TIER_ALIASES.map((alias) => ({ alias, models: [] })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
