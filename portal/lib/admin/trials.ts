/**
 * Trial campaigns.
 *
 * `trial_codes` had no writer in application code — only scripts — so creating
 * a marketing code meant a shell on the box. Doing it here is the same power
 * with an audit row and a role check.
 *
 * REDEMPTION IS UNTOUCHED. `redeemTrialCode()` (lib/trial/service.ts) is the
 * only path a customer takes, and nothing here goes near it: the console
 * creates and retires the CODES and reads who used them.
 *
 * DEACTIVATE, NEVER DELETE. `trial_redemptions.trial_code_id` is
 * `ON DELETE CASCADE`, so deleting a code would erase the record of everyone
 * who redeemed it — a marketing campaign's only evidence that it worked.
 */

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { trialCodes } from '@/db/schema';
import { appendAudit } from '@/lib/audit';

export interface TrialCodeRow {
  id: string;
  code: string;
  trialDays: number;
  /** 0 = unlimited. */
  maxRedemptions: number;
  /** The denormalised column — can drift, so `liveRedemptions` is authoritative. */
  redeemedCount: number;
  models: string[];
  tokenLimits: Record<string, number>;
  validFrom: string;
  validUntil: string;
  expiresAt: string;
  active: boolean;
  /** Counted from trial_redemptions, not read from the column. */
  liveRedemptions: number;
  createdAt: string;
}

/**
 * Every campaign code, newest first.
 *
 * The redemption count is a SUBQUERY rather than `trial_codes.redeemed_count`
 * on purpose: the column is incremented on redemption and defensively
 * decremented on rollback, so it can drift from the rows. An operator reading
 * "127 of 500 used" needs the count of actual rows.
 */
export async function listTrialCodes(): Promise<TrialCodeRow[]> {
  const rows = (await db.execute(sql`
    SELECT t.id::text, t.code, t.trial_days, t.max_redemptions, t.redeemed_count,
           t.models, COALESCE(t.token_limits, '{}'::jsonb) AS token_limits,
           t.valid_from, t.valid_until, t.expires_at, t.active, t.created_at,
           (SELECT count(*) FROM trial_redemptions r WHERE r.trial_code_id = t.id)::int
             AS live_redemptions
      FROM trial_codes t
     ORDER BY t.created_at DESC
  `)) as unknown as {
    id: string;
    code: string;
    trial_days: number;
    max_redemptions: number;
    redeemed_count: number;
    models: string[];
    token_limits: Record<string, number>;
    valid_from: Date | string;
    valid_until: Date | string;
    expires_at: Date | string;
    active: boolean;
    created_at: Date | string;
    live_redemptions: number;
  }[];

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    trialDays: Number(r.trial_days),
    maxRedemptions: Number(r.max_redemptions),
    redeemedCount: Number(r.redeemed_count),
    models: r.models ?? [],
    tokenLimits: r.token_limits ?? {},
    validFrom: new Date(r.valid_from).toISOString(),
    validUntil: new Date(r.valid_until).toISOString(),
    expiresAt: new Date(r.expires_at).toISOString(),
    active: Boolean(r.active),
    liveRedemptions: Number(r.live_redemptions),
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export interface TrialCodeInput {
  code: string;
  trialDays: number;
  /** 0 = unlimited. */
  maxRedemptions: number;
  models: string[];
  tokenLimits?: Record<string, number>;
}

export type TrialActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string; message: string };

/**
 * Create a campaign code.
 *
 * The code is normalised to upper case because `redeemTrialCode()` compares
 * case-insensitively and a customer reading "spring25" off a poster will type
 * either. Storing one casing means the unique index enforces what the lookup
 * means.
 */
