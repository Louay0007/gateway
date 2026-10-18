/**
 * Key service — orchestration over the store and gateway ports.
 *
 * Four properties are load-bearing, and each one exists because of a
 * specific way this feature can go wrong:
 *
 *   1. PLAINTEXT ONCE. The gateway's `key` string is returned to the
 *      caller of createApiKey() and then never persisted, logged, or
 *      audited. Only sha256(key) and key.slice(0,12) are stored. If the
 *      caller drops the value, the key is gone — that is the intended
 *      trade (the customer can always mint another) and the reason the
 *      UI shouts about it.
 *
 *   2. NO ORPHANS. LiteLLM issues the key before we have a row to point
 *      at it. If the insert then fails, the gateway still holds a live,
 *      unmetered-by-us credential. createApiKey() revokes it before
 *      rethrowing. An unmetered key is a billing hole, not a cosmetic bug.
 *
 *   3. REVOKE IS UPSTREAM-FIRST. The portal's row is marked revoked only
 *      after LiteLLM confirms the delete. Marking first would produce a
 *      key that reads as dead in the dashboard and still spends money.
 *
 *   4. ZERO IS NEVER A LIMIT. A key's max_budget of 0 means UNLIMITED in
 *      LiteLLM's limiter (BLUEPRINT.md §9.4). planForOrg() already
 *      resolves that, and createApiKey() re-asserts it before the call.
 *
 * Every permission check runs here, not in the page. The dashboard hides
 * buttons; this refuses them.
 */

import {
  assertModelsAllowed,
  buildKeyAlias,
  canCreateKey,
  canRevokeKey,
  keyHashFor,
  keyLimitState,
  keyPrefixFor,
  mintKey,
} from '@/lib/keys/policy';
import { CUT_BUDGET } from '@/lib/entitlements/policy';
import { KeyServiceError, type CreateKeyInput, type CreateKeyResult, type KeyDeps, type KeyView, type ListKeysInput, type RevokeKeyInput, type RevokeKeyResult } from '@/lib/keys/types';
import { log } from '@/lib/log';

/** Cap on rows returned to the dashboard. A plan may allow 100 keys; no
 *  page needs every one of them at once. */
