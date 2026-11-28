/**
 * auth-edge behaviour, against the real module with a real upstream.
 *
 * These are the tests that matter most in this change: the edge sits in the
 * credential path, and its two dangerous failure modes are SILENT — a
 * mistranslated key that authenticates nothing (unmetered usage), or a
 * dropped header that turns a request anonymous without an error. Both
 * look like success from the outside.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { rewriteCredential, mapModelDeniedBody } from '../../edge/server.mjs';
import { fileURLToPath } from 'node:url';

// Absolute, so the child process is launched correctly whatever the CWD.
const EDGE_ENTRY = fileURLToPath(new URL('../../edge/server.mjs', import.meta.url));

/**
 * Spawn an edge on an OS-assigned port and resolve once it is listening.
 *
 * WHY NOT `upstreamPort + 1`. That arithmetic was a real flake, not a
 * hypothetical one: when vitest runs files in parallel, any other listener
 * can hold the neighbour port, the edge dies with EADDRINUSE, and every
 * request below gets ECONNREFUSED — which the suite reports as 9 failing
 * tests in the credential path. That reads as a product regression and is
 * not one. Passing port 0 lets the kernel reserve a free port atomically,
 * and the edge already announces its own port on stdout
 * (`auth_edge.listening`), so there is nothing to guess and no window in
 * which two processes can pick the same number.
 *
 * @param {Record<string, string>} envExtra
 * @returns {Promise<{ proc: import('node:child_process').ChildProcess, port: number, lines: any[] }>}
 */
async function startEdge(envExtra) {
  const { spawn } = await import('node:child_process');

  const proc = spawn(process.execPath, [EDGE_ENTRY], {
    env: {
      ...process.env,
      AUTH_EDGE_HOST: '127.0.0.1',
      AUTH_EDGE_PORT: '0', // kernel-assigned; see above
      ...envExtra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Every JSON line the edge writes, in order, for the whole life of the
  // process — not just the handshake. The audit fields (`model`,
  // `key_prefix`) are only observable here: they are written to stdout and
  // nowhere else, so a dropped argument at a `log(...)` call site would be
  // invisible without this buffer.
  /** @type {any[]} */
  const lines = [];

  const port = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(
      () => reject(new Error('edge did not report a listening port within 15s')),
      15_000,
    );
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      const parts = buf.split('\n');
      // The last element is a partial line until its newline arrives.
      buf = parts.pop() ?? '';
      for (const line of parts) {
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // not one of ours; keep reading
        }
        lines.push(msg);
        if (msg?.msg === 'auth_edge.listening' && msg.port) {
          clearTimeout(timer);
          resolve(msg.port);
        }
      }
    });
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });

  return { proc, port, lines };
}

/**
 * A stand-in for LiteLLM that reports exactly which credential it received,
 * plus an SSE endpoint to prove responses are not buffered.
 */
/** @type {import('node:http').Server} */
let upstream;
let upstreamPort;
const seen = { authorization: undefined, xApiKey: undefined };

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    seen.authorization = req.headers.authorization;
    seen.xApiKey = req.headers['x-api-key'];

    // SSE is served on the model path itself. `/sse` and `/echo-body` were
    // stand-ins, but the edge now forwards ONLY the model surface — a helper
    // path is a 404 before it reaches here, which is the allowlist working.
    if (req.url?.startsWith('/v1/messages') && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      });
      res.write('data: first\n\n');
      // Hold the stream open briefly so a buffering proxy would be caught.
      setTimeout(() => {
        res.write('data: second\n\n');
        res.end();
      }, 60);
      return;
    }

    if (req.url?.startsWith('/v1/messages') && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ body, auth: req.headers.authorization }));
      });
      return;
    }

    // Anything carrying a credential we do not recognise is rejected,
    // exactly as the gateway would.
    const raw = req.headers.authorization ?? req.headers['x-api-key'] ?? '';
    const key = raw.replace(/^Bearer\s+/i, '');
    if (key && !/^sk-[A-Za-z0-9_-]{13,}$/.test(key)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'invalid key' }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, saw: key }));
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  upstreamPort = /** @type {{port:number}} */ (upstream.address()).port;
});

