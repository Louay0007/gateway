/**
 * GET /api/orgs — the orgs the caller belongs to.
 *
 * Single-account MVP, so this is usually one row — but the dashboard
 * reads its org through this rather than reaching into the database, so
 * the client surface stays a stable API even as the model grows.
 */

import { listMemberships } from '@/lib/auth/authorize';
import { errorResponse } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const memberships = await listMemberships();
    return Response.json({
      orgs: memberships.map((m) => ({
        id: m.orgId,
        name: m.orgName,
        slug: m.orgSlug,
        status: m.orgStatus,
        role: m.role,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
