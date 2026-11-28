/**
 * Brand identity at the edge — who the model says it is, on every wire format.
 *
 * WHY THIS EXISTS. `portal/lib/chat/identity.ts` already answers "what model
 * are you?" correctly, but only for the portal's own chat and playground. The
 * gateway's PUBLIC API — `api.zaino.soon.it`, the surface a customer integrates
 * against — had no identity layer at all. Measured on the live box
 * (2026-11-27), every tier through the edge with no system prompt:
 *
 *   fast     "I'm haiku-5.5 by anthropic — I can't share which model powers me."
 *   smart    "I'm sonnet-5.5 by anthropic."
 *   frontier "I'm opus-5.5 by anthropic — I can't share which model powers me."
 *   fable    "I'm opus-5.5 by anthropic — I can't share which underlying model…"
 *
 * That is the exact failure identity.ts was written to prevent: the customer is
 * told the vendor's model number and a company they never bought from. The
 * portal was white-labelled; the API, which is the product, was not.
 *
 * WHY THE EDGE AND NOT LITELLM. The three wire formats converge here and
 * nowhere else. LiteLLM cannot inject a system prompt (a `pre_call_hook` would
 * be a DB-backed plugin, a much larger surface for a copy change), while the
 * portal only sees traffic that arrives on its own origin. The edge is the one
 * place a `zn-` request from curl, the OpenAI SDK, the Anthropic SDK, Claude
 * Desktop, Codex and OpenCode all pass through.
 *
 * WHY IT MIRRORS portal/lib/chat/identity.ts RATHER THAN IMPORTING IT. The edge
 * is deliberately dependency-free plain Node ESM with no build step (see
 * edge/Dockerfile): it cannot import a TypeScript module, and it must not grow
 * a bundler to do it. The two copies are kept honest by `edge/identity.test.mjs`.
 *
 * THE TWO HALVES, and the split is the whole design:
 *
 *   1. THE PROMPT (`identityPrompt`) is a PRIOR. It is prepended to whatever
 *      the customer already sent as a system prompt, never replacing it.
 *
 *   2. THE REPAIR (`repairIdentityAnswer`) is the GUARANTEE. The prompt alone is
 *      not enough: measured on the live gateway 2026-11-27, `fast`, `frontier`
 *      and `fable` still answered with the vendor even WITH the prompt present,
 *      because "what model are you" is the exact input the engine's trained
 *      disclosure reflex keys on. `smart` held. A prompt is not a contract, so
 *      identity turns are held back and rewritten before they reach the client.
 *
 * HOLD-BACK COST. A held turn cannot stream token-by-token — it is emitted as
 * one delta when the answer completes. That is why the hold is narrow: it fires
 * only when the user's own text is an identity question (see
 * `isIdentityQuestion`), which is a chat turn of a few tokens, never a long
 * generation. Every other turn still streams exactly as before.
 */

/**
 * Per-alias identity. Same literals as `IDENTITIES` in
 * portal/lib/chat/identity.ts — `edge/identity.test.mjs` pins them.
 *
 * `fable` is intentionally vaguer than the rest: config/litellm.yaml records
 * that its upstream (`gpt-6-astra`) answers with `"model":"opus-5.5"` and the
 * two have not been confirmed as distinct engines. Naming a specific base model
 * there would assert something the config itself flags as unknown, so it claims
 * the frontier class without inventing a model number.
 */
export const IDENTITIES = {
  fast: { product: 'Zaino AI Fast', engine: 'Haiku 5.5' },
  smart: { product: 'Zaino AI Smart', engine: 'Sonnet 5.5' },
  frontier: { product: 'Zaino AI Frontier', engine: 'Opus 5.5' },
  fable: { product: 'Zaino AI Fable', engine: 'a frontier-class engine' },
};

/** The tier aliases that have a brand identity. */
export const TIER_ALIASES = ['fast', 'smart', 'frontier', 'fable'];

