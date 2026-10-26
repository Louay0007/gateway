/**
 * GET /api/device/usage — token quota for the desktop app.
 *
 * The desktop agent holds a `zn-` gateway key but no browser session, so
 * it cannot call /api/subscription (which requires requireActiveOrg).
 * This endpoint bridges that gap: authenticate by gateway key, resolve
 * the org from the key's LiteLLM team, and return the same token-limit
 * and token-usage data the dashboard shows.
 *
 * Auth flow:
 *   1. Bearer token → look up api_keys row by key_hash
 *   2. Join to organizations to get orgId
 *   3. Delegate to subscriptionBundle() for the canonical numbers
 *
 * Tokens are the only quota (migration 0023). Returns plan code, models,
 * per-alias token budgets, blended tokens used, and remaining tokens for
 * the current billing period. No PII, no spend figures, no admin data.
 */

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { apiKeys, organizations } from '@/db/schema';
import { subscriptionBundle } from '@/lib/billing';
import {
  remainingTokensByModel as computeRemainingTokens,
  isTokenExhausted,
  outOfTokensMessage,
} from '@/lib/entitlements/quota';
import { errorResponse, jsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function orgIdForKey(key: string): Promise<string | null> {
  // The desktop sends the zn- form as its Bearer token. `api_keys.key_hash`
  // stores the SHA-256 hex of that plaintext (lib/keys/policy.ts keyHashFor),
  // NOT the plaintext itself — so the lookup has to hash before comparing.
  // Comparing the raw plaintext against key_hash can never match, which
  // made this endpoint answer 401 for every caller, including valid keys.
  const hash = createHash('sha256').update(key, 'utf8').digest('hex');
  const [row] = await db.execute(sql`
    SELECT ak.organization_id
      FROM api_keys ak
      JOIN organizations o ON o.id = ak.organization_id
     WHERE ak.key_hash = ${hash}
       AND ak.revoked_at IS NULL
       AND o.status = 'active'
     LIMIT 1
  `) as unknown as { organization_id: string }[];
  return row?.organization_id ?? null;
}

export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    return jsonError('unauthorized', 'Missing or malformed authorization header.');
  }
  const key = auth.slice(7).trim();
  if (!key || !key.startsWith('zn-')) {
    return jsonError('unauthorized', 'Invalid key format.');
  }

  try {
    const orgId = await orgIdForKey(key);
    if (!orgId) {
      return jsonError('unauthorized', 'Key not found or organization inactive.');
    }

    const bundle = await subscriptionBundle(orgId);

    // Project only what the desktop agent needs. The full bundle contains
    // cost figures and internal state the device client should not see.
    // `remainingTokensByModel` lets the client block before spending
    // tokens it does not have.
    //
    // Same pure helpers the gateway wall uses (computeTokenAllowedModels),
    // so the number here and the 403 there cannot disagree. Clamped at 0 —
    // a negative remaining is still "stop". A missing limit = unlimited
    // (fail-open, see quota.ts).
    const tokenLimits = bundle.plan?.tokenLimits ?? {};
    const usedTokens = bundle.tokensByModel ?? {};
    const remainingTokens = computeRemainingTokens(tokenLimits, usedTokens);
    const entitled = bundle.plan?.models ?? [];
    const tokenExhausted = entitled.filter((a) => isTokenExhausted(a, tokenLimits, usedTokens));
    const resetDate = bundle.period?.end ?? bundle.subscription?.currentPeriodEnd ?? null;

    // Sync guard: when a `model` query names an exhausted alias, answer
    // 429 HERE rather than letting the client spend a call the gateway
    // wall will 403 a moment later.
    const url = new URL(request.url);
    const wanted = (url.searchParams.get('model') ?? '').trim().toLowerCase();
    if (wanted && tokenExhausted.includes(wanted)) {
      return Response.json(
        {
          error: {
            code: 'quota_exhausted',
            message: outOfTokensMessage(wanted, resetDate),
            model: wanted,
            exhaustedBy: 'tokens',
            remainingTokensByModel: remainingTokens,
            periodStart: bundle.period.start,
            periodEnd: bundle.period.end,
          },
        },
        { status: 429 },
      );
    }

    return Response.json({
      planCode: bundle.plan?.code ?? null,
      models: entitled,
      tokenLimits,
      tokensByModel: usedTokens,
      remainingTokensByModel: remainingTokens,
      tokenExhausted,
      exhaustedByModel: Object.fromEntries(
        entitled.map((a) => [a, tokenExhausted.includes(a) ? 'tokens' : null]),
      ),
      periodStart: bundle.period.start,
      periodEnd: bundle.period.end,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
