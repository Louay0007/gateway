/**
 * GET /api/orgs — the orgs the caller belongs to.
 *
 * Single-account MVP, so this is usually one row — but the dashboard
 * reads its org through this rather than reaching into the database, so
 * the client surface stays a stable API even as the model grows.
 *
 * Auth: gated on `currentUser()`, NOT `requireActiveOrg()`. Requiring the
 * active org to LIST orgs is circular — this is the endpoint whose job is
 * to tell the caller what orgs exist for them, including the case where
 * the answer is "none" or "deleted". Anonymous → 401, matching every
 * sibling route. Deleted orgs are filtered: the product surface 404s them
 * (`requireOrgMembership`), so listing them here would offer a destination
 * that answers Not Found.
 */

import { currentUser, listMemberships } from '@/lib/auth/authorize';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const user = await currentUser();
    if (!user) {
      return jsonError('unauthorized', 'Not signed in');
    }
    const memberships = await listMemberships();
    return Response.json({
      orgs: memberships
        .filter((m) => m.orgStatus !== 'deleted')
        .map((m) => ({
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
