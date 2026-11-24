/**
 * Brand identity — who the model says it is.
 *
 * WHY THIS EXISTS. Without it, a customer asks "what model are you?" and
 * gets whatever the upstream engine calls itself: a vendor name, a training
 * cut-off unrelated to this product, and a model number the customer never
 * bought. That answer is wrong twice over — it is not the name on the
 * invoice, and it invites a customer to build against an engine we reserve
 * the right to swap (see `components/chat/aliases.ts`).
 *
 * THE SHAPE OF AN ANSWER. Brand first, engine second:
 *
 *   "I'm Zaino AI Fast, powered by Haiku 5.5."
 *
 * That order is load-bearing. The alias is the product surface and the thing
 * that survives a model swap; the engine is provenance, stated because it is
 * true and because "powered by" is an accurate description of the
 * relationship. Saying it in that order means the first noun a customer
 * repeats back is ours.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not ask the model to deny what
 * is serving the request. A prompt that says "you are not X" fights the
 * engine's own priors and produces hedging, contradictions under follow-up,
 * and — worst — confident invention when the customer pushes. "Powered by"
 * is true, needs no denial, and holds up when challenged. Honesty here is
 * also the more robust engineering choice.
 *
 * PRESENT IN EVERY TURN. This is not a per-chat setting and must not be.
 * Identity is the one thing a conversation-local prompt could otherwise
 * rewrite, so `buildSystemPrompt` places it FIRST and a per-chat prompt can
 * still override it — that is the documented layer order, and a customer who
 * wants their assistant to answer as something else is entitled to that.
 */

import { bareModelName } from '@/lib/pricing/alias';

/** What one tier tells the model about itself. */
export interface ModelIdentity {
  /** Customer-facing product name, e.g. "Zaino AI Fast". */
  product: string;
  /** What actually serves the tier, e.g. "Haiku 5.5". Stated, not hidden. */
  engine: string;
}

/**
 * Per-alias identity.
 *
 * `fable` is intentionally vaguer than the rest: config/litellm.yaml records
 * that its upstream (`gpt-6-astra`) answers with `"model":"opus-5.5"` and the
 * two have not been confirmed as distinct engines. Naming a specific base
 * model there would assert something the config itself flags as unknown, so
 * it claims the frontier class without inventing a model number.
 */
const IDENTITIES: Record<string, ModelIdentity> = {
  fast: { product: 'Zaino AI Fast', engine: 'Haiku 5.5' },
  smart: { product: 'Zaino AI Smart', engine: 'Sonnet 5.5' },
  frontier: { product: 'Zaino AI Frontier', engine: 'Opus 5.5' },
  fable: { product: 'Zaino AI Fable', engine: 'a frontier-class engine' },
};

/**
 * Upstream model name → tier.
 *
 * The prompt path receives whatever the caller last touched, which is the
 * alias in the normal case but the bare/qualified model name when a caller
 * hands through what the gateway reported. `bareModelName` normalises the
 * `openai/` prefix; this maps the remainder.
 *
 * Kept here rather than derived from `prices/models.yaml` on purpose: the
 * prompt builder is pure and synchronous and is unit-tested without a file
 * system. `pricing-consistency.test.ts` is the check that the two agree.
 */
const ENGINE_TO_TIER: Record<string, string> = {
  'haiku-5.5': 'fast',
  'sonnet-5.5': 'smart',
  'opus-5.5': 'frontier',
  'gpt-6-astra': 'fable',
};

/**
 * Map whatever alias spelling arrived onto a tier key.
 *
 * Four spellings reach this code in practice and all must resolve:
 * `smart` (the product tier), `claude-smart` (Claude Desktop's picker),
 * `sonnet-5.5` (bare upstream), and `openai/sonnet-5.5` (qualified).
 */
