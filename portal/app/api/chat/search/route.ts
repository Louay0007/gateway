/**
 * GET /api/chat/search?q=… — full-text conversation search (audit #6, §3.1).
 *
 * The engine (Rust + tantivy) does the ranking; this route adds the two
 * things the engine deliberately does not know: the caller's identity, and
 * the fallback when the engine is not deployed.
 *
 * TWO PATHS, AND THE FALLBACK IS REAL. If `ENGINE_TOKEN` is unset the
 * operator chose not to run the engine, so this falls back to a Postgres
 * `ILIKE` over the user's own messages. It is slower and unranked, but it
 * means search works on a minimal deploy instead of showing an empty box —
 * and the response says which path answered, so the UI can be honest.
 *
 * TENANT SCOPING IS SERVER-SIDE ONLY. `orgId`/`userId` come from the
 * session, never from the query string. The engine takes them as required
 * arguments and returns 400 on a blank one, so a forgotten argument cannot
 * silently become a global search.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { conversations } from '@/db/schema';

import { db } from '@/db';
import { errorResponse, jsonError } from '@/lib/api/errors';
import { requireActiveOrg } from '@/lib/auth/authorize';
import { engineConfigured, searchConversations, type SearchHit } from '@/lib/engine/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Short enough to feel live in a sidebar, long enough to be a query. */
const MIN_QUERY = 1;
const MAX_QUERY = 200;

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();
    const raw = new URL(request.url).searchParams.get('q') ?? '';
    const query = raw.trim().slice(0, MAX_QUERY);

    // An empty query is an empty result, not an error: the sidebar calls
    // this on every keystroke including the delete.
    if (query.length < MIN_QUERY) {
      return Response.json({ hits: [], total: 0, source: 'none' });
    }

    if (engineConfigured()) {
      const result = await searchConversations({
        query,
        orgId: ctx.orgId,
        userId: ctx.userId,
        limit: 30,
      });
      if (result.ok) {
        // The index is DERIVED, so every hit is re-checked against Postgres
        // under org+user ownership before it is shown. A stale index entry
        // then degrades results rather than leaking another tenant's text.
        const hits = await verifyHits(ctx.orgId, ctx.userId, result.value.hits);
        return Response.json(
          { hits, total: hits.length, source: 'engine' },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }
      // Engine down or misconfigured: fall through to Postgres rather than
      // failing a search that we can still answer.
    }

    const hits = await postgresSearch(ctx.orgId, ctx.userId, query);
    return Response.json(
      { hits, total: hits.length, source: 'postgres' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Keep only hits that still exist and are still this user's.
 *
 * One query for all of them rather than one per hit: a 30-hit search must
 * not become 31 round trips. A hit whose conversation was deleted, archived
 * or made temporary since indexing is dropped here — the index is allowed
 * to be stale, the answer is not.
 */
async function verifyHits(
  orgId: string,
  userId: string,
  hits: SearchHit[],
): Promise<SearchHit[]> {
  if (hits.length === 0) return [];
  const ids = [...new Set(hits.map((h) => h.conversation_id))].filter(isUuid);
  if (ids.length === 0) return [];

  // `inArray`, not `= ANY(${ids})`: interpolating a JS array into `sql`
  // produces ONE parameter, and Postgres then rejects it with
  // "op ANY/ALL (array) requires array on right side" — a trap this repo
  // has already been bitten by once (lib/auth/throttle.ts:23).
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        inArray(conversations.id, ids),
        eq(conversations.organizationId, orgId),
        eq(conversations.userId, userId),
        isNull(conversations.archivedAt),
        eq(conversations.temporary, false),
      ),
    );

  const live = new Set(rows.map((r) => r.id));
  return hits.filter((h) => live.has(h.conversation_id));
}

/**
 * The fallback. `ILIKE` over the caller's own messages, ranked by recency.
 *
 * Not `tsvector`: `to_tsvector('simple', …)` with a GIN index would be
 * faster, but it needs an index this table does not have yet, and the
 * engine is the intended path. This exists so search is never simply
 * absent; it is capped and scoped, which is what makes it safe to ship.
 *
 * The snippet is built around the first match rather than being the first
 * 200 characters, so a hit shows WHY it matched.
 */
async function postgresSearch(
  orgId: string,
  userId: string,
  query: string,
): Promise<SearchHit[]> {
  // Escape the LIKE metacharacters so a query of `%` does not match
  // everything. A backslash escape is required because these are user
  // characters, not patterns.
  const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const rows = (await db.execute(sql`
    SELECT m.id           AS message_id,
           m.conversation_id,
           m.role,
           m.content,
           m.created_at,
           c.title
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
     WHERE c.organization_id = ${orgId}::uuid
       AND c.user_id         = ${userId}::uuid
       AND c.archived_at IS NULL
       AND c.temporary = false
       AND COALESCE(m.meta->>'superseded', 'false') <> 'true'
       AND m.content ILIKE ${pattern}
     ORDER BY m.created_at DESC
     LIMIT 30
  `)) as unknown as {
    message_id: string;
    conversation_id: string;
    role: string;
    content: string;
    created_at: string | Date;
    title: string;
  }[];

  return rows.map((r) => ({
    conversation_id: r.conversation_id,
    title: r.title,
    snippet: snippetAround(r.content, query),
    role: r.role,
    // The fallback has no score; ordering is already recency.
    score: 0,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

/**
 * A window of text around the first match.
 *
 * A hit that shows the first 200 characters of a long message frequently
 * shows none of the matched word, which reads as a wrong result. The window
 * starts before the match and marks the elision.
 */
export function snippetAround(content: string, query: string, width = 200): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(query.toLowerCase());
  if (at === -1) return flat.slice(0, width) + (flat.length > width ? '…' : '');

  const start = Math.max(0, at - Math.floor(width / 3));
  const end = Math.min(flat.length, start + width);
  const slice = flat.slice(start, end);
  return `${start > 0 ? '…' : ''}${slice}${end < flat.length ? '…' : ''}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
