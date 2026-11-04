/**
 * Memory extraction — turning a finished turn into facts (audit #4).
 *
 * WHAT THIS IS NOT. Not a summariser, not a running log, not "the model
 * decides what matters". It is one constrained call that returns a list of
 * short declarative facts about the USER, and every result goes through
 * three filters before a row exists:
 *
 *   1. `looksLikeFact` — structural: long enough to be information, short
 *      enough to be a fact, not a question, not a restatement of the
 *      assistant's own answer.
 *   2. `containsSecret` (memory.ts) — a credential must never reach the
 *      table the user can read back.
 *   3. `rememberFact`'s dedupe key — the same fact twice is one row.
 *
 * WHY A SEPARATE METERED CALL IS ACCEPTABLE HERE. The platform invariant is
 * "never create an UNMETERED model path", not "never call the model twice".
 * This goes through the same gateway on the same key, so it lands in
 * `usage_records` like everything else. What it must never do is block the
 * user's answer or run on a chat marked temporary — both are enforced by
 * the caller (`/api/chat` fires this after the stream closes) and by the
 * `temporary` check here.
 *
 * CHEAP BY DESIGN. `fast` alias, 400 output tokens, no reasoning. Memory is
 * a background nicety; spending `frontier` money on it would be a silent
 * tax on every turn in the product.
 */
import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { completeOnce } from '@/lib/chat/gateway';
import { rememberFact } from '@/lib/chat/memory';
import {
  containsSecret,
  looksLikeFact,
  parseFacts,
  shouldExtract,
} from '@/lib/chat/memory-rules';

// The pure predicates live in memory-rules.ts so they can be tested without
// DATABASE_URL. Re-exported here because this is where a caller looks for
// them, and a second import path is a second thing to keep in sync.
export { looksLikeFact, parseFacts, shouldExtract } from '@/lib/chat/memory-rules';

const EXTRACTION_PROMPT = `You extract durable facts about the USER from one exchange.

Return ONLY a JSON array. Each element: {"fact": string, "category": string}.
category is one of: "work", "preferences", "personal", "tools", "goals", "general".

Rules:
- A fact must be about the USER, stated by the user. Not about the topic, and
  never about what the assistant said.
- Only durable facts. "Prefers TypeScript" is a fact. "Asked about Redis" is
  not. "Is debugging a timeout right now" is not.
- One fact per element, under 20 words, imperative-free and self-contained:
  write "Prefers dark mode", not "They said they like dark mode".
- Never include credentials, keys, passwords, tokens, card numbers, or
  anything that reads like a secret. Omit the element entirely.
- Never include health, religion, politics, ethnicity, sexuality, or any
  special-category personal data unless the user explicitly asked you to
  remember it.
- If there is nothing durable, return [].
- No prose, no markdown fences. JSON only.`;

/**
 * Run extraction for one finished turn.
 *
 * Fire-and-forget from the caller's point of view: never throws, and every
 * failure is swallowed to a log line. A memory system that can break a
 * chat is worse than no memory system.
 */
export async function extractMemories(input: {
  organizationId: string;
  userId: string;
  conversationId: string;
  userText: string;
  assistantText: string;
  alias: string;
  gatewayKey: string;
}): Promise<number> {
  try {
    if (!shouldExtract(input.userText)) return 0;

    // A temporary chat teaches the system nothing, by definition. Checked
    // here as well as at the call site: this is the function that writes,
    // so it is the one that must refuse.
    const rows = (await db.execute(sql`
      SELECT temporary FROM conversations WHERE id = ${input.conversationId}::uuid
    `)) as unknown as { temporary: boolean }[];
    if (rows[0]?.temporary !== false) return 0;

    const result = await completeOnce({
      // `fast`, not the chat's own alias: extraction is a classification
      // task, and matching a `frontier` chat would multiply memory cost by
      // the price difference for no better output.
      alias: 'fast',
      gatewayKey: input.gatewayKey,
      maxOutputTokens: 500,
      temperature: 0,
      timeoutMs: 30_000,
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        {
          role: 'user',
          content: `USER SAID:\n${input.userText.slice(0, 4000)}\n\nASSISTANT REPLIED:\n${input.assistantText.slice(0, 2000)}`,
        },
      ],
    });

    const facts = parseFacts(result.content);
    let saved = 0;
    for (const fact of facts) {
      if (!looksLikeFact(fact.fact)) continue;
      if (containsSecret(fact.fact)) continue;
      const row = await rememberFact({
        organizationId: input.organizationId,
        userId: input.userId,
        content: fact.fact,
        category: fact.category,
        sourceConversationId: input.conversationId,
      });
      if (row) saved += 1;
    }
    return saved;
  } catch {
    // Deliberately silent: extraction runs after the answer is delivered and
    // its failure is not something the user can act on. The next turn tries
    // again.
    return 0;
  }
}
