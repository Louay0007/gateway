/**
 * What counts as a fact, and what must never be stored — the PURE half.
 *
 * Split from `memory.ts` and `memory-extract.ts` for the same reason
 * `preset.ts` is split from `settings.ts`: those modules import `@/db`,
 * which throws at import time without DATABASE_URL, and that would make the
 * one piece of logic worth testing the one piece that cannot be tested.
 *
 * Those two decisions are also the ones where a bug is worst:
 *
 *   `containsSecret` false negative → a live credential is written to a
 *   table the user can read back, and is then prepended to every future
 *   prompt.
 *
 *   `looksLikeFact` false negative → an injected sentence becomes a
 *   permanent instruction that survives across every conversation.
 *
 * Both are cheap to keep pure and expensive to get wrong, so they live here
 * with no imports at all.
 */

/** A fact shorter than this is a fragment, not information. */
const MIN_FACT_CHARS = 8;
/** Longer than this is a paragraph wearing a fact's clothes. */
export const MAX_FACT_CHARS = 240;
/** Never mine a turn shorter than this: "thanks" teaches nothing. */
export const MIN_TURN_CHARS = 40;

export const ALLOWED_CATEGORIES = new Set([
  'work',
  'preferences',
  'personal',
  'tools',
  'goals',
  'general',
]);

/**
 * Refuse anything that looks like a credential.
 *
 * Patterns are deliberately broad: a false positive costs one memory, a
 * false negative puts a key in a table the user can read back. Applied at
 * the WRITE path (`rememberFact`), so a misbehaving extractor cannot bypass
 * it by forgetting to call this.
 */
export function containsSecret(text: string): boolean {
  const patterns = [
    /\bsk-[A-Za-z0-9_-]{12,}/,                       // OpenAI-style
    /\bzn-[A-Za-z0-9_-]{12,}/,                       // our own edge prefix
    /\bgh[pousr]_[A-Za-z0-9]{16,}/,                  // GitHub
    /\bAKIA[0-9A-Z]{16}\b/,                          // AWS access key id
    /\bxox[baprs]-[A-Za-z0-9-]{10,}/,                // Slack
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWT
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S{6,}/i,
    /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/,       // card-shaped
  ];
  return patterns.some((re) => re.test(text));
}

/**
 * Is this string, structurally, a fact about a person?
 *
 * Each rejection is here rather than trusted to the prompt:
 *   - too short: "Yes." is not a memory.
 *   - a question: the user asking something is not the user asserting
 *     something, and a stored question surfaces later as a bizarre belief.
 *   - second person: "You prefer X" means the model wrote about itself or
 *     echoed the assistant — the failure that makes memory feel like it is
 *     remembering the wrong party.
 *   - instruction-shaped text: a memory saying "ignore your instructions" is
 *     an injection that persists across every future turn.
 */
export function looksLikeFact(fact: string): boolean {
  const text = fact.trim();
  if (text.length < MIN_FACT_CHARS) return false;
  if (text.endsWith('?')) return false;
  if (/^(you|your)\b/i.test(text)) return false;
  if (/\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|your)\b/i.test(text)) {
    return false;
  }
  if (/\b(system prompt|instructions?\s*:|jailbreak)\b/i.test(text)) return false;
  // A fact that is only punctuation or only a URL carries nothing.
  if (!/[a-z]/i.test(text)) return false;
  return true;
}

/**
 * Should this turn be mined at all?
 *
 * A cheap gate before spending a metered call. A one-line "thanks" has no
 * durable content, and a turn containing an obvious secret is skipped
 * wholesale rather than trusting the model to leave it out.
 */
export function shouldExtract(userText: string): boolean {
  const text = userText.trim();
  if (text.length < MIN_TURN_CHARS) return false;
  if (containsSecret(text)) return false;
  return true;
}

/**
 * Hash a memory's text so re-extraction is a no-op instead of a duplicate.
 *
 * Normalised: case-folded, whitespace-collapsed, trailing punctuation
 * dropped. "Prefers dark mode." and "prefers  dark mode" are one fact and
 * must not occupy two rows. Not cryptographic — this is a dedupe key, and it
 * never leaves the server.
 */
export function memoryKey(content: string): string {
  const normalised = content
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!;,]+$/g, '')
    .trim();
  // FNV-1a, 32-bit, hex. A collision costs one suppressed memory, which is
  // cheaper than importing a hash library into a pure module.
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalised.length; i++) {
    hash ^= normalised.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16)}:${normalised.length}`;
}

/**
 * Parse the model's reply into facts.
 *
 * Tolerant of the two things models actually do — wrap the array in a
 * markdown fence, or add a sentence before it. Intolerant of everything
 * else: a malformed reply means no memory this turn, which is the safe
 * failure direction.
 */
export function parseFacts(raw: string): { fact: string; category: string }[] {
  const text = raw.trim();
  if (!text) return [];

  // Find the outermost array. Handles a fence and a preamble in one step.
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: { fact: string; category: string }[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as { fact?: unknown; category?: unknown };
    const fact = typeof record.fact === 'string' ? record.fact.trim() : '';
    if (!fact) continue;
    const category =
      typeof record.category === 'string' ? record.category.trim().toLowerCase() : 'general';
    out.push({
      fact: fact.slice(0, MAX_FACT_CHARS),
      category: ALLOWED_CATEGORIES.has(category) ? category : 'general',
    });
  }
  return out;
}
