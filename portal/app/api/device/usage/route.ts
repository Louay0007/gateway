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

import { subscriptionBundle } from '@/lib/billing';
import {
  remainingTokensByModel as computeRemainingTokens,
  isTokenExhausted,
  outOfTokensMessage,
} from '@/lib/entitlements/quota';
import { errorResponse, jsonError } from '@/lib/api/errors';
import { MINUTE, rateLimit } from '@/lib/api/ratelimit';
import { bearerKey, keyDigest, keyInfoFor } from '@/lib/device/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Per-key request ceiling.
 *
 * The desktop gate calls this before a prompt, so a chatty client could
 * drive it once per keystroke-send — and every call runs the whole
 * `subscriptionBundle` (plan lookup, entitlement query and two
 * `usage_records` aggregates over the day's window). That is the most
 * expensive read in the portal behind the least expensive credential to
 * obtain, so it is throttled per key rather than trusted.
 *
 * 60/min: a human cannot send faster, the client caches for 60 s anyway,
 * and a burst of a dozen parallel prompts still fits. Over the limit the
 * endpoint answers 429 with `rate_limited` — deliberately NOT the
 * `quota_exhausted` 429 shape, because a throttle is not exhaustion and the
 * desktop must not render "out of tokens" for it.
 */
const USAGE_MAX_PER_MINUTE = 60;

export async function GET(request: Request): Promise<Response> {
  const key = bearerKey(request);
  if (!key) {
    return jsonError('unauthorized', 'Missing or malformed authorization header.');
  }

  try {
    const info = await keyInfoFor(key);
    if (!info) {
      return jsonError('unauthorized', 'Key not found or organization inactive.');
    }
    const orgId = info.organizationId;

    // Throttle AFTER the key resolves: an unauthenticated caller must not be
    // able to fill the throttle table with junk buckets, and a real key is
    // the only thing worth metering. Bucketed by the key's digest so the
    // table holds no credential.
    const limit = await rateLimit(`device-usage:${keyDigest(key).slice(0, 32)}`, {
      max: USAGE_MAX_PER_MINUTE,
      windowMs: MINUTE,
    });
    if (!limit.allowed) {
      return jsonError('rate_limited', 'Too many usage checks. Retry in a moment.', {
        'retry-after': String(limit.retryAfterSeconds),
      });
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
      // G11: when the KEY dies, as distinct from when the allowance resets.
      // Both were `periodEnd` on the client, so a pasted key carried no
      // expiry and the app could only discover a lapsed key on a failed
      // prompt. Null = no expiry (an org key, or one minted before TTLs).
      keyExpiresAt: info.expiresAt,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
