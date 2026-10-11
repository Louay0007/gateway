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

  async revoke(keyName: string): Promise<void> {
    // LiteLLM soft-deletes, so usage history attached to the key survives
    // the revoke — which is exactly what `usage_records.api_key_id`
    // (ON DELETE SET NULL) is designed for.
    await deleteKey(keyName);
  },

  async info(keyName: string) {
    const info = await getKeyInfo(keyName);
    return {
      lastUsed: info.last_used ?? null,
      models: info.models ?? [],
    };
  },
};
