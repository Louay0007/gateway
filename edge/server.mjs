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

const CUSTOM_PREFIX = 'zn-';
const GATEWAY_PREFIX = 'sk-';
const MIN_BODY = 16;

const LISTEN_HOST = process.env.AUTH_EDGE_HOST ?? '127.0.0.1';
const LISTEN_PORT = Number(process.env.AUTH_EDGE_PORT ?? 4001);
const UPSTREAM = new URL(
  process.env.AUTH_EDGE_UPSTREAM ?? 'http://127.0.0.1:4000',
);

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

const server = http.createServer((req, res) => {
  const started = process.hrtime.bigint();

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

  const upstreamReq = http.request(
    {
      protocol: UPSTREAM.protocol,
      hostname: UPSTREAM.hostname,
      port: UPSTREAM.port || (UPSTREAM.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: req.url,
      headers,
    },
    (upstreamRes) => {
      const outHeaders = {};
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (HOP_BY_HOP.has(name.toLowerCase())) continue;
        // Pass framing through untouched: chunked in, chunked out. Setting
        // our own content-length here would break SSE.
        outHeaders[name] = value;
      }
      res.writeHead(upstreamRes.statusCode ?? 502, outHeaders);
      upstreamRes.pipe(res);
      upstreamRes.on('end', () => {
        res.end();
        log(req, started, upstreamRes.statusCode ?? 502, rewritten);
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

  // Pipe the request body rather than ending the upstream request empty.
  // `pipe` ends it when the client body ends, which is correct for a GET
  // (immediately) and for a POST with a body.
  req.pipe(upstreamReq);

  // If the client goes away mid-upload, stop the upstream work too —
  // otherwise an abandoned request keeps spending a model call.
  req.on('aborted', () => upstreamReq.destroy());
  req.on('error', () => upstreamReq.destroy());
});

function log(req, started, status, rewritten, err) {
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  // Deliberately no credential, no credential length, no slice of it.
  const line = {
    msg: 'auth_edge',
    method: req.method,
    // Query strings can carry user input; keep the path only.
    path: (req.url ?? '').split('?')[0],
    status,
    ms: Math.round(ms),
    prefix_substituted: rewritten,
  };
  if (err) line.error = err.code ?? err.message;
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

// Listen only when executed directly. Tests import `rewriteCredential` from
// this module; without the guard that import would bind a port as a side
// effect and leak a listener into the test run.
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  server.listen(LISTEN_PORT, LISTEN_HOST, () => {
    process.stdout.write(
      `${JSON.stringify({
        msg: 'auth_edge.listening',
        host: LISTEN_HOST,
        port: LISTEN_PORT,
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