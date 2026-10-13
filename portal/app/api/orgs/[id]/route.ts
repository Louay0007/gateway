/**
 * PATCH /api/orgs/[id] — org settings (C-09).
 *
 * Body: { name?, slug? } — both optional, at least one required.
 *
 * The tenant check is the point of this file: the orgId comes from the
 * URL, and it is only honoured when the SESSION proves membership of
 * THAT org (requireOrgMembership). A guessed UUID is indistinguishable
 * from a nonexistent org — PLATFORM.md §10.1. Owner-only: renaming the
 * account and changing its public slug are account-level acts.
 *
 * The slug is the dashboard-visible handle, so it is re-resolved through
 * uniqueSlug() (the same helper provisioning uses) rather than trusted
 * from the body — a taken slug would otherwise be a 500 from the unique
 * index instead of a new candidate.
 */

import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireOrgMembership, roleAtLeast } from '@/lib/auth/authorize';
import { appendAudit } from '@/lib/audit';
import { uniqueSlug } from '@/lib/auth/provision';
import { db } from '@/db';
import { organizations } from '@/db/schema';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the account a name.').max(80).optional(),
    slug: z
      .string()
      .trim()
      .min(2, 'Use at least 2 characters.')
      .max(48)
      .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers, and dashes only.')
      .optional(),
  })
  .refine((v) => v.name !== undefined || v.slug !== undefined, {
    message: 'Nothing to update.',
  });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('validation', 'Request body must be JSON.');
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError('validation', parsed.error.issues[0]?.message ?? 'Invalid request.');
  }

  try {
    const { id } = await params;
    // Throws 404/403 for a non-member — before any mutation.
    const ctx = await requireOrgMembership(id);
    if (!roleAtLeast(ctx.role, 'owner')) {
      return jsonError('forbidden', 'Only the account owner can change account settings.');
    }

    const before = { name: ctx.org.name, slug: ctx.org.slug };

    const updates: { name?: string; slug?: string; updatedAt: Date } = {
      updatedAt: new Date(),
    };

    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.slug !== undefined) {
      // A slug equal to the current one is a no-op, not a collision.
      const requested = parsed.data.slug;
      if (requested !== ctx.org.slug) {
        const taken = await db.query.organizations.findFirst({
          where: eq(organizations.slug, requested),
        });
        // taken by another org → resolve with the candidate helper.
        updates.slug = taken ? await uniqueSlug(requested) : requested;
      }
    }

    const [updated] = await db
      .update(organizations)
      .set(updates)
      .where(eq(organizations.id, ctx.org.id))
      .returning();
    if (!updated) return jsonError('not_found', 'Organization not found.');

    await appendAudit({
      actorType: 'user',
      actorId: ctx.userId,
      organizationId: ctx.org.id,
      action: 'organization.settings_updated',
      targetType: 'organization',
      targetId: ctx.org.id,
      before,
      after: { name: updated.name, slug: updated.slug },
    });

    // The LiteLLM team alias is derived from the FIRST slug and is left
    // alone on purpose: it is the gateway-side join key (the collector
    // maps teams to orgs by id, not alias), and renaming it buys
    // cosmetics for a rename call that can fail.
    return Response.json({
      organization: { id: updated.id, name: updated.name, slug: updated.slug },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
