/**
 * /api/admin/staff — GET the roster, POST grant access.
 *
 * STAFF ONLY. GET is `read_only`; POST is `owner` ONLY.
 *
 * Why granting is owner-gated: `read_only` can already see every
 * customer, every payment and every audit entry in the product. Granting
 * someone an account is the action that makes all of that reachable by
 * a new person, so it is deliberately one tier above `admin` — the tier
 * that can already suspend paying customers and record refunds.
 *
 * POST grants ACCESS to an email that must already have a `users` row.
 * It does not create an identity or a credential: `create-accounts.ts`
 * owns credential creation because it must hash with the same scrypt
 * parameters the sign-in path verifies against, and inventing a second
 * hashing path here would produce credentials that never work.
 */

import { z } from 'zod';
import { requireStaff } from '@/lib/auth/authorize';
import { isStaffRole, STAFF_ROLES } from '@/lib/auth/staff-roles';
import { grantStaffAccess, listStaff } from '@/lib/admin/staff';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await requireStaff('read_only');
    const rows = await listStaff();
    return Response.json({ rows, roles: STAFF_ROLES });
  } catch (e) {
    return errorResponse(e);
  }
}

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  name: z.string().trim().max(120).optional().nullable(),
  role: z.string().refine(isStaffRole, `Role must be one of: ${STAFF_ROLES.join(', ')}.`),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('validation', 'Request body must be JSON.');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError('validation', parsed.error.issues[0]?.message ?? 'Invalid request.');
  }

  try {
    const staff = await requireStaff('owner');
    const result = await grantStaffAccess(staff.id, {
      email: parsed.data.email,
      name: parsed.data.name ?? null,
      role: parsed.data.role,
    });
    if (!result.ok) {
      return jsonError(result.error === 'unknown_user' ? 'validation' : 'conflict', result.message);
    }
    return Response.json({ ok: true, id: result.id });
  } catch (e) {
    return errorResponse(e);
  }
}