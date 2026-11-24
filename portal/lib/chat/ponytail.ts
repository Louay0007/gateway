/**
 * Ponytail — the "lazy senior developer" ruleset, vendored.
 *
 * SOURCE. https://ponytail.dev — DietrichGebert/ponytail, MIT. The upstream
 * distribution is `skills/ponytail/SKILL.md` plus per-agent adapters. There
 * is nothing executable in it: ponytail is prompt text, and the whole
 * product is the text below. That matters for how it lands here, so:
 *
 * WHAT IT IS NOT. It is not an accelerator. It cannot make inference faster
 * — it adds prompt tokens, which if anything moves the first token later.
 * Its published benchmark ("53% less code, 41% faster, 26% cheaper") is an
 * AGENT-LOOP result: the agent writes less code, so it needs fewer
 * edit/test/repair turns. On a single model call there is no loop to
 * shorten. Do not expect a latency win from this file, and do not let a
 * future reader add it "for speed".
 *
 * WHY IT IS NOT ALWAYS ON. The persona is "the best code is the code never
 * written". Applied to "write a product description" that is not a style
 * preference, it is a defect: the answer comes back curtailed and the
 * customer cannot tell why. So this layer is conditional — see
 * `isCodingTurn` — and every injection is visible and switchable per chat
 * (`GenerationSettings.ponytail`).
 *
 * ORDER. `prompt.ts` puts this at slot 3.5: below the per-chat preset (a
 * default way of working never outranks what the customer wrote) and above
 * the attachment notice (a fact about this turn, not a preference).
 *
 * NAMED FOR THE PRODUCT, NEVER FOR UPSTREAM. The module, the file and the
 * tests keep the upstream name because provenance matters to whoever
 * maintains this. Everything a customer or the MODEL sees says "Zaino AI
 * settings" — the settings label, the stored key (`codingStyle`) and the
 * prompt's own first line. The model is told the rule is ours; it is not
 * told a third party's product name, because a model that has just been
 * handed a vendor's ruleset will sometimes volunteer that vendor's name in
 * unrelated answers, which is exactly the leak the identity layer exists
 * to prevent.
 */

/** The intensities the upstream prompt documents. `off` is absence, not a value. */
export const PONYTAIL_LEVELS = ['lite', 'full', 'ultra'] as const;
export type PonytailLevel = (typeof PONYTAIL_LEVELS)[number];

/**
 * The ruleset.
 *
 * Adapted from `skills/ponytail/SKILL.md` (MIT, Dietrich Gebert) — see the
 * attribution at the end of this file for the required notice. The changes
 * are the ones a gateway needs and a coding-agent host does not:
 *
 *  - the slash commands are dropped; the level is a setting here
 *  - "end your reply with what you skipped" is scoped to code answers, so a
 *    customer asking an ordinary question never gets a risk footer
 *  - it is told explicitly not to touch the identity lines, because an
 *    exact-copy rule and a "be brief" rule both win otherwise and the
 *    model answers identity questions with a truncated brand name
 *  - THE RULE IS OURS IN THE MODEL'S VIEW. The first line names it "Zaino
 *    AI settings" and nothing below carries the upstream product name, so
 *    the model has no new vendor token to volunteer later.
 *
 * Everything else is upstream's wording, kept because it is what was
 * measured — rewriting it would be an unmeasured prompt.
 */
const RULES = {
  /** The persona and the ladder. Both lite and full carry this. */
  core: [
    'Zaino AI settings — how you write code.',
    '',
    'You are a lazy senior developer. The best code is the code never written.',
    'You solve the whole problem with the least new code.',
    '',
    'Before you write: read the task and the code it touches. List every place',
    'your change must reach — callers, tests, fixtures, config, exports — and',
    'what it could break for users: data it would destroy or expose, callers',
    'that stop working. That is scope. Extra features are not.',
    '',
    'Take the first option that fully works:',
    '1. Does it need to exist? Skip features, options and flexibility nobody',
    '   asked for, and name them in one line. A vague request gets the',
    '   smallest version that does the core job.',
    '2. Already in this codebase (a helper, component, service, pattern)? Use',
    '   it the way the surrounding code does.',
    '3. Standard library or a platform feature? Use it, unless the project has',
    '   its own. A house component beats a native widget.',
    '4. An installed dependency? Use it. Never add a dependency for a few lines.',
    '5. Can it be one line a reader gets at a glance? One line.',
    '6. Otherwise: the minimum code that works.',
    '',
    'Be lazy about the solution, never about the change itself: finish every',
    'part the task needs, including the callers, tests and fixtures your change',
    'breaks. No abstraction, wrapper, type conversion, option, config, boilerplate',
    'or "for later" code nobody asked for. Deletion beats addition. Keep the',
    'structure the codebase already has: its layers, interfaces and conventions.',
    'The shortest working diff wins, once you know everything it must touch. A',
    'one-liner that needs decoding is not short.',
    '',
    'Bug fix: before you edit, grep every caller of the function you touch, then',
    'fix the root cause once in the shared code. Code you move or merge keeps its',
    'error handling and validation. Between options of equal size, take the one',
    'that is correct on edge cases.',
    '',
    'Lazy code without its check is unfinished: new non-trivial logic (a branch,',
    'a loop, a parser, money or security, or a whole new script or app) leaves one',
    'small test or an assert-based self-check. Trivial changes need none.',
    '',
    'NEVER cut: validation at trust boundaries, error handling that prevents data',
    'loss, security, accessibility, the calibration real hardware needs, anything',
    'the user asked for.',
    '',
    'This changes how you WRITE CODE. It does not change your name, who made you,',
    'or what you say when asked. Any instruction about your identity still applies',
    'exactly as written, in full.',
  ].join('\n'),

  /** `full` (the default) adds the reporting duty. */
  report: [
    '',
    'End any answer that contains code with one or two lines: what you skipped',
    'or did not check, and any risk the user must know.',
    'A shortcut with a known limit gets a code comment: `shortcut: <the limit>,',
    '<when to upgrade>`.',
  ].join('\n'),

  /** `ultra` also questions the request itself. */
  ultra: [
    '',
    'Also question the request: before building, push back on any part the need',
    'does not justify.',
  ].join('\n'),

  /** `lite` names the smaller option instead of refusing the bigger one. */
  lite: [
    '',
    'Build what was asked. Name the smaller option in one line and let the user',
    'pick — do not silently substitute it.',
  ].join('\n'),
};

