/**
 * /api/notifications — the org's quota-alert preferences.
 *
 *   GET   → `{ thresholds, channel, onExhausted, onAnomaly }`
 *   PATCH → the same shape, partially
 *
 * ORG-SCOPED THROUGH THE SESSION, never a body id. `requireActiveOrg()` is
 * the same guard every other dashboard route uses, so a preference write
 * cannot be aimed at another organisation by editing a payload.
 *
 * NO ROW = DEFAULTS (migration 0051). GET returns the defaults when the org
 * has never saved, so the settings page renders a real form on a fresh
 * account and turning a switch off is one click rather than "save first".
 */
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { orgAlertPrefs } from '@/db/schema';
import { requireActiveOrg } from '@/lib/auth/authorize';
import { errorResponse, jsonError } from '@/lib/api/errors';
import { DEFAULT_THRESHOLDS, normalizeThresholds } from '@/lib/dashboard/quota-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    // Percentages only, 1..100. The DB CHECK enforces the same range; this
    // is the copy that produces a readable error instead of a 500.
    thresholds: z.array(z.number().int().min(1).max(100)).max(5).optional(),
    channel: z.enum(['email', 'none']).optional(),
    onExhausted: z.boolean().optional(),
    onAnomaly: z.boolean().optional(),
  })
  .strict();

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();
    const [row] = await db
      .select()
      .from(orgAlertPrefs)
      .where(eq(orgAlertPrefs.organizationId, ctx.orgId));

    return Response.json(
      {
        thresholds: row ? normalizeThresholds(row.quotaThresholds) : [...DEFAULT_THRESHOLDS],
        channel: row?.channel ?? 'email',
        onExhausted: row?.onExhausted ?? true,
        onAnomaly: row?.onAnomaly ?? false,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('validation', 'Send a JSON body.');
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      'validation',
      parsed.error.issues[0]?.message ?? 'Invalid notification settings.',
    );
  }

  try {
    const ctx = await requireActiveOrg();
    const patch = parsed.data;

    if (Object.keys(patch).length === 0) {
      return jsonError('validation', 'Nothing to update.');
    }

    // Upsert. A first save from a fresh org creates the row with defaults for
    // any field the request did not mention, so a partial PATCH can never
    // leave a half-populated preference set. COALESCE keeps "not mentioned"
    // distinct from "set to false", which is the bug a naive `||` would ship.
    await db.execute(sql`
      INSERT INTO org_alert_prefs (
        organization_id, quota_thresholds, channel, on_exhausted, on_anomaly, updated_at
      ) VALUES (
        ${ctx.orgId}::uuid,
        ${patch.thresholds ? sql`${JSON.stringify(patch.thresholds)}::int[]` : sql`ARRAY[80,95]::int[]`},
        ${patch.channel ?? 'email'},
        ${patch.onExhausted ?? true},
        ${patch.onAnomaly ?? false},
        now()
      )
      ON CONFLICT (organization_id) DO UPDATE SET
        quota_thresholds = CASE
          WHEN ${patch.thresholds !== undefined}
            THEN ${patch.thresholds ? sql`${JSON.stringify(patch.thresholds)}::int[]` : sql`org_alert_prefs.quota_thresholds`}
          ELSE org_alert_prefs.quota_thresholds
        END,
        channel      = COALESCE(${patch.channel ?? null}, org_alert_prefs.channel),
        on_exhausted = COALESCE(${patch.onExhausted ?? null}, org_alert_prefs.on_exhausted),
        on_anomaly   = COALESCE(${patch.onAnomaly ?? null}, org_alert_prefs.on_anomaly),
        updated_at   = now()
    `);

    return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
