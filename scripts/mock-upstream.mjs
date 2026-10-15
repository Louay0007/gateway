#!/usr/bin/env node
/**
 * scripts/mock-upstream.mjs — a fake "Anthropic-compatible" upstream for
 * LOCAL acceptance testing only.
 *
 * WHY THIS EXISTS. The real upstream needs a paid Console API key. The
 * acceptance suite (scripts/smoke.sh) proves the GATEWAY's data path —
 * dual-format routing, streaming, spend accounting, budget hard-stop,
 * SSRF-body rejection — none of which depends on Anthropic's internals,
 * only on a well-formed OpenAI/Anthropic response. This server supplies
 * exactly that, so the whole suite can go green locally with zero spend.
 *
 * It is NOT a faithful Anthropic clone and is never deployed: point
 * UPSTREAM_BASE_URL at it via `make mock-upstream`, run smoke, then
 * restart litellm to restore the real upstream.
 *
 * Usage is non-zero and fixed (100 prompt / 20 completion tokens/call) so
 * LiteLLM records spend — enough that A-8 (budget hard-stop) and A-15
 * (spend accounting) fire, without depending on any real provider.
 */
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 8787);

// Bind address. Loopback by default, and that is the RIGHT default: the mock
// holds no credential, but it does mint fake completions, so it must not be
// reachable from anything but this machine.
//
// It is configurable only because LiteLLM runs in Docker. On Docker Desktop
// (macOS) `host.docker.internal` reaches the host's interfaces, so loopback
// works. On a LINUX host the container resolves that name to the docker
// bridge gateway (172.17.0.1), which CANNOT reach the host's 127.0.0.1 — so
// `make verify-metering` on a VPS fails every request with
// "OpenAIException - Connection error" unless the mock binds wider.
//
// `MOCK_HOST=0.0.0.0` is therefore opt-in and is only ever needed on a host
// that already firewalls the port (the Lightsail box admits 22/80/443 only).
const HOST = process.env.MOCK_HOST ?? '127.0.0.1';
const PROMPT_TOKENS = 100;
const COMPLETION_TOKENS = 20;

// Prompt-cache emulation. Real Anthropic returns cache_creation on the
// first request bearing a cache_control block, and cache_read on an
// IDENTICAL repeat. We key on the JSON of the cacheable content so A-6b
// (identical repeat → cache read) has a truthful upstream to assert
// against. In-memory only; it does not survive a mock restart, which is
// correct for a test fixture.
const cacheSeen = new Set();

/** Extract the cacheable text (system + message content) for hashing. */
function cacheKey(body) {
  const parts = [];
  if (Array.isArray(body?.system)) {
    for (const b of body.system) parts.push(typeof b?.text === 'string' ? b.text : JSON.stringify(b));
  } else if (typeof body?.system === 'string') {
    parts.push(body.system);
  }
  if (Array.isArray(body?.messages)) {
    for (const m of body.messages) {
      parts.push(typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content));
    }
  }
  return parts.join('\u0000');
}

const lastPrompt = (body) => {
  const arr = body?.messages;
  const last = Array.isArray(arr) ? arr.at(-1) : undefined;
  return typeof last?.content === 'string' ? last.content : 'hi';
};

/** Anthropic /v1/messages → non-streaming JSON. */
function anthropicMessages(body) {
  // Honour cache_control like the real API. First request bearing a
  // cache_control marker reports a cache-CREATION; an identical repeat
  // reports a cache-READ (a hit). This is what A-6 / A-6b assert, and it
  // mirrors what gets dropped if LiteLLM translates /v1/messages instead
  // of passing it through.
  let cacheWrite = 0;
  let cacheRead = 0;
  let hasCacheControl = false;
  const scan = (blocks) => {
    if (!Array.isArray(blocks)) return;
    for (const b of blocks) {
      if (b && b.cache_control) { cacheWrite += 100; hasCacheControl = true; }
    }
  };
  if (Array.isArray(body?.system)) scan(body.system);
  if (Array.isArray(body?.messages)) {
    for (const m of body.messages) scan(Array.isArray(m.content) ? m.content : undefined);
  }
  if (hasCacheControl) {
    const k = cacheKey(body);
    if (cacheSeen.has(k)) {
      // Identical repeat → this was written before, now it is a read.
      cacheWrite = 0;
      cacheRead = 100;
    } else {
      cacheSeen.add(k);
    }
  }
  return {
    id: 'msg_mock_' + Date.now(),
    type: 'message',
    role: 'assistant',
    model: body?.model ?? 'mock',
    content: [{ type: 'text', text: 'mock: ' + lastPrompt(body) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: PROMPT_TOKENS,
      output_tokens: COMPLETION_TOKENS,
      cache_creation_input_tokens: cacheWrite,
      cache_read_input_tokens: cacheRead,
    },
  };
}

/** OpenAI /v1/chat/completions → non-streaming JSON. */
function openaiChat(body) {
  return {
    id: 'chatcmpl-mock-' + Date.now(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body?.model ?? 'mock',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'mock: ' + lastPrompt(body) },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: PROMPT_TOKENS,
      completion_tokens: COMPLETION_TOKENS,
      total_tokens: PROMPT_TOKENS + COMPLETION_TOKENS,
    },
  };
}

