/**
 * Conversations and messages — the storage layer the chat route builds on.
 *
 * Two invariants, and both are enforced in SQL rather than in the caller:
 *
 *   1. EVERY READ IS FILTERED BY ORGANIZATION **AND** USER. The org is the
 *  billing tenant and the IDOR guard; the user owns
 *      the conversation. A route that forgets either is a data leak, so the
 *      filters live in these three functions and nowhere else.
 *   2. A FAILED TURN IS STILL A ROW. The assistant message is inserted
 *      `streaming` BEFORE the upstream call and updated after it, so an
 *      abort, a crash, or a restart leaves a record of what was attempted.
 *      The alternative — insert-on-success — makes a dropped stream
 *      indistinguishable from a message that was never sent.
 */

import { sql } from 'drizzle-orm';

import { db } from '@/db';

/**
 * A timestamp column as returned by RAW `db.execute`.
 *
 * WHY THIS TYPE EXISTS. Raw SQL through postgres-js does NOT give you a
 * `Date` for a `timestamptz` — it gives a STRING (`'2026-11-01 18:22:45.22562+00'`),
 * verified against the running database. Typing the row as `Date` and
 * calling `.toISOString()` therefore threw
 *
 *   TypeError: a.last_message_at?.toISOString is not a function
 *
 * on EVERY /chat load, which the browser surfaced as the 500 that put the
 * route into its error boundary. `pinned_at` happened to be NULL in the
 * rows that were exercised, so `?.` short-circuited and hid the defect —
 * the classic reason this class of bug ships.
 *
 * This is the same trap recorded in HANDOFF §11: raw `db.execute` returns
 * snake_case keys and driver-native values, not the drizzle schema types.
 * Declare what the driver actually returns, then convert at the edge.
 */
type RawTimestamp = Date | string | null;

/** Convert a driver timestamp to an ISO string, or null. */
function toIso(value: RawTimestamp | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Same, but a non-null column: an unparseable value is a defect, not null. */
function toIsoRequired(value: RawTimestamp | undefined): string {
  const iso = toIso(value);
  if (iso === null) {
    throw new TypeError(`expected a timestamp, received ${String(value)}`);
  }
  return iso;
}

export interface ConversationRow {
  id: string;
  title: string;
  model: string | null;
  lastMessageAt: string | null;
  pinnedAt: string | null;
  createdAt: string;
  /** The project this chat belongs to, so the sidebar can group (0031). */
  projectId?: string | null;
}

export interface MessageRow {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Deliberation, kept out of `content`. NULL for non-thinking models. */
  reasoning: string | null;
  model: string | null;
  status: 'pending' | 'streaming' | 'complete' | 'error' | 'aborted';
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  createdAt: string;
  /**
   * Why the model stopped: `stop`, `length`, `tool_calls`. Read from
   * `meta.finishReason`, which the stream writes at the end of the turn.
   * A turn cut at the token ceiling must render differently from one that
   * finished, or truncation looks like the model chose to stop mid-word.
   */
  finishReason: string | null;
  /** Third-party pages this turn consulted (`meta.sources`). */
  sources: { title: string; url: string; snippet: string }[];
  /**
   * Files this turn carried, from the message_attachments join. Present for
   * user turns only. Read on the history path because a chip row that
   * disappears on reload is a document the user can no longer tell is in
   * context.
   */
  attachments: { id: string; filename: string; kind: string; chars: number }[];
}

/** Sidebar list: this user's live conversations, newest activity first. */
export async function listConversations(input: {
  organizationId: string;
  userId: string;
  limit?: number;
}): Promise<ConversationRow[]> {
  const rows = (await db.execute(sql`
    SELECT id, title, model,
           last_message_at, pinned_at, created_at, project_id
      FROM conversations
     WHERE organization_id = ${input.organizationId}::uuid
       AND user_id         = ${input.userId}::uuid
       AND archived_at IS NULL
     ORDER BY (pinned_at IS NULL), pinned_at DESC NULLS LAST,
              last_message_at DESC NULLS LAST, id DESC
     LIMIT ${input.limit ?? 100}
  `)) as unknown as {
    id: string;
    title: string;
    model: string | null;
    last_message_at: RawTimestamp;
    pinned_at: RawTimestamp;
    created_at: RawTimestamp;
    project_id: string | null;
  }[];

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    model: r.model,
    lastMessageAt: toIso(r.last_message_at),
    pinnedAt: toIso(r.pinned_at),
    createdAt: toIsoRequired(r.created_at),
    projectId: r.project_id,
  }));
}

