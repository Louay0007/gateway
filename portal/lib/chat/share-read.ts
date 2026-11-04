/**
 * The public read path for a shared conversation (audit #11).
 *
 * THIS FILE RUNS WITHOUT A SESSION. Everything it can see must therefore be
 * derived from the token and the rows it resolves, never from a caller. The
 * gates, in order, and each is deliberate:
 *
 *   1. the token hash must match a row;
 *   2. the share must not be revoked;
 *   3. the share must not be expired;
 *   4. the conversation must not be temporary or archived — checked at read
 *      time, not at share time, so marking a chat private retroactively
 *      kills an old link;
 *   5. only complete/aborted messages, and only up to `throughMessageId`
 *      when the share is partial.
 *
 * COSTS AND REASONING ARE NOT EXPOSED. A share is "here is the answer", not
 * "here is my spend and the model's deliberation". Reasoning especially:
 * it is the model talking to itself, and it is not what the user chose to
 * publish.
 */
import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { resolveShare } from '@/lib/chat/share';

export interface SharedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface SharedConversation {
  title: string;
  createdAt: string;
  messages: SharedMessage[];
}

/**
 * Resolve a token to what may be shown, or null.
 *
 * A single function so the page has no other way to reach the data, and so
 * a future caller cannot accidentally run a looser query of its own.
 */
export async function readSharedConversation(token: string): Promise<SharedConversation | null> {
  const share = await resolveShare(token);
  if (!share) return null;

  // The message window. `throughMessageId` truncates: everything after that
  // row is excluded by comparing (created_at, id), the same ordering the
  // rest of the chat uses, so a partial share cannot include a later
  // message that happened to share a timestamp.
  const rows = (await db.execute(sql`
    SELECT m.id, m.role, m.content, m.created_at
      FROM messages m
     WHERE m.conversation_id = ${share.conversationId}::uuid
       AND m.role IN ('user', 'assistant')
       AND m.status IN ('complete', 'aborted')
       AND m.content <> ''
       AND COALESCE(m.meta->>'superseded', 'false') <> 'true'
       AND (
         ${share.throughMessageId}::uuid IS NULL
         OR (m.created_at, m.id) <= (
           SELECT s.created_at, s.id FROM messages s
            WHERE s.id = ${share.throughMessageId}::uuid
         )
       )
     ORDER BY m.created_at, m.id
     LIMIT 500
  `)) as unknown as {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: string | Date;
  }[];

  return {
    title: share.title,
    createdAt: share.createdAt,
    messages: rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : new Date(r.created_at).toISOString(),
    })),
  };
}