/** Anthropic /v1/messages → streaming SSE (message_start … message_delta). */
function anthropicStream(res, body) {
  const words = ('mock ' + lastPrompt(body)).split(' ');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_mock_' + Date.now(),
      type: 'message',
      role: 'assistant',
      model: body?.model ?? 'mock',
      content: [],
      usage: {
        input_tokens: PROMPT_TOKENS,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  });
  send('content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  });
  for (const w of words) {
    send('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: w + ' ' },
    });
  }
  send('content_block_stop', { type: 'content_block_stop', index: 0 });
  send('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: COMPLETION_TOKENS },
  });
  send('message_stop', { type: 'message_stop' });
  res.end();
}

/** OpenAI /v1/chat/completions → streaming SSE (chat.completion.chunk …). */
function openaiStream(res, body) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const id = 'chatcmpl-mock-' + Date.now();
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta, finish) =>
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model: body?.model ?? 'mock',
      choices: [{ index: 0, delta, finish_reason: finish ?? null }],
    })}\n\n`;
  res.write(chunk({ role: 'assistant' }, null));
  for (const w of ('mock ' + lastPrompt(body)).split(' ')) {
    res.write(chunk({ content: w + ' ' }, null));
  }
  res.write(chunk({}, 'stop'));
  res.write(
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model: body?.model ?? 'mock',
      choices: [],
      usage: {
        prompt_tokens: PROMPT_TOKENS,
        completion_tokens: COMPLETION_TOKENS,
        total_tokens: PROMPT_TOKENS + COMPLETION_TOKENS,
      },
    })}\n\n`
  );
  res.write('data: [DONE]\n\n');
  res.end();
}

/** Anthropic /v1/messages/count_tokens */
function countTokens(body) {
  const s = JSON.stringify(body ?? {});
  return { input_tokens: Math.max(1, Math.ceil(s.length / 4)) };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      /* empty body ok */
    }

    if (url.pathname === '/v1/models' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'fast', object: 'model' },
            { id: 'smart', object: 'model' },
            { id: 'frontier', object: 'model' },
          ],
        })
      );
      return;
    }

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ healthy: true }));
      return;
    }

    if (url.pathname === '/v1/messages/count_tokens') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(countTokens(body)));
      return;
    }

    if (url.pathname === '/v1/messages') {
      if (body.stream) return anthropicStream(res, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(anthropicMessages(body)));
      return;
    }

    if (url.pathname === '/v1/chat/completions') {
      if (body.stream) return openaiStream(res, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(openaiChat(body)));
      return;
    }

    // LiteLLM strips the /v1 prefix on the openai/* deployment, so the
    // upstream sees /chat/completions (and occasionally /messages for the
    // anthropic/* deployment). Serve the same handlers at the bare path so
    // both wire formats resolve regardless of how the route was rewritten.
    if (url.pathname === '/chat/completions') {
      if (body.stream) return openaiStream(res, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(openaiChat(body)));
      return;
    }
    if (url.pathname === '/messages') {
      if (body.stream) return anthropicStream(res, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(anthropicMessages(body)));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ error: { message: 'mock: unknown path ' + url.pathname } })
    );
  });
});

server.listen(PORT, HOST, () => {
  console.log(`mock-upstream listening on http://${HOST}:${PORT}`);
});
