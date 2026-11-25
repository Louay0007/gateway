/**
 * claude-* alias resolution — the one-step rule.
 *
 * Keys are minted with `models: allowlistFor(...)` (portal/lib/litellm/client.ts:167)
 * and carry tier aliases only. So `claude-fast` must become `fast` and STOP:
 * a second hop onto `haiku-5.5` 403s every existing key, which is the exact
 * bug this test exists to catch.
 *
 * `node --test edge/alias.test.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLAUDE_ALIAS, resolveModelAlias, advertiseClaudeAliases } from './server.mjs';

const body = (model) => Buffer.from(JSON.stringify({ model, max_tokens: 8 }), 'utf8');
const model = (buf) => JSON.parse(buf.toString('utf8')).model;

test('claude-* maps one step to its tier alias', () => {
  assert.equal(CLAUDE_ALIAS['claude-fast'], 'fast');
  assert.equal(CLAUDE_ALIAS['claude-smart'], 'smart');
  assert.equal(CLAUDE_ALIAS['claude-frontier'], 'frontier');
  assert.equal(CLAUDE_ALIAS['claude-fable'], 'fable');
});

test('a tier alias is not a claude-* key, and vice versa', () => {
  for (const tier of Object.values(CLAUDE_ALIAS)) {
    assert.equal(CLAUDE_ALIAS[tier], undefined);
  }
});

test('unknown model passes through byte-for-byte', () => {
  const raw = body('some-unreleased-model');
  const out = resolveModelAlias(raw);
  assert.equal(out.model, 'some-unreleased-model');
  assert.equal(out.body, raw);
});

test('unparseable body is forwarded untouched', () => {
  const raw = Buffer.from('not json', 'utf8');
  assert.equal(resolveModelAlias(raw).body, raw);
});

// The rewriting tests need EDGE_RESOLVE_ALIASES=1, read at module load, so they
// re-import with the flag on. Kept in one test to avoid toggling the env twice.
test('EDGE_RESOLVE_ALIASES=1: one step, no chaining onto the upstream name', async () => {
  process.env.EDGE_RESOLVE_ALIASES = '1';
  const m = await import(`./server.mjs?resolved=${Date.now()}`);
  delete process.env.EDGE_RESOLVE_ALIASES;

  const fast = m.resolveModelAlias(body('fast'));
  assert.equal(model(fast.body), 'haiku-5.5');
  assert.equal(fast.model, 'haiku-5.5');

  const claudeFast = m.resolveModelAlias(body('claude-fast'));
  assert.equal(model(claudeFast.body), 'fast');
  assert.notEqual(model(claudeFast.body), 'haiku-5.5');
});

test('claude-* resolves with alias rewriting off, one step, no chaining', () => {
  const claudeFast = resolveModelAlias(body('claude-fast'));
  assert.equal(model(claudeFast.body), 'fast');
  assert.equal(claudeFast.model, 'fast');
  // Rewriting the tier alias again is a no-op without EDGE_RESOLVE_ALIASES.
  assert.equal(model(resolveModelAlias(claudeFast.body).body), 'fast');
});
test('/v1/models gains a claude-* twin only for tiers already present', () => {
  const one = advertiseClaudeAliases({ data: [{ id: 'fable', object: 'model' }] });
  const ids = one.data.map((m) => m.id);
  assert.deepEqual(ids, ['fable', 'claude-fable']);
  // A tier the key cannot use must NOT be advertised: its claude-* twin
  // would say "available" and then 403 on use.
  assert.equal(ids.includes('claude-fast'), false);
  assert.equal(ids.includes('fast'), false);
});

test('/v1/models twin keeps the tier entry fields', () => {
  const out = advertiseClaudeAliases({
    data: [{ id: 'smart', object: 'model', owned_by: 'zaino', created: 7 }],
  });
  const twin = out.data.find((m) => m.id === 'claude-smart');
  assert.equal(twin.owned_by, 'zaino');
  assert.equal(twin.created, 7);
  assert.equal(twin.object, 'model');
});

test('/v1/models all four present gains exactly four twins', () => {
  const out = advertiseClaudeAliases({
    data: ['fast', 'smart', 'frontier', 'fable'].map((id) => ({ id })),
  });
  assert.equal(out.data.length, 8);
  assert.equal(out.data.filter((m) => m.id.startsWith('claude-')).length, 4);
});

test('/v1/models non-list payload is returned untouched', () => {
  assert.deepEqual(advertiseClaudeAliases({ error: 'nope' }), { error: 'nope' });
  assert.deepEqual(advertiseClaudeAliases({}), {});
});

// ── Model size metadata ───────────────────────────────────────────────────
// Claude Desktop reads `context_window` on an Anthropic-shaped model object.
// When it is absent the client falls back to its own default for that id
// (200K for `claude-*`), which made a 1M-context model report "160K / 200K"
// and auto-compact early. These assertions are that regression's lock.

test('every alias and its claude-* twin states the real context window', async () => {
  const { advertiseModelSizes } = await import('./server.mjs');
  const out = advertiseModelSizes({
    data: ['fast', 'smart', 'frontier', 'fable', 'claude-fast', 'claude-smart'].map((id) => ({ id })),
  });
  for (const m of out.data) {
    assert.equal(m.context_window, 1048576, `${m.id} context_window`);
    assert.equal(m.max_input_tokens, 1048576, `${m.id} max_input_tokens`);
    assert.equal(m.max_output_tokens, 65536, `${m.id} max_output_tokens`);
  }
});

test('a model id the edge does not know is left exactly as-is', async () => {
  const { advertiseModelSizes } = await import('./server.mjs');
  const entry = { id: 'some-other-vendor-model', object: 'model' };
  const out = advertiseModelSizes({ data: [entry] });
  assert.deepEqual(out.data[0], { id: 'some-other-vendor-model', object: 'model' });
  assert.equal(out.data[0].context_window, undefined);
});

test('an existing display_name or output cap is not overwritten', async () => {
  const { advertiseModelSizes } = await import('./server.mjs');
  const out = advertiseModelSizes({
    data: [{ id: 'smart', display_name: 'Zaino Smart', max_output_tokens: 8192 }],
  });
  assert.equal(out.data[0].display_name, 'Zaino Smart');
  assert.equal(out.data[0].max_output_tokens, 8192);
  assert.equal(out.data[0].context_window, 1048576);
});

test('tier entries carry sizes BEFORE twins are cloned from them', async () => {
  // The clone copies the tier entry, so applying sizes afterwards is what
  // makes the twins correct; applying them first would leave twins at the
  // client's 200K default. This asserts the composition the server uses.
  const { advertiseClaudeAliases, advertiseModelSizes } = await import('./server.mjs');
  const out = advertiseModelSizes(advertiseClaudeAliases({ data: [{ id: 'smart' }] }));
  const twin = out.data.find((m) => m.id === 'claude-smart');
  assert.ok(twin, 'claude-smart twin present');
  assert.equal(twin.context_window, 1048576);
});

test('non-list payloads are returned untouched', async () => {
  const { advertiseModelSizes } = await import('./server.mjs');
  const payload = { error: 'nope' };
  assert.deepEqual(advertiseModelSizes(payload), payload);
});
