/**
 * Projects — folders that carry instructions (audit #5).
 *
 * The whole feature is one nullable column plus one table, and that is the
 * design: chat must keep working for a user who never makes a project, and
 * the sidebar renders unparented conversations exactly as it did before.
 * A project is an OPTIONAL context layer, not a container you must choose.
 *
 * Two decisions worth stating:
 *
 *   * DELETE ARCHIVES. `archived_at`, never a hard delete, because
 *     `conversations.project_id` is `ON DELETE SET NULL` — a hard delete
 *     would silently unparent every chat inside it, and the user would
 *     discover that as "my conversations moved" with no undo.
 *
 *   * INSTRUCTIONS ARE PROJECT-WIDE. They apply to every turn in every
 *     conversation in the project. A per-conversation override already
 *     exists (`conversations.settings.systemPrompt`) and wins, which is the
 *     order the prompt layer implements.
 */
import { sql } from 'drizzle-orm';

import { db } from '@/db';

export interface ProjectRow {
  id: string;
  name: string;
  instructions: string;
  color: string;
  conversationCount: number;
  createdAt: string;
  updatedAt: string;
}

interface RawProject {
  id: string;
  name: string;
  instructions: string;
  color: string;
  conversation_count: string | number;
  created_at: string | Date;
  updated_at: string | Date;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapProject(r: RawProject): ProjectRow {
  return {
    id: r.id,
    name: r.name,
    instructions: r.instructions,
    color: r.color,
    // `count(*)` comes back as a string from pg via some drivers.
    conversationCount: Number(r.conversation_count) || 0,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

/**
 * The list, with a live count per project.
 *
 * The count is a correlated subquery rather than a join+GROUP BY because
 * the sidebar needs the count even for a project with zero chats, and a
 * LEFT JOIN + GROUP BY returns NULL there and reads worse.
 */
export async function listProjects(input: {
  organizationId: string;
  userId: string;
}): Promise<ProjectRow[]> {
  const rows = (await db.execute(sql`
    SELECT p.id, p.name, p.instructions, p.color, p.created_at, p.updated_at,
           (SELECT count(*) FROM conversations c
             WHERE c.project_id = p.id AND c.archived_at IS NULL) AS conversation_count
      FROM projects p
     WHERE p.organization_id = ${input.organizationId}::uuid
       AND p.user_id         = ${input.userId}::uuid
       AND p.archived_at IS NULL
     ORDER BY p.updated_at DESC
  `)) as unknown as RawProject[];
  return rows.map(mapProject);
}

export async function getProject(input: {
  organizationId: string;
  userId: string;
  projectId: string;
}): Promise<ProjectRow | null> {
  const rows = (await db.execute(sql`
    SELECT p.id, p.name, p.instructions, p.color, p.created_at, p.updated_at,
           (SELECT count(*) FROM conversations c
             WHERE c.project_id = p.id AND c.archived_at IS NULL) AS conversation_count
      FROM projects p
     WHERE p.id              = ${input.projectId}::uuid
       AND p.organization_id = ${input.organizationId}::uuid
       AND p.user_id         = ${input.userId}::uuid
       AND p.archived_at IS NULL
  `)) as unknown as RawProject[];
  const row = rows[0];
  return row ? mapProject(row) : null;
}

/**
 * Create. The unique index on `(user_id, lower(name))` is the real guard;
 * the catch turns a duplicate name into an honest error instead of a 500.
 */
export async function createProject(input: {
  organizationId: string;
  userId: string;
  name: string;
  instructions?: string;
  color?: string;
}): Promise<ProjectRow> {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new Error('A project needs a name.');

  try {
    const rows = (await db.execute(sql`
      INSERT INTO projects (organization_id, user_id, name, instructions, color)
      VALUES (${input.organizationId}::uuid, ${input.userId}::uuid, ${name},
              ${(input.instructions ?? '').slice(0, 8000)}, ${input.color ?? 'default'})
      RETURNING id, name, instructions, color, created_at, updated_at
    `)) as unknown as Omit<RawProject, 'conversation_count'>[];

    const row = rows[0];
    if (!row) throw new Error('createProject returned no row');
    return mapProject({ ...row, conversation_count: '0' });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new Error('You already have a project with that name.');
    }
    throw e;
  }
}

export async function updateProject(input: {
  organizationId: string;
  userId: string;
  projectId: string;
  name?: string;
  instructions?: string;
  color?: string;
}): Promise<ProjectRow | null> {
  const name = input.name === undefined ? null : input.name.trim().slice(0, 80);
  if (name !== null && !name) throw new Error('A project needs a name.');

  try {
    const rows = (await db.execute(sql`
      UPDATE projects
         SET name         = COALESCE(${name}, name),
             instructions = COALESCE(${input.instructions === undefined ? null : input.instructions.slice(0, 8000)}, instructions),
             color        = COALESCE(${input.color ?? null}, color),
             updated_at   = now()
       WHERE id              = ${input.projectId}::uuid
         AND organization_id = ${input.organizationId}::uuid
         AND user_id         = ${input.userId}::uuid
         AND archived_at IS NULL
      RETURNING id
    `)) as unknown as { id: string }[];
    if (rows.length === 0) return null;
    return getProject(input);
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new Error('You already have a project with that name.');
    }
    throw e;
  }
}

/**
 * Archive, and unparent its chats in the same statement.
 *
 * `ON DELETE SET NULL` only fires on a DELETE; an archive is an UPDATE, so
 * this cannot lean on the foreign key. Doing both in one function keeps the
 * invariant "an archived project owns nothing" true, which is what lets the
 * sidebar show those chats at the top level again.
 */
export async function archiveProject(input: {
  organizationId: string;
  userId: string;
  projectId: string;
}): Promise<boolean> {
  await db.execute(sql`
    UPDATE conversations
       SET project_id = NULL, updated_at = now()
     WHERE project_id      = ${input.projectId}::uuid
       AND organization_id = ${input.organizationId}::uuid
       AND user_id         = ${input.userId}::uuid
  `);

  const rows = (await db.execute(sql`
    UPDATE projects
       SET archived_at = now()
     WHERE id              = ${input.projectId}::uuid
       AND organization_id = ${input.organizationId}::uuid
       AND user_id         = ${input.userId}::uuid
       AND archived_at IS NULL
    RETURNING id
  `)) as unknown as { id: string }[];
  return rows.length > 0;
}

/**
 * Move a chat in or out of a project.
 *
 * `projectId: null` removes it. Ownership is checked on BOTH sides: a user
 * must not be able to attach their chat to somebody else's project, which
 * would make the other user's instructions apply to their conversation.
 */
export async function setConversationProject(input: {
  organizationId: string;
  userId: string;
  conversationId: string;
  projectId: string | null;
}): Promise<boolean> {
  if (input.projectId) {
    const owned = await getProject({
      organizationId: input.organizationId,
      userId: input.userId,
      projectId: input.projectId,
    });
    if (!owned) return false;
  }

  const rows = (await db.execute(sql`
    UPDATE conversations
       SET project_id = ${input.projectId}::uuid, updated_at = now()
     WHERE id              = ${input.conversationId}::uuid
       AND organization_id = ${input.organizationId}::uuid
       AND user_id         = ${input.userId}::uuid
    RETURNING id
  `)) as unknown as { id: string }[];
  return rows.length > 0;
}

/** Postgres 23505 is a unique violation. Narrow on purpose: a 23503
 *  (foreign key) or 23514 (check) is a bug and must surface as a 500. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === '23505';
}
