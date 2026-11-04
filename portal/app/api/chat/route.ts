/**
 * POST /api/chat — the only inference path the browser can reach.
 *
 * The browser holds no credential: it sends a session cookie and an alias,
 * and this route mints/locates the org's gateway key server-side.
 *
 * THE ORDER OF THESE CHECKS IS THE DESIGN.
 *
 *   1. parse + validate the body (cheap, and a malformed body must not
 *      reach the quota wall);
 *   2. authenticate and resolve the org;
 *   3. `getAllowedModels` — the SAME wall `enforce_prompt_limits` pushes to
 *      the gateway, so this cannot allow something the gateway will refuse
 *      five minutes later, and cannot refuse something it would allow;
 *   4. conversation ownership (a 404, never a 403: probing must not
 *      distinguish "not yours" from "does not exist");
 *   5. only then touch the gateway.
 *
 * THE TRANSCRIPT IS REBUILT FROM ROWS, NOT TAKEN FROM THE CLIENT. The
 * browser used to POST the whole visible history and this route forwarded
 * it verbatim, so the stored rows were a log of what the client claimed.
 * Now the client sends ONE message and the context comes from `messages`:
 * a client cannot inject turns, replay another account's text, or bill
 * context that was never stored. `messages` in the body is accepted only
 * for a conversation that does not exist yet (there is nothing to rebuild
 * from) and is discarded as soon as the conversation has rows.
 *
 * STREAMING SHAPE. Success is `text/event-stream`; every failure BEFORE the
 * stream opens is the normal JSON envelope, because a client that gets SSE
 * headers cannot show an error. Frames:
 *
 *    data: {"conversationId","messageId"}   first, so the sidebar can move
 *    data: {"delta":"…"}                    one answer chunk
 *    data: {"reasoning":"…"}                deliberation, kept separate
 *    data: {"usage":{…}}                    final token/cost block
 *    data: {"finish":"stop"}                terminal
 *    data: {"error":{"message":…}}          mid-stream failure
 *
 * NO TIMEOUT ON THE UPSTREAM FETCH. lib/chat/gateway.ts explains why the
 * shared client would cut a generation at 30 s.
 *
 * ABORT IS NOT A FAILURE, AND DOES NOT CANCEL THE BILL. The turn already
 * happened at the gateway; the user just stopped reading. So the partial
 * text is persisted as `aborted` (honest) rather than discarded (data loss)
 * or marked complete (a lie). The upstream fetch IS aborted on disconnect,
 * which is what stops a closed tab from spending more tokens.
 */

import { z } from 'zod';

import { requireActiveOrg } from '@/lib/auth/authorize';
import { errorResponse, jsonError } from '@/lib/api/errors';
import { getAllowedModels } from '@/lib/entitlements/allowed-models';
import { getChatCredential, retireCredential, ChatKeyError } from '@/lib/chat/key';
import { streamChatCompletion, GatewayError, type GatewayStreamResult } from '@/lib/chat/gateway';
import { splitFrames } from '@/lib/chat/sse';
import { resolveSettings } from '@/lib/chat/settings';
import {
  appendMessage,
  createConversation,
  finishMessage,
  getConversation,
  historyForModel,
  supersedeLastAnswer,
} from '@/lib/chat/service';
import { loadInstructions } from '@/lib/chat/instructions';
import { promptMemories } from '@/lib/chat/memory';
import { extractMemories } from '@/lib/chat/memory-extract';
import { buildSystemPrompt, buildUserTurn } from '@/lib/chat/prompt';
import { getProject } from '@/lib/chat/projects';
import {
  searchQueryFrom,
  webSearch,
  webSearchConfigured,
} from '@/lib/chat/web-search';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/db';
import { attachments, messageAttachments } from '@/db/schema';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Byte cap on the whole outbound conversation.
 *
 * 2 MB is Caddy's default request cap; the chat route's own ceiling is
 * lower on purpose. A pasted log is legitimate; a pasted repository is not,
 * and the model would be billed for it either way.
 */
const MAX_MESSAGE_BYTES = 256 * 1024;

