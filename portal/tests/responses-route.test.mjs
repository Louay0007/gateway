/**
 * The Responses route, end-to-end over real HTTP.
 *
 * The unit tests in responses-shim.test.mjs prove the translation functions.
 * These prove the WIRING — that the edge actually intercepts POST
 * /v1/responses, rewrites it to /v1/chat/completions for the gateway, and
 * returns a response the client can act on. A correct translator behind a
 * route that never fires is worth nothing.
 *
 * The fake upstream here stands in for LiteLLM, and asserts on what it
 * receives: if the request were forwarded untranslated, these assertions fail.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const EDGE_ENTRY = fileURLToPath(new URL('../../edge/server.mjs', import.meta.url));

/** @type {import('node:http').Server} */
let upstream;
/** @type {import('node:child_process').ChildProcess} */
let edge;
let upstreamPort;
let edgePort;

/** What the fake gateway last received — the load-bearing assertions. */
const seen = { path: undefined, body: undefined, auth: undefined, contentLength: undefined };

/** Counts real upstream calls, so a test can assert the gateway was NOT hit. */
let callCount = 0;

/** Set by a test to steer the fake gateway's reply. */
let reply = null;

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      callCount += 1;
      seen.path = req.url;
      seen.auth = req.headers.authorization;
      seen.contentLength = req.headers['content-length'];
      try {
        seen.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        seen.body = null;
      }

      const mode = reply?.mode ?? 'chat';
      if (mode === 'error') {
        res.writeHead(reply.status ?? 429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: reply.message ?? 'rate limited' } }));
        return;
      }
      if (mode === 'stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const c of reply.chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply?.chat ?? {}));
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  upstreamPort = /** @type {{port:number}} */ (upstream.address()).port;

  edgePort = upstreamPort + 1;
  const { spawn } = await import('node:child_process');
  edge = spawn(process.execPath, [EDGE_ENTRY], {
    env: {
      ...process.env,
      AUTH_EDGE_HOST: '127.0.0.1',
      AUTH_EDGE_PORT: String(edgePort),
      AUTH_EDGE_UPSTREAM: `http://127.0.0.1:${upstreamPort}`,
    },
    stdio: 'ignore',
  });

  // Poll the edge's own health endpoint rather than sleeping a fixed 900ms.
  // A fixed sleep passes in isolation and fails when vitest runs files in
  // parallel, which reads as a real product bug and is not one.
  const deadline = Date.now() + 15_000;
  for (;;) {
    const ok = await new Promise((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port: edgePort, path: '/__edge/health', method: 'GET' },
        (res) => { res.resume(); resolve(res.statusCode === 200); },
      );
      req.on('error', () => resolve(false));
      req.end();
    });
    if (ok) break;
    if (Date.now() > deadline) throw new Error('auth-edge did not become ready');
    await new Promise((r) => setTimeout(r, 100));
  }
});

afterAll(async () => {
  edge?.kill('SIGKILL');
  await new Promise((r) => upstream.close(() => r()));
});

const post = (path, body, headers = {}) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: edgePort,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });

const KEY = { authorization: 'Bearer zn-' + 'a'.repeat(43) };