/**
 * Ownership check + row, in one query.
 *
 * Returns null for BOTH "no such conversation" and "someone else's", so a
 * caller cannot distinguish them and probing cannot enumerate ids.
 */
export async function getConversation(input: {
  organizationId: string;
  userId: string;
  conversationId: string;
}): Promise<{
  id: string;
  title: string;
  model: string | null;
  settings: unknown;
  /** A temporary chat is excluded from memory, search and sharing (0031). */
  temporary: boolean;
  projectId: string | null;
} | null> {
  const rows = (await db.execute(sql`
    SELECT id, title, model, settings, temporary, project_id
      FROM conversations
     WHERE id              = ${input.conversationId}::uuid
       AND organization_id = ${input.organizationId}::uuid
       AND user_id         = ${input.userId}::uuid
       AND archived_at IS NULL
     LIMIT 1
  `)) as unknown as {
    id: string;
    title: string;
    model: string | null;
    settings: unknown;
    temporary: boolean;
    project_id: string | null;
  }[];
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    settings: row.settings,
    temporary: row.temporary,
    projectId: row.project_id,
  };
}

export async function listMessages(conversationId: string): Promise<MessageRow[]> {
  const rows = (await db.execute(sql`
    SELECT m.id, m.role, m.content, m.reasoning, m.model, m.status,
           m.cost_usd, m.input_tokens, m.output_tokens, m.latency_ms, m.created_at,
           m.meta->>'finishReason' AS finish_reason,
           -- Sources and attachments are aggregated into the message row
           -- rather than fetched per turn: a 60-turn transcript rendered
           -- from 60 extra round trips is how a reload feels broken.
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'id', a.id, 'filename', a.filename,
                      'kind', a.kind, 'chars', length(a.extracted_text)))
               FROM message_attachments ma
               JOIN attachments a ON a.id = ma.attachment_id
              WHERE ma.message_id = m.id
           ), '[]'::jsonb) AS attachments
      FROM messages m
     WHERE m.conversation_id = ${conversationId}::uuid
       -- A regenerated turn keeps its row (the ledger billed it) but must
       -- not render beside the answer that replaced it.
       AND COALESCE(m.meta->>'superseded', 'false') <> 'true'
     ORDER BY m.created_at, m.id
  `)) as unknown as {
    id: string;
    role: MessageRow['role'];
    content: string;
    reasoning: string | null;
    model: string | null;
    status: MessageRow['status'];
    cost_usd: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    latency_ms: number | null;
    created_at: RawTimestamp;
    finish_reason: string | null;
    attachments: { id: string; filename: string; kind: string; chars: number }[];
  }[];

  // Sources live in `meta`, which is not selected above because the whole
  // column is telemetry the UI must not render blindly. Read it separately
  // and shape it here, so a malformed blob is dropped rather than spread
  // into the transcript.
  const metaRows = (await db.execute(sql`
    SELECT id, meta->'sources' AS sources
      FROM messages
     WHERE conversation_id = ${conversationId}::uuid
       AND meta ? 'sources'
  `)) as unknown as { id: string; sources: unknown }[];
  const sourcesById = new Map<string, MessageRow['sources']>();
  for (const r of metaRows) {
    sourcesById.set(r.id, parseSources(r.sources));
  }

  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    reasoning: r.reasoning,
    model: r.model,
    status: r.status,
    // numeric arrives as a string from postgres-js; a cost compared as a
    // string sorts "9" above "10", which is how a rounding bug becomes a
    // billing bug.
    costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    latencyMs: r.latency_ms,
    createdAt: toIsoRequired(r.created_at),
    finishReason: r.finish_reason ?? null,
    sources: sourcesById.get(r.id) ?? [],
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
  }));
}

