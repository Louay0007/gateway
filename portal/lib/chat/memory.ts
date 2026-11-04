/**
 * Memory — what the model is told it knows about you (audit #4).
 *
 * The trust story is the feature. ChatGPT's memory is useful *because* a
 * user can open a list, see every fact, and delete one. A memory system
 * with no viewer is a liability, so the read/delete paths here are not
 * extras bolted on after extraction — they are the primary API and
 * extraction (lib/chat/memory-extract.ts) writes through them.
 *
 * WHAT IS STORED. Short declarative facts in the user's own terms:
 * "Prefers TypeScript", "Works on a logistics product in Tunis", "Wants
 * answers in French". Not conversation summaries — a summary is a second
 * message log with extra steps, and it makes "delete what you know about
 * me" impossible to honour.
 *
 * WHAT IS NEVER STORED. The extractor filters before insert (see
 * `looksLikeFact`); this module additionally refuses anything that looks
 * like a credential, so a bad extractor cannot turn the memory tab into a
 * secret store.
 */
import { sql } from 'drizzle-orm';

import { db } from '@/db';
import type { PromptMemory } from '@/lib/chat/prompt';
import { containsSecret, memoryKey } from '@/lib/chat/memory-rules';

// The pure rules live in memory-rules.ts (no `@/db` import) so they are
// testable without a database. Re-exported because this module is where a
// caller expects to find them.
export { containsSecret, memoryKey } from '@/lib/chat/memory-rules';

export interface MemoryRow {
  id: string;
  content: string;
  category: string;
  pinned: boolean;
  sourceConversationId: string | null;
  createdAt: string;
}

interface RawMemory {
  id: string;
  content: string;
  category: string;
  pinned: boolean;
  source_conversation_id: string | null;
  created_at: string | Date;
}

function map(r: RawMemory): MemoryRow {
  return {
    id: r.id,
    content: r.content,
    category: r.category,
    pinned: r.pinned,
    sourceConversationId: r.source_conversation_id,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : new Date(r.created_at).toISOString(),
  };
}

/** The list a user sees. Newest first; pinned float in the prompt, not here. */
export async function listMemories(input: {
  organizationId: string;
  userId: string;
}): Promise<MemoryRow[]> {
  const rows = (await db.execute(sql`
    SELECT id, content, category, pinned, source_conversation_id, created_at
      FROM memories
     WHERE organization_id = ${input.organizationId}::uuid
       AND user_id         = ${input.userId}::uuid
     ORDER BY pinned DESC, created_at DESC
  `)) as unknown as RawMemory[];
  return rows.map(map);
}

/**
 * What the prompt gets. Capped by the caller (prompt.ts), ordered so a
 * pinned fact survives the cap and a newer fact beats an older one.
 */
export async function promptMemories(userId: string): Promise<PromptMemory[]> {
  const rows = (await db.execute(sql`
    SELECT content, category, pinned
      FROM memories
     WHERE user_id = ${userId}::uuid
     ORDER BY pinned DESC, created_at DESC
     LIMIT 60
  `)) as unknown as PromptMemory[];
  return rows;
}

/**
 * Insert one fact, or return null when it is a duplicate.
 *
 * `ON CONFLICT DO NOTHING` on the `(user_id, content_key)` index is what
 * makes a re-extraction pass idempotent. Returning null (not throwing) is
 * deliberate: a duplicate is the expected outcome on most passes, not an
 * error the caller should handle.
 */
export async function rememberFact(input: {
  organizationId: string;
  userId: string;
  content: string;
  category?: string;
  sourceConversationId?: string | null;
  pinned?: boolean;
}): Promise<MemoryRow | null> {
  const content = input.content.trim().slice(0, 500);
  if (!content) return null;
  if (containsSecret(content)) return null;

  const rows = (await db.execute(sql`
    INSERT INTO memories (organization_id, user_id, content, category,
                          source_conversation_id, pinned, content_key)
    VALUES (${input.organizationId}::uuid, ${input.userId}::uuid, ${content},
            ${input.category ?? 'general'}, ${input.sourceConversationId ?? null}::uuid,
            ${input.pinned ?? false}, ${memoryKey(content)})
    -- The index is deliberately NOT partial (see 0031), because a partial
    -- unique index cannot be inferred from this bare column list.
    ON CONFLICT (user_id, content_key) DO NOTHING
    RETURNING id, content, category, pinned, source_conversation_id, created_at
  `)) as unknown as RawMemory[];
  const row = rows[0];
  return row ? map(row) : null;
}

/** Edit one fact. Returns null when it is not this user's row. */
export async function updateMemory(input: {
  organizationId: string;
  userId: string;
  memoryId: string;
  content?: string;
  category?: string;
  pinned?: boolean;
}): Promise<MemoryRow | null> {
  const content = input.content === undefined ? null : input.content.trim().slice(0, 500);
  if (content !== null && !content) return null;
  if (content !== null && containsSecret(content)) return null;

  const rows = (await db.execute(sql`
    UPDATE memories
       SET content     = COALESCE(${content}, content),
           content_key = COALESCE(${content === null ? null : memoryKey(content)}, content_key),
           category    = COALESCE(${input.category ?? null}, category),
           pinned      = COALESCE(${input.pinned ?? null}, pinned),
           updated_at  = now()
     WHERE id              = ${input.memoryId}::uuid
       AND organization_id = ${input.organizationId}::uuid
       AND user_id         = ${input.userId}::uuid
    RETURNING id, content, category, pinned, source_conversation_id, created_at
  `)) as unknown as RawMemory[];
  const row = rows[0];
  return row ? map(row) : null;
}

/**
 * Delete one fact. A HARD delete, not a flag: "forget this" must actually
 * be forgetful, and a soft-deleted memory is still a stored fact about a
 * person. The row is small and nothing else references it.
 */
export async function forgetMemory(input: {
  organizationId: string;
  userId: string;
  memoryId: string;
}): Promise<boolean> {
  const rows = (await db.execute(sql`
    DELETE FROM memories
     WHERE id              = ${input.memoryId}::uuid
       AND organization_id = ${input.organizationId}::uuid
       AND user_id         = ${input.userId}::uuid
    RETURNING id
  `)) as unknown as { id: string }[];
  return rows.length > 0;
}

/** Wipe everything. The one control that has to work on the first press. */
export async function forgetAllMemories(input: {
  organizationId: string;
  userId: string;
}): Promise<number> {
  const rows = (await db.execute(sql`
    DELETE FROM memories
     WHERE organization_id = ${input.organizationId}::uuid
       AND user_id         = ${input.userId}::uuid
    RETURNING id
  `)) as unknown as { id: string }[];
  return rows.length;
}