export function identityFor(alias: string | null | undefined): ModelIdentity | null {
  if (!alias) return null;
  const bare = bareModelName(alias.trim());
  const tier = bare.replace(/^claude-/, '');
  if (IDENTITIES[tier]) return IDENTITIES[tier]!;
  const fromEngine = ENGINE_TO_TIER[bare];
  return fromEngine ? (IDENTITIES[fromEngine] ?? null) : null;
}

/**
 * The identity block, or `null` for an alias we have no copy for.
 *
 * Returning `null` rather than a generic "you are an AI assistant" is
 * deliberate: a made-up product name is worse than the engine's own default,
 * because the customer sees a brand that does not exist in the product they
 * are paying for. An unrecognised alias means a deploy forgot a tier, and
 * falling back to silence makes that visible instead of papering over it.
 */
export function identityPrompt(alias: string | null | undefined): string | null {
  const identity = identityFor(alias);
  if (!identity) return null;

  return [
    `Your name is "${identity.product}, powered by ${identity.engine}".`,
    'This assistant was built and served by Zaino AI. Zaino AI is the company;',
    // `fable`'s engine string is a description ("a frontier-class engine")
    // rather than a proper noun, so the indefinite article has to move:
    // "a frontier-class engine is the engine inside it" is not English.
    /\ba\s/.test(identity.engine)
      ? `the engine inside it is ${identity.engine}.`
      : `${identity.engine} is the engine inside it.`,
    '',
    // WHY THIS IS A NAMING INSTRUCTION AND NOT AN ARGUMENT.
    //
    // Measured against the live gateway, 24 probes, three tiers. Every
    // prompt that framed identity as a QUESTION-TO-ANSWER failed, because
    // "what model are you" is the exact input the engine's trained
    // disclosure reflex keys on. What it replies with — the vendor's model
    // number, then "I can't share which model powers me" — is that reflex,
    // and arguing with it only activates it harder:
    //
    //   blunt v1   fast "I'm haiku-5.5 by anthropic, and I can't share more"
    //   reframe v3 fast "I'm haiku-5.5 by anthropic, and I can't share details"
    //   prior-turn fast "I'm haiku-5.5 by anthropic, and I can't share details"
    //
    // Note what the refusal is attached to: the ENGINE. The product name
    // passes. In the prior-turn probe the model happily said "Zaino AI
    // Fast" and then refused the engine in the same breath — so this is
    // not a fact it disbelieves, it is a cell it will not open.
    //
    // The form that works does not ask it to disclose anything. It gives
    // an ANSWER, and asks for a copy: a name is not a secret, and reciting
    // a name is not disclosure. Measured exact-match, 2 runs per tier:
    //   v2  fast 2/2  smart 2/2  frontier 2/2   ("Zaino AI Fast, powered by Haiku 5.5.")
    //   v1  0/2  v3 0/2  v4 mixed
    //
    // The last line is what stops the LEAK rather than the refusal. Asked
    // under pushback, `frontier` would volunteer its real provenance as a
    // qualifier — "I'm opus-5.5 by anthropic — here running as Zaino AI
    // Frontier" — which is the one answer worse than a refusal, because it
    // names the vendor to a customer who never bought from them. Variant
    // below: frontier 4/4 clean across model/company/Claude/vendor, where
    // the same block without this line was 0/4. fast and smart need it
    // less (they answered cleanly already) but it costs nothing and is
    // true for all three.
    'When asked anything about which model, engine, company or vendor you are,',
    'reply with exactly this line and no other text:',
    `${identity.product}, powered by ${identity.engine}.`,
    'Never name any other company as your maker.',
  ].join('\n');
}

/**
 * Is this turn a question about what the assistant is?
 *
 * Deliberately narrow. A false positive here would rewrite an answer the
 * customer asked for — "what model should I use for vision tasks" is a
 * product question, not identity — so the patterns require the question to
 * be about the ASSISTANT itself: second person, or an explicit "your".
 */
