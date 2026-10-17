/**
 * POST /api/auth/device/verify — approve a user code from an Auth.js session.
 *
 * Called by the /device page after the person has signed in to the portal.
 * Server-side authorization: a valid session, membership in an organization
 * with an active plan, and a pending unexpired user code. No secret is
 * returned — approval only binds the code to the account and mints the
 * device key, which the desktop app collects by polling /api/auth/device/token.
 */

import { z } from 'zod';
import { auth } from '@/auth';
import { userByEmail, requireActiveOrg } from '@/lib/auth/authorize';
import { AuthzError } from '@/lib/auth/errors';
import { approveDeviceCode } from '@/lib/auth/device';
import { appOrigin } from '@/lib/auth/tokens';
import { jsonError, errorResponse } from '@/lib/api/errors';

const verifySchema = z.object({
  user_code: z.string().trim().min(1, 'A sign-in code is required.'),
});

/**
 * Same-origin gate for this state-changing endpoint: only the portal itself
 * (same Origin/Referer) may approve codes. Browsers always send Origin on a
 * same-origin POST; a cross-origin page cannot forge it.
 */
function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin') ?? request.headers.get('referer');
  if (!origin) {
    throw new AuthzError('Missing origin — approve from the portal instead.', 'forbidden', 403);
  }
  try {
    if (new URL(origin).origin !== appOrigin()) {
      throw new AuthzError('Cross-origin approval is not allowed.', 'forbidden', 403);
    }
  } catch {
    throw new AuthzError('Invalid origin.', 'forbidden', 403);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('validation', 'Request body must be JSON.');
  }

  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError('validation', parsed.error.issues[0]?.message ?? 'Invalid request.');
  }

  try {
    const session = await auth();
    if (!session?.user?.email) {
      throw new AuthzError('Sign in to the portal before approving a device.', 'unauthorized', 401);
    }
    const user = await userByEmail(session.user.email);
    if (!user) {
      throw new AuthzError('Sign in to the portal before approving a device.', 'unauthorized', 401);
    }

    const ctx = await requireActiveOrg();
    assertSameOrigin(request);

    const result = await approveDeviceCode({
      userCode: parsed.data.user_code,
      actorUserId: user.id,
      organizationId: ctx.orgId,
      role: ctx.role,
    });
    return Response.json({ approved: true, userCode: result.userCode });
  } catch (e) {
    return errorResponse(e);
  }
}
