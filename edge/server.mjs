/**
 * auth-edge — the `zn-` → `sk-` prefix boundary.
 *
 * WHY THIS EXISTS. Customers hold `zn-<body>`. LiteLLM stores `sk-<body>`
 * and hashes it on the way in; its key normalizer only hashes values that
 * start with `sk-`, so a `zn-` value would be treated as an already-hashed
 * token and looked up verbatim (and never match). The prefix is therefore
 * structural to the gateway and cannot be changed in the credential.
 *
 * So the random body is chosen by the portal (lib/keys/policy.ts) and is
 * IDENTICAL in both forms. This process restores the gateway's prefix on the
 * request path, and does nothing else.
 *
 * WHAT IT DOES. Reads the credential, substitutes the leading `zn-` with
 * `sk-`, forwards to LiteLLM, streams the response back. No buffering, no
 * header rewriting beyond the credential, no request/response mutation.
 *
 * DESIGN RULES, in priority order:
 *
 *  1. FAIL CLOSED. If the upstream is unreachable the answer is 502, never
 *     200. A proxy that answers successfully when the gateway did not is an
 *     unmetered request, which is the exact failure this product exists to
 *     prevent. An unrecognised credential is likewise passed through
 *     untouched for the gateway to reject — never guessed at, never forged.
 *
 *  2. NEVER LOG A CREDENTIAL. Logs carry method, path, status, duration and
 *     a boolean saying whether a prefix was substituted. Not the value, not
 *     the length, not a slice.
 *
 *  3. STREAM, OR THE PRODUCT IS BROKEN. Responses are piped with no
 *     aggregation, so `text/event-stream` arrives token by token. Nothing
 *     here may buffer a body, set Content-Length on a streamed response, or
 *     transform the payload.
 *
 *  4. BYPASS-FREE. The management surface is denied here as well as at the
 *     edge proxy (config/Caddyfile is authoritative; this is defence in
 *     depth for the case where the edge is ever exposed directly).
 *
 * No dependencies: node:http only. A credential proxy is the last place to
 * take a supply-chain dependency.
 */

import http from 'node:http';
import { URL, pathToFileURL } from 'node:url';
import {
  responsesToChat,
  chatToResponses,
  ResponsesStreamTranslator,
  encodeSse,
} from './responses-shim.mjs';
import { sanitizeRequest } from './upstream-guard.mjs';
import {
  applyChatIdentity,
  applyMessagesIdentity,
  applyResponsesIdentity,
  identityLine,
  isIdentityQuestion,
  lastUserText,
  repairIdentityAnswer,
} from './identity.mjs';


const CUSTOM_PREFIX = 'zn-';
const GATEWAY_PREFIX = 'sk-';
const MIN_BODY = 16;

const LISTEN_HOST = process.env.AUTH_EDGE_HOST ?? '127.0.0.1';
const LISTEN_PORT = Number(process.env.AUTH_EDGE_PORT ?? 4001);
const UPSTREAM = new URL(
  process.env.AUTH_EDGE_UPSTREAM ?? 'http://127.0.0.1:4000',
);

/**
 * Keep-alive pool to LiteLLM. node's default global agent has keepAlive=false,
 * so without this every forwarded request (and every Responses-shim upstream
 * call) opens a fresh TCP connection on loopback. Loopback is fast, but the
 * handshake + TIME_WAIT churn still costs ~1-3 ms per request and shows up as
 * gateway overhead under concurrency. Reusing connections removes that hop
 * cost entirely. `keepAliveMsecs` probes idle sockets so a stale connection
 * is never handed to a request.
 */
export const UPSTREAM_AGENT = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 256,
  maxFreeSockets: 64,
});

/**
 * Responses translation. codex-cli 0.156 speaks the Responses API only, and
 * the upstream serves chat/completions + /v1/messages but 404s on
 * /v1/responses. LiteLLM forwards /v1/responses rather than translating it.
 *
 * Translate HERE, in front of LiteLLM, so that:
 *   - metering stays on /v1/chat/completions, the endpoint LiteLLM already
 *     prices and logs correctly, and
 *   - no second priced endpoint shape has to be invented.
 *
 * Kill switch: RESPONSES_SHIM=off restores pure passthrough. Kept because a
 * new upstream that speaks Responses natively would make this dead weight,
 * and it must be removable without a code change.
 */
const RESPONSES_SHIM = (process.env.RESPONSES_SHIM ?? 'on') !== 'off';
const RESPONSES_PATH = '/v1/responses';

/**
 * The ONLY paths this edge forwards. Mirrors the `@modelApi` matcher in
 * config/Caddyfile — kept in step deliberately: this is a second lock, not a
 * second policy.
 *
 * AN ALLOWLIST, and the reason is in the name. LiteLLM's own surface is far
 * wider than inference (/key/*, /spend/*, /config/*, /team/*, /health/*,
 * /metrics, /sso/*, /v1/files, /v1/batches, /model_group/*) and it grows with
 * every upstream release. A denylist of the management prefixes it happened
 * to know therefore failed OPEN: anything not on the list was public. Here
 * an unrecognised path is answered 404 by this process, so a route nobody
 * anticipated stays private.
 *
 * Caddy is authoritative. This exists because the edge binds loopback and is
 * one misconfigured `ports:` away from being reachable directly.
 */
const ALLOWED_EXACT = new Set([
  '/v1/chat/completions',
  '/v1/messages',
  '/v1/messages/count_tokens',
  '/v1/responses',
  '/v1/models',
]);

function isModelPath(pathname) {
  if (ALLOWED_EXACT.has(pathname)) return true;
  // Model discovery by id: `/v1/models/<id>`, one trailing segment only —
  // `/v1/models/x/y` is not a route LiteLLM serves.
  return /^\/v1\/models\/[^/]+$/.test(pathname);
}

/** Hop-by-hop headers must not be forwarded (RFC 9110 §7.6.1). */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Customer-facing alias → concrete upstream model name.
 *
 * The edge resolves aliases before forwarding so LiteLLM always receives a
 * concrete model name. LiteLLM's model_list maps `model_name: smart` →
 * `litellm_params.model: openai/sonnet-5.5`, but if LiteLLM's alias
 * resolution is temporarily unavailable (config not reloaded, DB-backed
 * model store, runtime issue) it returns "Invalid model name passed in
 * model=smart". Resolving here makes the edge self-sufficient.
 *
 * Names are upstream-model form (no `openai/` prefix) so LiteLLM passes
 * them straight through to the upstream when it has no `model_name` match.
 */
const MODEL_ALIAS = {
  fast: 'haiku-5.5',
  smart: 'sonnet-5.5',
  frontier: 'opus-5.5',
  fable: 'gpt-6-astra',
};

/** Claude Desktop's custom-model picker names → the tier alias they mean.
 *
 * Deliberately NOT merged into MODEL_ALIAS: that map resolves onward to an
 * upstream name, and forwarding `haiku-5.5` would 403 every key, because
 * keys are allowlisted per tier alias (portal/lib/litellm/client.ts:167).
 * The value here is the tier alias and the rewrite stops there — LiteLLM's
 * own model_list turns `fast` into the upstream model.
 *
 * Only used on /v1/messages. On /v1/chat/completions a `claude-*` name is
 * absent from MODEL_ALIAS and so falls through to modelRejection like any
 * other unknown name, which is the pre-existing behaviour.
 */
