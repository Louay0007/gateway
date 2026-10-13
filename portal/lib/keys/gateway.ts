/**
 * Production KeyGateway — the LiteLLM REST adapter.
 *
 * Deliberately thin: every policy decision lives in ./service.ts and
 * ./policy.ts, and every failure-to-decide lives in the service's error
 * mapping. This file translates our vocabulary into LiteLLM's field names
 * (`keyAlias` → `key_alias`) and nothing else, so there is exactly one
 * place to look when the gateway's API moves.
 */

import { deleteKey, generateKey, getKeyInfo } from '@/lib/litellm/client';
import type {
  GatewayGenerateInput,
  GatewayGenerateResult,
  KeyGateway,
} from '@/lib/keys/types';

export const gateway: KeyGateway = {
  async generate(input: GatewayGenerateInput): Promise<GatewayGenerateResult> {
    const issued = await generateKey({
      keyAlias: input.keyAlias,
      teamId: input.teamId,
      userId: input.userId,
      models: input.models,
      maxBudgetUsd: input.maxBudgetUsd,
      budgetDuration: input.budgetDuration,
      rpmLimit: input.rpmLimit,
      tpmLimit: input.tpmLimit,
      maxParallelRequests: input.maxParallelRequests,
    });

    return {
      key: issued.key,
      keyName: issued.key_name,
      token: issued.token,
      expires: issued.expires ?? null,
    };
  },

  /**
   * `token` is LiteLLM's token id (hash) — the only identifier its key
   * routes accept. The `key_name` that /key/generate returns is a display
   * mask ("sk-...w9Sg") and answers 404; see deleteKey() in client.ts.
   */
  async revoke(token: string): Promise<void> {
    // LiteLLM soft-deletes, so usage history attached to the key survives
    // the revoke — which is exactly what `usage_records.api_key_id`
    // (ON DELETE SET NULL) is designed for.
    await deleteKey(token);
  },

  async info(token: string) {
    const info = await getKeyInfo(token);
    return {
      // `last_active` is the field the gateway actually returns; there is
      // no `last_used` in the /key/info payload.
      lastUsed: info.last_active ?? null,
      models: info.models ?? [],
    };
  },
};
