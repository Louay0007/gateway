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
 * Management routes. Mirrors the @mgmt matcher in config/Caddyfile. Kept in
 * step with it deliberately: this is a second lock, not a second policy.
 */
const MGMT_PREFIXES = [
  '/key/', '/user/', '/team/', '/organization/',
  '/model/', '/spend/', '/config/', '/global/',
  '/customer/', '/budget/',
];

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
};

/** Concrete upstream model names the edge is allowed to forward.
 * Anything not in this set (and not a known alias) is rejected at the
 * edge with a clear 400, instead of being forwarded to LiteLLM where it
 * would surface as a confusing "Model 'x' is not available" error. */
const VALID_UPSTREAM_MODELS = new Set([
  'haiku-5.5',
  'sonnet-5.5',
  'opus-5.5',
]);

/** Rewrite `model: <alias>` → `model: <upstream-model>` in a JSON request body.
 * Returns the (possibly new) body buffer; `content-length` must be updated
 * by the caller. Non-JSON bodies pass through untouched. */
function resolveModelAlias(bodyBuf) {
  let parsed;
  try {
    parsed = JSON.parse(bodyBuf.toString('utf8'));
  } catch {
    return bodyBuf;
  }
  if (parsed.model && MODEL_ALIAS[parsed.model]) {
    parsed.model = MODEL_ALIAS[parsed.model];
    return Buffer.from(JSON.stringify(parsed), 'utf8');
  }
  return bodyBuf;
}

/** Validate a resolved model name. Returns null if OK, or a 400 message
 * if the model is unknown. Missing model is allowed (LiteLLM decides). */
function modelRejection(model) {
  if (!model) return null;
  if (VALID_UPSTREAM_MODELS.has(model)) return null;
  const aliases = Object.keys(MODEL_ALIAS).join(', ');
  const upstream = Object.values(MODEL_ALIAS).join(', ');
  return `Unknown model '${model}'. Use ${aliases} (or the upstream names ${upstream}).`;
}

