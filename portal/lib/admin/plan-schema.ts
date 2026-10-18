/**
 * Plan request body schema — shared by POST /api/admin/plans and
 * PATCH /api/admin/plans/[id].
 *
 * Lives here rather than in a route file because a `route.ts` may only
 * export HTTP handlers and route config: a named export of a zod schema
 * from one is not a valid module shape for the router and fails the
 * build. (`lib/admin/plans.ts` owns the MONEY validation — the rate
 * floor, the cap-vs-included check, the derived markup — and re-validates
 * everything regardless, so this schema is the request-shape guard, not
 * the business-rule guard. Both must pass.)
 */

import { z } from 'zod';

export const planBodySchema = z.object({
  code: z.string().trim().min(2).max(32),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional().nullable(),
  public: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  priceCents: z.number().int().min(0),
  interval: z.enum(['month', 'year']).optional(),
  includedSpendCents: z.number().int().min(0).optional(),
  hardCapCents: z.number().int().min(0).optional().nullable(),
  rpmLimit: z.number().int().min(0).optional().nullable(),
  tpmLimit: z.number().int().min(0).optional().nullable(),
  maxConcurrentRequests: z.number().int().min(0).optional().nullable(),
  maxKeys: z.number().int().min(1).max(1000).optional(),
  rateMultiplierBps: z.number().int().min(11_000).max(100_000),
  models: z.array(z.string().trim().min(1).max(64)).min(1, 'Grant at least one model.'),
  trialDays: z.number().int().min(0).max(365).optional(),
  promptLimits: z.record(z.string(), z.number().int().min(0)).optional(),
});

/** First issue message, for the `{error:{message}}` envelope. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid request.';
}