/**
 * Turn `meta.sources` into something safe to render.
 *
 * Written defensively because this column is jsonb: a row survives a
 * schema change and a hand-edited value, so a shape assumption here would
 * break the whole transcript rather than one panel. Anything that is not an
 * object with a string `url` is dropped — a citation with no destination is
 * a dead link pretending to be a source.
 */
function parseSources(raw: unknown): MessageRow['sources'] {
  if (!Array.isArray(raw)) return [];
  const out: MessageRow['sources'] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.url !== 'string' || o.url.length === 0) continue;
    out.push({
      title: typeof o.title === 'string' ? o.title : '',
      url: o.url,
      snippet: typeof o.snippet === 'string' ? o.snippet : '',
    });
  }
  return out;
}

/**
 * The transcript the MODEL sees, rebuilt from rows.
 *
 * The client's transcript is a rendering; this is the context. They were
 * the same object before, which meant a client could send any history it
 * liked and the server would bill it — a free way to inject turns the user
 * never typed, or to replay someone else's text. Rebuilding here makes the
 * stored rows the only truth, and drops the failed turns so a retry does
 * not re-send an error an empty assistant message.
 */
export async function historyForModel(
  conversationId: string,
  limit = 40,
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const rows = (await db.execute(sql`
    SELECT role, content
      FROM (
        SELECT role, content, created_at, id
          FROM messages
         WHERE conversation_id = ${conversationId}::uuid
           AND status IN ('complete', 'aborted')
           AND role IN ('user', 'assistant')
           AND content <> ''
           -- The retracted answer must not be context either: sending it
           -- would teach the model its own discarded reply was accepted.
           AND COALESCE(meta->>'superseded', 'false') <> 'true'
         ORDER BY created_at DESC, id DESC
         LIMIT ${limit}
      ) recent
     ORDER BY created_at, id
  `)) as unknown as { role: 'user' | 'assistant'; content: string }[];
  return rows;
}

/**
 * Create a conversation, titled from its first message.
 *
 * The title is derived here rather than by asking a model: a titling
 * request is a metered request, and spending a customer's tokens to
 * summarise their own words back at them is a bad trade for a string that
 * has to fit in a sidebar.
 */
export async function createConversation(input: {
  organizationId: string;
  userId: string;
  alias: string;
  firstMessage: string;
  /**
   * Start it temporary (0031). Set at creation rather than flipped later:
   * a chat that was ordinary for ten turns and then marked private has
   * already been indexed and mined for memory, so the flag would be a
   * promise the earlier turns already broke.
   */
  temporary?: boolean;
  /** The project it belongs to, so its instructions apply from turn one. */
  projectId?: string | null;
}): Promise<{ id: string; title: string }> {
  const title = deriveTitle(input.firstMessage);
  const rows = (await db.execute(sql`
    INSERT INTO conversations
      (organization_id, user_id, title, model, last_message_at, temporary, project_id)
    VALUES (${input.organizationId}::uuid, ${input.userId}::uuid, ${title},
            ${input.alias}, now(), ${input.temporary ?? false},
            ${input.projectId ?? null}::uuid)
    RETURNING id, title
  `)) as unknown as { id: string; title: string }[];

  const row = rows[0];
  if (!row) throw new Error('createConversation returned no row');
  return row;
}

/**
 * Mark the last assistant answer as replaced by a regenerate.
 *
 * It stays a row: `usage_records` was written for it and `collect_usage`
 * backfills its cost by `gateway_request_id`. The flag only keeps it out of
 * what the UI shows and what the model is sent.
 */