export const CLAUDE_ALIAS = {
  'claude-fast': 'fast',
  'claude-smart': 'smart',
  'claude-frontier': 'frontier',
  'claude-fable': 'fable',
};

/** How big each alias actually is, in tokens.
 *
 * WHY THE EDGE STATES THIS AND NOT LITELLM. LiteLLM's `/v1/models` answers
 * `max_input_tokens` / `max_output_tokens` only. An Anthropic-dialect client
 * (Claude Desktop above all) does not read those names — it reads
 * `context_window` on an Anthropic-shaped model object, and when that key is
 * ABSENT it falls back to its own built-in default for the model id. For a
 * `claude-*` id that default is 200K, which is what a customer sees even
 * though the upstream serves 1,048,576: every session reports "160K / 200K"
 * and auto-compacts long before it needs to. The number was never wrong on
 * the wire — it was simply never stated in the dialect the client speaks.
 *
 * Values mirror `config/litellm.yaml` model_info, which mirrors the
 * provider's own /v1/models (`context_window` 1048576, 65536 output).
 */
export const MODEL_CONTEXT = {
  fast: 1048576,
  smart: 1048576,
  frontier: 1048576,
  fable: 1048576,
  'claude-fast': 1048576,
  'claude-smart': 1048576,
  'claude-frontier': 1048576,
  'claude-fable': 1048576,
};

export const MODEL_MAX_OUTPUT = 65536;

/**
 * What these models can actually do — verified against the provider, not
 * copied from a spec sheet.
 *
 * Each flag below was measured on the live upstream (2026-11-25) before it
 * was advertised:
 *
 *   tools            chat/completions returned finish_reason "tool_calls"
 *                    with a well-formed call; /v1/messages returned
 *                    stop_reason "tool_use".
 *   tool round-trip  a tool_result / role:"tool" continuation answered in
 *                    text on both dialects, so a coding agent can loop.
 *   vision           an 8x8 solid-red PNG answered "Red." through
 *                    /v1/messages.
 *   attachment       the provider's own /v1/models declares it, and a PDF
 *                    document block is what upstream-guard rewrites — so it
 *                    is real, with the documented caveat that this upstream
 *                    refuses base64 PDFs and the guard converts them to a
 *                    text note.
 *
 * WHY ADVERTISE AT ALL. The transport already worked; nothing in our
 * metadata said so. A client that decides which models to offer for a
 * coding or tool-driven workflow reads these flags, and an absent flag is
 * indistinguishable from "unsupported" — the same class of bug as the
 * missing `context_window` that made a 1M model report 160K/200K.
 *
 * NOT ADVERTISED, DELIBERATELY:
 *   - reasoning / thinking. Every structure was tried
 *     (reasoning_effort none..max, reasoning:{effort}, thinking:{budget})
 *     and every one returned reasoning_tokens: 0 within ±0.4s. Claiming
 *     extended thinking would be a lie a client could not diagnose.
 *   - audio. The provider declares text and image only.
 */
export const MODEL_CAPABILITIES = {
  supports_function_calling: true,
  supports_tool_choice: true,
  supports_vision: true,
  supports_attachments: true,
  supports_parallel_tool_calls: true,
  /** Explicitly false: measured, not assumed. See the note above. */
  supports_reasoning: false,
};

/**
 * Add Anthropic-dialect size fields to every model the key can use.
 *
 * PURE, so the rule is testable without a server — same discipline as
 * `advertiseClaudeAliases` next to it. It only ever restates a size for an
 * id that is already in the payload, so it cannot advertise a model the key
 * is not allowed to call.
 *
 * `context_window` is the field Claude Desktop reads; `max_input_tokens` and
 * `max_output_tokens` stay because OpenAI-dialect clients (and our own docs)
 * use them. `display_name` is set only when the entry has none, so a future
 * LiteLLM-supplied label is not overwritten.
 */
export function advertiseModelSizes(payload) {
  const data = Array.isArray(payload && payload.data) ? payload.data : null;
  if (!data) return payload;
  for (const entry of data) {
    if (!entry || typeof entry.id !== 'string') continue;
    const ctx = MODEL_CONTEXT[entry.id];
    if (!ctx) continue;
    entry.context_window = ctx;
    entry.max_input_tokens = ctx;
    entry.max_output_tokens = entry.max_output_tokens ?? MODEL_MAX_OUTPUT;
    if (!entry.display_name) entry.display_name = entry.id;
    // Capability flags in the snake_case spellings OpenAI- and
    // Anthropic-dialect clients both probe.
    Object.assign(entry, MODEL_CAPABILITIES);
    entry.supports_tools = true;
    // Anthropic-shaped clients read capabilities off a nested object.
    entry.capabilities = {
      tools: true,
      function_calling: true,
      vision: true,
      attachment: true,
    };
    entry.architecture = entry.architecture ?? {
      modality: 'text+image->text',
      input_modalities: ['text', 'image', 'file'],
      output_modalities: ['text'],
    };
  }
  return payload;
}

/** Add a `claude-*` entry to a /v1/models payload for every tier already
 * in it. Pure, so the rule is testable without an HTTP server.
 *
 * A tier absent from the list is absent because the key is not allowed it —
 * adding its claude-* twin would advertise access the key does not have, and
 * the request would then 403. So the list only ever grows by a second
 * spelling of an entry that is already there.
 */
export function advertiseClaudeAliases(payload) {
  const data = Array.isArray(payload && payload.data) ? payload.data : null;
  if (!data) return payload;
  const present = new Set(data.map((m) => m && m.id).filter(Boolean));
  for (const [claudeName, tier] of Object.entries(CLAUDE_ALIAS)) {
    if (!present.has(tier)) continue;
    const twin = data.find((m) => m && m.id === tier);
    data.push({ ...twin, id: claudeName });
  }
  return payload;
}

/** Concrete upstream model names the edge is allowed to forward.
 * Anything not in this set (and not a known alias) is rejected at the
 * edge with a clear 400, instead of being forwarded to LiteLLM where it
 * would surface as a confusing "Model 'x' is not available" error. */
const VALID_UPSTREAM_MODELS = new Set([
  'haiku-5.5',
  'sonnet-5.5',
  'opus-5.5',
  'gpt-6-astra',
]);

/**
 * Rewrite `model: <alias>` → `model: <upstream-model>` before forwarding.
 *
 * OFF by default, deliberately. The live gateway's LiteLLM resolves the
 * aliases itself (`config/litellm.yaml` model_list), and its virtual keys and
 * teams are allowlisted by ALIAS name — a request naming the resolved upstream
 * model is denied with 403 before the router is ever consulted. With
 * rewriting on, every alias call on the live gateway failed that way
 * (2026-10-27: the customer saw `Model 'error' is not available`). Only set
 * `EDGE_RESOLVE_ALIASES=1` for a LiteLLM whose own alias resolution is
 * unavailable, and pair it with upstream-name allowlists.
 */
const RESOLVE_ALIASES = process.env.EDGE_RESOLVE_ALIASES === '1';

/** `claude-fast` → `fast`, or undefined. One lookup, never chained: the result
 * is never fed back into MODEL_ALIAS, because a tier alias is what keys are
 * allowlisted on (portal/lib/litellm/client.ts:167) and what LiteLLM's
 * model_list resolves to an upstream model. */
export function requestAlias(model) {
  return typeof model === 'string' ? CLAUDE_ALIAS[model] : undefined;
}

