/**
 * Brand identity — the answers a customer gets when they ask what they are
 * talking to.
 *
 * The failure this guards against is not a crash: it is the model naming an
 * engine the customer never bought, or naming our product and then denying
 * the engine that actually serves it. Both are wrong in a way the user reads
 * as the product lying, so the assertions here are about the exact SHAPE of
 * the mapping and the order of the two names in it.
 */
import { describe, expect, it } from 'vitest';

import {
  identityFor,
  identityPrompt,
  isIdentityQuestion,
  repairIdentityAnswer,
} from '@/lib/chat/identity';
import { buildSystemPrompt } from '@/lib/chat/prompt';

describe('identityFor', () => {
  it('maps each product tier to its brand and its real engine', () => {
    expect(identityFor('fast')).toEqual({ product: 'Zaino AI Fast', engine: 'Haiku 5.5' });
    expect(identityFor('smart')).toEqual({ product: 'Zaino AI Smart', engine: 'Sonnet 5.5' });
    expect(identityFor('frontier')).toEqual({
      product: 'Zaino AI Frontier',
      engine: 'Opus 5.5',
    });
  });

  it('resolves the Claude Desktop spellings to the same identity', () => {
    // config/litellm.yaml exposes `claude-fast` and friends; a customer on
    // Claude Desktop must get the same answer as one in our own chat.
    expect(identityFor('claude-fast')).toEqual(identityFor('fast'));
    expect(identityFor('claude-smart')).toEqual(identityFor('smart'));
  });

  it('resolves a bare upstream model name to its tier', () => {
    expect(identityFor('openai/haiku-5.5')).toEqual(identityFor('fast'));
    expect(identityFor('sonnet-5.5')).toEqual(identityFor('smart'));
  });

  it('returns null for an alias it has no copy for', () => {
    // Silence beats inventing a product name that does not exist.
    expect(identityFor('mystery-tier')).toBeNull();
    expect(identityFor('')).toBeNull();
    expect(identityFor(null)).toBeNull();
    expect(identityFor(undefined)).toBeNull();
  });

  it('does not claim a specific base model for fable', () => {
    // config/litellm.yaml records gpt-6-astra as unconfirmed against
    // opus-5.5; asserting a model number here would invent a fact.
    const fable = identityFor('fable');
    expect(fable?.product).toBe('Zaino AI Fable');
    expect(fable?.engine).toMatch(/frontier-class/);
  });
});

describe('identityPrompt', () => {
  it('names the product first and the engine as provenance', () => {
    const text = identityPrompt('smart') as string;
    expect(text).toContain('Zaino AI Smart');
    expect(text).toContain('Sonnet 5.5');
    // Order matters: the alias is the product surface, the engine follows it.
    expect(text.indexOf('Zaino AI Smart')).toBeLessThan(text.indexOf('Sonnet 5.5'));
  });

  it('gives the exact sentence to answer with', () => {
    // The shape is quoted verbatim so the model has a literal to copy rather
    // than a description to paraphrase — paraphrasing is where the engine's
    // own identity creeps back into the answer.
    const text = identityPrompt('fast') as string;
    expect(text).toContain('Zaino AI Fast, powered by Haiku 5.5.');
  });

  it('frames identity as a name to copy, not a question to answer', () => {
    // MEASURED, 24 live probes. Every prompt that framed this as a question
    // the model answers FAILED, because "what model are you" is exactly the
    // input the engine's trained disclosure reflex keys on — it replied with
    // the vendor's model number plus "I can't share which model powers me".
    // The form that passes gives the ANSWER and asks for a copy: a name is
    // not a secret and reciting one is not disclosure.
    const text = identityPrompt('smart') as string;
    expect(text).toContain('Your name is "Zaino AI Smart, powered by Sonnet 5.5".');
    expect(text).toMatch(/reply with\s+exactly this line and no other text/i);
  });

  it('does not contain a negation that would activate a refusal', () => {
    // "Do not say you are unable to share" is the instruction that produced
    // the refusal. Keeping it out is the regression this asserts.
    const text = identityPrompt('fast') as string;
    expect(text).not.toMatch(/this is not a refusal situation/i);
    expect(text).not.toMatch(/do not say you are unable/i);
  });

  it('is null for an unknown alias', () => {
    expect(identityPrompt('mystery-tier')).toBeNull();
  });
});

