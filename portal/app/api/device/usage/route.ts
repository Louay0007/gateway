/**
 * GET /api/device/usage — prompt-based quota for the desktop app.
 *
 * The desktop agent holds a `zn-` gateway key but no browser session, so
 * it cannot call /api/subscription (which requires requireActiveOrg).
 * This endpoint bridges that gap: authenticate by gateway key, resolve
 * the org from the key's LiteLLM team, and return the same prompt-limit
 * and prompt-usage data the dashboard shows.
 *
 * Auth flow:
 *   1. Bearer token → look up api_keys row by litellm_key_hash
 *   2. Join to organizations to get orgId
 *   3. Delegate to subscriptionBundle() for the canonical numbers
 *
 * Returns only what the desktop needs: plan code, models, prompt limits,
 * and per-model prompt counts for the current billing period. No PII,
 * no spend figures, no admin data.
 */

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { apiKeys, organizations } from '@/db/schema';
import { subscriptionBundle } from '@/lib/billing';
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

    // Project only what the desktop agent needs. Full bundle contains
    // cost figures and internal state the device client should not see.
    // `prompts` is the period total (all aliases); `remainingByModel` lets
    // the client block before spending a prompt it does not have.
    const limits = bundle.plan?.promptLimits ?? {};
    const used = bundle.promptsByModel ?? {};
    const remainingByModel: Record<string, number> = {};
    for (const [alias, limit] of Object.entries(limits)) {
      remainingByModel[alias] = Math.max(0, limit - (used[alias] ?? 0));
    }
    return Response.json({
      planCode: bundle.plan?.code ?? null,
      models: bundle.plan?.models ?? [],
      promptLimits: limits,
      promptsByModel: used,
      prompts: bundle.usage.prompts ?? 0,
      remainingByModel,
      periodStart: bundle.period.start,
      periodEnd: bundle.period.end,
    });
  } catch (e) {
    return errorResponse(e);
  }
}