export function resolveModelAlias(bodyBuf) {
  let parsed;
  try {
    parsed = JSON.parse(bodyBuf.toString('utf8'));
  } catch {
    return { model: null, body: bodyBuf };
  }
  const model = typeof parsed?.model === 'string' ? parsed.model : null;
  if (!model) return { model, body: bodyBuf };
  // claude-* → tier alias, always, and never onward through MODEL_ALIAS below:
  // keys are allowlisted per tier, so forwarding haiku-5.5 would 403 every
  // existing key. That is one step and the result is not looked up again.
  const alias = requestAlias(model);
  if (alias) {
    parsed.model = alias;
    return { model: alias, body: Buffer.from(JSON.stringify(parsed), 'utf8') };
  }
  if (!RESOLVE_ALIASES || !MODEL_ALIAS[model]) {
    return { model, body: bodyBuf };
  }
  // Exactly one step: `fast` → `haiku-5.5` stops at the upstream name. Never
  // look the result up again.
  const resolved = MODEL_ALIAS[model];
  parsed.model = resolved;
  return { model: resolved, body: Buffer.from(JSON.stringify(parsed), 'utf8') };
}

/** Validate the model the edge is about to forward. Returns null if OK, or a
 * 400 message if the model is unknown. A customer alias is always valid —
 * LiteLLM resolves it through model_list and allowlists it — and so is a
 * concrete upstream name for a LiteLLM set up to serve them. Missing model is
 * allowed (LiteLLM decides). */
function modelRejection(model) {
  if (!model) return null;
  if (MODEL_ALIAS[model]) return null;
  if (VALID_UPSTREAM_MODELS.has(model)) return null;
  const aliases = Object.keys(MODEL_ALIAS).join(', ');
  const upstream = Object.values(MODEL_ALIAS).join(', ');
  return `Unknown model '${model}'. Use ${aliases} (or the upstream names ${upstream}).`;
}

/** True when the path is outside the model surface. Every such request is
 * answered 404 without touching the upstream. */
function isDeniedPath(pathname) {
  return !isModelPath(pathname);
}

/**
 * Substitute the customer prefix for the gateway's one.
 *
 * Only the LEADING prefix, only when it is `zn-`. Everything else — the
 * gateway's master key, a JWT, a hashed token id, an `sk-` key issued before
 * this format existed — is returned byte-identical.
 */
export function rewriteCredential(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith(CUSTOM_PREFIX)) return { value: trimmed, rewritten: false };
  const body = trimmed.slice(CUSTOM_PREFIX.length);
  // A prefix with nothing usable behind it is refused rather than turned
  // into `sk-`, which would be a syntactically valid credential with no
  // secret in it.
  if (body.length < MIN_BODY) return { value: trimmed, rewritten: false, malformed: true };
  return { value: GATEWAY_PREFIX + body, rewritten: true };
}

/** `Bearer zn-…` → `Bearer sk-…`, preserving the scheme and spacing. */
function rewriteAuthorization(raw) {
  const m = /^(\s*)(bearer)(\s+)(.*)$/i.exec(raw);
  if (!m) {
    const r = rewriteCredential(raw);
    return { value: r.value, rewritten: r.rewritten, malformed: r.malformed };
  }
  const r = rewriteCredential(m[4]);
  if (!r.rewritten && !r.malformed) return { value: raw, rewritten: false };
  return { value: `${m[1]}${m[2]}${m[3]}${r.value}`, rewritten: r.rewritten, malformed: r.malformed };
}

function failClosed(res, status, message) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = JSON.stringify({ error: { message, type: 'auth_edge_error' } });
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Upstream model name → customer-facing alias, so a denial that names the
 * routed model ('sonnet-5.5') still reaches the customer as 'smart'. */
const UPSTREAM_TO_ALIAS = {
  "haiku-5.5": "fast",
  "sonnet-5.5": "smart",
  "opus-5.5": "frontier",
  // `fable` is served by the provider's `gpt-6-astra`. Without this entry a
  // denial that named the routed model fell through to the quoted-candidate
  // heuristic and could surface the upstream name to a customer — the one
  // thing the alias layer exists to prevent.
  "gpt-6-astra": "fable",
};

/** Quoted tokens that are error-dialect words, never a model name. Guards
 * the quoted-candidates fallback. */
const NON_MODEL_TOKENS = new Set([
  "error", "message", "model", "key", "api_key", "apikey", "invalid",
  "invalid_request_error", "request", "access", "denied", "token", "tokens",
  "plan", "type", "code", "status", "api", "llm", "provider", "mast", "auth",
]);

/** The customer-facing alias for a model name — alias, or upstream name,
 * or nothing (an unknown token keeps no display identity of its own). */
function displayAlias(model) {
  if (typeof model !== "string" || model.length === 0) return null;
  if (UPSTREAM_TO_ALIAS[model]) return UPSTREAM_TO_ALIAS[model];
  if (MODEL_ALIAS[model]) return model;
  return null;
}

/**
 * Map a generic LiteLLM model-denied 403 to an actionable message.
 *
 * LiteLLM answers a disallowed model with 403 and a body like
 * "Model 'frontier' is not available for this API key" (wording varies by
 * version). Customers cannot act on that — it reads as a credential bug.
 * The edge cannot know whether the alias is token-exhausted or simply not
 * in the plan, so the mapped message names the model and states both, and
 * always contains `out of <alias>` for the quota case. Anything that is
 * not a model-access denial passes through untouched.
 *
 * The model is named by, in order: an alias word in the body, the model the
 * CUSTOMER requested (`requestedModel`, passed by both proxy and responses
 * paths), or a quoted token inside `error.message`. The raw body is never
 * scanned for quoted tokens: its first quoted string is the `"error"` JSON
 * key itself, and a message that once claimed the model was 'error' came
 * from exactly that mistake.
 *
 * Pure (no I/O): unit-tested via the auth-edge suite.
 */
export function mapModelDeniedBody(status, rawText, requestedModel = null) {
  if (status !== 403) return null;
  const text = String(rawText ?? '');
  if (!/not\s+(available|allowed)|not\s+allowed\s+for|excluded|no\s+access|denied|not\s+have\s+access/i.test(text)) {
    return null;
  }
  let messageText = text;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      const err = parsed.error;
      if (err && typeof err === 'object' && typeof err.message === 'string') messageText = err.message;
      else if (typeof parsed.message === 'string') messageText = parsed.message;
    }
  } catch {
    // Plaintext body — scan as-is.
  }
  const bodyAlias = /\b(fast|smart|frontier|fable)\b/i.exec(text)?.[1]?.toLowerCase() ?? null;
  const requested = displayAlias(requestedModel);
  const quoted = messageText.match(/["']([A-Za-z0-9][A-Za-z0-9_.\-]{1,64})["']/g) ?? [];
  const candidates = quoted
    .map((q) => q.slice(1, -1))
    .filter((token) => !NON_MODEL_TOKENS.has(token.toLowerCase()))
    .map((token) => displayAlias(token) ?? token);
  const model = bodyAlias ?? requested ?? candidates[0] ?? null;
  // 0038: budgets are MONTHLY since the window moved to the subscription
  // period. Telling a customer "resets at midnight" would be a lie that
  // invites them to wait for a reset that no longer happens.
  //
  // 0039: do NOT name the model. The allowance is one shared pool, so a
  // customer told "out of fast tokens" switches to smart, gets a second
  // 403, and concludes the product is broken. The plan is out of tokens as
  // a whole, and that is what the message must say.
  const message = model
    ? `Model '${model}' is not available for this API key — you may be out of tokens for this billing period or your plan does not include it. Check usage for remaining tokens.`
    : 'Model not available for this API key — you may be out of tokens for this billing period or your plan does not include it. Check usage for remaining tokens.';
  return { model, message };
}

/** Buffer a small upstream error body, map a model denial, answer. */
function handleProxyUpstreamError(upstreamRes, res, req, started, rewritten, status, outHeaders, requestedModel = null, keyPrefix = null) {
  const chunks = [];
  upstreamRes.on('data', (c) => chunks.push(c));
  upstreamRes.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const mapped = mapModelDeniedBody(status, raw, requestedModel);
    if (!mapped) {
      // Not a model denial — pass through byte-identical.
      res.writeHead(status, outHeaders);
      res.end(raw);
      log(req, started, status, rewritten, null, 'proxy', displayAlias(requestedModel), keyPrefix);
      return;
    }
    const body = JSON.stringify({ error: { message: mapped.message, type: 'auth_edge_error', model: mapped.model } });
    res.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
    log(req, started, status, rewritten, null, 'proxy:model-denied', mapped.model, keyPrefix);
  });
}

