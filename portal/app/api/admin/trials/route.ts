/**
 * GET  /api/admin/trials — every campaign code.
 * POST /api/admin/trials — create one.
 *
 * STAFF ONLY. Reading is `support`; creating is `owner`, because a code is
 * money with no customer attached — the same tier as editing the plan catalog,
 * for the same reason.
 */

import { z } from 'zod';

import { requireStaff } from '@/lib/auth/authorize';
import { createTrialCode, listTrialCodes } from '@/lib/admin/trials';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODEL_ALIAS = /^[a-z0-9][a-z0-9.-]{0,63}$/;

const schema = z.object({
  code: z.string().trim().min(3).max(64),
  trialDays: z.number().int().min(1).max(365),
  /** 0 = unlimited. */
  maxRedemptions: z.number().int().min(0),
  models: z.array(z.string().trim().min(1).max(64)).min(1, 'Grant at least one model.'),
  tokenLimits: z.record(z.string().regex(MODEL_ALIAS), z.number().int().min(0)).optional(),
});

export async function GET(): Promise<Response> {
  try {
    await requireStaff('support');
    return Response.json({ rows: await listTrialCodes() });
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

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError('validation', parsed.error.issues[0]?.message ?? 'Invalid trial code.');
  }

  try {
    const staff = await requireStaff('owner');
    const result = await createTrialCode(staff.id, parsed.data);

    if (!result.ok) {
      return jsonError(result.error === 'conflict' ? 'conflict' : 'validation', result.message);
    }
    return Response.json({ ok: true, id: result.id });
  } catch (e) {
    return errorResponse(e);
  }
}