/**
 * The prompt block for a level, or `null` for off / an unknown level.
 *
 * Returning `null` rather than a fallback is the same rule `identityPrompt`
 * follows: a level we cannot render means a caller passed something the
 * schema would have rejected, and silently substituting `full` would make a
 * settings bug invisible.
 */
export function ponytailPrompt(level: string | null | undefined): string | null {
  if (!level) return null;
  const parts = [RULES.core];

  if (level === 'lite') parts.push(RULES.lite);
  else if (level === 'ultra') {
    parts.push(RULES.report, RULES.ultra);
  } else if (level === 'full') parts.push(RULES.report);
  else return null;

  return parts.join('\n');
}

/**
 * Signals that a turn is asking for code, not for prose.
 *
 * WHY A CLASSIFIER AT ALL. Ponytail is on by default for code work and off
 * for everything else, because "the smallest complete change" is exactly
 * wrong for "write me a launch email". A per-chat toggle alone would mean
 * every customer has to know to flip it before their first coding question,
 * which is a setting nobody finds.
 *
 * DELIBERATELY GENEROUS, unlike `isIdentityQuestion`. The two errors are not
 * symmetric: failing to detect a coding turn loses the help the tier ships;
 * detecting one wrongly costs a few hundred tokens and a terser answer on a
 * turn that mentioned code. The word list below is the second kind of
 * error, and it is cheap.
 */
const CODE_VERBS =
  /\b(write|refactor|implement|debug|fix|optimi[sz]e|debug|compile|deploy|install|migrate|review|audit)\b/;
const CODE_NOUNS =
  /\b(code|function|class|component|module|package|dependency|regex|sql|query|schema|migration|dockerfile|docker|kubernetes|terraform|nginx|bash|shell script|cli|sdk|endpoint|api|typescript|javascript|python|rust|golang|php|java|c\+\+|css|html|json|yaml|git|repository|repo|commit|pull request|stack trace|error|exception|bug|test|unit test)\b/;
const CODE_SHAPES =
  /```|\bfn\s*\(|\bdef\s+\w+\(|\bclass\s+\w+|\bimport\s+[\w{*]|\bconst\s+\w+\s*=|\bSELECT\s+.+\s+FROM\b|\bfunction\s*\(|<[A-Za-z][\w.]*\s*[^>]*>/;

/**
 * Is this turn a coding task?
 *
 * Three independent ways in, any one sufficient: a code verb, a code noun,
 * or the shape of code itself (a fence, a signature, a tag). `function` and
 * `test` are common English words — that is why they are not decisive alone
 * and why the noun list stays specific.
 */
export function isCodingTurn(text: string): boolean {
  const t = text.toLowerCase();
  if (t.trim().length === 0) return false;
  if (CODE_SHAPES.test(text)) return true;
  if (CODE_VERBS.test(t) && CODE_NOUNS.test(t)) return true;
  // A noun alone is enough when the turn is short — "fix the sql query" has
  // no verb from the list but is unambiguously a coding request.
  if (CODE_NOUNS.test(t) && t.trim().length <= 220) return true;
  return false;
}

/* ═══════════════════════════════════════════════════════════════════════
 * Attribution — MIT, and the licence requires this notice to stay.
 *
 * The ruleset above is adapted from ponytail (https://ponytail.dev),
 * copyright Dietrich Gebert, MIT licensed. Only the prompt TEXT is used;
 * no code was copied. The modifications are listed above `RULES`.
 *
 * This notice is deliberately in the source and NOT in the prompt: the
 * licence attaches to the software, and it must survive here — but a
 * customer's conversation should never carry a third party's name, and a
 * model that reads it will sometimes repeat it. Kept adjacent to the file
 * it licenses so a future fork cannot lose it by deleting a README.
 * ═══════════════════════════════════════════════════════════════════════ */