function isMgmtPath(pathname) {
  return (
    MGMT_PREFIXES.some((p) => pathname.startsWith(p)) ||
    ['/key', '/user', '/team', '/organization', '/model', '/spend', '/config',
     '/global', '/customer', '/budget'].includes(pathname)
  );
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
 * Pure (no I/O): unit-tested via the auth-edge suite.
 */
export function mapModelDeniedBody(status, rawText) {
  if (status !== 403) return null;
  const text = String(rawText ?? '');
  if (!/not\s+(available|allowed)|not\s+allowed\s+for|excluded|no\s+access|denied|not\s+have\s+access/i.test(text)) {
    return null;
  }
  const aliasHit = /\b(fast|smart|frontier)\b/i.exec(text);
  const quotedHit = /["']([A-Za-z0-9][A-Za-z0-9\-_]{1,64})["']/.exec(text);
  const model = aliasHit ? aliasHit[1].toLowerCase() : quotedHit ? quotedHit[1] : null;
  const message = model
    ? `Model '${model}' is not available for this API key — you may be out of ${model} tokens or your plan does not include it. Check usage for remaining tokens.`
    : 'Model not available for this API key — you may be out of tokens or your plan does not include it. Check usage for remaining tokens.';
  return { model, message };
}

/** Buffer a small upstream error body, map a model denial, answer. */
function handleProxyUpstreamError(upstreamRes, res, req, started, rewritten, status, outHeaders) {
  const chunks = [];
  upstreamRes.on('data', (c) => chunks.push(c));
  upstreamRes.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const mapped = mapModelDeniedBody(status, raw);
    if (!mapped) {
      // Not a model denial — pass through byte-identical.
      res.writeHead(status, outHeaders);
      res.end(raw);
      log(req, started, status, rewritten, null, 'proxy');
      return;
    }
    const body = JSON.stringify({ error: { message: mapped.message, type: 'auth_edge_error', model: mapped.model } });
    res.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
    log(req, started, status, rewritten, null, 'proxy:model-denied');
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

  if (isMgmtPath(pathname)) {
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
    return handleResponses(req, res, headers, started, rewritten);
  }

  // Buffer + resolve model alias for chat/completions so LiteLLM always
  // receives a concrete model name, even if LiteLLM's own model_list alias
  // resolution is temporarily unavailable. All other routes stay a pure pipe.
  let bodyBuf;
  if (req.method === 'POST' && pathname === '/v1/chat/completions') {
    bodyBuf = await readBody(req);
    bodyBuf = resolveModelAlias(bodyBuf);
    headers['content-length'] = bodyBuf.length;

    // Reject unknown models at the edge with a clear 400 instead of
    // forwarding to LiteLLM where they surface as "Model 'x' is not
    // available". A missing model is allowed (LiteLLM decides).
    try {
      const parsed = JSON.parse(bodyBuf.toString('utf8'));
      const reject = modelRejection(parsed.model);
      if (reject) {
        return failClosed(res, 400, reject);
      }
    } catch {
      // Not JSON — pass through unchanged
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
      // A model-access denial is a small JSON error, never a stream — buffer
      // it so the customer gets `out of <alias> tokens` instead of the
      // generic gateway wording. Everything else streams untouched.
      if (status === 403 && (req.method === 'POST' || req.method === 'GET')) {
        handleProxyUpstreamError(upstreamRes, res, req, started, rewritten, status, outHeaders);
        return;
      }
      res.writeHead(status, outHeaders);
      upstreamRes.pipe(res);
      upstreamRes.on('end', () => {
        res.end();
        log(req, started, upstreamRes.statusCode ?? 502, rewritten, null, 'proxy');
      });
    },
  );

  // Fail closed: an unreachable gateway is a 502, never a silent success.
  upstreamReq.on('error', (err) => {
    log(req, started, 502, rewritten, err);
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

function log(req, started, status, rewritten, err, route = 'proxy') {
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
  if (err) line.error = err.code ?? err.message;
  process.stdout.write(`${JSON.stringify(line)}\n`);
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
async function handleResponses(req, res, headers, started, rewritten) {
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

  // Resolve model alias so LiteLLM always receives a concrete model name,
  // mirroring the proxy-path alias resolution.
  if (translated.body.model && MODEL_ALIAS[translated.body.model]) {
    translated.body.model = MODEL_ALIAS[translated.body.model];
  }

  // Reject unknown models at the edge with a clear 400 instead of
  // forwarding to LiteLLM where they surface as "Model 'x' is not
  // available". A missing model is allowed (LiteLLM decides).
  const reject = modelRejection(translated.body.model);
  if (reject) {
    log(req, started, 400, rewritten, null, 'responses:invalid-model');
    return failResponses(res, 400, reject);
  }

  const chatBody = Buffer.from(JSON.stringify(translated.body), 'utf8');

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
    (upstreamRes) => { handleResponsesUpstream(upstreamRes, res, req, started, rewritten, parsed.model); },
  );

  upstreamReq.on('error', (err) => {
    log(req, started, 502, rewritten, err, 'responses');
    failResponses(res, 502, 'The API gateway is unavailable. Please retry.');
  });

  req.on('aborted', () => upstreamReq.destroy());
  upstreamReq.end(chatBody);
}

function handleResponsesUpstream(upstreamRes, res, req, started, rewritten, requestedModel) {
  const status = upstreamRes.statusCode ?? 502;
  const type = String(upstreamRes.headers['content-type'] ?? '');

  // An upstream error must reach the client as an error, with its own
  // status. Turning a 429 into a 200 with an empty completion would let an
  // agent believe the model answered.
  if (status >= 400) {
    const chunks = [];
    upstreamRes.on('data', (c) => chunks.push(c));
    upstreamRes.on('end', () => {
      const raw = Buffer.concat(chunks);
      let message = 'The upstream request failed.';
      try {
        message = JSON.parse(raw.toString('utf8'))?.error?.message ?? message;
      } catch { /* keep the generic message */ }
      log(req, started, status, rewritten, null, 'responses:upstream-error');
      failResponses(res, status, message);
    });
    return;
  }

  if (type.includes('text/event-stream')) {
    streamResponses(upstreamRes, res, req, started, rewritten, requestedModel);
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
    const body = JSON.stringify(chatToResponses(chat, requestedModel));
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
    log(req, started, 200, rewritten, null, 'responses');
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
function streamResponses(upstreamRes, res, req, started, rewritten, requestedModel) {
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
      write(tr.push(chunk));
    }
  });

  const finish = () => {
    if (!res.writableEnded) {
      for (const e of tr.finish()) res.write(encodeSse(e));
      res.end();
    }
    log(req, started, 200, rewritten, null, 'responses:stream');
  };

  upstreamRes.on('end', finish);
  upstreamRes.on('error', (err) => {
    log(req, started, 502, rewritten, err, 'responses:stream');
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