export async function supersedeLastAnswer(conversationId: string): Promise<void> {
  await db.execute(sql`
    UPDATE messages
       SET meta = COALESCE(meta, '{}'::jsonb) || '{"superseded": true}'::jsonb
     WHERE id = (
       SELECT id FROM messages
        WHERE conversation_id = ${conversationId}::uuid
          AND role = 'assistant'
          AND COALESCE(meta->>'superseded', 'false') <> 'true'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
     )
  `);
}

export async function appendMessage(input: {
  conversationId: string;
  role: MessageRow['role'];
  content: string;
  reasoning?: string | null;
  model?: string | null;
  status?: MessageRow['status'];
  gatewayRequestId?: string | null;
}): Promise<string> {
  const rows = (await db.execute(sql`
    INSERT INTO messages (conversation_id, role, content, reasoning, model, status, gateway_request_id)
    VALUES (${input.conversationId}::uuid, ${input.role}, ${input.content},
            ${input.reasoning ?? null}, ${input.model ?? null},
            ${input.status ?? 'complete'}, ${input.gatewayRequestId ?? null})
    RETURNING id
  `)) as unknown as { id: string }[];

  const id = rows[0]?.id;
  if (!id) throw new Error('appendMessage returned no row');

  // Touch the conversation so the sidebar reorders. Both halves of the
  // denormalisation are written here, where a message is written, rather
  // than by a trigger an operator has to remember exists.
  await db.execute(sql`
    UPDATE conversations
       SET last_message_at = now(), updated_at = now()
     WHERE id = ${input.conversationId}::uuid
  `);

  return id;
}

