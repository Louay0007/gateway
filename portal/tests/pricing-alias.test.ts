/**
 * Alias resolution — the module that stands between an upstream model name
 * and a customer's screen.
 *
 * The one outcome this module exists to prevent is an upstream name reaching
 * the ledger or the dashboard. Every case below is a shape the gateway or
 * the upstream has actually produced, so each is pinned rather than assumed:
 * provider-qualified, upstream-echoed `-free` suffixed, bare, already an
 * alias, and the prefix-collision pair (`mimo-v2.6` vs `mimo-v2.6-flash`).
 */
import { describe, it, expect } from 'vitest';
import { toAlias, aliasForRow, routeForCallType, bareModelName, isAlias, UNKNOWN_ALIAS, TIER_ALIASES } from '@/lib/pricing/alias';

const MAP = {
  'space-bunny': 'fast',
  'mimo-v2.6': 'smart',
  'mimo-v2.6-flash': 'smart',
  'grok-4.6-liberated': 'frontier',
};

describe('bareModelName', () => {
  it('strips the provider prefix', () => {
    expect(bareModelName('openai/space-bunny')).toBe('space-bunny');
  });

  it('strips the upstream free suffix', () => {
    // The upstream answers `"model":"space-bunny-free"`.
    expect(bareModelName('space-bunny-free')).toBe('space-bunny');
    expect(bareModelName('laguna-s-2.1:free')).toBe('laguna-s-2.1');
  });

  it('handles both at once', () => {
    expect(bareModelName('openai/space-bunny-free')).toBe('space-bunny');
  });

  it('leaves a bare name alone', () => {
    expect(bareModelName('fast')).toBe('fast');
  });
});

describe('toAlias', () => {
  it('resolves every shape the gateway has actually produced', () => {
    for (const shape of [
      'openai/space-bunny',
      'space-bunny',
      'space-bunny-free',
      'openai/space-bunny-free',
    ]) {
      expect(toAlias(MAP, shape), shape).toBe('fast');
    }
  });

  it('is idempotent on an already-resolved alias', () => {
    for (const a of TIER_ALIASES) {
      expect(toAlias(MAP, a)).toBe(a);
    }
  });

  it('resolves longest key first, so a prefix cannot shadow a model', () => {
    // `mimo-v2.6-flash` starts with `mimo-v2.6`. A naive startsWith match
    // would route the flash model through the wrong row — and if the two
    // ever land in different tiers, through the wrong rate.
    const mixed = { 'mimo-v2.6': 'smart', 'mimo-v2.6-flash': 'fast' };
    expect(toAlias(mixed, 'mimo-v2.6-flash')).toBe('fast');
    expect(toAlias(mixed, 'mimo-v2.6')).toBe('smart');
  });

  it('never passes an upstream name through', () => {
    // The whole point of this module. An unmapped name must come out as
    // `unknown`, not as itself.
    expect(toAlias(MAP, 'some-future-model')).toBe(UNKNOWN_ALIAS);
    expect(toAlias(MAP, '')).toBe(UNKNOWN_ALIAS);
    expect(toAlias(MAP, null)).toBe(UNKNOWN_ALIAS);
    expect(toAlias(MAP, undefined)).toBe(UNKNOWN_ALIAS);
  });

  it('treats whitespace-padded values as themselves, not as typos', () => {
    expect(toAlias(MAP, ' space-bunny ')).toBe('fast');
  });
});

describe('isAlias', () => {
  it('accepts the three tiers and nothing else', () => {
    expect(isAlias('fast')).toBe(true);
    expect(isAlias('space-bunny')).toBe(false);
    expect(isAlias('unknown')).toBe(false);
  });
});

describe('aliasForRow — model_group wins, model is the fallback', () => {
  it('prefers the group the client requested over the resolved model', () => {
    // The normal case: group is the alias, model is the upstream id.
    expect(aliasForRow(MAP, { model: 'openai/mimo-v2.6', model_group: 'smart' })).toBe('smart');
  });

  it('still maps when the group is empty', () => {
    // Zero-token rows (a `/v1/models` call logged against an alias-looking
    // model) carry no group. The registry mapping takes over.
    expect(aliasForRow(MAP, { model: 'openai/mimo-v2.6', model_group: '' })).toBe('smart');
    expect(aliasForRow(MAP, { model: 'openai/space-bunny' })).toBe('fast');
  });

  it('never returns a raw name even when both fields are unmapped', () => {
    expect(aliasForRow(MAP, { model: 'openai/something-new', model_group: '' })).toBe(UNKNOWN_ALIAS);
    expect(aliasForRow(MAP, {})).toBe(UNKNOWN_ALIAS);
  });

  it('maps a group value that is itself a model name', () => {
    // Defensive: if some gateway version ever logs the resolved name in the
    // group field, the registry still applies rather than passing it through.
    expect(aliasForRow(MAP, { model: 'x', model_group: 'openai/space-bunny' })).toBe('fast');
  });
});

describe('routeForCallType', () => {
  it('maps the three inference call types', () => {
    expect(routeForCallType('acompletion')).toBe('chat');
    expect(routeForCallType('anthropic_messages')).toBe('messages');
    expect(routeForCallType('aresponses')).toBe('responses');
  });

  it('labels non-inference calls with what they are', () => {
    expect(routeForCallType('/v1/models')).toBe('models');
    expect(routeForCallType('/key/info')).toBe('key-info');
  });

  it('keeps a legacy endpoint only when it is a real route', () => {
    expect(routeForCallType(undefined, 'chat')).toBe('chat');
    expect(routeForCallType(undefined, 'something-odd')).toBe('unknown');
  });

  it('returns unknown only when the row carries nothing at all', () => {
    expect(routeForCallType(undefined, undefined)).toBe('unknown');
    expect(routeForCallType('', '')).toBe('unknown');
  });
});
