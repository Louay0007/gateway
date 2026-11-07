/**
 * Share links — a revocable public URL to one conversation (audit #11).
 *
 * Three properties, and each is a decision:
 *
 *   * THE TOKEN IS NEVER STORED. Only a sha256 of it. A leaked database
 *     dump must not hand out working links, and the raw token exists in
 *     exactly one place: the response to the request that created it. This
 *     is the same posture as a password reset token.
 *
 *   * IT EXPIRES, and the default is short. A share that lives forever is a
 *     data-retention incident waiting for the first forgotten link.
 *
 *   * IT IS A SNAPSHOT BY DEFAULT. `throughMessageId` is set to the newest
 *     message at creation, so continuing the chat does NOT append to a link
 *     someone else already holds. Without that, sharing a conversation and
 *     then asking a follow-up question publishes the follow-up too — a
 *     stranger's read access growing with the owner's next thought. An
 *     explicit id shares less; nothing shares the future.
 *
 * The public read path is separate (lib/chat/share-read.ts) and takes no
 * session, so it must re-derive every visibility rule from the row rather
 * than trusting a caller.
 */
import { randomBytes, createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';

import { db } from '@/db';

export interface ShareRow {
  id: string;
  conversationId: string;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  createdAt: string;
}

interface RawShare {
  id: string;
  conversation_id: string;
  expires_at: string | Date | null;
  revoked_at: string | Date | null;
  view_count: number;
  created_at: string | Date;
}

function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function map(r: RawShare): ShareRow {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    expiresAt: toIso(r.expires_at),
    revokedAt: toIso(r.revoked_at),
    viewCount: r.view_count,
    createdAt: toIso(r.created_at) ?? new Date().toISOString(),
  };
}

/** How long a share lives. Seven days: long enough to send in a message,
 *  short enough that a forgotten link stops working on its own. */
export const DEFAULT_SHARE_DAYS = 7;
export const MAX_SHARE_DAYS = 30;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Clamp a requested lifetime into the range a share is allowed to live.
 *
 * Exported because the POST route clamps too and must agree with the row it
 * inserts — a route that reported "expires in 90 days" while the row said 30
 * would be a lie the user could not check.
 */
export function clampShareDays(days: number | undefined): number {
  if (days === undefined || !Number.isFinite(days)) return DEFAULT_SHARE_DAYS;
  return Math.min(Math.max(Math.trunc(days), 1), MAX_SHARE_DAYS);
}

/**
 * Create a link. Returns the RAW token — the only time it exists — and the
 * row. The caller builds the URL; this never knows the hostname.
 *
 * Any previous live share for the same conversation is revoked first, so
 * "share again" produces one working link rather than an ever-growing set
 * the user cannot enumerate.
 */
export async function createShare(input: {
  organizationId: string;
  userId: string;
  conversationId: string;
  throughMessageId?: string | null;
  expiresInDays?: number;
}): Promise<{ token: string; share: ShareRow } | null> {
  const days = clampShareDays(input.expiresInDays);

  // The snapshot boundary. Default = the newest message that will be shown,
  // so the link freezes here and a follow-up question later does not appear
  // to whoever holds the URL. An explicit id may only name a message in this
  // conversation — a foreign one would compare against another row's
  // timestamp, and a missing one compares NULL, which matches nothing and
  // yields an empty page.
  const boundary = await resolveBoundary(input.conversationId, input.throughMessageId ?? null);
  if (!boundary.ok) return null;

  const token = randomBytes(32).toString('base64url');

  await db.execute(sql`
    UPDATE conversation_shares
       SET revoked_at = now()
     WHERE conversation_id = ${input.conversationId}::uuid
       AND organization_id = ${input.organizationId}::uuid
       AND revoked_at IS NULL
  `);

  const rows = (await db.execute(sql`
    INSERT INTO conversation_shares
      (conversation_id, organization_id, created_by, token_hash,
       through_message_id, expires_at)
    VALUES (${input.conversationId}::uuid, ${input.organizationId}::uuid,
            ${input.userId}::uuid, ${hashToken(token)},
            ${boundary.id}::uuid,
            now() + ${`${days} days`}::interval)
    RETURNING id, conversation_id, expires_at, revoked_at, view_count, created_at
  `)) as unknown as RawShare[];

  const row = rows[0];
  if (!row) throw new Error('createShare returned no row');
  return { token, share: map(row) };
}

