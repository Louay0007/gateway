import { describe, expect, it } from 'vitest';

import { isCodingTurn, ponytailPrompt, PONYTAIL_LEVELS } from '@/lib/chat/ponytail';
import { buildSystemPrompt } from '@/lib/chat/prompt';
import { mergeSettings, readSettings } from '@/lib/chat/preset';

/**
 * Ponytail is prompt text, so these tests are the only thing standing
 * between a customer and a curtailed answer. Two properties matter:
 * the block says what upstream says, and it never reaches a prose turn.
 */

describe('ponytailPrompt', () => {
  it('renders each level', () => {
    for (const level of PONYTAIL_LEVELS) {
      expect(ponytailPrompt(level)).toBeTruthy();
    }
  });

  it('keeps upstream’s ladder verbatim', () => {
    const full = ponytailPrompt('full') as string;
    // The rungs are the product. If one is paraphrased away the rule stops
    // being the rule that was measured.
    expect(full).toContain('Does it need to exist?');
    expect(full).toContain('Already in this codebase');
    expect(full).toContain('Standard library or a platform feature?');
    expect(full).toContain('An installed dependency?');
    expect(full).toContain('One line');
    expect(full).toContain('the minimum code that works');
  });

  it('keeps the never-cut list', () => {
    // These are the safety clauses. Dropping one turns "lazy" into
    // "negligent", which is the only way this ruleset can cause harm.
    const full = ponytailPrompt('full') as string;
    for (const clause of ['validation at trust boundaries', 'error handling', 'security', 'accessibility']) {
      expect(full).toContain(clause);
    }
  });

  it('adds the report duty to full and ultra, not lite', () => {
    expect(ponytailPrompt('full')).toContain('what you skipped');
    expect(ponytailPrompt('ultra')).toContain('what you skipped');
    expect(ponytailPrompt('lite')).not.toContain('what you skipped');
  });

  it('grade differences are real, not decoration', () => {
    const lite = ponytailPrompt('lite') as string;
    const ultra = ponytailPrompt('ultra') as string;
    expect(lite).toContain('Name the smaller option');
    expect(ultra).toContain('question the request');
    expect(lite).not.toContain('question the request');
  });

  it('returns null rather than guessing a level', () => {
    expect(ponytailPrompt(null)).toBeNull();
    expect(ponytailPrompt(undefined)).toBeNull();
    expect(ponytailPrompt('off')).toBeNull();
    expect(ponytailPrompt('maximum')).toBeNull();
  });

  it('protects the identity lines from its own brevity rule', () => {
    // Both rules are "be brief"; without this sentence the identity answer
    // arrives as a truncated brand name.
    expect(ponytailPrompt('full')).toContain('does not change your name');
  });
});

describe('isCodingTurn', () => {
  const coding = [
    'write a function that parses this date format',
    'refactor this component to use the new hook',
    'fix the bug in the sql query',
    '```ts\nconst x = 1\n```',
    'debug my dockerfile',
    'review this pull request',
    'why does my git commit fail',
    'write a python script to rename files',
    'help me with this stack trace',
    'migrate the schema',
  ];
  it.each(coding)('detects %s', (text) => {
    expect(isCodingTurn(text)).toBe(true);
  });

  const prose = [
    'write a launch email for our new pricing',
    'summarise this invoice',
    'what is the capital of France',
    'draft a reply to this customer complaint',
    'translate this paragraph to French',
    'is our plan cheaper for long documents',
  ];
  it.each(prose)('leaves %s alone', (text) => {
    expect(isCodingTurn(text)).toBe(false);
  });

  it('handles empty input', () => {
    expect(isCodingTurn('')).toBe(false);
    expect(isCodingTurn('   ')).toBe(false);
  });
});

describe('the settings knob', () => {
  it('accepts every level plus off', () => {
    for (const level of ['off', ...PONYTAIL_LEVELS]) {
      expect(readSettings({ codingStyle: level }).codingStyle).toBe(level);
    }
  });

  it('drops a level the schema does not know', () => {
    // A typo must degrade to "unset", never to a 500.
    expect(readSettings({ codingStyle: 'maximum' }).codingStyle).toBeUndefined();
  });

  it('absent is not off', () => {
    // Absent means "decide by turn shape"; off means never. Collapsing the
    // two would remove the default behaviour from every new account.
    expect(readSettings({}).codingStyle).toBeUndefined();
    expect(readSettings({ codingStyle: undefined }).codingStyle).toBeUndefined();
  });

  it('a later layer wins', () => {
    expect(mergeSettings({ codingStyle: 'lite' }, { codingStyle: 'off' }).codingStyle).toBe('off');
    expect(mergeSettings({ codingStyle: 'off' }, {}).codingStyle).toBe('off');
  });
});

describe('buildSystemPrompt with ponytail', () => {
  it('is inserted for a coding turn with no stored setting', () => {
    const prompt = buildSystemPrompt({ alias: 'smart', userText: 'fix this sql query' });
    expect(prompt).toContain('lazy senior developer');
  });

  it('is absent for a prose turn with no stored setting', () => {
    const prompt = buildSystemPrompt({ alias: 'smart', userText: 'write a launch email' });
    expect(prompt).not.toContain('lazy senior developer');
    expect(prompt).toContain('Zaino AI Smart');
  });

  it('an explicit off wins even on a coding turn', () => {
    // The user said never. Shape must not override that.
    const prompt = buildSystemPrompt({
      alias: 'smart',
      ponytail: 'off',
      userText: 'fix this sql query',
    });
    expect(prompt).not.toContain('lazy senior developer');
  });

  it('an explicit level wins even on a prose turn', () => {
    const prompt = buildSystemPrompt({
      alias: 'smart',
      ponytail: 'ultra',
      userText: 'write a launch email',
    });
    expect(prompt).toContain('question the request');
  });

  it('sits below the per-chat preset, so the customer still wins', () => {
    const prompt = buildSystemPrompt({
      alias: 'smart',
      userText: 'fix this sql query',
      chatSystemPrompt: 'Always explain your reasoning at length.',
    }) as string;
    expect(prompt.indexOf('lazy senior developer')).toBeLessThan(
      prompt.indexOf('Always explain your reasoning'),
    );
  });

  it('never displaces the identity block', () => {
    const prompt = buildSystemPrompt({ alias: 'fast', userText: 'write a rust function' }) as string;
    expect(prompt.indexOf('Zaino AI Fast')).toBeLessThan(prompt.indexOf('lazy senior developer'));
  });
});

describe('branding — the customer and the model see only Zaino AI', () => {
  it('the prompt never carries the upstream product name', () => {
    // A model handed a third party's ruleset will sometimes volunteer that
    // third party's name in an unrelated answer. The identity layer exists
    // to stop exactly that, so this block must not seed it.
    for (const level of PONYTAIL_LEVELS) {
      const text = ponytailPrompt(level) as string;
      expect(text.toLowerCase()).not.toContain('ponytail');
      expect(text.toLowerCase()).not.toContain('dietrich');
      expect(text.toLowerCase()).not.toContain('gebert');
    }
  });

  it('the prompt opens with our own name', () => {
    expect(ponytailPrompt('full')?.trimStart().startsWith('Zaino AI settings')).toBe(true);
  });

  it('the stored settings key is ours, not upstream’s', () => {
    // GET /api/chat/presets returns this object to the browser, so the key
    // name is user-visible in network traffic.
    const stored = readSettings({ codingStyle: 'full' });
    expect(stored.codingStyle).toBe('full');
    expect(Object.keys(stored)).not.toContain('ponytail');
  });
});
