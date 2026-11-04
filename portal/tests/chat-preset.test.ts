/**
 * The three-layer settings merge.
 *
 * The bug this guards is not a crash: `{...global, ...chat}` with an
 * explicit `undefined` CLEARS a preset, so a chat that only sets a
 * temperature would silently drop the user's system prompt. Merge order and
 * undefined handling are the whole contract.
 */
import { describe, expect, it } from 'vitest';

import { mergeSettings, readSettings } from '@/lib/chat/preset';

describe('readSettings', () => {
  it('returns nothing for a row that was never written', () => {
    expect(readSettings(null)).toEqual({});
    expect(readSettings(undefined)).toEqual({});
  });

  it('drops a value from an older or bogus shape instead of throwing', () => {
    // A stored row must never 500 a chat turn: the schema is validated on
    // read because nothing validates on write (it is jsonb by design).
    expect(readSettings({ temperature: 'hot', bogus: 1 })).toEqual({});
    expect(readSettings({ temperature: 9 })).toEqual({});
  });

  it('keeps the values it understands', () => {
    expect(readSettings({ temperature: 0.3, systemPrompt: 'be terse' })).toEqual({
      temperature: 0.3,
      systemPrompt: 'be terse',
    });
  });
});

describe('mergeSettings', () => {
  it('applies layers in order, later winning', () => {
    expect(mergeSettings({ temperature: 0.9 }, { temperature: 0.2 })).toEqual({ temperature: 0.2 });
  });

  it('does not let an absent value clear a set one', () => {
    expect(mergeSettings({ systemPrompt: 'keep me' }, { temperature: 0.5 })).toEqual({
      systemPrompt: 'keep me',
      temperature: 0.5,
    });
    expect(mergeSettings({ systemPrompt: 'keep me' }, undefined, null)).toEqual({
      systemPrompt: 'keep me',
    });
  });

  it('ignores empty strings and zero-ish absent values without dropping a real 0', () => {
    // temperature 0 is a legitimate setting (deterministic), so the guard
    // must test for undefined/null/'' and not for falsiness.
    expect(mergeSettings({ systemPrompt: 'x' }, { systemPrompt: '' })).toEqual({
      systemPrompt: 'x',
    });
    expect(mergeSettings({ temperature: 0 })).toEqual({ temperature: 0 });
  });
});
