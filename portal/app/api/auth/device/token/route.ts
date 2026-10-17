/**
 * POST /api/auth/device/token — polled by the Zaino Desktop app until the
 * person approves the device on the portal.
 *
 * The device code authenticates the app — no session is involved. Returns
 * `{ token, models, user, organization }` once the code is approved, or an
 * OAuth-device-flow error (authorization_pending / slow_down / expired_token
 * / invalid_grant / access_denied) otherwise. The one-time key plaintext is
 * released exactly once and nulled server-side on collection.
 */

import { z } from 'zod';
import { DeviceServiceError } from '@/lib/auth/device/types';
import { pollDeviceToken } from '@/lib/auth/device';
import { errorResponse } from '@/lib/api/errors';

const tokenSchema = z.object({
  device_code: z.string().trim().min(1, 'A device code is required.'),
});

/** RFC 8628-style error codes for the device token endpoint. */
const TOKEN_ERROR_STATUS: Record<string, number> = {
  authorization_pending: 400,
  slow_down: 400,
  expired_token: 400,
  invalid_grant: 400,
  access_denied: 400,
  validation: 400,
  conflict: 409,
  forbidden: 403,
  payment_required: 402,
  not_found: 404,
  upstream: 502,
  internal: 500,
};

function deviceErrorResponse(error: unknown): Response {
  if (error instanceof DeviceServiceError) {
    const status = TOKEN_ERROR_STATUS[error.code] ?? 500;
    return Response.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return errorResponse(error);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: 'validation', message: 'Request body must be JSON.' } }, { status: 400 });
  }

  const parsed = tokenSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'validation', message: parsed.error.issues[0]?.message ?? 'Invalid request.' } },
      { status: 400 },
    );
  }

  try {
    const outcome = await pollDeviceToken({ deviceCode: parsed.data.device_code });
    if (outcome.kind === 'pending') {
      return Response.json(
        {
          error: {
            code: 'authorization_pending',
            message: 'Approval is pending — sign in to the portal and approve this device, then poll again.',
          },
        },
        { status: 400 },
      );
    }
    return Response.json({
      token: outcome.token,
      models: outcome.models,
      user: outcome.user,
      organization: outcome.organization,
    });
  } catch (e) {
    return deviceErrorResponse(e);
  }
}
