/**
 * GET /api/admin/d17/[id]/screenshot — stream a proof screenshot.
 *
 * STAFF OR GATE. The filename comes from the database row, never from
 * the URL: a path parameter that reached the filesystem would be a
 * directory-traversal primitive. The row's own path is validated for
 * separators before use, the file is read from the uploads directory
 * (outside the web root), and the response is marked no-store.
 *
 * Why the gate counts here and nowhere else: viewing a screenshot is
 * read-only evidence, and the gate code is the operator's credential on
 * this deployment — there is no staff login session to present. Every
 * route that CHANGES something (approve, reject, export) still demands
 * `requireStaff()`, and this route must never grow a write.
 */

import { readFile } from 'node:fs/promises';
import { gateCookieValid } from '@/lib/admin/gate';
import { requireStaff } from '@/lib/auth/authorize';
import { db } from '@/db';
import { paymentsD17 } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { d17UploadsDir } from '@/lib/billing/d17-config';
import { errorResponse, jsonError } from '@/lib/api/errors';
import { AuthzError } from '@/lib/auth/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    // Gate-first, staff-second. A gate-only operator (valid cookie, no
    // staff session) may VIEW evidence — that is the whole point of the
    // gate on this deployment. Support staff pass either way. Anyone with
    // neither gets the same 401 the staff path has always answered.
    const gateOk = await gateCookieValid();
    if (!gateOk) {
      try {
        // Support is enough to view evidence; approving needs more.
        await requireStaff('read_only');
      } catch {
        throw new AuthzError('Not signed in', 'unauthorized', 401);
      }
    }

    const { id } = await params;
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

    const bytes = await readFile(`${d17UploadsDir()}/${name}`);
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