const server = http.createServer((req, res) => {
  const started = process.hrtime.bigint();

  (async () => {
    try {

  let pathname = '/';
  try {
    pathname = new URL(req.url ?? '/', 'http://edge.invalid').pathname;
  } catch {
    return failClosed(res, 400, 'Malformed request target.');
  }

  // The edge's own liveness. Not forwarded, and deliberately not a
  // LiteLLM route, so it cannot shadow one.
  if (pathname === '/__edge/health') {
    const body = JSON.stringify({ status: 'ok', upstream: UPSTREAM.origin });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    return res.end(body);
  }

  if (isDeniedPath(pathname)) {
    return failClosed(res, 404, 'Not found');
  }

  // ── Credential substitution ────────────────────────────────────────
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(name.toLowerCase())) continue;
    if (Array.isArray(value)) {
      headers[name] = value.map((v) => v);
    } else {
      headers[name] = value;
    }
  }

  let rewritten = false;
  let malformed = false;

  // Read the prefix BEFORE the substitution below: the portal stores the
  // display prefix of the `zn-` credential it issued, so a prefix taken
  // from the rewritten `sk-` header could never be joined to `api_keys`.
  const keyPrefix = credentialPrefix(req.headers);
  for (const [name, lower] of [['Authorization', 'authorization'], ['X-Api-Key', 'x-api-key']]) {
    const raw = req.headers[lower];
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const r = lower === 'authorization' ? rewriteAuthorization(raw) : rewriteCredential(raw);
    if (r.malformed) malformed = true;
    if (r.rewritten) rewritten = true;
    headers[name] = r.value;
  }

  // A credential that claims to be ours but carries no usable body is
  // rejected here. Forwarding it would turn a typo into an upstream 400
  // with a different message, and would risk a silent fallthrough.
  if (malformed) {
    return failClosed(res, 401, 'Invalid API key.');
  }

  // ── Responses → Chat translation ────────────────────────────────────
  // The one route that is rewritten rather than forwarded. Everything else
  // below this point is the original pure-proxy path, untouched.
  const wantsShim = RESPONSES_SHIM && req.method === 'POST' && pathname === RESPONSES_PATH;

  if (wantsShim) {
    return handleResponses(req, res, headers, started, rewritten, keyPrefix);
  }

  // ── Buffer the body when the edge must inspect it ───────────────────
  // Everything else is a pure pipe: no buffering, no content-length.
  let bodyBuf;
  let requestedModel = null;
  /**
   * Set when this turn asks what the assistant is. The answer for such a turn is
   * held until the upstream finishes and then passed through
   * `repairIdentityAnswer`, because the identity prompt is a prior and not a
   * guarantee (see edge/identity.mjs). `null` on every other turn, which then
   * streams exactly as it always has.
   */
  let identityHold = null;

  // /v1/messages: drop blocks the upstream refuses. An Anthropic-shaped body
  // is forwarded verbatim, which is what makes images reach the model — and
  // also what makes a PDF block reach the upstream and 400. A PDF stays in
  // the history for the rest of the conversation, so one attachment would
  // wedge the session permanently. Rewrite those blocks to a text note;
  // everything else is forwarded byte-for-byte. See upstream-guard.mjs.
  // `count_tokens` carries the same `claude-*` names and must be rewritten
  // the same way. It is not the chat path — no block sanitizing, no model
  // validation — but it IS a path Claude Desktop calls on every turn to
  // draw its context meter, and it 403s on a `claude-*` name because keys
  // are allowlisted by TIER alias. Measured: `count_tokens` answered 403
  // for `claude-smart` while `smart` answered 200, so the meter would read
  // "unknown" and a client could silently fall back to a small context.
  if (req.method === 'POST' && pathname === '/v1/messages/count_tokens') {
    const raw = await readBody(req);
    const parsed = tryParseJson(raw);
    bodyBuf = raw;
    if (parsed) {
      const original = typeof parsed.model === 'string' ? parsed.model : null;
      requestedModel = original;
      const alias = requestAlias(original);
      if (alias) {
        parsed.model = alias;
        requestedModel = alias;
        bodyBuf = Buffer.from(JSON.stringify(parsed), 'utf8');
        log(req, started, 200, rewritten, null, 'count_tokens:alias', alias, keyPrefix);
      }
    }
    headers['content-length'] = bodyBuf.length;
  }

  if (req.method === 'POST' && pathname === '/v1/messages') {
    const raw = await readBody(req);
    const parsed = tryParseJson(raw);
    bodyBuf = raw;
    if (parsed) {
      const { body, changed: guarded } = sanitizeRequest(parsed);
      requestedModel = typeof body.model === 'string' ? body.model : null;
      // `claude-fast` → `fast`, exactly one step, and NOT onward to the
      // upstream name. Keys are allowlisted per tier alias, so forwarding
      // `haiku-5.5` here would 403 every existing key — the whole reason
      // this rewrite exists. LiteLLM's model_list resolves `fast` itself.
      // Only claude-* is rewritten: the four tier aliases already work
      // untouched on this path.
      let changed = guarded;
      const alias = requestAlias(requestedModel);
      if (alias) {
        body.model = alias;
        requestedModel = alias;
        changed = true;
      }
      // ── Brand identity ──────────────────────────────────────────────
      // Prepended to the client's own `system`, never replacing it. This is the
      // Anthropic dialect: `system` is a top-level field and may be a string or
      // a block array, which is why the apply function handles both. See
      // edge/identity.mjs.
      const identity = applyMessagesIdentity(body, requestedModel);
      if (identity.changed) {
        Object.assign(body, identity.body);
        changed = true;
      }
      if (changed) {
        bodyBuf = Buffer.from(JSON.stringify(body), 'utf8');
        log(req, started, 200, rewritten, null, 'messages:guarded', displayAlias(requestedModel), keyPrefix);
      }
      // Hold the answer when this turn is a question about the product.
      // A prompt is a prior; the repair below is the guarantee, and it can
      // only fire if the text is still available when the stream ends.
      identityHold = isIdentityQuestion(lastUserText(body, 'messages'))
        ? { alias: requestedModel }
        : null;
    }
    headers['content-length'] = bodyBuf.length;
  }

  // chat/completions: alias handling so LiteLLM receives a name it can serve.
  if (req.method === 'POST' && pathname === '/v1/chat/completions') {
    const resolved = resolveModelAlias(await readBody(req));
    bodyBuf = resolved.body;
    requestedModel = resolved.model;
    headers['content-length'] = bodyBuf.length;

    // Reject unknown models at the edge with a clear 400 instead of
    // forwarding to LiteLLM where they surface as "Model 'x' is not
    // available". A missing model is allowed (LiteLLM decides).
    const forwarded = RESOLVE_ALIASES && requestedModel && MODEL_ALIAS[requestedModel]
      ? MODEL_ALIAS[requestedModel]
      : requestedModel;
    const reject = modelRejection(forwarded);
    if (reject) {
      return failClosed(res, 400, reject);
    }

    // ── Brand identity ────────────────────────────────────────────────
    // OpenAI dialect: the system prompt is a `system` entry in `messages`. This
    // runs AFTER modelRejection so a rejected model never gets a prompt built
    // for it, and it is idempotent so a client that already sends our block (the
    // portal) is not doubled. See edge/identity.mjs.
    const chatBody = tryParseJson(bodyBuf);
    if (chatBody) {
      const identity = applyChatIdentity(chatBody, requestedModel);
      if (identity.changed) {
        bodyBuf = Buffer.from(JSON.stringify(identity.body), 'utf8');
        headers['content-length'] = bodyBuf.length;
        log(req, started, 200, rewritten, null, 'chat:identity', displayAlias(requestedModel), keyPrefix);
      }
      identityHold = isIdentityQuestion(lastUserText(chatBody, 'chat'))
        ? { alias: requestedModel }
        : null;
    }
  }

  const upstreamReq = http.request(
    {
      protocol: UPSTREAM.protocol,
      hostname: UPSTREAM.hostname,
      port: UPSTREAM.port || (UPSTREAM.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: req.url,
      headers,
      agent: UPSTREAM_AGENT,
    },
    (upstreamRes) => {
      const status = upstreamRes.statusCode ?? 502;
      const outHeaders = {};
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (HOP_BY_HOP.has(name.toLowerCase())) continue;
        // Pass framing through untouched: chunked in, chunked out. Setting
        // our own content-length here would break SSE.
        outHeaders[name] = value;
      }
      // ── Model discovery: advertise the claude-* names ──────────────
      // Claude Desktop's custom-endpoint picker reads this list, so without
      // this it offers `fast`/`smart`/… and never the `claude-*` names the
      // user was told to enter. Buffered (it is a small JSON array, never a
      // stream) and rewritten; every other route still streams untouched.
      //
      // Each claude-* name is added ONLY for a tier LiteLLM already returned,
      // so the list stays exactly as wide as the key's allowlist — this adds
      // no capability, it adds a second spelling of one the key already has.
      if (req.method === 'GET' && pathname === '/v1/models' && status === 200) {
        const chunks = [];
        upstreamRes.on('data', (c) => chunks.push(c));
        upstreamRes.on('end', () => {
          const raw = Buffer.concat(chunks);
          let body = raw;
          try {
            // Size fields FIRST: the claude-* twins are cloned from the tier
            // entry below, so stating sizes after the clone would leave the
            // twins advertising the client's default 200K.
            const withTwins = advertiseClaudeAliases(JSON.parse(raw.toString('utf8')));
            body = Buffer.from(JSON.stringify(advertiseModelSizes(withTwins)), 'utf8');
            outHeaders['content-length'] = body.length;
          } catch {
            // Not JSON (a proxy error page, say). Forward it byte-for-byte
            // rather than turning a readable upstream error into a 502.
          }
          res.writeHead(status, outHeaders);
          res.end(body);
          log(req, started, status, rewritten, null, 'models:advertised', null, keyPrefix);
        });
        upstreamRes.on('error', () => { res.writeHead(502); res.end(); });
        return;
      }
      // A model-access denial is a small JSON error, never a stream — buffer
      // it so the customer gets `out of <alias> tokens` instead of the
      // generic gateway wording. Everything else streams untouched.
      if (status === 403 && (req.method === 'POST' || req.method === 'GET')) {
        handleProxyUpstreamError(
          upstreamRes, res, req, started, rewritten, status, outHeaders, requestedModel, keyPrefix,
        );
        return;
      }
      // ── Identity repair, by dialect ────────────────────────────────
      // Only an identity turn sets `identityHold`, and only those are buffered.
      // The answer is rebuilt before it reaches the client because a leaked
      // vendor name is usually the FIRST thing the model emits: streaming it and
      // correcting it afterwards would show the customer the exact fact the
      // repair exists to remove. Every other turn takes the streaming path
      // below, unchanged.
      //
      // The body shape follows the ROUTE, not a guess: an OpenAI
      // `chat.completion(.chunk)` on /v1/chat/completions, an Anthropic
      // `message` / `content_block_delta` on /v1/messages.
      if (identityHold && status < 400) {
        const isChat = pathname === '/v1/chat/completions';
        const chunks = [];
        upstreamRes.on('data', (c) => chunks.push(c));
        upstreamRes.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const type = upstreamRes.headers['content-type'];
          const repaired = isChat
            ? repairChatAnswer(raw, identityHold.alias, type)
            : repairMessagesAnswer(raw, identityHold.alias, type);
          delete outHeaders['content-length'];
          const out = Buffer.from(repaired, 'utf8');
          outHeaders['content-length'] = out.length;
          res.writeHead(status, outHeaders);
          res.end(out);
          log(
            req, started, status, rewritten, null,
            isChat ? 'chat:identity-repair' : 'messages:identity-repair',
            displayAlias(requestedModel), keyPrefix,
          );
        });
        upstreamRes.on('error', () => { res.writeHead(502); res.end(); });
        return;
      }
      res.writeHead(status, outHeaders);
      upstreamRes.pipe(res);
      upstreamRes.on('end', () => {
        res.end();
        log(
          req, started, upstreamRes.statusCode ?? 502, rewritten, null, 'proxy',
          displayAlias(requestedModel), keyPrefix,
        );
      });
    },
  );

  // Fail closed: an unreachable gateway is a 502, never a silent success.
  upstreamReq.on('error', (err) => {
    log(req, started, 502, rewritten, err, 'proxy', displayAlias(requestedModel), keyPrefix);
    failClosed(res, 502, 'The API gateway is unavailable. Please retry.');
  });

  // No explicit timeout: a generation can legitimately run for minutes, and
  // the gateway owns its own timeouts. A timeout here would cut valid
  // long-running requests.

  // Send the (possibly alias-resolved) body, or pipe the raw request for
  // non-chat/completions routes and GETs.
  if (bodyBuf) {
    upstreamReq.end(bodyBuf);
  } else {
    req.pipe(upstreamReq);
  }

  // If the client goes away mid-upload, stop the upstream work too —
  // otherwise an abandoned request keeps spending a model call.
  req.on('aborted', () => upstreamReq.destroy());
  req.on('error', () => upstreamReq.destroy());

    } catch (err) {
      log(req, started, 502, null, err, 'proxy');
      if (!res.headersSent) {
        failClosed(res, 502, 'The API gateway encountered an error.');
      }
    }
  })();
});

