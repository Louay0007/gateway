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
import { rewriteCredential } from '../../edge/server.mjs';
import { fileURLToPath } from 'node:url';

// Absolute, so the child process is launched correctly whatever the CWD.
const EDGE_ENTRY = fileURLToPath(new URL('../../edge/server.mjs', import.meta.url));

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

    if (req.url?.startsWith('/sse')) {
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

    if (req.url?.startsWith('/echo-body')) {
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

beforeAll(async () => {
  const { spawn } = await import('node:child_process');
  edgePort = upstreamPort + 1;
  edge = spawn(process.execPath, [EDGE_ENTRY], {
    env: {
      ...process.env,
      AUTH_EDGE_HOST: '127.0.0.1',
      AUTH_EDGE_PORT: String(edgePort),
      AUTH_EDGE_UPSTREAM: `http://127.0.0.1:${upstreamPort}`,
    },
    stdio: 'ignore',
  });
  // Poll the edge's own health endpoint instead of sleeping a fixed 900ms.
  // The sleep passed in isolation and failed intermittently when vitest ran
  // files in parallel: the child had not finished importing its module graph,
  // so every request below got ECONNREFUSED and the whole file reported as
  // broken. That reads as a product regression and is not one.
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

  it('works through x-api-key as well as Authorization', async () => {
    const r = await call('/v1/messages', { 'x-api-key': 'zn-XYZabc0123456789DEF' });
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
          path: '/sse',
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

  it('forwards the request body untouched', async () => {
    const payload = JSON.stringify({ model: 'fast', messages: [{ role: 'user', content: 'hi' }] });
    const r = await call(
      '/echo-body',
      {
        authorization: 'Bearer zn-ABCdef0123456789XYZ',
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(payload)),
      },
      'POST',
      payload,
    );
    expect(r.status).toBe(200);
    expect(r.json.body).toBe(payload);
    // And the credential still arrived in gateway form.
    expect(r.json.auth).toBe('Bearer sk-ABCdef0123456789XYZ');
  });

  it('denies the management surface (defence in depth)', async () => {
    for (const p of ['/key/generate', '/user/info', '/spend/logs', '/config/yaml']) {
      const r = await call(p, { authorization: 'Bearer zn-ABCdef0123456789XYZ' });
      expect(r.status, `${p} must be denied — got ${r.status} ${r.text.slice(0, 120)}`).toBe(404);
    }
  });

  it('has its own health endpoint and does not shadow the gateway', async () => {
    const r = await call('/__edge/health');
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('ok');
  });

  it('fails CLOSED when the upstream is gone', async () => {
    // A second edge pointed at a dead port: the answer must not be 200.
    const { spawn } = await import('node:child_process');
    const deadPort = upstreamPort + 9;
    const dead = spawn(process.execPath, [EDGE_ENTRY], {
      env: {
        ...process.env,
        AUTH_EDGE_HOST: '127.0.0.1',
        AUTH_EDGE_PORT: String(deadPort),
        AUTH_EDGE_UPSTREAM: 'http://127.0.0.1:1', // nothing listens here
      },
      stdio: 'ignore',
    });
    await new Promise((r) => setTimeout(r, 800));

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
});