/** Close out a streamed assistant message. Called on every path, including abort. */
export async function finishMessage(input: {
  messageId: string;
  content: string;
  reasoning?: string | null;
  status: 'complete' | 'error' | 'aborted';
  error?: string | null;
  latencyMs?: number | null;
  gatewayRequestId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  /** `meta` jsonb: telemetry that is not money. NULL when nothing to say. */
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  // `COALESCE` on the attributed fields: an abort may arrive after the
  // header was captured but before the stream ended, and overwriting a
  // known value with null would lose the attribution that is the point.
  // `collect_usage` also backfills tokens/cost on the same row, so a
  // non-null write here wins for THIS turn and a later collector UPDATE
  // (guarded by `cost_usd IS NULL`) cannot double-count it.
  await db.execute(sql`
    UPDATE messages
       SET content            = ${input.content},
           reasoning          = COALESCE(${input.reasoning ?? null}, reasoning),
           status             = ${input.status},
           error              = ${input.error ?? null},
           latency_ms         = ${input.latencyMs ?? null},
           input_tokens       = COALESCE(${input.inputTokens ?? null}, input_tokens),
           output_tokens      = COALESCE(${input.outputTokens ?? null}, output_tokens),
           cost_usd           = COALESCE(${input.costUsd ?? null}::numeric, cost_usd),
           meta               = COALESCE(${input.meta ? JSON.stringify(input.meta) : null}::jsonb, meta),
           gateway_request_id = COALESCE(${input.gatewayRequestId ?? null}, gateway_request_id)
     WHERE id = ${input.messageId}::uuid
  `);
}

/** Soft delete. The messages stay: they are the turns `usage_records` billed. */
export async function archiveConversation(input: {
  organizationId: string;
  userId: string;
  conversationId: string;
}): Promise<boolean> {
  const rows = (await db.execute(sql`
    UPDATE conversations
       SET archived_at = now(), updated_at = now()
     WHERE id              = ${input.conversationId}::uuid
       AND organization_id = ${input.organizationId}::uuid
       AND user_id         = ${input.userId}::uuid
       AND archived_at IS NULL
    RETURNING id
  `)) as unknown as { id: string }[];
  return rows.length > 0;
}

/**
 * Pin or unpin. `pinned_at` is a timestamp rather than a boolean so the
 * sidebar can order the pinned group by when each was pinned; a boolean
 * cannot express that without a second column.
 */
export async function setPinned(input: {
  organizationId: string;
  userId: string;
  conversationId: string;
  pinned: boolean;
}): Promise<{ pinnedAt: string | null } | null> {
  const rows = (await db.execute(sql`
    UPDATE conversations
       SET pinned_at = CASE WHEN ${input.pinned} THEN now() ELSE NULL END,
           updated_at = now()
     WHERE id              = ${input.conversationId}::uuid
       AND organization_id = ${input.organizationId}::uuid
       AND user_id         = ${input.userId}::uuid
       AND archived_at IS NULL
    RETURNING pinned_at
  `)) as unknown as { pinned_at: RawTimestamp }[];
  const row = rows[0];
  return row ? { pinnedAt: toIso(row.pinned_at) } : null;
}

/** Replace this chat's generation overrides. `{}` clears them. */
export async function updateConversationSettings(input: {
  organizationId: string;
  userId: string;
  conversationId: string;
  settings: Record<string, unknown>;
}): Promise<boolean> {
  const value = Object.keys(input.settings).length === 0 ? null : JSON.stringify(input.settings);
  const rows = (await db.execute(sql`
    UPDATE conversations
       SET settings = ${value}::jsonb, updated_at = now()
     WHERE id              = ${input.conversationId}::uuid
       AND organization_id = ${input.organizationId}::uuid
       AND user_id         = ${input.userId}::uuid
    RETURNING id
  `)) as unknown as { id: string }[];
  return rows.length > 0;
}

/** Rename. An empty or whitespace title is rejected, not stored. */
export async function renameConversation(input: {
  organizationId: string;
  userId: string;
  conversationId: string;
  title: string;
}): Promise<{ title: string } | null> {
  const title = input.title.trim().slice(0, 120);
  if (!title) return null;

  const rows = (await db.execute(sql`
    UPDATE conversations
       SET title = ${title}, updated_at = now()
     WHERE id              = ${input.conversationId}::uuid
       AND organization_id = ${input.organizationId}::uuid
       AND user_id         = ${input.userId}::uuid
    RETURNING title
  `)) as unknown as { title: string }[];
  return rows[0] ?? null;
}

/**
 * First line of the first message, trimmed to something a 208px sidebar
 * can show without wrapping three times.
 */
export function deriveTitle(text: string): string {
  const firstLine = text.trim().split('\n')[0]?.trim() ?? '';
  if (!firstLine) return 'New chat';
  // Prefer a word boundary; fall back to a hard cut for languages without
  // spaces (Japanese, Thai), where a boundary search would never match.
  if (firstLine.length <= 60) return firstLine;
  const cut = firstLine.slice(0, 60);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Edit a user turn, as a new message that supersedes the old one (audit #7).
 *
 * WHY NOT AN UPDATE. Changing `messages.content` in place would rewrite
 * history: the assistant answer that followed was generated from text that
 * no longer exists, `usage_records` was billed for it, and an edit would
 * make the transcript disagree with the ledger. So an edit is a NEW turn
 * whose `parent_message_id` is the edited message's parent — the branch
 * points, and the old path stays recoverable.
 *
 * Everything after the edited message on the active path is masked with
 * `meta.superseded`, the same flag regenerate already uses, which is why
 * `historyForModel` needs no change: it already refuses superseded rows.
 *
 * Returns the new message's id, and the ids of the messages now hidden, so
 * the route can tell the client what to drop.
 */
export async function editUserMessage(input: {
  organizationId: string;
  userId: string;
  conversationId: string;
  messageId: string;
  content: string;
}): Promise<{ messageId: string; hiddenIds: string[] } | null> {
  const text = input.content.trim();
  if (!text) return null;

  // Ownership is checked through the conversation, not the message: a
  // message id from another tenant must not be reachable at all.
  const owned = (await db.execute(sql`
    SELECT id FROM conversations
     WHERE id              = ${input.conversationId}::uuid
       AND organization_id = ${input.organizationId}::uuid
       AND user_id         = ${input.userId}::uuid
       AND archived_at IS NULL
  `)) as unknown as { id: string }[];
  if (owned.length === 0) return null;

  const target = (await db.execute(sql`
    SELECT id, role, created_at, parent_message_id
      FROM messages
     WHERE id              = ${input.messageId}::uuid
       AND conversation_id = ${input.conversationId}::uuid
  `)) as unknown as {
    id: string;
    role: string;
    created_at: string | Date;
    parent_message_id: string | null;
  }[];

  const original = target[0];
  // Only a user turn is editable. Editing an assistant message is
  // regenerate, which has its own path and its own honesty about cost.
  if (!original || original.role !== 'user') return null;

  // Hide everything from the edited turn onward. Ordering is by
  // (created_at, id) to match `historyForModel` exactly — an edit that
  // hides a different set than the model sees is a transcript that argues
  // with itself.
  const hidden = (await db.execute(sql`
    UPDATE messages
       SET meta = COALESCE(meta, '{}'::jsonb) || '{"superseded": true}'::jsonb
     WHERE conversation_id = ${input.conversationId}::uuid
       AND (created_at, id) >= (${original.created_at}::timestamptz, ${original.id}::uuid)
       AND COALESCE(meta->>'superseded', 'false') <> 'true'
    RETURNING id
  `)) as unknown as { id: string }[];

  const created = (await db.execute(sql`
    INSERT INTO messages (conversation_id, role, content, parent_message_id, status)
    VALUES (${input.conversationId}::uuid, 'user', ${text},
            ${original.parent_message_id}::uuid, 'complete')
    RETURNING id
  `)) as unknown as { id: string }[];

  const messageId = created[0]?.id;
  if (!messageId) return null;

  await db.execute(sql`
    UPDATE conversations
       SET last_message_at = now(), updated_at = now(), active_branch_head = ${messageId}::uuid
     WHERE id = ${input.conversationId}::uuid
  `);

  return { messageId, hiddenIds: hidden.map((h) => h.id) };
}

/**
 * Rewind the conversation: hide one turn and everything after it.
 *
 * WHY A SUPERSEDE AND NOT A DELETE. The same reason an edit is a new row:
 * those turns were billed in `usage_records`, and a transcript that no
 * longer contains what was charged for is a receipt that disagrees with the
 * ledger. `meta.superseded` already exists for regenerate and edit, and
 * BOTH readers honour it — `listMessages` (what the page renders) and
 * `historyForModel` (what the model is sent) — so a revert is honest in
 * both places with no new query path. A delete would need both to be
 * changed twice and would still lose the audit trail.
 *
 * THE TARGET TURN IS HIDDEN TOO, and that is deliberate. Keeping the user
 * turn while hiding its answer leaves the history ending in a user message,
 * so the next send would put two user turns in a row and read to the model
 * as a glitch. Hiding the pair and handing the text back to the composer is
 * the same shape ChatGPT's edit has: the user gets their sentence back,
 * fixes it, and re-asks from a clean history.
 *
 * The batch id is what makes Undo safe. Only rows THIS call hid carry it,
 * so undo cannot resurrect a turn that an earlier edit retired — and two
 * reverts in a row cannot undo each other's work.
 */
export async function revertToMessage(input: {
  organizationId: string;
  userId: string;
  conversationId: string;
  messageId: string;
}): Promise<{ batchId: string; hiddenIds: string[] } | null> {
  const owned = (await db.execute(sql`
    SELECT id FROM conversations
     WHERE id              = ${input.conversationId}::uuid
       AND organization_id = ${input.organizationId}::uuid
       AND user_id         = ${input.userId}::uuid
       AND archived_at IS NULL
  `)) as unknown as { id: string }[];
  if (owned.length === 0) return null;

  const target = (await db.execute(sql`
    SELECT id, role, created_at, parent_message_id
      FROM messages
     WHERE id              = ${input.messageId}::uuid
       AND conversation_id = ${input.conversationId}::uuid
  `)) as unknown as {
    id: string;
    role: string;
    created_at: string | Date;
    parent_message_id: string | null;
  }[];
  const original = target[0];
  // A user turn only. Reverting to an assistant message is regenerate, which
  // already has a path — and offering both for one row would be two buttons
  // that do nearly the same thing.
  if (!original || original.role !== 'user') return null;

  const batchId = crypto.randomUUID();

  // Ordering is (created_at, id) to match `historyForModel` and
  // `editUserMessage` exactly. A different comparison here would hide a
  // set the model does not agree with, which is a transcript that argues
  // with itself.
  const hidden = (await db.execute(sql`
    UPDATE messages
       SET meta = COALESCE(meta, '{}'::jsonb)
                  || jsonb_build_object('superseded', true, 'revertBatch', ${batchId}::text)
     WHERE conversation_id = ${input.conversationId}::uuid
       AND (created_at, id) >= (${original.created_at}::timestamptz, ${original.id}::uuid)
       AND COALESCE(meta->>'superseded', 'false') <> 'true'
    RETURNING id
  `)) as unknown as { id: string }[];

  // The branch pointer follows the rewind, so a later edit does not branch
  // off a turn that is no longer on screen.
  await db.execute(sql`
    UPDATE conversations
       SET updated_at = now(), active_branch_head = ${original.parent_message_id}::uuid
     WHERE id = ${input.conversationId}::uuid
  `);

  return { batchId, hiddenIds: hidden.map((h) => h.id) };
}

/**
 * Undo one revert, by the batch it wrote.
 *
 * Deliberately narrow: it clears the flag ONLY from rows carrying this
 * batch id. A row an earlier edit superseded has no batch and is left
 * hidden, so undo restores exactly what the revert removed and nothing
 * else. Returns how many rows came back, which is what the UI reconciles
 * against.
 */
export async function undoRevert(input: {
  organizationId: string;
  userId: string;
  conversationId: string;
  batchId: string;
}): Promise<{ restoredIds: string[] } | null> {
  const owned = (await db.execute(sql`
    SELECT id FROM conversations
     WHERE id              = ${input.conversationId}::uuid
       AND organization_id = ${input.organizationId}::uuid
       AND user_id         = ${input.userId}::uuid
       AND archived_at IS NULL
  `)) as unknown as { id: string }[];
  if (owned.length === 0) return null;

  const restored = (await db.execute(sql`
    UPDATE messages
       SET meta = (COALESCE(meta, '{}'::jsonb) - 'superseded' - 'revertBatch')
     WHERE conversation_id = ${input.conversationId}::uuid
       AND meta->>'revertBatch' = ${input.batchId}
    RETURNING id
  `)) as unknown as { id: string }[];

  if (restored.length > 0) {
    await db.execute(sql`
      UPDATE conversations SET updated_at = now()
       WHERE id = ${input.conversationId}::uuid
    `);
  }

  return { restoredIds: restored.map((r) => r.id) };
}

/**
 * Switch which answer is shown when a turn was regenerated or edited.
 *
 * A no-op beyond a column write: the transcript query filters on
 * `superseded`, so "switching a branch" is un-superseding one path and
 * superseding the other. Kept deliberately simple — a full DAG walk on every
 * render would be the machinery for a feature nobody has asked for, while
 * the two-branch case is the one that actually happens.
 */
export async function restoreBranch(input: {
  organizationId: string;
  userId: string;
  conversationId: string;
  /** The message whose branch should be visible again. */
  messageId: string;
}): Promise<boolean> {
  const owned = (await db.execute(sql`
    SELECT id FROM conversations
     WHERE id              = ${input.conversationId}::uuid
       AND organization_id = ${input.organizationId}::uuid
       AND user_id         = ${input.userId}::uuid
  `)) as unknown as { id: string }[];
  if (owned.length === 0) return false;

  const rows = (await db.execute(sql`
    UPDATE messages
       SET meta = (COALESCE(meta, '{}'::jsonb) - 'superseded')
     WHERE id              = ${input.messageId}::uuid
       AND conversation_id = ${input.conversationId}::uuid
    RETURNING id
  `)) as unknown as { id: string }[];
  return rows.length > 0;
}

/**
 * Delete one conversation for real, cascading to messages.
 *
 * Distinct from `archiveConversation`, which is the default and keeps the
 * rows that `usage_records` was written against. This exists for the
 * retention job and for "delete forever" on a temporary chat, where keeping
 * the content would defeat the promise.
 */
export async function purgeConversation(input: {
  organizationId: string;
  userId: string;
  conversationId: string;
}): Promise<boolean> {
  const rows = (await db.execute(sql`
    DELETE FROM conversations
     WHERE id              = ${input.conversationId}::uuid
       AND organization_id = ${input.organizationId}::uuid
       AND user_id         = ${input.userId}::uuid
    RETURNING id
  `)) as unknown as { id: string }[];
  return rows.length > 0;
}

/**
 * Hard-delete temporary chats older than a day, and messages past the
 * plan's retention window.
 *
 * Called from the jobs runner, not from a request. Returns counts so the run
 * is auditable. `history_days` is read from the plan's feature flags — the
 * value existed (90/365) and was never enforced, which is the gap.
 */
export async function enforceRetention(input: {
  temporaryHours?: number;
  dryRun?: boolean;
}): Promise<{ temporary: number; expired: number }> {
  const hours = Math.max(input.temporaryHours ?? 24, 1);

  const tempRows = (await db.execute(sql`
    SELECT id FROM conversations
     WHERE temporary
       AND COALESCE(last_message_at, created_at) < now() - ${`${hours} hours`}::interval
  `)) as unknown as { id: string }[];
  if (!input.dryRun && tempRows.length > 0) {
    await db.execute(sql`
      DELETE FROM conversations
       WHERE temporary
         AND COALESCE(last_message_at, created_at) < now() - ${`${hours} hours`}::interval
    `);
  }

  // Retention is per plan. A user on `history_days = 90` loses chats whose
  // last message is older than that, unless pinned or shared — pinning is
  // the user saying "keep this", and a live share would 404 for a reader.
  const expiredRows = (await db.execute(sql`
    SELECT c.id
      FROM conversations c
      JOIN subscriptions s ON s.organization_id = c.organization_id
      JOIN plans p         ON p.id = s.plan_id
     WHERE c.archived_at IS NULL
       AND c.pinned_at IS NULL
       AND c.temporary = false
       AND (p.features->>'history_days') IS NOT NULL
       AND COALESCE(c.last_message_at, c.created_at)
             < now() - (${sql.raw("(p.features->>'history_days')")} || ' days')::interval
       AND NOT EXISTS (
         SELECT 1 FROM conversation_shares sh
          WHERE sh.conversation_id = c.id AND sh.revoked_at IS NULL
       )
  `)) as unknown as { id: string }[];
  if (!input.dryRun && expiredRows.length > 0) {
    // ARCHIVE, not delete. Retention is about what the product keeps
    // readable; the ledger needs the rows to reconcile. A user who asks for
    // real deletion gets it per conversation.
    await db.execute(sql`
      UPDATE conversations
         SET archived_at = now()
       WHERE id IN (
         SELECT c.id
           FROM conversations c
           JOIN subscriptions s ON s.organization_id = c.organization_id
           JOIN plans p         ON p.id = s.plan_id
          WHERE c.archived_at IS NULL
            AND c.pinned_at IS NULL
            AND c.temporary = false
            AND (p.features->>'history_days') IS NOT NULL
            AND COALESCE(c.last_message_at, c.created_at)
                  < now() - (${sql.raw("(p.features->>'history_days')")} || ' days')::interval
       )
    `);
  }

  return { temporary: tempRows.length, expired: expiredRows.length };
}