/** How many prior turns the model sees. Bounded: context is billed. */
const HISTORY_TURNS = 40;

const Body = z.object({
  conversationId: z.string().uuid().nullish(),
  alias: z.string().min(1).max(40),
  /** The new turn. Required; history is rebuilt server-side. */
  message: z.string().optional(),
  /**
   * Re-answer the LAST user turn instead of adding a new one.
   *
   * A regenerate that appended another user row would silently rewrite the
   * conversation (the same question twice, the model answering the second),
   * and every retry would add a metered row. This flag means "answer what
   * is already stored" — the original turn stays the single source.
   */
  regenerate: z.boolean().optional(),
  /**
   * Attachment ids uploaded this turn via POST /api/attachments.
   *
   * IDS, NOT BYTES: the file was already parsed once and stored as text, so
   * re-sending it here would mean re-uploading megabytes and re-parsing a
   * document the engine has already read. The server re-reads the rows under
   * org+user ownership, so an id from another tenant resolves to nothing.
   */
  attachmentIds: z.array(z.string().uuid()).max(10).optional(),
  /**
   * Start a temporary chat: excluded from memory, search and sharing, and
   * purged by the retention job (audit #12).
   */
  temporary: z.boolean().optional(),
  /**
   * Ask for a web search this turn. Absent means "use the chat's saved
   * setting", which is what a client should send.
   */
  webSearch: z.boolean().optional(),
  /**
   * Deprecated: accepted for a conversation that does not exist yet only.
   * A client that still sends it is not broken, it is just ignored once
   * there are rows to rebuild from.
   */
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
      }),
    )
    .max(200)
    .optional(),
});