/**
 * Repair an Anthropic-dialect answer, in either of the two shapes it arrives in.
 *
 * A `text/event-stream` response is a sequence of `content_block_delta` frames
 * carrying `{type:'text_delta', text:'…'}`; a plain response is a JSON body with
 * `content: [{type:'text', text:'…'}]`. The whole answer is reassembled, one
 * `repairIdentityAnswer` call is made on it, and the result is written back into
 * the shape it came in — so a client sees a normal Anthropic response either way.
 *
 * This is the ONLY place on this path that buffers, and it is reached only for an
 * identity turn (a few tokens), never for a long generation.
 */
export function repairMessagesAnswer(raw, alias, contentType) {
  const isSse = String(contentType ?? '').includes('text/event-stream');

  if (!isSse) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Not JSON: forward byte-for-byte rather than mangle a body we cannot read.
      return raw;
    }
    const blocks = Array.isArray(parsed?.content) ? parsed.content : [];
    const text = blocks
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    const repaired = repairIdentityAnswer(text, alias, true);
    if (repaired === null) return raw;

    // Replace the FIRST text block and drop the rest: the answer is one line, and
    // leaving a second text block behind would concatenate a duplicate.
    let replaced = false;
    parsed.content = blocks.filter((b) => {
      if (!b || b.type !== 'text') return true;
      if (replaced) return false;
      replaced = true;
      return true;
    });
    for (const b of parsed.content) {
      if (b?.type === 'text') {
        b.text = repaired;
        break;
      }
    }
    // A body with no text block at all still needs the answer.
    if (!replaced) parsed.content = [{ type: 'text', text: repaired }];
    return JSON.stringify(parsed);
  }

  // ── SSE ──
  // Each `data:` frame is JSON. Text deltas are dropped from the wire and the
  // surviving text is emitted once in the `content_block_stop` for that block,
  // as a single `content_block_delta`. Every other frame is passed through in
  // order, so `message_start`, `content_block_start`, usage and `message_stop`
  // all arrive exactly as the upstream sent them.
  const out = [];
  let text = '';
  let repairedText = null;

  for (const frame of raw.split('\n\n')) {
    if (frame.trim() === '') continue;
    const dataLines = frame.split('\n').filter((l) => l.startsWith('data:'));
    if (dataLines.length === 0) {
      out.push(frame);
      continue;
    }
    const payload = dataLines.map((l) => l.slice(5).trim()).join('');
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      out.push(frame);
      continue;
    }

    const isTextDelta =
      event?.type === 'content_block_delta' && event?.delta?.type === 'text_delta';
    if (isTextDelta) {
      text += event.delta.text ?? '';
      continue;
    }

    if (event?.type === 'content_block_stop' && text !== '') {
      if (repairedText === null) {
        repairedText = repairIdentityAnswer(text, alias, true) ?? text;
      }
      if (repairedText !== '') {
        out.push(
          `event: content_block_delta\ndata: ${JSON.stringify({
            type: 'content_block_delta',
            index: event.index,
            delta: { type: 'text_delta', text: repairedText },
          })}`,
        );
      }
      text = '';
    }

    out.push(frame);
  }

  // A stream that ended without a `content_block_stop` still owes the answer.
  if (text !== '') {
    const repaired = repairedText ?? repairIdentityAnswer(text, alias, true) ?? text;
    if (repaired !== '') {
      out.push(
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: repaired },
        })}`,
      );
    }
  }

  return `${out.join('\n\n')}\n\n`;
}

/**
 * Repair an OpenAI-dialect answer, in either of the two shapes it arrives in.
 *
 * Companion to `repairMessagesAnswer` below, and needed for the same reason: the
 * prompt is a prior, not a guarantee. Measured on the live edge 2026-11-27 with
 * the prompt present, `fast`, `frontier` and `fable` still named the vendor on
 * /v1/chat/completions — the chat dialect lets the model emit a reasoning pass
 * first, and the disclosure reflex tends to win during it.
 *
 * A streamed response is `chat.completion.chunk` frames whose text lives in
 * `choices[0].delta.content`; a plain response is one `chat.completion` with the
 * answer in `choices[0].message.content`. Both are rewritten to the same one-line
 * answer, and every other field — ids, usage, finish_reason, tool calls — is
 * passed through exactly as the upstream sent it.
 */
export function repairChatAnswer(raw, alias, contentType) {
  const isSse = String(contentType ?? '').includes('text/event-stream');

  if (!isSse) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return raw;
    }
    const text = parsed?.choices?.[0]?.message?.content;
    const repaired = repairIdentityAnswer(text, alias, true);
    if (repaired === null) return raw;
    parsed.choices[0].message.content = repaired;
    // A `refusal` alongside a corrected answer would contradict it, and some
    // clients render the refusal instead of the content.
    if ('refusal' in parsed.choices[0].message) parsed.choices[0].message.refusal = null;
    return JSON.stringify(parsed);
  }

  // ── SSE ──
  // Text deltas are held on the wire; the corrected answer is emitted once at the
  // final chunk for the same choice. Envelope frames (`role` deltas, usage-only
  // chunks, `[DONE]`) pass through untouched and in order, so a client's parser
  // sees a normal stream.
  const out = [];
  let text = '';
  let choiceIndex = 0;
  let roleEmitted = false;

  for (const frame of raw.split('\n\n')) {
    if (frame.trim() === '') continue;
    const dataLines = frame.split('\n').filter((l) => l.startsWith('data:'));
    if (dataLines.length === 0) {
      out.push(frame);
      continue;
    }
    const payload = dataLines.map((l) => l.slice(5).trim()).join('');
    if (payload === '[DONE]') {
      // The answer still owes its corrected text before the terminator.
      if (text !== '') {
        out.push(`data: ${JSON.stringify(chatDelta(choiceIndex, repairIdentityAnswer(text, alias, true) ?? text))}`);
        text = '';
      }
      out.push(frame);
      continue;
    }
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      out.push(frame);
      continue;
    }
    const choice = chunk?.choices?.[0];
    if (choice?.index !== undefined) choiceIndex = choice.index;

    // A role-only first chunk opens the message and must survive, or some clients
    // never bind the assistant turn.
    if (choice?.delta?.role && !roleEmitted) {
      roleEmitted = true;
      out.push(frame);
      continue;
    }

    const piece = choice?.delta?.content;
    if (typeof piece === 'string' && piece !== '') {
      text += piece;
      // Everything on the chunk except the held text still has to reach the
      // client — a `finish_reason` riding along with the last piece is the
      // common case, and dropping it truncates the turn for the client.
      const { content: _held, ...restDelta } = choice.delta;
      if (Object.keys(restDelta).length > 0) {
        const rest = { ...chunk, choices: [{ ...choice, delta: restDelta }] };
        // Flush the held text first so the order stays text-then-finish.
        out.push(`data: ${JSON.stringify(chatDelta(choiceIndex, repairIdentityAnswer(text, alias, true) ?? text))}`);
        text = '';
        out.push(`data: ${JSON.stringify(rest)}`);
      }
      continue;
    }

    out.push(frame);
  }

  if (text !== '') {
    out.push(`data: ${JSON.stringify(chatDelta(choiceIndex, repairIdentityAnswer(text, alias, true) ?? text))}`);
  }

  return `${out.join('\n\n')}\n\n`;
}

/** One `chat.completion.chunk` carrying a complete answer as its delta. */
function chatDelta(index, text) {
  return {
    object: 'chat.completion.chunk',
    choices: [{ index, delta: { content: text }, finish_reason: null }],
  };
}

/**
 * One line per request for forensics.
 *
 * `model` is the customer-facing ALIAS the request resolved to, never the
 * upstream name (the alias layer's whole point). It is what answers "which
 * model burned this key's tokens" without going to LiteLLM's spend table,
 * and it is the only field here that can attribute spend to a model.
 *
 * `key_prefix` is the credential's display prefix — exactly what the portal
 * stores in `api_keys.key_prefix` (`keyPrefixFor`, KEY_PREFIX_LENGTH = 12),
 * never enough to reconstruct the body. Without it an operator cannot tell
 * two of a customer's keys apart in the log, and with a different length the
 * line could not be joined to the portal's own row at all.
 */
function log(req, started, status, rewritten, err, route = 'proxy', model = null, keyPrefix = null) {
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const line = {
    msg: 'auth_edge',
    method: req.method,
    // Query strings can carry user input; keep the path only.
    path: (req.url ?? '').split('?')[0],
    status,
    ms: Math.round(ms),
    prefix_substituted: rewritten,
    route,
  };
  if (model) line.model = model;
  if (keyPrefix) line.key_prefix = keyPrefix;
  if (err) line.error = err.code ?? err.message;
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

/**
 * The display prefix of whichever credential the request carried.
 *
 * Bounded and non-secret by construction: KEY_PREFIX_LENGTH characters of a
 * `zn-`/`sk-` body, matching `keyPrefixFor` in the portal. A credential
 * shorter than the prefix is not reported at all rather than reported whole.
 */
const KEY_PREFIX_LENGTH = 12;

function credentialPrefix(headers) {
  const raw = headers?.Authorization ?? headers?.authorization;
  const value = typeof raw === 'string' ? raw : '';
  const token = value.startsWith('Bearer ') ? value.slice(7).trim() : value;
  if (!/^(zn|sk)-[A-Za-z0-9_-]{16,}$/.test(token)) return null;
  return token.slice(0, KEY_PREFIX_LENGTH);
}

// ── Responses route ─────────────────────────────────────────────────────

/**
 * Request-body ceiling. A Responses body is a full conversation plus a tool
 * catalogue; a coding agent's can be large, but not unbounded. Without a cap
 * this route becomes an unbounded memory allocation keyed on a client's
 * willingness to send bytes.
 */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

/** Read a request body with a hard ceiling. Never resolves past the cap. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Parse a body for inspection. Returns null rather than throwing: a body
 *  that is not JSON is forwarded untouched for the upstream to judge. */
function tryParseJson(buf) {
  try {
    const parsed = JSON.parse(buf.toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function failResponses(res, status, message) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  // Responses-shaped, so a Codex client surfaces the message rather than
  // choking on an unexpected envelope.
  const body = JSON.stringify({ error: { message, type: 'invalid_request_error', code: null } });
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Translate one /v1/responses request into a /v1/chat/completions call. */
async function handleResponses(req, res, headers, started, rewritten, keyPrefix = null) {
  let raw;
  try {
    raw = await readBody(req);
  } catch (err) {
    log(req, started, err.status ?? 400, rewritten, err, 'responses');
    return failResponses(res, err.status ?? 400, 'Could not read the request body.');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    log(req, started, 400, rewritten, null, 'responses');
    return failResponses(res, 400, 'Request body is not valid JSON.');
  }

  const translated = responsesToChat(parsed);
  if (!translated.ok) {
    // Refused deliberately, not mangled. Silently dropping the unsupported
    // field would hand the model a truncated history that still looks like a
    // success.
    log(req, started, translated.status, rewritten, null, 'responses:refused');
    return failResponses(res, translated.status, translated.message);
  }

  // Resolve model alias so LiteLLM receives a concrete model name, mirroring
  // the proxy-path alias resolution — but only when alias rewriting is on
  // (see RESOLVE_ALIASES: the default gateway's LiteLLM resolves the alias and
  // allowlists by alias, so a rewritten name would be denied).
  if (RESOLVE_ALIASES && translated.body.model && MODEL_ALIAS[translated.body.model]) {
    translated.body.model = MODEL_ALIAS[translated.body.model];
  }
  // Claude Desktop names, one step to the tier alias — otherwise the
  // modelRejection below 400s a `claude-*` name.
  const claudeAlias = requestAlias(translated.body.model);
  if (claudeAlias) translated.body.model = claudeAlias;

  // Reject unknown models at the edge with a clear 400 instead of
  // forwarding to LiteLLM where they surface as "Model 'x' is not
  // available". A missing model is allowed (LiteLLM decides).
  const reject = modelRejection(translated.body.model);
  if (reject) {
    log(req, started, 400, rewritten, null, 'responses:invalid-model');
    return failResponses(res, 400, reject);
  }

  // Same capability guard as /v1/messages: a document or URL image the
  // upstream refuses would fail this turn and every later turn that
  // replays it. See upstream-guard.mjs.
  let guarded = translated.body;
  const sanitized = sanitizeRequest(guarded);
  if (sanitized.changed) {
    guarded = sanitized.body;
    log(req, started, 200, rewritten, null, 'responses:guarded', displayAlias(parsed.model), keyPrefix);
  }

  // ── Brand identity ──────────────────────────────────────────────────
  // Responses dialect: the system prompt is `instructions`, which
  // `responsesToChat` turns into a leading system message. Prepending here means
  // the identity survives the translation without the shim knowing about it.
  // Applied to the CHAT body (post-translation) so there is exactly one place a
  // system message can come from, and so a client that sets `instructions`
  // keeps every word of it. See edge/identity.mjs.
  const identity = applyChatIdentity(guarded, translated.body.model);
  if (identity.changed) {
    guarded = identity.body;
    log(req, started, 200, rewritten, null, 'responses:identity', displayAlias(parsed.model), keyPrefix);
  }
  // Hold the answer for an identity turn — the repair needs the whole text.
  const identityHold = isIdentityQuestion(lastUserText(translated.body, 'chat'))
    ? { alias: translated.body.model }
    : null;

  const chatBody = Buffer.from(JSON.stringify(guarded), 'utf8');

  const outHeaders = { ...headers };
  delete outHeaders['content-length'];
  delete outHeaders['content-encoding'];
  delete outHeaders['accept-encoding'];
  outHeaders['content-length'] = chatBody.length;
  outHeaders['content-type'] = 'application/json';
  // LiteLLM resolves the alias on chat/completions, which is what makes the
  // `fast` group and its metering work.
  outHeaders['x-gateway-route'] = 'responses-shim';

  const upstreamReq = http.request(
    {
      protocol: UPSTREAM.protocol,
      hostname: UPSTREAM.hostname,
      port: UPSTREAM.port || (UPSTREAM.protocol === 'https:' ? 443 : 80),
      method: 'POST',
      path: '/v1/chat/completions',
      headers: outHeaders,
      agent: UPSTREAM_AGENT,
    },
    (upstreamRes) => { handleResponsesUpstream(upstreamRes, res, req, started, rewritten, parsed.model, keyPrefix, identityHold); },
  );

  upstreamReq.on('error', (err) => {
    log(req, started, 502, rewritten, err, 'responses', displayAlias(parsed.model), keyPrefix);
    failResponses(res, 502, 'The API gateway is unavailable. Please retry.');
  });

  req.on('aborted', () => upstreamReq.destroy());
  upstreamReq.end(chatBody);
}

function handleResponsesUpstream(upstreamRes, res, req, started, rewritten, requestedModel, keyPrefix = null, identityHold = null) {
  const status = upstreamRes.statusCode ?? 502;
  const type = String(upstreamRes.headers['content-type'] ?? '');

  // An upstream error must reach the client as an error, with its own
  // status. Turning a 429 into a 200 with an empty completion would let an
  // agent believe the model answered.
  if (status >= 400) {
    const chunks = [];
    upstreamRes.on('data', (c) => chunks.push(c));
    upstreamRes.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const mapped = mapModelDeniedBody(status, raw, requestedModel);
      let message = 'The upstream request failed.';
      if (mapped) {
        // A model denial reaches the customer with the per-alias wording,
        // same as the proxy path — not the LiteLLM-internal name.
        message = mapped.message;
      } else {
        try {
          message = JSON.parse(raw)?.error?.message ?? message;
        } catch { /* keep the generic message */ }
      }
      log(req, started, status, rewritten, null, 'responses:upstream-error', displayAlias(requestedModel), keyPrefix);
      failResponses(res, status, message);
    });
    return;
  }

  if (type.includes('text/event-stream')) {
    streamResponses(upstreamRes, res, req, started, rewritten, requestedModel, keyPrefix, identityHold);
    return;
  }

  const chunks = [];
  upstreamRes.on('data', (c) => chunks.push(c));
  upstreamRes.on('end', () => {
    let chat;
    try {
      chat = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (err) {
      log(req, started, 502, rewritten, err, 'responses:bad-upstream-json');
      return failResponses(res, 502, 'The upstream returned an unreadable response.');
    }
    // ── Identity repair, exactly once, before the body is serialized. ──
    // The prompt is a prior; this is the guarantee. Only an identity turn sets
    // `identityHold`, so every other answer is passed through untouched — a
    // customer asking about haiku-5.5 as a product gets the real answer.
    if (identityHold) {
      const text = chat?.choices?.[0]?.message?.content;
      const repaired = repairIdentityAnswer(text, identityHold.alias, true);
      if (repaired !== null) {
        chat.choices[0].message.content = repaired;
        chat.choices[0].message.refusal = null;
        log(req, started, 200, rewritten, null, 'responses:identity-repair', displayAlias(requestedModel), keyPrefix);
      }
    }
    const body = JSON.stringify(chatToResponses(chat, requestedModel));
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
    log(req, started, 200, rewritten, null, 'responses', displayAlias(requestedModel), keyPrefix);
  });
}

/**
 * Translate a Chat SSE stream into Responses SSE, incrementally.
 *
 * Nothing is aggregated: each Chat chunk is translated and written as it
 * arrives, so the client still sees tokens live. A `response.completed` event
 * is always emitted, including when the upstream produced no chunks at all —
 * a client that waits for `completed` would otherwise hang until timeout.
 */
function streamResponses(upstreamRes, res, req, started, rewritten, requestedModel, keyPrefix = null, identityHold = null) {
  const tr = new ResponsesStreamTranslator({ model: requestedModel });

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // Deliberately NO content-length: this is a stream.
  });

  let pending = '';
  let opened = false;

  const write = (events) => {
    if (events.length === 0) return;
    if (!opened) {
      // The first Chat chunk carries the role delta; emit `created` first so
      // the client has a response id before any output item appears.
      for (const e of events) res.write(encodeSse(e));
      opened = true;
      return;
    }
    for (const e of events) res.write(encodeSse(e));
  };

  upstreamRes.on('data', (c) => {
    pending += c.toString('utf8');
    // Split on the SSE frame boundary. A partial trailing frame stays in
    // `pending` for the next chunk — splitting on a bare newline would
    // corrupt any frame split across a TCP segment.
    let idx;
    while ((idx = pending.indexOf('\n\n')) !== -1) {
      const frame = pending.slice(0, idx);
      pending = pending.slice(idx + 2);
      const dataLines = frame.split('\n').filter((l) => l.startsWith('data:'));
      if (dataLines.length === 0) continue;
      const payload = dataLines.map((l) => l.slice(5).trim()).join('');
      if (payload === '' || payload === '[DONE]') continue;
      let chunk;
      try {
        chunk = JSON.parse(payload);
      } catch {
        // An unparseable frame is dropped rather than fatal: one bad frame
        // must not truncate an otherwise good stream.
        continue;
      }
      write(tr.push(chunk).filter(
        // Hold the ANSWER TEXT when this turn asks what the assistant is.
        //
        // The repair can only work on the whole answer, and a leaked vendor name
        // is usually the FIRST thing the model emits — streaming it and
        // correcting it afterwards would show the customer the very fact the
        // repair exists to remove. Everything else on a held turn still streams:
        // `created`/`in_progress`, reasoning, tool calls. Only the answer text is
        // deferred to one `output_text.done` at the end.
        //
        // On every other turn `identityHold` is null, so this is a no-op and the
        // stream is byte-for-byte what it always was.
        (e) => !(identityHold && e?.data?.type === 'response.output_text.delta'),
      ));
    }
  });

  const finish = () => {
    // ── Identity repair, on the accumulated text. ─────────────────────
    // `tr.text` is what `output_text.done` and every `completed` snapshot are
    // built from, so replacing it here fixes the whole turn with one edit —
    // there is no second copy of the answer anywhere.
    if (identityHold) {
      const repaired = repairIdentityAnswer(tr.text, identityHold.alias, true);
      if (repaired !== null) {
        tr.text = repaired;
        log(req, started, 200, rewritten, null, 'responses:identity-repair', displayAlias(requestedModel), keyPrefix);
      }
    }
    if (!res.writableEnded) {
      for (const e of tr.finish()) res.write(encodeSse(e));
      res.end();
    }
    log(req, started, 200, rewritten, null, 'responses:stream', displayAlias(requestedModel), keyPrefix);
  };

  upstreamRes.on('end', finish);
  upstreamRes.on('error', (err) => {
    log(req, started, 502, rewritten, err, 'responses:stream', displayAlias(requestedModel), keyPrefix);
    if (!res.writableEnded) {
      // Still terminate the event sequence so the client gets a definitive
      // end rather than an infinite wait.
      for (const e of tr.finish()) res.write(encodeSse(e));
      res.end();
    }
  });
}

// Tune the inbound server so long reasoning streams are not cut off by node's
// default requestTimeout (5 min on recent node versions), while idle keep-alive
// sockets still recycle promptly.
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 0;
server.timeout = 0;

// Listen only when executed directly. Tests import `rewriteCredential` from
// this module; without the guard that import would bind a port as a side
// effect and leak a listener into the test run.
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  server.listen(LISTEN_PORT, LISTEN_HOST, () => {
    // Report the ACTUAL bound port, not the requested one: when the
    // listener is started with port 0 (kernel-assigned, as the test suite
    // does to avoid collisions), LISTEN_PORT is 0 and useless to anyone
    // trying to connect. server.address() is the only truth here.
    const bound = server.address();
    const boundPort =
      bound && typeof bound === 'object' ? bound.port : LISTEN_PORT;
    process.stdout.write(
      `${JSON.stringify({
        msg: 'auth_edge.listening',
        host: LISTEN_HOST,
        port: boundPort,
        upstream: UPSTREAM.origin,
        rewrites: `${CUSTOM_PREFIX} -> ${GATEWAY_PREFIX}`,
      })}\n`,
    );
  });

  // A closed listener must not leave the process half-alive: exit so the
  // supervisor restarts a clean instance.
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      server.close(() => process.exit(0));
      // Do not wait forever on lingering keep-alive sockets.
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
}