/**
 * GET  /api/keys — active keys for the caller's organization.
 * POST /api/keys — mint a key (IMPLEMENTATION.md §3.1, C-05).
 *
 * The response to POST contains the plaintext exactly once. There is no
 * endpoint that can return it again, and no code path that stores it —
 * see lib/keys/service.ts.
 */

import { z } from 'zod';
import { requireActiveOrg } from '@/lib/auth/authorize';
import { createKey, listKeys } from '@/lib/keys';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give the key a name so you can tell it apart later.')
    .max(80, 'Names are limited to 80 characters.'),
  models: z
    .array(z.string().trim().min(1))
    .min(1, 'Select at least one model.')
    .max(10, 'Too many models selected.'),
});

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();
    const { keys } = await listKeys({ organizationId: ctx.orgId, userId: ctx.userId });
    return Response.json({ keys });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('validation', 'Request body must be JSON.');
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError('validation', parsed.error.issues[0]?.message ?? 'Invalid request.');
  }

  try {
    const ctx = await requireActiveOrg();
    const created = await createKey({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      role: ctx.role,
      name: parsed.data.name,
      models: parsed.data.models,
    });
    return Response.json(created, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