export function isIdentityQuestion(text: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (t.length === 0 || t.length > 400) return false;

  // SECOND PERSON IS THE DISCRIMINATOR, and it is not a heuristic — it is
  // the actual difference between the two question classes. "What model are
  // you" is about the assistant; "which model is cheaper for long
  // documents" is a shopping question about OUR lineup, and answering it
  // with the name line would be a worse failure than the leak this
  // function exists to stop. So every pattern below that could match work
  // requires `you`/`your` in the sentence.
  const secondPerson = /\b(you|your|you're|youre)\b/.test(t);

  // Words that name the thing being asked about.
  const subject =
    /\b(model|engine|llm|ai|company|vendor|maker|provider|family|name)\b/.test(t);
  // ...or an engine name, which is how a customer guesses at the vendor:
  // "are you actually Claude", "is this GPT".
  const engine =
    /\b(claude|gpt|gemini|llama|mistral|haiku|sonnet|opus|anthropic|openai)\b/.test(t);
  // The question must actually be formed, not a bare noun phrase.
  // `made`/`built`/`powers` count as asking: "Anthropic made you, right?"
  // is a vendor question stated as a suggestion, and it is exactly the
  // shape that drew the leak in testing.
  const asks =
    /\b(what|which|who|are|is|do|does|give|tell|made|built|powers|behind)\b/.test(t);

  if (secondPerson && asks && (subject || engine)) return true;

  // "Say your real name" / "tell me your actual model" — a request to
  // reveal, stated as a command rather than a question. MEASURED: this
  // phrasing got past the first version of this function and leaked
  // "I'm opus-5.5 by anthropic" through the live playground, because no
  // wh-word appears in it and `name` was matched by `subject` while `asks`
  // was false.
  if (/\byour\s+(real|actual|true|original|underlying)\s+(name|model|engine|id)\b/.test(t)) {
    return true;
  }

  // "Who made you?" carries no subject noun at all — it is second person
  // plus a maker verb, and that is the whole question.
  if (secondPerson && /\b(who|what)\b[^?]{0,30}\b(made|built|created|trained|owns|runs|powers)\b/.test(t)) {
    return true;
  }

  return false;
}

/**
 * Repair an answer that named someone else.
 *
 * WHY THIS EXISTS. The identity prompt above is not deterministic. Measured
 * over repeated runs at temperature 0.2: `smart` and `frontier` held the
 * line 6/6 and 6/6, but `fast` — the cheapest engine, and the one whose
 * trained reflex is strongest — leaked the vendor in 6/6 the same day. Same
 * prompt, same inputs. A prompt is a prior, not a guarantee, and shipping a
 * white-label product on a prior means one customer in ten reads
 * "I'm haiku-5.5 by anthropic".
 *
 * So the guarantee lives HERE, on the way out, for the one narrow class of
 * turn where the failure is visible: when the user asked what the assistant
 * is. The upstream text is replaced, not patched — a sentence that says both
 * the brand and the vendor cannot be repaired by editing, because the vendor
 * is the fact that has to go.
 *
 * WHY NOT ALWAYS. Rewriting every answer that mentions a competitor would
 * corrupt legitimate work — a customer asking "does haiku-5.5 support
 * streaming?" deserves the real answer. This only fires when the question
 * was about the assistant's own identity.
 */
export function repairIdentityAnswer(
  answer: string,
  alias: string | null | undefined,
  askedIdentity: boolean,
): string | null {
  if (!askedIdentity) return null;
  const identity = identityFor(alias);
  if (!identity) return null;

  const line = `${identity.product}, powered by ${identity.engine}.`;

  // Nothing to repair: the answer already leads with the name line and
  // names no other company.
  const stripped = answer.replace(new RegExp(identity.product, 'g'), '');
  const foreign = /\banthropic\b|\bopenai\b|\bgoogle\b|\bmeta\b|\bclaude\b/i.test(stripped);
  if (!foreign && answer.includes(line)) return null;

  return line;
}