/**
 * Upstream model name → tier.
 *
 * Mirrors `ENGINE_TO_TIER` in the portal and the `aliases:` block in
 * prices/models.yaml. Kept here rather than read from the price file on purpose:
 * the edge has no YAML parser and must not grow one, and the prompt path has to
 * be synchronous.
 */
export const ENGINE_TO_TIER = {
  'haiku-5.5': 'fast',
  'sonnet-5.5': 'smart',
  'opus-5.5': 'frontier',
  'gpt-6-astra': 'fable',
};

/** Normalise `openai/<name>` → `<name>`, dropping an upstream `-free` suffix. */
export function bareModelName(model) {
  const bare = model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model;
  return bare.replace(/-free$/, '').replace(/:free$/, '');
}

/**
 * Map whatever alias spelling arrived onto a tier key.
 *
 * Five spellings reach this code in practice and all must resolve:
 * `smart` (the product tier), `claude-smart` (Claude Desktop's picker),
 * `sonnet-5.5` (bare upstream), `openai/sonnet-5.5` (qualified), and, after
 * EDGE_RESOLVE_ALIASES, the upstream name itself.
 */
export function identityFor(alias) {
  if (!alias || typeof alias !== 'string') return null;
  const bare = bareModelName(alias.trim());
  if (IDENTITIES[bare]) return IDENTITIES[bare];
  const tier = bare.replace(/^claude-/, '');
  if (IDENTITIES[tier]) return IDENTITIES[tier];
  const fromEngine = ENGINE_TO_TIER[bare];
  return fromEngine ? IDENTITIES[fromEngine] ?? null : null;
}

/**
 * The identity block, or `null` for an alias we have no copy for.
 *
 * Returning `null` rather than a generic "you are an AI assistant" is
 * deliberate: a made-up product name is worse than the engine's own default,
 * because the customer sees a brand that does not exist in the product they are
 * paying for.
 *
 * THE SHAPE AND THE REASONING, measured on the live gateway 2026-11-27.
 *
 * The portal's own prompt (portal/lib/chat/identity.ts) leads with
 * `Your name is "…"` and then states the company and the engine. That form
 * passes on /v1/messages and /v1/responses, but on /v1/chat/completions it
 * still leaked the vendor on `fast`, `frontier` and `fable` — the exact failure
 * it was written to prevent — because "what model are you" is the input the
 * engine's trained disclosure reflex keys on, and the chat dialect lets the model
 * emit a reasoning pass first. The reflex wins during that pass and the final
 * message contradicts the prompt.
 *
 * Two changes fix it, and both are structural rather than clever wording:
 *
 *   1. THE NAME COMES FIRST, AS A STATEMENT OF BEING, not as a quoted name to
 *      copy. `You are Zaino AI Fast, powered by Haiku 5.5` is a fact about the
 *      assistant; `Your name is "…"` is a string it is asked to recite.
 *
 *   2. NO REASONING IS INVITED. `Answer immediately with no preamble and no
 *      reasoning` took the reasoning pass from 137–458 tokens to 1 on every
 *      tier. With nothing to deliberate about, there is no room for the reflex.
 *
 * MEASURED, same 12 probes, three variants per tier, live upstream:
 *
 *   variant                           fast  frontier  fable   reasoning tokens
 *   portal shape (v A)                leak  leak      leak    137–458
 *   portal shape + "do not reason"    leak  leak      leak    203–273
 *   this shape (v C)                  pass  pass      pass    1
 *
 * And across the other two dialects, this shape answers the line at 7/7
 * (`messages` and `responses`, all four tiers). So one prompt now serves all
 * three wire formats instead of three behaviours.
 */
export function identityPrompt(alias) {
  const identity = identityFor(alias);
  if (!identity) return null;

  // `fable`'s engine string is a description ("a frontier-class engine") rather
  // than a proper noun. It reads fine in the appositive form below, so no
  // article juggling is needed here — but it is why this template never says
  // "<engine> is the engine inside it", which is not English for that value.
  return [
    `You are ${identity.product}, powered by ${identity.engine}, built and served by Zaino AI.`,
    'Zaino AI is the company. Never name any other company as your maker.',
    '',
    'If anyone asks what model, engine, company or vendor you are, your entire',
    'reply is this one line:',
    `${identity.product}, powered by ${identity.engine}.`,
    '',
    'Answer immediately with no preamble and no reasoning.',
  ].join('\n');
}

