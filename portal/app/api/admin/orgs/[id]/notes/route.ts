/**
 * GET  /api/admin/orgs/[id]/notes — an account's operator notes.
 * POST /api/admin/orgs/[id]/notes — add one.
 *
 * STAFF ONLY. Read is `read_only` (a note is context, and an analyst reading
 * the roster benefits from it); writing is `support` (answering a customer is
 * exactly when a note gets written).
 */

import { z } from 'zod';

import { requireStaff } from '@/lib/auth/authorize';
import { addNote, listNotes, NOTE_KINDS } from '@/lib/admin/notes';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  body: z.string().trim().min(1, 'Write something first.').max(4000),
  kind: z.enum(NOTE_KINDS).optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireStaff('read_only');
    const { id } = await params;
    if (!UUID.test(id)) return jsonError('not_found', 'No such organization.');

    return Response.json({ rows: await listNotes(id) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('validation', 'Request body must be JSON.');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError('validation', parsed.error.issues[0]?.message ?? 'Invalid note.');
  }

  try {
    const staff = await requireStaff('support');
    const { id } = await params;
    if (!UUID.test(id)) return jsonError('not_found', 'No such organization.');

    const result = await addNote(
      { id: staff.id, username: staff.username },
      id,
      parsed.data,
    );

    if (!result.ok) return jsonError('validation', result.message);
    return Response.json({ ok: true, id: result.id });
  } catch (e) {
    return errorResponse(e);
  }
}
