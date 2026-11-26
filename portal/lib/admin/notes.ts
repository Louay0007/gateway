/**
 * Operator notes (0056) — the free text the next person needs.
 *
 * APPEND-AND-PIN ONLY. Nothing edits and nothing deletes: a wrong note is
 * corrected by a later one, exactly as a credit note corrects a refund. That
 * keeps the console's own history unrewritable, which is the same discipline
 * `credit_notes` and `audit_log` follow.
 *
 * NOT the audit trail. `audit_log` is structured and machine-read through
 * prefix filters; it cannot hold "called them, they paid by cash at the post
 * office" without degrading into a free-text log. Notes are for the human next
 * in the queue; the audit row is the record.
 */

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { adminNotes } from '@/db/schema';
import { appendAudit } from '@/lib/audit';

/** The values the filter offers. Anything else renders as plain text. */
export const NOTE_KINDS = ['note', 'payment', 'subscription', 'abuse'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export function isNoteKind(v: unknown): v is NoteKind {
  return typeof v === 'string' && (NOTE_KINDS as readonly string[]).includes(v);
}

export interface AdminNote {
  id: string;
  organizationId: string;
  authorId: string;
  authorUsername: string;
  body: string;
  kind: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Notes for an account, pinned first then newest first.
 *
 * Pinned-first is the order the drill-down renders: the note that says "this
 * customer is a chargeback risk" must not scroll away behind six routine
 * entries.
 */
export async function listNotes(orgId: string): Promise<AdminNote[]> {
  const rows = (await db.execute(sql`
    SELECT id::text, organization_id::text AS organization_id,
           author_id::text AS author_id, author_username,
           body, kind, pinned, created_at, updated_at
      FROM admin_notes
     WHERE organization_id = ${orgId}::uuid
     ORDER BY pinned DESC, created_at DESC
     LIMIT 200
  `)) as unknown as {
    id: string;
    organization_id: string;
    author_id: string;
    author_username: string;
    body: string;
    kind: string;
    pinned: boolean;
    created_at: Date | string;
    updated_at: Date | string;
  }[];

  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    authorId: r.author_id,
    authorUsername: r.author_username,
    body: r.body,
    kind: r.kind,
    pinned: Boolean(r.pinned),
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
}

export type NoteActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string; message: string };

/**
 * Add a note.
 *
 * `authorUsername` is passed in, not looked up: the caller already holds the
 * staff session, and denormalising it here means the note still reads correctly
 * if that operator's username is later changed.
 *
 * Audited, even though the note itself is the human-readable record. "Who
 * pinned a chargeback warning to this account" belongs in the trail alongside
 * every other operator action.
 */
export async function addNote(
  staff: { id: string; username: string },
  orgId: string,
  input: { body: string; kind?: string },
): Promise<NoteActionResult> {
  const body = input.body.trim();

  if (!body) return { ok: false, error: 'validation', message: 'Write something first.' };
  if (body.length > 4000) {
    return { ok: false, error: 'validation', message: 'Keep the note under 4000 characters.' };
  }

  const kind = isNoteKind(input.kind) ? input.kind : 'note';

  const [row] = await db
    .insert(adminNotes)
    .values({
      organizationId: orgId,
      authorId: staff.id,
      authorUsername: staff.username,
      body,
      kind,
    })
    .returning({ id: adminNotes.id });

  await appendAudit({
    actorType: 'user',
    actorId: staff.id,
    organizationId: orgId,
    action: 'note.added',
    targetType: 'admin_note',
    targetId: row?.id ?? null,
    after: { kind, pinned: false, length: body.length },
  });

  return { ok: true, id: row?.id ?? '' };
}

/**
 * Pin or unpin.
 *
 * SCOPED BY ORG as well as id, so a note id from one drill-down cannot pin a
 * note on another account — the same reasoning `adminRevokeKey` applies to a
 * key. A mismatch is 404, not 403, so it is indistinguishable from a bad id.
 */
export async function setNotePinned(
  staffId: string,
  orgId: string,
  noteId: string,
  pinned: boolean,
): Promise<NoteActionResult> {
  const existing = await db.query.adminNotes.findFirst({
    where: and(eq(adminNotes.id, noteId), eq(adminNotes.organizationId, orgId)),
  });
  if (!existing) return { ok: false, error: 'not_found', message: 'No such note on this account.' };
  if (existing.pinned === pinned) {
    return { ok: false, error: 'conflict', message: 'That note is already in that state.' };
  }

  await db
    .update(adminNotes)
    .set({ pinned, updatedAt: new Date() })
    .where(eq(adminNotes.id, noteId));

  await appendAudit({
    actorType: 'user',
    actorId: staffId,
    organizationId: orgId,
    action: pinned ? 'note.pinned' : 'note.unpinned',
    targetType: 'admin_note',
    targetId: noteId,
    before: { pinned: existing.pinned },
    after: { pinned },
  });

  return { ok: true, id: noteId };
}
