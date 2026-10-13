/**
 * GET /api/admin/d17/[id]/screenshot — stream a proof screenshot.
 *
 * STAFF ONLY, and the filename comes from the database row, never from
 * the URL: a path parameter that reached the filesystem would be a
 * directory-traversal primitive. The row's own path is validated for
 * separators before use, the file is read from the uploads directory
 * (outside the web root), and the response is marked no-store.
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    // Support is enough to view evidence; approving needs more.
    await requireStaff('read_only');

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
