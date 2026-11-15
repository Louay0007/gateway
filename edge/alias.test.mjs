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
import { CLAUDE_ALIAS, resolveModelAlias } from './server.mjs';

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
