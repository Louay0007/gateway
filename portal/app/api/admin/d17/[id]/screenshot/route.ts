/**
 * GET /api/admin/d17/[id]/screenshot — stream a proof screenshot.
 *
 * STAFF ONLY. The filename comes from the database row, never from the URL:
 * a path parameter that reached the filesystem would be a directory-traversal
 * primitive. The row's own path is validated for separators before use, the
 * file is read from the uploads directory (outside the web root), and the
 * response is marked no-store.
 *
 * This route must never grow a write. Approve and reject call
 * `requireOperator(rank)` instead, so a `read_only` operator can look at
 * evidence and cannot act on it.
 */

import { readFile } from 'node:fs/promises';
import { requireStaff } from '@/lib/auth/authorize';
import { db } from '@/db';
import { paymentsD17 } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { d17UploadsDir } from '@/lib/billing/d17-config';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    // STAFF ONLY — one check, because there is one credential now.
    //
    // This used to try the shared gate cookie FIRST and fall back to the
    // staff role only when it failed. `gateCookieValid()` returns true when
    // ADMIN_GATE_SECRET is unset ("no gate installed"), so on any deployment
    // that had not set the secret, an ANONYMOUS caller could pull payment
    // proof images. The gate is gone with the console login (0053) and this
    // is a plain rank check.
    await requireStaff('read_only');

    const { id } = await params;
    // A malformed id is 404, matching every other route: it must never
    // reach Postgres as a cast error (that would be a 500 oracle).
    if (!UUID.test(id)) {
      return jsonError('not_found', 'No screenshot for this payment.');
    }
    const payment = await db.query.paymentsD17.findFirst({
      where: eq(paymentsD17.id, id),
    });
    if (!payment?.screenshotPath) {
      return jsonError('not_found', 'No screenshot for this payment.');
    }

    const name = payment.screenshotPath;
    // Defense in depth: the name is ours (a UUID), but never trust that.
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) {
      return jsonError('not_found', 'Invalid screenshot reference.');
    }

    let bytes: Buffer;
    try {
      bytes = await readFile(`${d17UploadsDir()}/${name}`);
    } catch (e) {
      // Row says there is a file, disk disagrees: that is a missing
      // resource, not a server fault. Anything but ENOENT still 500s.
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return jsonError('not_found', 'No screenshot for this payment.');
      }
      throw e;
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        // Re-encoded to PNG at upload, so the type is known.
        'Content-Type': 'image/png',
        'Content-Disposition': `inline; filename="${name}"`,
        'Cache-Control': 'no-store',
        // Screenshots can incidentally contain other notifications.
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
