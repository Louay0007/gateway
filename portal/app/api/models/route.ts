/**
 * GET /api/models — the aliases this account may use right now.
 *
 * The chat pages read `getAllowedModels` server-side and pass the result
 * down, so this route is not how the chat UI gets its list. It exists for
 * client-side consumers that cannot render a server component, and for
 * verifying from a terminal that the wall and the picker agree.
 *
 * Same source as the wall — never a second computation.
 */
import { errorResponse } from '@/lib/api/errors';
import { requireActiveOrg } from '@/lib/auth/authorize';
import { getAllowedModels } from '@/lib/entitlements/allowed-models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();
    const wall = await getAllowedModels(ctx.orgId);
    return Response.json(
      {
        /** Every alias the plan entitles, spent ones included. */
        models: wall.entitled.map((alias) => ({
          alias,
          allowed: wall.allowed.includes(alias),
          tokenLimit: wall.tokenLimits[alias] ?? null,
          usedTokens: wall.usedTokensBy[alias] ?? 0,
        })),
        planCode: wall.planCode,
        period: wall.period
          ? { start: wall.period.start.toISOString(), end: wall.period.end.toISOString() }
          : null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
