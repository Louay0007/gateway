/**
 * POST /api/auth/device — issue a device-code authorization (RFC 8628 style).
 *
 * Called by the Zaino Desktop app to start sign-in. The response carries the
 * plaintext device code exactly once; only its hash is stored. No session is
 * involved — the code is useless until an Auth.js session approves it at
 * /api/auth/device/verify.
 *
 * The optional `device_name` in the body is display metadata: the app sends
 * its hostname and platform so the key list, and the person whose other
 * machine gets signed out by this approval, can tell devices apart. It is
 * sanitized and bounded here because the dashboard renders it.
 */

import { DEVICE_CODE_TTL_SECONDS } from '@/lib/auth/device/policy';
import { requestDeviceCode } from '@/lib/auth/device';
import { errorResponse } from '@/lib/api/errors';
import { appOrigin } from '@/lib/auth/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Long enough for "MacBook-Pro (darwin)", short enough to render in a row. */
const MAX_DEVICE_NAME = 64;

/**
 * Read the reported device name.
 *
 * The body is optional — older clients post nothing at all — so a missing or
 * unparseable body yields no name rather than a 400. The value is reduced to
 * printable text: it comes from a client and is displayed in the dashboard.
 */
async function readDeviceName(request: Request): Promise<string | null> {
  const body = (await request.json().catch(() => undefined)) as unknown;
  if (!body || typeof body !== 'object') return null;

  const raw = (body as { device_name?: unknown }).device_name;
  if (typeof raw !== 'string') return null;

  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, MAX_DEVICE_NAME);

  return cleaned.length > 0 ? cleaned : null;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const created = await requestDeviceCode({ deviceName: await readDeviceName(request) });
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