const LIST_LIMIT = 100;

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/** LiteLLM returns an ISO string or null depending on the key's duration. */
function parseExpires(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Mint a key.
 *
 * Order: permissions → org → plan → model allowlist → key ceiling →
 * gateway issue → persist → audit. Every check that can reject the
 * request happens BEFORE a credential exists upstream, so a rejected
 * create leaves nothing behind to clean up.
 */
export async function createApiKey(
  input: CreateKeyInput,
  deps: KeyDeps,
): Promise<CreateKeyResult> {
  const { store, gateway } = deps;

  // IMPLEMENTATION.md §1.2: developer and above. viewer/billing never.
  if (!canCreateKey(input.role)) {
    throw new KeyServiceError(
      'Your role cannot create API keys.',
      'forbidden',
      403,
    );
  }

  const org = await store.orgWithTeam(input.organizationId);
  if (!org) {
    throw new KeyServiceError('Organization not found.', 'not_found', 404);
  }
  if (!org.litellmTeamId) {
    // Provisioning created the org but the gateway team never attached.
    // Creating a key here would mint one outside every limit we enforce.
    throw new KeyServiceError(
      'This organization is not connected to the gateway yet.',
      'upstream',
      502,
    );
  }

  const plan = await store.planForOrg(input.organizationId);
  if (!plan) {
    // No live subscription resolves to no plan — that is the paywall,
    // not a server fault. With no free tier a brand-new account lands
    // here until it subscribes (lib/billing), and the dashboard sends
    // the user to plan selection from this exact response.
    throw new KeyServiceError(
      'Choose a plan to create API keys.',
      'payment_required',
      402,
    );
  }

  const models = assertModelsAllowed(input.models, plan.models);
  if (!models.ok) {
    throw new KeyServiceError(models.error ?? 'Invalid models.', 'validation', 400);
  }

  const activeCount = await store.countActiveKeys(input.organizationId);
  const limit = keyLimitState(activeCount, plan.maxKeys);
  if (!limit.canCreate) {
    throw new KeyServiceError(limit.error ?? 'Key limit reached.', 'conflict', 409);
  }

  // Re-assert the "0 means unlimited" rule at the last possible moment.
  // planForOrg() resolves it once; this guards the value that actually
  // crosses the wire to LiteLLM.
  const maxBudgetUsd = plan.maxBudgetUsd > 0 ? plan.maxBudgetUsd : CUT_BUDGET;

  // Pin the LiteLLM user_id at creation. Without it, a client can move its
  // spend to an arbitrary end_user_id in the request body and our
  // per-member attribution disappears. Prefer the member's provisioned id;
  // otherwise pin to the org so every key in an org shares one identity.
  const pinnedUserId =
    (await store.memberLiteLLMUserId(input.organizationId, input.userId)) ??
    `org-${org.slug}`;

  const keyAlias = buildKeyAlias({ orgSlug: org.slug, name: input.name });

  // ONE random body, two prefixes. `customerKey` is what the person pastes
  // into their app; `gatewayKey` is what LiteLLM stores. The auth edge turns
  // the leading `zn-` back into `sk-` on the way in, so the secret half is
  // identical in both and no second credential exists.
  const { customerKey, gatewayKey } = mintKey();

  let issued;
  try {
    issued = await gateway.generate({
      key: gatewayKey,
      keyAlias,
      teamId: org.litellmTeamId,
      userId: pinnedUserId,
      models: models.models,
      maxBudgetUsd,
      budgetDuration: plan.budgetDuration,
      rpmLimit: plan.rpm,
      tpmLimit: plan.tpm,
      maxParallelRequests: plan.concurrency,
    });
  } catch (e) {
    log.error('key create: gateway refused', {
      organizationId: input.organizationId,
      error: e instanceof Error ? e.message : String(e),
    });
    throw new KeyServiceError(
      'The gateway could not issue a key. Try again in a moment.',
      'upstream',
      502,
    );
  }

  const keyPrefix = keyPrefixFor(customerKey);

  // REFUSE unless the gateway stored exactly the body we chose.
  //
  // `customerKey` is only usable because it differs from the stored
  // credential by its prefix. If LiteLLM ever ignored our `key` and
  // auto-generated one, the `zn-` key we are about to display would not
  // match the stored credential and would fail on the customer's first
  // request — a dead key that looks perfect on screen. Failing here, loudly,
  // is the only safe outcome. Revoke first so nothing is orphaned.
  if (issued.key !== gatewayKey) {
    try {
      await gateway.revoke(issued.token);
    } catch (cleanup) {
      log.error('key create: mismatch cleanup failed — MANUAL ACTION REQUIRED', {
        organizationId: input.organizationId,
        error: cleanup instanceof Error ? cleanup.message : String(cleanup),
      });
    }
    log.error('key create: gateway stored a different key than requested', {
      organizationId: input.organizationId,
    });
    throw new KeyServiceError(
      'The gateway issued an unexpected key, so it was revoked. Please try again.',
      'upstream',
      502,
    );
  }

  let row: { id: string };
  try {
    row = await store.insertKey({
      organizationId: input.organizationId,
      createdBy: input.userId,
      name: input.name,
      keyPrefix,
      // The hash identifies the credential the CUSTOMER holds, which is the
      // `zn-` form and the one `keyPrefix` is derived from.
      keyHash: keyHashFor(customerKey),
      litellmKeyName: issued.keyName,
      litellmKeyHash: issued.token,
      expiresAt: parseExpires(issued.expires),
      createdAt: new Date(),
      kind: 'personal',
    });
  } catch (e) {
    // The credential exists upstream with nothing local describing it.
    // Revoke before surfacing the failure.
    try {
      // The token id, not the display mask — this cleanup path must
      // actually delete the orphaned credential.
      await gateway.revoke(issued.token);
    } catch (cleanup) {
      log.error('key create: orphan cleanup failed — MANUAL ACTION REQUIRED', {
        organizationId: input.organizationId,
        keyPrefix,
        error: cleanup instanceof Error ? cleanup.message : String(cleanup),
      });
    }
    log.error('key create: store insert failed', {
      organizationId: input.organizationId,
      error: e instanceof Error ? e.message : String(e),
    });
    throw new KeyServiceError(
      'The key could not be saved and has been revoked. Please try again.',
      'internal',
      500,
    );
  }

  const view: KeyView = {
    id: row.id,
    name: input.name,
    keyPrefix,
    models: models.models,
    createdBy: input.userId,
    isOwn: true,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  };

  await store.appendAudit({
    actorId: input.userId,
    organizationId: input.organizationId,
    action: 'key.created',
    targetId: row.id,
    // No plaintext, no hash — the audit log is read by staff (A-11) and
    // must not become a place key material accumulates.
    after: { name: input.name, models: models.models, keyPrefix, plan: plan.planCode },
  });

  // `customerKey`, never `issued.key`: the customer must never see the
  // gateway's `sk-` form, and the two are verified identical below the prefix.
  return { key: view, plaintext: customerKey };
}

/**
 * Revoke a key.
 *
 * The gateway call is the commit point. If it fails we throw and leave
 * the row active: a key the dashboard calls "live" and that actually is
 * live is recoverable, whereas the inverse — "revoked" in the portal,
 * still spending upstream — is invisible until it costs real money.
 */
export async function revokeApiKey(
  input: RevokeKeyInput,
  deps: KeyDeps,
): Promise<RevokeKeyResult> {
  const { store, gateway } = deps;

  const key = await store.findKey(input.organizationId, input.keyId);
  if (!key) {
    // 404 rather than 403: a key in another org must be indistinguishable
    // from one that does not exist.
    throw new KeyServiceError('Key not found.', 'not_found', 404);
  }
  if (key.revokedAt) {
    throw new KeyServiceError('This key is already revoked.', 'conflict', 409);
  }

  const isOwn = key.createdBy === input.userId;
  if (!canRevokeKey(input.role, isOwn)) {
    throw new KeyServiceError(
      'Your role cannot revoke this key.',
      'forbidden',
      403,
    );
  }

  if (!key.litellmKeyHash) {
    // A row without the gateway token id cannot be revoked upstream. Fail
    // loudly rather than flipping local state to a lie.
    throw new KeyServiceError(
      'This key is not registered with the gateway and cannot be revoked automatically.',
      'internal',
      500,
    );
  }

  try {
    // The token id, never the display mask: /key/delete answers 404 to
    // "sk-...w9Sg", which is how this call used to fail.
    await gateway.revoke(key.litellmKeyHash);
  } catch (e) {
    log.error('key revoke: gateway refused', {
      organizationId: input.organizationId,
      keyId: key.id,
      error: e instanceof Error ? e.message : String(e),
    });
    throw new KeyServiceError(
      'The gateway could not revoke this key. It is still active — try again.',
      'upstream',
      502,
    );
  }

  const at = new Date();
  await store.markRevoked(key.id, at);

  await store.appendAudit({
    actorId: input.userId,
    organizationId: input.organizationId,
    action: 'key.revoked',
    targetId: key.id,
    after: { name: key.name, keyPrefix: key.keyPrefix },
  });

  return { id: key.id, revokedAt: at.toISOString() };
}

/**
 * Active keys for the dashboard.
 *
 * `lastUsedAt` and the model allowlist come from the gateway, not from
 * our columns: only LiteLLM sees the request that uses a key. They are
 * best-effort — a gateway hiccup degrades one column to "unknown" rather
 * than failing the page.
 */
export async function listApiKeys(
  input: ListKeysInput,
  deps: KeyDeps,
): Promise<{ keys: KeyView[] }> {
  const rows = await deps.store.listActiveKeys(input.organizationId, LIST_LIMIT);

  // Enrich keys concurrently rather than sequentially. An org near the
  // 100-key limit would otherwise make 100 serial HTTP roundtrips to the
  // gateway, turning a dashboard load into a multi-second stall.
  // allSettled keeps the list renderable even when individual lookups fail.
  const enrichments = await Promise.allSettled(
    rows.map((row) =>
      row.litellmKeyHash ? deps.gateway.info(row.litellmKeyHash) : null,
    ),
  );

  const keys: KeyView[] = rows.map((row, i) => {
    let models: string[] | null = null;
    let lastUsedAt = toIso(row.lastUsedAt);

    const result = enrichments[i];
    if (result?.status === 'fulfilled' && result.value) {
      const info = result.value;
      if (info.models.length) models = info.models;
      lastUsedAt = info.lastUsed ?? lastUsedAt;
    }

    return {
      id: row.id,
      name: row.name,
      keyPrefix: row.keyPrefix,
      models,
      createdBy: row.createdBy,
      isOwn: row.createdBy === input.userId,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt,
      revokedAt: null,
    };
  });

  return { keys };
}
