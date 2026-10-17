/**
 * POST /api/auth/device — issue a device-code authorization (RFC 8628 style).
 *
 * Called by the Zaino Desktop app to start sign-in. The response carries the
 * plaintext device code exactly once; only its hash is stored. No session is
 * involved — the code is useless until an Auth.js session approves it at
 * /api/auth/device/verify.
 */

import { DEVICE_CODE_TTL_SECONDS } from '@/lib/auth/device/policy';
import { requestDeviceCode } from '@/lib/auth/device';
import { errorResponse } from '@/lib/api/errors';
import { appOrigin } from '@/lib/auth/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  try {
    const created = await requestDeviceCode();
    return Response.json({
      device_code: created.deviceCode,
      user_code: created.userCode,
      verification_url: `${appOrigin()}/device?user_code=${encodeURIComponent(created.userCode)}`,
      expires_in: DEVICE_CODE_TTL_SECONDS,
      interval: created.intervalSeconds,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
