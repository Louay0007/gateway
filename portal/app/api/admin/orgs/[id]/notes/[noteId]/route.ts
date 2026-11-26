/**
 * PATCH /api/admin/orgs/[id]/notes/[noteId] — pin or unpin a note.
 *
 * STAFF ONLY, `support`. Scoped by org as well as id, so a note id taken from
 * one drill-down cannot pin a note on another account.
 *
 * There is no DELETE and no PUT: notes are append-and-pin only, so a wrong
 * note is corrected by a later one — the same discipline credit notes follow.
 */

import { z } from 'zod';

import { requireStaff } from '@/lib/auth/authorize';
import { setNotePinned } from '@/lib/admin/notes';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({ pinned: z.boolean() });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('validation', 'Request body must be JSON.');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError('validation', 'pinned must be true or false.');

  try {
    const staff = await requireStaff('support');
    const { id, noteId } = await params;
    if (!UUID.test(id) || !UUID.test(noteId)) return jsonError('not_found', 'No such note.');

    const result = await setNotePinned(staff.id, id, noteId, parsed.data.pinned);

    if (!result.ok) {
      return jsonError(result.error === 'not_found' ? 'not_found' : 'conflict', result.message);
    }

    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