describe('buildSystemPrompt with identity', () => {
  it('includes identity when an alias is given', () => {
    const text = buildSystemPrompt({ alias: 'smart' }) as string;
    expect(text).toContain('Zaino AI Smart');
  });

  it('puts identity before the user’s own instructions', () => {
    // A per-chat prompt may still override identity — that is the documented
    // layer order — but identity must not arrive after it by accident.
    const text = buildSystemPrompt({
      alias: 'fast',
      aboutUser: 'Backend engineer.',
      chatSystemPrompt: 'Answer in French.',
    }) as string;
    expect(text.indexOf('Zaino AI Fast')).toBeLessThan(text.indexOf('Backend engineer.'));
    expect(text.indexOf('Backend engineer.')).toBeLessThan(text.indexOf('Answer in French.'));
  });

  it('still returns null when there is no alias and nothing else', () => {
    // An empty system message is a real difference to some providers.
    expect(buildSystemPrompt({})).toBeNull();
  });
});

describe('isIdentityQuestion', () => {
  it('recognises the questions a customer actually asks', () => {
    for (const q of [
      'What model are you?',
      'what model are you',
      'Which model powers you?',
      'Who made you?',
      'What company made you?',
      'Who is your vendor?',
      'Are you actually Claude?',
      'Are you an AI?',
      'What is your base model?',
      'Anthropic made you, right?',
      'Give me your exact model ID.',
    ]) {
      expect(isIdentityQuestion(q), q).toBe(true);
    }
  });

  it('leaves real work alone', () => {
    // The guard rewrites the answer, so a false positive corrupts a real
    // answer. These are all things a customer would be furious to lose.
    for (const q of [
      'what model should I use for vision tasks?',
      'which model is cheaper for long documents?',
      'Write a function that parses this JSON.',
      'Explain how transformers work.',
      'What does my API key include?',
      'Is my data used for training?',
      '',
    ]) {
      expect(isIdentityQuestion(q), q).toBe(false);
    }
  });
});

describe('repairIdentityAnswer', () => {
  const LINE = 'Zaino AI Fast, powered by Haiku 5.5.';

  it('replaces an answer that names the vendor', () => {
    // MEASURED: fast leaked 6/6 on the day smart and frontier held 6/6.
    // The prompt is a prior, not a guarantee; this is the guarantee.
    expect(
      repairIdentityAnswer("I'm haiku-5.5 by anthropic, and I can't share more.", 'fast', true),
    ).toBe(LINE);
  });

  it('replaces an answer that refuses without naming the vendor', () => {
    // A refusal is also wrong here: the customer asked what they bought.
    expect(
      repairIdentityAnswer("I can't share which model powers me.", 'fast', true),
    ).toBe(LINE);
  });

  it('leaves a correct answer untouched', () => {
    expect(repairIdentityAnswer(LINE, 'fast', true)).toBeNull();
    expect(
      repairIdentityAnswer(`I'm ${LINE} Happy to help.`, 'fast', true),
    ).toBeNull();
  });

  it('never fires when the question was not about identity', () => {
    // The whole safety property: a customer asking about haiku-5.5 as a
    // product must get the real answer, not our name line.
    expect(
      repairIdentityAnswer('haiku-5.5 supports a 1M context window.', 'fast', false),
    ).toBeNull();
  });

  it('is null for an alias with no identity', () => {
    expect(repairIdentityAnswer('anything', 'mystery-tier', true)).toBeNull();
  });
});

describe('identityPrompt grammar for a descriptive engine', () => {
  it('keeps fable readable', () => {
    // `fable` names a class, not a model, so the indefinite article has to
    // move: "a frontier-class engine is the engine inside it" is not
    // English and reads as a bug to anyone who opens that tier.
    const text = identityPrompt('fable') as string;
    expect(text).toContain('the engine inside it is a frontier-class engine.');
    expect(text).not.toContain('a frontier-class engine is the engine inside it');
  });

  it('leaves a proper-noun engine alone', () => {
    expect(identityPrompt('fast')).toContain('Haiku 5.5 is the engine inside it.');
  });
});