export async function createTrialCode(
  staffId: string,
  input: TrialCodeInput,
): Promise<TrialActionResult> {
  const code = input.code.trim().toUpperCase();

  if (!/^[A-Z0-9-]{3,64}$/.test(code)) {
    return {
      ok: false,
      error: 'validation',
      message: 'A code must be 3–64 characters: letters, digits and dashes.',
    };
  }
  if (!Number.isInteger(input.trialDays) || input.trialDays < 1 || input.trialDays > 365) {
    return { ok: false, error: 'validation', message: 'Trial days must be between 1 and 365.' };
  }
  if (!Number.isInteger(input.maxRedemptions) || input.maxRedemptions < 0) {
    return {
      ok: false,
      error: 'validation',
      message: 'Max redemptions must be 0 (unlimited) or a positive number.',
    };
  }
  if (!Array.isArray(input.models) || input.models.length === 0) {
    return { ok: false, error: 'validation', message: 'A trial must grant at least one model.' };
  }

  const clash = (await db.execute(sql`
    SELECT 1 FROM trial_codes WHERE upper(code) = ${code} LIMIT 1
  `)) as unknown as unknown[];
  if (clash.length) {
    return { ok: false, error: 'conflict', message: `A code "${code}" already exists.` };
  }

  // The window matches how the redemption path reads a code: valid from now,
  // redeemable until the campaign ends, and the code itself expires with it.
  const now = new Date();
  const validUntil = new Date(now.getTime() + input.trialDays * 24 * 60 * 60 * 1000);

  const [row] = await db
    .insert(trialCodes)
    .values({
      code,
      createdBy: staffId,
      maxRedemptions: input.maxRedemptions,
      models: input.models,
      tokenLimits: input.tokenLimits ?? {},
      trialDays: input.trialDays,
      validFrom: now,
      validUntil,
      expiresAt: validUntil,
      active: true,
    })
    .returning({ id: trialCodes.id });

  await appendAudit({
    actorType: 'user',
    actorId: staffId,
    organizationId: null,
    action: 'trial_code.created',
    targetType: 'trial_code',
    targetId: row?.id ?? null,
    after: {
      code,
      trialDays: input.trialDays,
      maxRedemptions: input.maxRedemptions,
      models: input.models,
    },
  });

  return { ok: true, id: row?.id ?? '' };
}

/** Turn a campaign on or off. A deactivated code is refused at redemption. */
export async function setTrialCodeActive(
  staffId: string,
  codeId: string,
  active: boolean,
): Promise<TrialActionResult> {
  const existing = await db.query.trialCodes.findFirst({ where: eq(trialCodes.id, codeId) });
  if (!existing) return { ok: false, error: 'not_found', message: 'No such trial code.' };
  if (existing.active === active) {
    return { ok: false, error: 'conflict', message: 'That code is already in that state.' };
  }

  await db.update(trialCodes).set({ active }).where(eq(trialCodes.id, codeId));

  await appendAudit({
    actorType: 'user',
    actorId: staffId,
    organizationId: null,
    action: active ? 'trial_code.activated' : 'trial_code.deactivated',
    targetType: 'trial_code',
    targetId: codeId,
    before: { active: existing.active },
    after: { active },
  });

  return { ok: true, id: codeId };
}

export interface TrialRedemptionRow {
  id: string;
  organizationId: string;
  organizationName: string;
  userEmail: string | null;
  redeemedAt: string;
}

/** Who used a code, newest first. */
export async function trialRedemptions(codeId: string): Promise<TrialRedemptionRow[]> {
  const rows = (await db.execute(sql`
    SELECT r.id::text, r.organization_id::text AS organization_id,
           o.name AS organization_name, u.email AS user_email,
           r.redeemed_at
      FROM trial_redemptions r
      JOIN organizations o ON o.id = r.organization_id
      LEFT JOIN organization_members m ON m.organization_id = o.id AND m.role = 'owner'
      LEFT JOIN users u ON u.id = m.user_id
     WHERE r.trial_code_id = ${codeId}::uuid
     ORDER BY r.redeemed_at DESC
     LIMIT 500
  `)) as unknown as {
    id: string;
    organization_id: string;
    organization_name: string;
    user_email: string | null;
    redeemed_at: Date | string;
  }[];

  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    organizationName: r.organization_name,
    userEmail: r.user_email,
    redeemedAt: new Date(r.redeemed_at).toISOString(),
  }));
}