afterAll(async () => {
  await new Promise((r) => upstream.close(() => r()));
});

// Start the real edge as a child process so the test exercises the shipped
// entry point, not a re-implementation of it.
/** @type {import('node:child_process').ChildProcess} */
let edge;
let edgePort;
/** @type {any[]} */
let edgeLines;

beforeAll(async () => {
  ({ proc: edge, port: edgePort, lines: edgeLines } = await startEdge({
    AUTH_EDGE_UPSTREAM: `http://127.0.0.1:${upstreamPort}`,
  }));
  // The port handshake above already proves the listener is up. Poll the
  // health endpoint too, so a process that bound and then failed surfaces
  // here as one clear timeout rather than as a pile of ECONNREFUSEDs.
  const deadline = Date.now() + 15_000;
  for (;;) {
    const up = await new Promise((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port: edgePort, path: '/__edge/health', method: 'GET' },
        (r) => { r.resume(); resolve(r.statusCode === 200); },
      );
      req.on('error', () => resolve(false));
      req.end();
    });
    if (up) break;
    if (Date.now() > deadline) throw new Error('auth-edge did not become ready');
    await new Promise((r) => setTimeout(r, 100));
  }
});

afterAll(() => {
  edge?.kill('SIGKILL');
});

const call = (path, headers = {}, method = 'GET', body) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: edgePort, path, method, headers },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode ?? 0, json, text });
        });
      },
    );
    req.on('error', reject);
    // The body MUST be written when one is declared: a content-length with
    // no payload leaves the upstream waiting forever.
    req.end(body);
  });

describe('MODEL_ALIAS resolution (claude-* → tier aliases)', () => {
  it('claude-fast resolves to fast in one pass, no infinite recursion', async () => {
    // CLAUDE_ALIAS is a separate map: CLAUDE_ALIAS['claude-fast'] is 'fast'
    // and resolution STOPS there. MODEL_ALIAS (fast → haiku-5.5) is never
    // consulted for a claude-* name.
    //
    // A two-pass walk would forward 'haiku-5.5', which no key is allowlisted
    // for (keys carry tier aliases — portal/lib/litellm/client.ts:167), so
    // every existing customer would 403. That regression is the point of this
    // test: accepting a 403 would make it pass while the edge is broken.
    const r = await call(
      '/v1/messages',
      { authorization: 'Bearer zn-ABCdef0123456789XYZ', 'content-type': 'application/json' },
      'POST',
      JSON.stringify({ model: 'claude-fast', messages: [{ role: 'user', content: 'test' }] }),
    );
    // 400: the edge did not recognise claude-fast at all.
    // 403: it resolved past 'fast' to a name no key is allowlisted for.
    // Neither is acceptable.
    expect(r.status, 'unrecognised (edge did not resolve claude-fast)').not.toBe(400);
    expect(r.status, 'over-resolved (two-pass bug: forwarded an upstream name)').not.toBe(403);
  });
  it('all four claude-* names are recognized and not over-resolved', async () => {
    for (const name of ['claude-fast', 'claude-smart', 'claude-frontier', 'claude-fable']) {
      const r = await call(
        '/v1/messages',
        { authorization: 'Bearer zn-ABCdef0123456789XYZ', 'content-type': 'application/json' },
        'POST',
        JSON.stringify({ model: name, messages: [{ role: 'user', content: 'test' }] }),
      );
      expect(r.status, `${name} should not 400 (unrecognised)`).not.toBe(400);
      expect(r.status, `${name} should not 403 (over-resolved)`).not.toBe(403);
    }
  });
});

describe('rewriteCredential', () => {
  it('substitutes only the leading prefix', () => {
    expect(rewriteCredential('zn-abcdefghijklmnopqrst')).toEqual({
      value: 'sk-abcdefghijklmnopqrst',
      rewritten: true,
    });
  });

  it('flags a prefix with no usable body instead of inventing a key', () => {
    const r = rewriteCredential('zn-short');
    expect(r.malformed).toBe(true);
    expect(r.rewritten).toBe(false);
    // Critically: it must NOT become 'sk-short'.
    expect(r.value).not.toBe('sk-short');
  });

  it('passes everything else through byte-identical', () => {
    for (const v of ['sk-legacy0123456789012', 'not-a-key', '', 'plaintext-thing']) {
      expect(rewriteCredential(v).value).toBe(v);
    }
  });
});