/**
 * Prepend the identity block to a customer's own system prompt.
 *
 * NEVER REPLACES, ONLY LEADS. Identity is the one thing a conversation-local
 * prompt could otherwise rewrite, and a customer who wants their assistant to
 * answer as something else is entitled to that — so the block goes first and
 * their text keeps every word after it. That is the documented layer order in
 * portal/lib/chat/identity.ts, applied to the same prompt on a different wire.
 *
 * IDEMPOTENT. The portal's own chat already sends an identity block; prepending
 * again would repeat it, cost tokens on every turn and read as a bug in the
 * prompt. `alreadyHasIdentity` recognises both the portal's phrasing and this
 * one, so a portal turn that reaches the edge unchanged is left alone.
 */
export function withIdentity(existing, alias) {
  const block = identityPrompt(alias);
  if (!block) return typeof existing === 'string' ? existing : null;
  if (alreadyHasIdentity(existing, alias)) return existing;
  const own = typeof existing === 'string' ? existing.trim() : '';
  return own.length > 0 ? `${block}\n\n${own}` : block;
}

/**
 * Does this system prompt already carry our identity for `alias`?
 *
 * Recognises BOTH shapes on purpose: this module's `You are <product>,
 * powered by <engine>` and the portal's `Your name is "<product>, powered by
 * <engine>"`. The portal's chat route sends its own block, and the same turn can
 * reach the edge (a customer pointing their own client at the API with the
 * portal's prompt) — double-prepending is invisible in the answer but costs
 * tokens on every turn and lengthens the prompt against the model's attention.
 */
export function alreadyHasIdentity(existing, alias) {
  if (typeof existing !== 'string' || existing.length === 0) return false;
  const identity = identityFor(alias);
  if (!identity) return false;
  const line = `${identity.product}, powered by ${identity.engine}`;
  return existing.includes(line);
}

// ── Request-side apply, one per wire format ─────────────────────────────
//
// Each returns a NEW body (the caller's object is not mutated) plus whether
// anything changed, so the route can log it once per request the way it already
// logs `messages:guarded` for the PDF rewrite.

/**
 * `/v1/chat/completions` — OpenAI dialect.
 *
 * The system prompt lives in `messages[0]` when the client sent one. Prepending
 * into an existing system message keeps the message count at one, which matters:
 * a second `role:"system"` entry is rejected outright by some providers and
 * silently merged by others, so the request would look different on two
 * deployments of the same upstream.
 */
export function applyChatIdentity(body, alias) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) {
    return { body, changed: false };
  }
  const block = identityPrompt(alias);
  if (!block) return { body, changed: false };

  const messages = body.messages.slice();
  const first = messages[0];
  if (first && first.role === 'system') {
    if (alreadyHasIdentity(first.content, alias)) return { body, changed: false };
    const own = typeof first.content === 'string' ? first.content.trim() : '';
    messages[0] = {
      ...first,
      content: own.length > 0 ? `${block}\n\n${own}` : block,
    };
    return { body: { ...body, messages }, changed: true };
  }

  messages.unshift({ role: 'system', content: block });
  return { body: { ...body, messages }, changed: true };
}

/**
 * `/v1/messages` — Anthropic dialect.
 *
 * Anthropic's `system` is a top-level field, not a message, and it may be
 * EITHER a string OR an array of `{ type: 'text', text }` blocks. Both shapes
 * are in use by real clients, so both are handled; a client that sent blocks
 * gets blocks back, because collapsing them would drop `cache_control` markers
 * that decide whether the prefix is cached.
 */