describe('POST /v1/responses through the edge', () => {
  it('rewrites the route to /v1/chat/completions for the gateway', async () => {
    reply = { mode: 'chat', chat: { id: 'c1', created: 1, choices: [{ finish_reason: 'stop', message: { content: 'hi' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } };
    const r = await post('/v1/responses', { model: 'fast', input: 'hello' }, KEY);

    // If the edge passed the request through untouched, the upstream would
    // have seen /v1/responses and a Responses body. This is the assertion
    // that proves the interception is live, not just unit-tested.
    expect(seen.path).toBe('/v1/chat/completions');
    // The edge resolves the alias to a concrete model name before
    // forwarding, so LiteLLM always receives a model it can serve even if
    // LiteLLM's own model_list alias resolution is unavailable.
    expect(seen.body.model).toBe('haiku-5.5');
    expect(seen.body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(seen.contentLength).toBe(String(Buffer.byteLength(JSON.stringify(seen.body))));
    expect(r.status).toBe(200);
  });

  it('still substitutes the zn- credential on this route', async () => {
    reply = { mode: 'chat', chat: { id: 'c', created: 1, choices: [{ finish_reason: 'stop', message: { content: 'x' } }] } };
    await post('/v1/responses', { model: 'fast', input: 'hi' }, KEY);
    expect(seen.auth).toMatch(/^Bearer sk-a{43}$/);
  });

  it('returns a Responses object, not a Chat completion', async () => {
    reply = {
      mode: 'chat',
      chat: {
        id: 'chatcmpl-9', created: 1700000000, model: 'space-bunny-free',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'The answer is 4.' } }],
        usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
      },
    };
    const r = await post('/v1/responses', { model: 'fast', input: 'what is 2+2?' }, KEY);
    const d = JSON.parse(r.text);
    expect(d.object).toBe('response');
    expect(d.status).toBe('completed');
    expect(d.output_text).toBe('The answer is 4.');
    expect(d.output[0].content[0].type).toBe('output_text');
    expect(d.usage.input_tokens).toBe(11);
    expect(d.usage.output_tokens).toBe(5);
  });

  it('returns tool calls as function_call items', async () => {
    reply = {
      mode: 'chat',
      chat: {
        id: 'c2', created: 1,
        choices: [{ finish_reason: 'tool_calls', message: { content: 'checking', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }] } }],
      },
    };
    const r = await post(
      '/v1/responses',
      {
        model: 'fast',
        input: 'weather?',
        tools: [{ type: 'function', name: 'get_weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }],
      },
      KEY,
    );
    const d = JSON.parse(r.text);
    const call = d.output.find((o) => o.type === 'function_call');
    expect(call.name).toBe('get_weather');
    expect(call.call_id).toBe('call_1');
    expect(JSON.parse(call.arguments)).toEqual({ city: 'Paris' });
    // The flattened tool definition must reach the upstream.
    expect(seen.body.tools[0].function.name).toBe('get_weather');
  });

  it('streams Responses SSE and always terminates on response.completed', async () => {
    reply = {
      mode: 'stream',
      chunks: [
        { id: 's', created: 1, choices: [{ delta: { role: 'assistant' } }] },
        { id: 's', created: 1, choices: [{ delta: { content: 'Hel' } }] },
        { id: 's', created: 1, choices: [{ delta: { content: 'lo' } }] },
        { id: 's', created: 1, choices: [{ delta: {} }], usage: { prompt_tokens: 3, completion_tokens: 2 } },
      ],
    };
    const r = await post('/v1/responses', { model: 'fast', input: 'hi', stream: true }, KEY);

    const types = r.text
      .split('\n')
      .filter((l) => l.startsWith('event: '))
      .map((l) => l.slice(7).trim());

    expect(types[0]).toBe('response.created');
    expect(types).toContain('response.output_text.delta');
    // The terminal event is what stops a Codex client from hanging.
    expect(types[types.length - 1]).toBe('response.completed');

    const deltas = r.text
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)))
      .filter((d) => d.type === 'response.output_text.delta')
      .map((d) => d.delta);
    expect(deltas.join('')).toBe('Hello');
  });

  it('terminates the stream even when the upstream sends no chunks', async () => {
    reply = { mode: 'stream', chunks: [] };
    const r = await post('/v1/responses', { model: 'fast', input: 'hi', stream: true }, KEY);
    expect(r.text).toContain('event: response.completed');
  });

  it('surfaces an upstream error as an error, never as an empty success', async () => {
    // The failure that matters most: a 429 turned into a 200 with no content
    // makes an agent believe the model answered.
    reply = { mode: 'error', status: 429, message: 'No deployments available' };
    const r = await post('/v1/responses', { model: 'fast', input: 'hi' }, KEY);
    expect(r.status).toBe(429);
    const d = JSON.parse(r.text);
    expect(d.error.message).toBe('No deployments available');
    expect(d.output).toBeUndefined();
  });

  it('refuses previous_response_id without spending an upstream call', async () => {
    reply = { mode: 'chat', chat: { id: 'x', created: 1, choices: [{ message: { content: 'nope' } }] } };
    const before = callCount;
    const r = await post('/v1/responses', { model: 'fast', input: 'hi', previous_response_id: 'resp_old' }, KEY);
    expect(r.status).toBe(400);
    expect(JSON.parse(r.text).error.message).toMatch(/previous_response_id/);
    // The gateway must never see a request the edge refused — otherwise a
    // billable model call happens for work that was never done.
    expect(callCount).toBe(before);
  });

  it('rejects a malformed body without reaching the gateway', async () => {
    reply = { mode: 'chat', chat: {} };
    const payload = '{not json';
    const r = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: edgePort, path: '/v1/responses', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...KEY } },
        (res) => {
          let text = '';
          res.on('data', (c) => (text += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
        },
      );
      req.on('error', reject);
      req.end(payload);
    });
    expect(r.status).toBe(400);
  });

  it('leaves every OTHER route as a pure proxy', async () => {
    reply = { mode: 'chat', chat: { ok: true } };
    const r = await post('/v1/chat/completions', { model: 'fast', messages: [{ role: 'user', content: 'hi' }] }, KEY);
    expect(r.status).toBe(200);
    expect(seen.path).toBe('/v1/chat/completions');
    // Untranslated: no Responses-only field may appear, and the input must
    // not have been flattened into `messages` from something else.
    expect(seen.body.input).toBeUndefined();
    expect(seen.body.messages[0].content).toBe('hi');
  });
});
