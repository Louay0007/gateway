/**
 * GET /api/admin/audit — the audit trail, filterable.
 *
 * STAFF ONLY, `read_only`.
 *
 * `audit_log` was written by every money-moving action since 0001 and
 * read by NOTHING until this route. The operator questions it answers —
 "who suspended this account on the 12th?", "what did this customer do
 before they cancelled?" — were previously unanswerable from the
 product, which is an uncomfortable thing to discover during a dispute.
 *
 * `action` is a PREFIX match, not equality, so filtering on
 * `organization.` returns both `organization.suspended` and
 * `organization.reactivated` without enumerating them.
 *
 * `before`/`after` are returned raw. Their shape is per-action by
 * design — a single projection would have to flatten most of them into
 * something that no longer describes what happened.
 */

import { requireStaff } from '@/lib/auth/authorize';
import { listAudit } from '@/lib/admin/orgs';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTOR_TYPES = ['user', 'system', 'provider'] as const;

export async function GET(request: Request): Promise<Response> {
  try {
    await requireStaff('read_only');
    const sp = new URL(request.url).searchParams;

    const organizationId = sp.get('organization');
    if (organizationId && !UUID.test(organizationId)) {
      return jsonError('validation', 'organization must be a UUID.');
    }

    const actorType = sp.get('actor');
    if (actorType && !ACTOR_TYPES.includes(actorType as (typeof ACTOR_TYPES)[number])) {
      return jsonError('validation', `actor must be one of: ${ACTOR_TYPES.join(', ')}.`);
    }

    const page = Number(sp.get('page') ?? '1');
    const pageSize = Number(sp.get('page_size') ?? '50');
    if (!Number.isFinite(page) || page < 1) {
      return jsonError('validation', 'page must be a positive whole number.');
    }
    if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 100) {
      return jsonError('validation', 'page_size must be between 1 and 100.');
    }

    const result = await listAudit({
      organizationId: organizationId ?? undefined,
      action: sp.get('action') ?? undefined,
      actorType: actorType ?? undefined,
      page,
      pageSize,
    });

    return Response.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}