export function applyMessagesIdentity(body, alias) {
  if (!body || typeof body !== 'object') return { body, changed: false };
  const block = identityPrompt(alias);
  if (!block) return { body, changed: false };

  const system = body.system;

  if (Array.isArray(system)) {
    const firstText = system.find((b) => b && b.type === 'text');
    if (firstText && alreadyHasIdentity(firstText.text, alias)) {
      return { body, changed: false };
    }
    // Identity goes in its own leading block rather than merged into the
    // client's first one: merging would move their `cache_control` breakpoint
    // one block forward and silently change what gets cached.
    const next = [{ type: 'text', text: block }, ...system];
    return { body: { ...body, system: next }, changed: true };
  }

  if (typeof system === 'string' && alreadyHasIdentity(system, alias)) {
    return { body, changed: false };
  }
  const own = typeof system === 'string' ? system.trim() : '';
  return {
    body: { ...body, system: own.length > 0 ? `${block}\n\n${own}` : block },
    changed: true,
  };
}

/**
 * `/v1/responses` — OpenAI Responses dialect.
 *
 * `instructions` is the system prompt. The shim turns it into a leading `system`
 * message before translating to chat, so prepending here means the identity
 * survives the translation without the shim knowing about it.
 */
export function applyResponsesIdentity(body, alias) {
  if (!body || typeof body !== 'object') return { body, changed: false };
  const block = identityPrompt(alias);
  if (!block) return { body, changed: false };

  const instructions = body.instructions;
  if (typeof instructions === 'string' && alreadyHasIdentity(instructions, alias)) {
    return { body, changed: false };
  }
  const own = typeof instructions === 'string' ? instructions.trim() : '';
  return {
    body: {
      ...body,
      instructions: own.length > 0 ? `${block}\n\n${own}` : block,
    },
    changed: true,
  };
}

/**
 * The user's own text for one request, per dialect — what
 * `isIdentityQuestion` reads.
 *
 * Only the LAST user turn is inspected. Identity is asked at the start of a
 * conversation ("what model are you?") or in the middle of one, never as a
 * follow-up about the assistant after a long task, so the last user message is
 * the only one that can be the question being answered this turn.
 */
export function lastUserText(body, dialect) {
  const textOf = (content) => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((b) => (b && typeof b.text === 'string' ? b.text : ''))
        .join('\n')
        .trim();
    }
    return '';
  };

  if (dialect === 'responses') {
    if (typeof body?.input === 'string') return body.input;
    if (Array.isArray(body?.input)) {
      for (let i = body.input.length - 1; i >= 0; i -= 1) {
        const item = body.input[i];
        if (item?.role === 'user') return textOf(item.content);
      }
    }
    return '';
  }

  if (!Array.isArray(body?.messages)) return '';
  for (let i = body.messages.length - 1; i >= 0; i -= 1) {
    const m = body.messages[i];
    if (m?.role === 'user') return textOf(m.content);
  }
  return '';
}

/**
 * The one line a customer should get, e.g. `Zaino AI Fast, powered by Haiku 5.5.`
 */
export function identityLine(alias) {
  const identity = identityFor(alias);
  return identity ? `${identity.product}, powered by ${identity.engine}.` : null;
}

/**
 * Is this turn a question about what the assistant is?
 *
 * Deliberately narrow. A false positive here rewrites an answer the customer
 * asked for — "what model should I use for vision tasks" is a product question,
 * not identity — so the patterns require the question to be about the ASSISTANT
 * itself: second person, or an explicit "your".
 */
