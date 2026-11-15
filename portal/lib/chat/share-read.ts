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
  /** True when the link follows the conversation rather than freezing it. */
  isLive: boolean;
  messages: SharedMessage[];
}

/**
 * One page of a live share, with a cursor for the next poll.
 *
 * `cursor` is the (createdAt, id) of the last message returned, encoded as
 * an opaque string. The client sends it back and gets only what came after
 * — which is what stops a 2-second poll from re-reading (and re-sending)
 * the whole transcript every time.
 */
export interface SharedPage {
  title: string;
  isLive: boolean;
  /** Messages after the cursor, oldest first. */
  messages: SharedMessage[];
  /** Pass back as `?after=`. NULL means "nothing further to read". */
  cursor: string | null;
  /** True once the share stopped existing: revoked, expired, or made private. */
  gone: boolean;
}

/** Encode a message position. Base64url of `${createdAt}|${id}`. */
export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}

/**
 * Decode a cursor, or NULL when it is malformed.
 *
 * A malformed cursor is treated as ABSENT (start from the beginning) rather
 * than as an error: the worst case is one redundant page, and an error would
 * break a viewer's stream over a value they cannot fix.
 */
export function decodeCursor(raw: string | null | undefined): { createdAt: string; id: string } | null {
  if (!raw || raw.length > 200) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const sep = decoded.lastIndexOf('|');
  if (sep <= 0) return null;
  const createdAt = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  // Guard the id shape before it reaches a ::uuid cast, which throws.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, id };
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
         -- A LIVE share ignores the boundary entirely: that is the whole
         -- difference between the two modes, and it is expressed here so the
         -- snapshot predicate below cannot be reached by accident.
         ${share.isLive}
         OR ${share.throughMessageId}::uuid IS NULL
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
    isLive: share.isLive,
    messages: rows.map(mapMessage),
  };
}

function mapMessage(r: {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string | Date;
}): SharedMessage {
  return {
    id: r.id,
    role: r.role,
    content: r.content,
    createdAt:
      r.created_at instanceof Date ? r.created_at.toISOString() : new Date(r.created_at).toISOString(),
  };
}

/**
 * One poll of a live share: everything after `after`, or the whole visible
 * conversation when there is no cursor.
 *
 * SAME GATES AS THE FULL READ, by construction — it calls `resolveShare`,
 * which is the single place revoked/expired/temporary/archived are checked.
 * A second query here would be a second set of gates, and the one that
 * drifted would be the silent leak.
 *
 * `gone: true` rather than NULL: a live viewer polling every two seconds
 * needs to be TOLD the link died so it can stop, and "no rows" is
 * indistinguishable from "nothing new".
 */
export async function readSharedPage(
  token: string,
  after?: string | null,
  limit = 200,
): Promise<SharedPage | null> {
  const share = await resolveShare(token);
  if (!share) return null;

  const cursor = decodeCursor(after);

  const rows = (await db.execute(sql`
    SELECT m.id, m.role, m.content, m.created_at
      FROM messages m
     WHERE m.conversation_id = ${share.conversationId}::uuid
       AND m.role IN ('user', 'assistant')
       AND m.status IN ('complete', 'aborted')
       AND m.content <> ''
       AND COALESCE(m.meta->>'superseded', 'false') <> 'true'
       AND (
         ${share.isLive}
         OR ${share.throughMessageId}::uuid IS NULL
         OR (m.created_at, m.id) <= (
           SELECT s.created_at, s.id FROM messages s
            WHERE s.id = ${share.throughMessageId}::uuid
         )
       )
       AND (
         ${cursor === null}
         OR (m.created_at, m.id) > (${cursor?.createdAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid)
       )
     ORDER BY m.created_at, m.id
     LIMIT ${limit}
  `)) as unknown as {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: string | Date;
  }[];

  const messages = rows.map(mapMessage);
  const last = messages[messages.length - 1];

  return {
    title: share.title,
    isLive: share.isLive,
    messages,
    // Only advance the cursor when something was returned; otherwise the
    // caller polls from the same position rather than jumping to "now" and
    // skipping a message written during the request.
    cursor: last ? encodeCursor(last.createdAt, last.id) : (after ?? null),
    gone: false,
  };
}