describe('end to end through the edge', () => {
  it('a zn- key reaches the gateway as sk-', async () => {
    const r = await call('/v1/messages', { authorization: 'Bearer zn-ABCdef0123456789XYZ' });
    expect(r.status).toBe(200);
    expect(seen.authorization).toBe('Bearer sk-ABCdef0123456789XYZ');
  });

  it('logs the alias and the 12-char key prefix, never the key', async () => {
    // The spend log answers "how many tokens", not "which model, which key".
    // These two fields are the only bridge from an edge log line to a
    // LiteLLM spend row and to `api_keys.key_prefix`, so a dropped argument
    // at any `log(...)` call site is a silent attribution gap.
    const ours = () =>
      edgeLines.find(
        (entry) =>
          entry.msg === 'auth_edge' &&
          entry.path === '/v1/chat/completions' &&
          entry.key_prefix === 'zn-ABCdef012',
      );

    const r = await call(
      '/v1/chat/completions',
      { authorization: 'Bearer zn-ABCdef0123456789XYZ', 'content-type': 'application/json' },
      'POST',
      JSON.stringify({ model: 'haiku-5.5', messages: [] }),
    );
    expect(r.status).toBe(200);

    // The line is written after the response ends, off the request path, so
    // it can land a tick after the client sees the body. Poll rather than
    // assert on whatever happened to be buffered.
    const deadline = Date.now() + 5_000;
    while (!ours() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));

    const line = ours();
    expect(line).toBeDefined();
    // The customer-facing alias, not the upstream name it was routed to.
    expect(line.model).toBe('fast');
    expect(line.key_prefix).toBe('zn-ABCdef012');
    // Bounded: the prefix can never reconstitute the credential.
    expect(line.key_prefix.length).toBe(12);
    expect(JSON.stringify(line)).not.toContain('zn-ABCdef0123456789XYZ');
  });

  it('works through x-api-key as well as Authorization', async () => {    const r = await call('/v1/messages', { 'x-api-key': 'zn-XYZabc0123456789DEF' });
    expect(r.status).toBe(200);
    expect(seen.xApiKey).toBe('sk-XYZabc0123456789DEF');
  });

  it('leaves a legacy sk- key working (no deploy breaks existing users)', async () => {
    const r = await call('/v1/messages', { authorization: 'Bearer sk-legacy0123456789012' });
    expect(r.status).toBe(200);
    expect(seen.authorization).toBe('Bearer sk-legacy0123456789012');
  });

  it('REJECTS a zn- key with no body — it must not become sk-', async () => {
    const r = await call('/v1/messages', { authorization: 'Bearer zn-short' });
    expect(r.status).toBe(401);
    // And it never reached the gateway as a credential.
    expect(seen.authorization).not.toBe('Bearer sk-short');
  });

  it('an invalid zn- key is refused by the gateway, not accepted', async () => {
    const r = await call('/v1/messages', { authorization: 'Bearer zn-!!!notvalid!!!' });
    expect(r.status).toBe(401);
  });

  it('streams SSE without buffering', async () => {
    const started = Date.now();
    const chunks = [];
    await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: edgePort,
          path: '/v1/messages',
          headers: { authorization: 'Bearer zn-ABCdef0123456789XYZ' },
        },
        (res) => {
          expect(res.headers['content-type']).toBe('text/event-stream');
          res.on('data', (c) => chunks.push(c.toString()));
          res.on('end', () => resolve());
        },
      );
      req.on('error', reject);
      req.end();
    });
    // Two events, the second delayed 60ms. A buffering proxy would deliver
    // them together at the end; a streaming one delivers the first early.
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.join('')).toContain('first');
    expect(chunks.join('')).toContain('second');
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('forwards the request body, adding only the identity block', async () => {
    // The edge used to be a byte-for-byte pipe. It is no longer one ON PURPOSE:
    // `edge/identity.mjs` prepends the brand block to `system`, because measured
    // on the live box every tier answered "what model are you?" with
    // "I'm haiku-5.5 by anthropic" through this exact path. What this test still
    // guarantees is the part that made the old assertion worth writing: nothing
    // the client SENT is altered or dropped.
    const sent = { role: 'user', content: 'hi' };
    const payload = JSON.stringify({ model: 'fast', messages: [sent] });
    const r = await call(
      '/v1/messages',
      {
        authorization: 'Bearer zn-ABCdef0123456789XYZ',
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(payload)),
      },
      'POST',
      payload,
    );
    expect(r.status).toBe(200);

    const forwarded = JSON.parse(r.json.body);
    // The client's own messages arrive verbatim, in order.
    expect(forwarded.messages).toEqual([sent]);
    // The model name was not rewritten on this path: keys are allowlisted by
    // tier alias, so forwarding an upstream name would 403 every existing key.
    expect(forwarded.model).toBe('fast');
    // Identity was added, and only to `system`.
    expect(forwarded.system).toContain('Zaino AI Fast, powered by Haiku 5.5');

    // And the credential still arrived in gateway form.
    expect(r.json.auth).toBe('Bearer sk-ABCdef0123456789XYZ');
  });

  it('denies everything outside the model surface (ALLOWLIST, not a denylist)', async () => {
    // The list is deliberately wider than "the management prefixes": these
    // are the paths a denylist of /key, /spend, /config… would have let
    // through, and each one is real LiteLLM surface. If any of them answers
    // anything but 404, the edge has stopped being default-deny.
    for (const p of [
      '/key/generate', '/user/info', '/spend/logs', '/config/yaml',
      '/health/liveliness', '/health/readiness', '/metrics',
      '/sso/key/generate', '/v1/files', '/v1/batches', '/v1/embeddings',
      '/v1/fine_tuning/jobs', '/model_group/info', '/model/info',
      '/cache/ping', '/', '/v1', '/v1/',
    ]) {
      const r = await call(p, { authorization: 'Bearer zn-ABCdef0123456789XYZ' });
      expect(r.status, `${p} must be denied — got ${r.status} ${r.text.slice(0, 120)}`).toBe(404);
    }
  });

  it('allows exactly the model surface, including model discovery by id', async () => {
    for (const p of [
      '/v1/models',
      '/v1/models/fast',
      '/v1/models/some-alias',
    ]) {
      const r = await call(p, { authorization: 'Bearer zn-ABCdef0123456789XYZ' });
      expect(r.status, `${p} must be forwarded — got ${r.status}`).not.toBe(404);
    }
    // Two segments under /v1/models is not a gateway route; the allowlist
    // must not turn into a prefix match that swallows one.
    const deep = await call('/v1/models/fast/extra', {
      authorization: 'Bearer zn-ABCdef0123456789XYZ',
    });
    expect(deep.status).toBe(404);
  });

  it('has its own health endpoint and does not shadow the gateway', async () => {
    const r = await call('/__edge/health');
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('ok');
  });

  it('fails CLOSED when the upstream is gone', async () => {
    // A second edge pointed at a dead upstream: the answer must not be 200.
    const { proc: dead, port: deadPort } = await startEdge({
      AUTH_EDGE_UPSTREAM: 'http://127.0.0.1:1', // nothing listens here
    });

    const r = await new Promise((resolve) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: deadPort,
          path: '/v1/messages',
          headers: { authorization: 'Bearer zn-ABCdef0123456789XYZ' },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
        },
      );
      req.on('error', () => resolve({ status: 0 }));
      req.end();
    });
    dead.kill('SIGKILL');

    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(r.status).not.toBe(200);
  });

  it('maps a gateway model-denied 403 to a plan-wide message', async () => {
    // Unit-level: the pure mapper the proxy path uses.
    //
    // 0039: the allowance is ONE shared pool, so the copy names no model.
    // Naming it sent the customer to another alias that was equally empty
    // and told them the product was broken.
    const m = mapModelDeniedBody(
      403,
      `{"error":{"message":"Model 'frontier' is not available for this API key"}}`,
    );
    expect(m?.model).toBe('frontier');
    expect(m?.message).toMatch(/out of tokens/i);
    expect(m?.message).not.toMatch(/out of frontier tokens/i);
    expect(mapModelDeniedBody(403, 'overloaded, try again')).toBeNull();
    expect(mapModelDeniedBody(200, "Model 'frontier' is not available")).toBeNull();
  });

  it('maps a fable denial without leaking the upstream model name', async () => {
    // `fable` is served by `gpt-6-astra`. A denial that names the ROUTED
    // model must still reach the customer as the alias — the whole point of
    // the alias layer is that no upstream name is ever customer-visible.
    const byUpstream = mapModelDeniedBody(
      403,
      `{"error":{"message":"Model 'gpt-6-astra' is not available for this API key"}}`,
    );
    expect(byUpstream?.model).toBe('fable');
    expect(byUpstream?.message).toMatch(/out of tokens/i);
    expect(byUpstream?.message).not.toMatch(/gpt-6-astra/);

    // And the alias spelling itself still maps.
    const byAlias = mapModelDeniedBody(
      403,
      `{"error":{"message":"Model 'fable' is not available for this API key"}}`,
    );
    expect(byAlias?.model).toBe('fable');
  });

  it('never names the model after the JSON error key (2026-10-27 regression)', async () => {
    // The old mapper scanned the RAW body for a quoted token; the first
    // quoted token in any JSON error body is the `"error"` key itself, so
    // every unnamed upstream denial became "Model 'error' is not available".
    const raw = `{"error":{"message":"The requested model is not available for this API key"}}`;
    const m = mapModelDeniedBody(403, raw);
    expect(m).not.toBeNull();
    expect(m?.model).toBeNull();
    expect(m?.message).not.toContain("'error'");
  });

  it('uses the model the customer requested when the body names none', async () => {
    const raw = `{"error":{"message":"The requested model is not available for this API key"}}`;
    const m = mapModelDeniedBody(403, raw, 'smart');
    expect(m?.model).toBe('smart');
    expect(m?.message).toMatch(/out of tokens/i);
  });

  it('translates an upstream model name in the denial to the alias', async () => {
    const m = mapModelDeniedBody(
      403,
      `{"error":{"message":"Model 'sonnet-5.5' is not available for this API key"}}`,
    );
    expect(m?.model).toBe('smart');
    expect(m?.message).toMatch(/out of tokens/i);
    expect(m?.message).not.toContain('sonnet');
  });

  it('rewrites a gateway 403 denial body at the proxy path', async () => {
    // End-to-end through the real edge: upstream answers 403 with the
    // generic LiteLLM wording, the client must see the mapped message.
    const denied = http.createServer((req, res) => {
      const body = JSON.stringify({
        error: { message: "Model 'frontier' is not available for this API key" },
      });
      res.writeHead(403, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
      res.end(body);
    });
    await new Promise((resolve) => denied.listen(0, '127.0.0.1', resolve));
    const deniedPort = denied.address().port;
    const { proc: edge, port: edgePort2 } = await startEdge({
      AUTH_EDGE_UPSTREAM: `http://127.0.0.1:${deniedPort}`,
    });
    try {
      const r = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: edgePort2,
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
              authorization: 'Bearer zn-ABCdef0123456789XYZ',
              'content-type': 'application/json',
              'content-length': 2,
            },
          },
          (res) => {
            let text = '';
            res.on('data', (c) => (text += c.toString()));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
          },
        );
        req.on('error', reject);
        req.end('{}');
      });
      expect(r.status).toBe(403);
      // 0039: plan-wide copy — the pool is shared, so no alias is named.
      expect(r.text).toMatch(/out of tokens/i);
      expect(r.text).not.toMatch(/out of frontier tokens/i);
    } finally {
      edge.kill('SIGKILL');
      denied.close();
    }
  });
});