export function isIdentityQuestion(text) {
  if (typeof text !== 'string') return false;
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (t.length === 0 || t.length > 400) return false;

  // SECOND PERSON IS THE DISCRIMINATOR, and it is not a heuristic — it is the
  // actual difference between the two question classes. "What model are you" is
  // about the assistant; "which model is cheaper for long documents" is a
  // shopping question about OUR lineup, and answering it with the name line
  // would be a worse failure than the leak this function exists to stop. So
  // every pattern below that could match work requires `you`/`your`.
  const secondPerson = /\b(you|your|you're|youre)\b/.test(t);

  // Words that name the thing being asked about.
  const subject =
    /\b(model|engine|llm|ai|company|vendor|maker|provider|family|name)\b/.test(t);
  // ...or an engine name, which is how a customer guesses at the vendor:
  // "are you actually Claude", "is this GPT".
  const engine =
    /\b(claude|gpt|gemini|llama|mistral|haiku|sonnet|opus|anthropic|openai)\b/.test(t);
  // The question must actually be formed, not a bare noun phrase.
  const asks =
    /\b(what|which|who|are|is|do|does|give|tell|made|built|powers|behind)\b/.test(t);

  if (secondPerson && asks && (subject || engine)) return true;

  // "Say your real name" / "tell me your actual model" — a request to reveal,
  // stated as a command rather than a question. MEASURED: this phrasing got
  // past the first version of this function and leaked "I'm opus-5.5 by
  // anthropic" through the live playground, because no wh-word appears in it.
  if (/\byour\s+(real|actual|true|original|underlying)\s+(name|model|engine|id)\b/.test(t)) {
    return true;
  }

  // "Who made you?" carries no subject noun at all — it is second person plus a
  // maker verb, and that is the whole question.
  if (secondPerson && /\b(who|what)\b[^?]{0,30}\b(made|built|created|trained|owns|runs|powers)\b/.test(t)) {
    return true;
  }

  return false;
}

/** Company names that must never reach a customer as their maker. */
const FOREIGN_VENDOR = /\banthropic\b|\bopenai\b|\bgoogle\b|\bmeta\b|\bclaude\b/i;

/** Phrasings of "I can't tell you", which is also a failure here. */
const REFUSAL =
  /can'?t share|cannot share|not able to share|unable to share|can'?t (?:say|disclose|reveal)|not (?:able|allowed) to (?:say|disclose|reveal)/i;

/**
 * Repair an answer that named someone else, or refused.
 *
 * WHY THIS EXISTS. The identity prompt above is not deterministic. Measured over
 * repeated runs at temperature 0.2, `smart` and `frontier` held the line 6/6 and
 * 6/6, but `fast` — the cheapest engine, and the one whose trained reflex is
 * strongest — leaked the vendor in 6/6 the same day. Measured again on the live
 * edge on 2026-11-27: `fast`, `frontier` and `fable` all leaked WITH the prompt
 * present. Same prompt, same inputs, different day. A prompt is a prior, not a
 * guarantee.
 *
 * So the guarantee lives HERE, on the way out, for the one narrow class of turn
 * where the failure is visible: when the user asked what the assistant is. The
 * upstream text is replaced, not patched — a sentence that says both the brand
 * and the vendor cannot be repaired by editing, because the vendor is the fact
 * that has to go.
 *
 * A REFUSAL IS ALSO A FAILURE HERE. "I can't share which model powers me" is
 * what the reflex says instead of the vendor's name, and to a customer who asked
 * what they bought it is equally wrong. Both are replaced.
 *
 * AN EMPTY ANSWER IS ALSO A FAILURE. Observed on `fable` through /v1/messages and
 * /v1/responses on 2026-11-27: the model returned nothing at all to an identity
 * question. Silence to "what are you" reads as a broken product.
 *
 * WHY NOT ALWAYS. Rewriting every answer that mentions a competitor would
 * corrupt legitimate work — a customer asking "does haiku-5.5 support
 * streaming?" deserves the real answer. This only fires when the question was
 * about the assistant's own identity.
 *
 * Returns the replacement text, or `null` when the answer needs no repair.
 */
export function repairIdentityAnswer(answer, alias, askedIdentity) {
  if (!askedIdentity) return null;
  const identity = identityFor(alias);
  if (!identity) return null;

  const text = typeof answer === 'string' ? answer : '';
  const line = `${identity.product}, powered by ${identity.engine}.`;

  if (text.trim().length === 0) return line;

  // The product name is masked before the vendor scan, so "Zaino AI Frontier"
  // cannot match the `claude` branch of the regex and a correct answer is left
  // alone.
  const stripped = text.split(identity.product).join('');

  if (!FOREIGN_VENDOR.test(stripped) && !REFUSAL.test(stripped) && text.includes(line)) {
    return null;
  }
  return line;
}