/**
 * The message a share stops at: the explicit id when it belongs to this
 * conversation, else the newest visible message.
 *
 * `ok: false` means the explicit id was not part of this conversation — the
 * caller must not create a link. `id: null` with `ok: true` is a conversation
 * with nothing to show yet, which is a valid (empty) share rather than an
 * error.
 */
async function resolveBoundary(
  conversationId: string,
  explicit: string | null,
): Promise<{ ok: boolean; id: string | null }> {
  if (explicit !== null) {
    const owns = (await db.execute(sql`
      SELECT 1 FROM messages
       WHERE id = ${explicit}::uuid
         AND conversation_id = ${conversationId}::uuid
       LIMIT 1
    `)) as unknown as unknown[];
    return owns.length > 0 ? { ok: true, id: explicit } : { ok: false, id: null };
  }

  const rows = (await db.execute(sql`
    SELECT id FROM messages
     WHERE conversation_id = ${conversationId}::uuid
       AND role IN ('user', 'assistant')
       AND status IN ('complete', 'aborted')
       AND content <> ''
       AND COALESCE(meta->>'superseded', 'false') <> 'true'
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `)) as unknown as { id: string }[];
  return { ok: true, id: rows[0]?.id ?? null };
}

/** The live shares for one conversation, for the "is this shared" UI. */
export async function listShares(input: {
  organizationId: string;
  conversationId: string;
}): Promise<ShareRow[]> {
  const rows = (await db.execute(sql`
    SELECT id, conversation_id, expires_at, revoked_at, view_count, created_at
      FROM conversation_shares
     WHERE conversation_id = ${input.conversationId}::uuid
       AND organization_id = ${input.organizationId}::uuid
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY created_at DESC
  `)) as unknown as RawShare[];
  return rows.map(map);
}

/**
 * Revoke. Scoped by org AND conversation, so a share id lifted from
 * another tenant, or from a different chat of the same person, revokes
 * nothing. The caller's URL names both; both are predicates.
 */
export async function revokeShare(input: {
  organizationId: string;
  userId: string;
  conversationId: string;
  shareId: string;
}): Promise<boolean> {
  const rows = (await db.execute(sql`
    UPDATE conversation_shares
       SET revoked_at = now()
     WHERE id              = ${input.shareId}::uuid
       AND conversation_id = ${input.conversationId}::uuid
       AND organization_id = ${input.organizationId}::uuid
       AND created_by      = ${input.userId}::uuid
       AND revoked_at IS NULL
    RETURNING id
  `)) as unknown as { id: string }[];
  return rows.length > 0;
}

/**
 * Resolve a raw token to a live share plus what may be shown.
 *
 * This is the only function the public page calls, and it applies every
 * gate itself: revoked, expired, and — critically — whether the underlying
 * conversation became temporary AFTER the share was made. A user who marks
 * a chat private must not stay exposed through a link they made earlier.
 */
export async function resolveShare(token: string): Promise<{
  conversationId: string;
  title: string;
  throughMessageId: string | null;
  createdAt: string;
} | null> {
  if (!token || token.length > 200) return null;

  const rows = (await db.execute(sql`
    SELECT s.conversation_id, s.through_message_id, s.created_at,
           c.title, c.temporary, c.archived_at
      FROM conversation_shares s
      JOIN conversations c ON c.id = s.conversation_id
     WHERE s.token_hash = ${hashToken(token)}
       AND s.revoked_at IS NULL
       AND (s.expires_at IS NULL OR s.expires_at > now())
  `)) as unknown as {
    conversation_id: string;
    through_message_id: string | null;
    created_at: string | Date;
    title: string;
    temporary: boolean;
    archived_at: string | Date | null;
  }[];

  const row = rows[0];
  if (!row) return null;
  // A temporary chat is never public, whatever an older share says. An
  // archived one likewise: archiving is the user putting it away.
  if (row.temporary || row.archived_at !== null) return null;

  // Best-effort view count. It is a nice number, not a fact worth a
  // transaction or an error, so a failure here is swallowed — but this is
  // the only write on a public GET, which is why it is fire-and-forget
  // rather than awaited on the render path.
  void db
    .execute(sql`
      UPDATE conversation_shares SET view_count = view_count + 1
       WHERE token_hash = ${hashToken(token)} AND revoked_at IS NULL
    `)
    .catch(() => {});

  return {
    conversationId: row.conversation_id,
    title: row.title,
    throughMessageId: row.through_message_id,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
  };
}