export async function POST(request: Request): Promise<Response> {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return jsonError('validation', 'That message could not be read. Try again.');
  }

  // A new turn may arrive as `message` (current client) or as the last user
  // entry of a legacy `messages` array. Both normalise to one string.
  const legacy = parsed.messages ? [...parsed.messages].reverse().find((m) => m.role === 'user') : undefined;
  const userText = (parsed.message ?? legacy?.content ?? '').trim();
  const regenerate = parsed.regenerate === true;
  if (!userText && !regenerate) {
    return jsonError('validation', 'Type a message first.');
  }

  const bytes = Buffer.byteLength(userText, 'utf8');
  if (bytes > MAX_MESSAGE_BYTES) {
    return jsonError(
      'validation',
      `That message is ${Math.round(bytes / 1024)} KB. The limit is ${
        MAX_MESSAGE_BYTES / 1024
      } KB — try shortening what you paste.`,
    );
  }

  let ctx: Awaited<ReturnType<typeof requireActiveOrg>>;
  try {
    ctx = await requireActiveOrg();
  } catch (e) {
    return errorResponse(e);
  }

  // ── The wall. Not a second computation: the same function the job uses.
  const wall = await getAllowedModels(ctx.orgId);
  if (wall.allowed.length === 0) {
    // Two different refusals wear the same status, and conflating them is
    // the bug that makes a paying customer think their plan is broken.
    return wall.entitled.length === 0
      ? jsonError('payment_required', 'Choose a plan to start chatting.')
      : jsonError(
          'forbidden',
          'You have used your token budget for this period. It resets automatically — you can see when under Settings → Usage.',
        );
  }
  if (!wall.allowed.includes(parsed.alias)) {
    return jsonError(
      'forbidden',
      'That model is not available on your plan right now. Pick another from the list.',
    );
  }

  // ── Ownership. A 404 for both "missing" and "not yours".
  let conversationId = parsed.conversationId ?? null;
  let conversationSettings: unknown = null;
  // Kept in the outer scope: the capability layer reads `temporary` and
  // `projectId` from it long after the ownership check.
  let owned: Awaited<ReturnType<typeof getConversation>> = null;
  if (conversationId) {
    owned = await getConversation({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      conversationId,
    });
    if (!owned) return jsonError('not_found', 'That conversation is no longer available.');
    conversationSettings = owned.settings;
  }

  // ── Temporary mode, resolved BEFORE anything is written: a chat marked
  // temporary must be created temporary, not flipped afterwards. An
  // existing chat is authoritative over the request — a client cannot mark
  // somebody's saved conversation private by sending a flag.
  const isTemporary = owned ? owned.temporary : parsed.temporary === true;

  // ── Settings. Three layers merged; the server applies them, the client
  // only ever sees its own values echoed back.
  const settings = await resolveSettings({
    userId: ctx.userId,
    alias: parsed.alias,
    conversationSettings,
  });

  // ── The credential. Minted on first ever chat for this org.
  let credential;
  try {
    credential = await getChatCredential({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      models: wall.entitled,
    });
  } catch (e) {
    if (e instanceof ChatKeyError) {
      return jsonError(e.code === 'payment_required' ? 'payment_required' : 'upstream', e.message);
    }
    throw e;
  }

  // ── Persist the user's turn FIRST. If the gateway then fails, the
  // conversation still contains what was asked, which is what lets the user
  // retry without retyping.
  if (!conversationId) {
    const created = await createConversation({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      alias: parsed.alias,
      firstMessage: userText,
      temporary: isTemporary,
    });
    conversationId = created.id;
  }

  if (regenerate && !parsed.conversationId) {
    return jsonError('validation', 'There is no previous turn to regenerate.');
  }

  // The context the model sees: stored rows plus this turn. Rebuilt after
  // the row is written so the two can never disagree.
  // ── The capability layer, assembled in one place so the prompt and the
  // stored row cannot disagree about what the model was told.
  //
  // Everything read here is scoped to this user: memories by `user_id`,
  // custom instructions by `user_id`, the project by `user_id`. A temporary
  // chat opts out of all of it — a chat the user asked not to be saved must
  // not read the dossier either, not merely decline to write one.
  const [instructions, memories, attachedFiles, projectContext] = await Promise.all([
    isTemporary ? Promise.resolve({ aboutUser: '', responseStyle: '' }) : loadInstructions(ctx.userId),
    isTemporary ? Promise.resolve([]) : promptMemories(ctx.userId),
    resolveAttachments(ctx.orgId, ctx.userId, parsed.attachmentIds ?? []),
    resolveProject(owned?.projectId ?? null, ctx.orgId, ctx.userId),
  ]);

  // ── Web search (audit #2). Runs BEFORE the model call because the
  // results are part of the prompt, not a tool the model invokes. That is
  // the whole design difference: this deployment has no tool-call loop, and
  // inventing one unprompted would be an unmetered second path.
  const wantsSearch = parsed.webSearch ?? settings.webSearch ?? false;
  const searchOutcome =
    wantsSearch && userText && !regenerate && webSearchConfigured()
      ? await webSearch(searchQueryFrom(userText), 5)
      : null;
  const webResults = searchOutcome?.ok ? searchOutcome.results : [];

  const systemPrompt = buildSystemPrompt({
    aboutUser: instructions.aboutUser,
    responseStyle: instructions.responseStyle,
    memories,
    projectName: projectContext?.name,
    projectInstructions: projectContext?.instructions,
    chatSystemPrompt: settings.systemPrompt,
    attachments: attachedFiles.map((f) => ({
      filename: f.filename,
      kind: f.kind,
      chars: f.text.length,
      truncated: f.truncated,
    })),
    webSearch: webResults.length > 0 ? { query: userText.slice(0, 200), results: webResults.length } : undefined,
  });

  // Retire the answer being replaced BEFORE the context is rebuilt, and
  // before the new row exists.
  //
  // WHY HERE AND NOT LOWER. `historyForModel` filters superseded rows, so
  // running it FIRST handed back a transcript whose last turn was the
  // assistant message being replaced. Two consequences, both fatal to
  // regenerate: the guard below saw `last.role !== 'user'` and answered
  // "There is no previous turn to regenerate" for EVERY request, so the
  // button could never work; and had the guard passed, the model would
  // have been asked to continue from its own discarded reply.
  //
  // Retiring first also keeps the crash guarantee the old placement was
  // protecting: a failure between here and the new row leaves one answer
  // visible, not zero.
  if (regenerate) await supersedeLastAnswer(conversationId);

  const prior = await historyForModel(conversationId, HISTORY_TURNS);
  const contextMessages: { role: 'user' | 'assistant' | 'system'; content: string }[] = [];
  if (systemPrompt) {
    contextMessages.push({ role: 'system', content: systemPrompt });
  }
  contextMessages.push(...prior);
  if (regenerate) {
    // The stored history already ends with the user turn being re-answered.
    // Sending it twice would ask the model to reply to the same sentence
    // twice in a row, which reads as a glitch to the model too.
    const last = prior[prior.length - 1];
    if (!last || last.role !== 'user') {
      return jsonError('validation', 'There is no previous turn to regenerate.');
    }
  } else {
    // The turn the MODEL sees carries the extracted file text and the web
    // results, wrapped so untrusted content reads as data. The row stored
    // below keeps only what the user typed, so the transcript shows their
    // message and the files as chips rather than a wall of PDF text.
    contextMessages.push({
      role: 'user',
      content: buildUserTurn({
        text: userText,
        attachments: attachedFiles.map((f) => ({
          filename: f.filename,
          text: f.text,
          truncated: f.truncated,
        })),
        webResults,
      }),
    });
  }

  const userMessageId = regenerate
    ? null
    : await appendMessage({
        conversationId,
        role: 'user',
        content: userText,
      });

  // Link the files to the turn that used them. Written after the message
  // exists because the join needs its id; a failure here must not fail the
  // turn (the model already has the text), so it is not awaited into the
  // error path.
  if (userMessageId && attachedFiles.length > 0) {
    await linkAttachments(userMessageId, attachedFiles).catch(() => {});
    // The char count explains a large `input_tokens` value later: 50k tokens
    // on a two-line question is only confusing if you cannot see that a
    // 180k-character PDF went with it.
    await recordAttachmentChars(userMessageId, attachedFiles).catch(() => {});
  }

  const assistantId = await appendMessage({
    conversationId,
    role: 'assistant',
    content: '',
    model: parsed.alias,
    status: 'streaming',
  });

  const startedAt = Date.now();

  // The upstream body must be tied to the CLIENT's lifetime, not the
  // route's: a closed tab should stop spending money immediately.
  const upstreamAbort = new AbortController();
  request.signal.addEventListener('abort', () => upstreamAbort.abort(), { once: true });

  let upstream: GatewayStreamResult;
  try {
    upstream = await openStream({
      gatewayKey: credential.gatewayKey,
      alias: parsed.alias,
      organizationId: ctx.orgId,
      userId: ctx.userId,
      entitled: wall.entitled,
      messages: contextMessages,
      settings,
      signal: upstreamAbort.signal,
    });
  } catch (e) {
    const message =
      e instanceof GatewayError
        ? e.message
        : 'The gateway could not complete the request. Try again in a moment.';
    if (!(e instanceof GatewayError)) {
      log.error('chat: unexpected gateway failure', {
        organizationId: ctx.orgId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    await finishMessage({ messageId: assistantId, content: '', status: 'error', error: message });
    return jsonError('upstream', message);
  }

  const stream = relayStream({
    upstream: upstream.body,
    downstreamAbort: upstreamAbort,
    assistantId,
    conversationId,
    userMessageId,
    gatewayRequestId: upstream.requestId,
    headerCostUsd: upstream.costUsd,
    startedAt,
    // The pages this turn actually read. Emitted as a frame AND stored on
    // the row, so a reopened conversation shows the same citations as the
    // live one — a Sources panel that vanishes on reload is a footnote to
    // nothing.
    sources:
      webResults.length > 0
        ? webResults.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet }))
        : null,
    // A temporary chat teaches the system nothing, and a regenerate has no
    // new user text to learn from.
    memory:
      isTemporary || regenerate || !userText
        ? null
        : {
            organizationId: ctx.orgId,
            userId: ctx.userId,
            alias: parsed.alias,
            gatewayKey: credential.gatewayKey,
            userText,
          },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // No store: a cached stream would replay one user's answer to another.
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // Tells every buffering proxy in the chain (Caddy included) to pass
      // bytes through as they arrive. Without it the user sees one chunk.
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * Open the gateway stream, rotating the chat key once on a 401.
 *
 * A 401 means OUR credential is stale — a key revoked from the console, a
 * LiteLLM reset, a re-provisioned team. Retrying once after re-minting is
 * the difference between "the product is broken" and a five-second delay,
 * and the key is per org so the second attempt fixes every member.
 */
async function openStream(input: {
  /** Already read once by the caller; re-reading would be a second query. */
  gatewayKey: string;
  alias: string;
  organizationId: string;
  userId: string;
  entitled: string[];
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
  settings: {
    temperature?: number;
    maxOutputTokens?: number;
    reasoningEffort?: string;
  };
  signal: AbortSignal;
}): Promise<GatewayStreamResult> {
  const attempt = async (gatewayKey: string) =>
    streamChatCompletion({
      alias: input.alias,
      gatewayKey,
      messages: input.messages,
      temperature: input.settings.temperature,
      maxOutputTokens: input.settings.maxOutputTokens,
      // Absent means "the deployment's pinned floor" (config/litellm.yaml),
      // which is what a plan with no preset should get.
      reasoningEffort: input.settings.reasoningEffort,
      signal: input.signal,
    });

  try {
    return await attempt(input.gatewayKey);
  } catch (e) {
    if (!(e instanceof GatewayError) || e.status !== 401) throw e;
    const retired = await retireCredential(input.organizationId);
    if (!retired) throw e;
    const rotated = await getChatCredential({
      organizationId: input.organizationId,
      userId: input.userId,
      models: input.entitled,
    });
    log.warn('chat: rotated the gateway key after a 401', { organizationId: input.organizationId });
    return attempt(rotated.gatewayKey);
  }
}

/**
 * Translate the gateway's SSE into ours while accumulating the text.
 *
 * WHY NOT PIPE THE BODY THROUGH. The bytes have to be inspected anyway to
 * know what to persist and where the turn ended, and a pipe would send the
 * user frames containing upstream model names and usage objects they have
 * no business seeing. Parsing here is what keeps the contract ours.
 *
 * The final `finish` frame carries the assistant message id, so the client
 * can navigate to `/chat/[id]` on a brand-new conversation without a second
 * round trip.
 */
function relayStream(input: {
  upstream: ReadableStream<Uint8Array>;
  downstreamAbort: AbortController;
  assistantId: string;
  conversationId: string;
  userMessageId: string | null;
  gatewayRequestId: string | null;
  headerCostUsd: number | null;
  startedAt: number;
  /**
   * Third-party pages consulted this turn. Stored on the row's `meta` so the
   * Sources panel survives a reload, and sent as one frame so the live turn
   * does not have to wait for the answer to show what it read.
   */
  sources: { title: string; url: string; snippet: string }[] | null;
  /**
   * Everything extraction needs, so the memory pass can run AFTER the answer
   * is delivered. Passed as data rather than closed over the request scope:
   * the stream outlives the route handler, and a captured `request` would
   * keep the whole body alive for the life of the connection.
   */
  memory?: {
    organizationId: string;
    userId: string;
    alias: string;
    gatewayKey: string;
    userText: string;
  } | null;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = input.upstream.getReader();

  let text = '';
  let reasoning = '';
  let finishReason: string | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let streamCostUsd: number | null = null;
  let buffer = '';
  let closed = false;

  const frame = (payload: unknown) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

  /** Persist exactly once, whichever path got us here. */
  const finish = async (status: 'complete' | 'error' | 'aborted', error?: string) => {
    if (closed) return;
    closed = true;
    await finishMessage({
      messageId: input.assistantId,
      content: text,
      reasoning: reasoning || null,
      status,
      error: error ?? null,
      latencyMs: Date.now() - input.startedAt,
      gatewayRequestId: input.gatewayRequestId,
      inputTokens,
      outputTokens,
      // The header is authoritative for what THIS call cost; the stream
      // block is the fallback. Neither is the customer price — that is
      // `collect_usage`'s job, which backfills `cost_usd` on this row.
      costUsd: null,
      meta: {
        ...(finishReason ? { finishReason } : {}),
        ...(streamCostUsd !== null ? { upstreamCostUsd: streamCostUsd } : {}),
        ...(input.headerCostUsd !== null ? { headerCostUsd: input.headerCostUsd } : {}),
        ...(reasoning ? { reasoningChars: reasoning.length } : {}),
        // The Sources panel reads these back on reload. `sources` lives in
        // `meta` rather than its own table because it is per-turn telemetry
        // about a turn that already has a row — one jsonb key, no join, and
        // no migration for a shape only this surface renders.
        ...(input.sources && input.sources.length > 0 ? { sources: input.sources } : {}),
      },
    }).catch((e) => {
      log.error('chat: could not persist assistant message', {
        messageId: input.assistantId,
        error: e instanceof Error ? e.message : String(e),
      });
    });
  };

  const usageFrame = () => {
    const cost = streamCostUsd ?? input.headerCostUsd;
    if (inputTokens === null && outputTokens === null && cost === null) return null;
    return frame({
      usage: {
        inputTokens,
        outputTokens,
        costUsd: cost,
      },
    });
  };

  return new ReadableStream<Uint8Array>({
    // A pump, not a chained pipe: the bytes must be parsed to know what to
    // persist, and a pipe would forward upstream model names and usage
    // objects the customer has no business seeing.
    async start(controller) {
      // The ids go out FIRST, so the sidebar can show a brand-new
      // conversation while the answer is still arriving.
      controller.enqueue(
        frame({
          conversationId: input.conversationId,
          messageId: input.assistantId,
          userMessageId: input.userMessageId,
        }),
      );

      // What this turn read, before the first token. A Sources panel that
      // waited for the answer would be the last thing the reader sees on a
      // long reply, when it is most useful as an up-front signal that the
      // model went and looked something up rather than answering from
      // memory.
      if (input.sources && input.sources.length > 0) {
        controller.enqueue(frame({ sources: input.sources }));
      }

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const { events, remainder } = splitFrames(buffer);
          // Keeping the remainder is what stops a token being dropped when
          // the network cuts a frame in half.
          buffer = remainder;

          for (const event of events) {
            if (event.error) {
              await finish('error', event.error);
              controller.enqueue(frame({ error: { message: event.error } }));
              controller.close();
              return;
            }
            if (event.delta) {
              text += event.delta;
              controller.enqueue(frame({ delta: event.delta }));
            }
            if (event.reasoning) {
              reasoning += event.reasoning;
              controller.enqueue(frame({ reasoning: event.reasoning }));
            }
            if (event.finishReason) finishReason = event.finishReason;
            if (event.usage) {
              if (event.usage.inputTokens !== null) inputTokens = event.usage.inputTokens;
              if (event.usage.outputTokens !== null) outputTokens = event.usage.outputTokens;
              if (event.usage.costUsd !== null) streamCostUsd = event.usage.costUsd;
            }
          }
        }

        await finish('complete');

        // Memory extraction runs AFTER the answer is on screen, and is not
        // awaited into the response. It is a second metered call (same
        // gateway, same key — never an unmetered path), so its cost is the
        // price of memory; making the user wait for it would be paying it
        // twice, once in tokens and once in latency.
        if (input.memory && text.trim().length > 0) {
          void extractMemories({
            organizationId: input.memory.organizationId,
            userId: input.memory.userId,
            conversationId: input.conversationId,
            userText: input.memory.userText,
            assistantText: text,
            alias: input.memory.alias,
            gatewayKey: input.memory.gatewayKey,
          });
        }

        const usage = usageFrame();
        if (usage) controller.enqueue(usage);
        controller.enqueue(
          frame({
            finish: finishReason === 'length' ? 'length' : 'stop',
            messageId: input.assistantId,
            reasoning: reasoning || undefined,
          }),
        );
        controller.close();
      } catch (e) {
        // A client disconnect surfaces here as an abort. Not a failure: the
        // user pressed stop or closed the tab, and the partial answer is
        // still theirs to read.
        if (input.downstreamAbort.signal.aborted) {
          await finish('aborted');
          try {
            controller.close();
          } catch {
            /* the consumer already closed it */
          }
          return;
        }
        const message = 'The answer stopped early. Try again.';
        log.error('chat: stream failed', {
          messageId: input.assistantId,
          error: e instanceof Error ? e.message : String(e),
        });
        await finish('error', message);
        try {
          controller.enqueue(frame({ error: { message } }));
          controller.close();
        } catch {
          /* the consumer already closed it */
        }
      }
    },

    async cancel() {
      // The consumer went away: stop generating so a closed tab does not
      // keep spending, and keep whatever text arrived.
      input.downstreamAbort.abort();
      await reader.cancel().catch(() => {});
      await finish('aborted');
    },
  });
}

/** An attachment as the prompt layer needs it: text and how it was cut. */
interface ResolvedAttachment {
  id: string;
  filename: string;
  kind: string;
  text: string;
  truncated: boolean;
}

/**
 * Load the attachments the client claims to have uploaded.
 *
 * The ids come from the REQUEST, so they are re-read under
 * `organization_id` AND `user_id` — an id belonging to another tenant
 * resolves to nothing rather than to their file. The order the client sent
 * is preserved by re-sorting on the input list, because "the second
 * spreadsheet I attached" is what the user means.
 *
 * A missing row is silently dropped: an attachment deleted between upload
 * and send should cost the user that file, not the whole turn.
 */
async function resolveAttachments(
  organizationId: string,
  userId: string,
  ids: string[],
): Promise<ResolvedAttachment[]> {
  if (ids.length === 0) return [];

  // `inArray`, not a hand-built `ARRAY[...]`: interpolating a JS array into
  // `sql` yields one parameter and Postgres rejects it (see
  // lib/auth/throttle.ts), while building the literal by hand would put
  // request-supplied strings into SQL text. The builder parameterises each
  // id.
  const rows = await db
    .select({
      id: attachments.id,
      filename: attachments.filename,
      kind: attachments.kind,
      text: attachments.extractedText,
      truncated: attachments.truncated,
    })
    .from(attachments)
    .where(
      and(
        inArray(attachments.id, ids),
        eq(attachments.organizationId, organizationId),
        eq(attachments.userId, userId),
      ),
    );

  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: ResolvedAttachment[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    out.push({
      id: row.id,
      filename: row.filename,
      kind: row.kind,
      text: row.text,
      truncated: row.truncated,
    });
  }
  return out;
}

/** The project a conversation belongs to, or null. Ownership is in the query. */
async function resolveProject(
  projectId: string | null,
  organizationId: string,
  userId: string,
): Promise<{ name: string; instructions: string } | null> {
  if (!projectId) return null;
  const project = await getProject({ organizationId, userId, projectId });
  if (!project) return null;
  // A project with no instructions adds nothing to the prompt, so it is
  // treated as absent rather than as an empty section.
  if (!project.instructions.trim()) return null;
  return { name: project.name, instructions: project.instructions };
}

/**
 * Attach the files to the turn that used them.
 *
 * `positions` preserves the order the user attached them, which is the only
 * thing the join row carries beyond the link. `ON CONFLICT DO NOTHING` makes
 * a retried send idempotent instead of a primary-key error.
 */
async function linkAttachments(
  messageId: string,
  files: ResolvedAttachment[],
): Promise<void> {
  if (files.length === 0) return;
  await db
    .insert(messageAttachments)
    .values(
      files.map((f, position) => ({
        messageId,
        attachmentId: f.id,
        position,
      })),
    )
    .onConflictDoNothing();
}

/**
 * Record how much extracted text this turn carried.
 *
 * Best-effort, like `linkAttachments`: the model already has the text and
 * the answer is already being generated. A failure here costs a diagnostic
 * number, not the turn.
 */
async function recordAttachmentChars(
  messageId: string,
  files: ResolvedAttachment[],
): Promise<void> {
  const chars = files.reduce((sum, f) => sum + f.text.length, 0);
  await db.execute(sql`
    UPDATE messages SET attachment_chars = ${chars} WHERE id = ${messageId}::uuid
  `);
}
