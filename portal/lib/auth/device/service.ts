/**
 * Device-code service — orchestration over the device store and the key
 * issuance path (store + gateway ports).
 *
 * Four properties are load-bearing:
 *
 *   1. SERVER-SIDE AUTHORIZATION ONLY. A code is issued anonymously, but it
 *      is useless until an Auth.js session approves it (verify), and the
 *      token is released only to whoever holds the unguessable device code
 *      (poll). Neither step leaks the key to the browser.
 *   2. ONE KEY PER DEVICE. Before minting, every previous device key for the
 *      organization is revoked upstream and locally — a device never holds
 *      two valid keys at once, and re-auth regenerates rather than replays.
 *   3. PLAINTEXT ONCE. The minted `zn-…` key travels to the app exactly
 *      once: held in `device_codes.key_plaintext` between approval and the
 *      first successful poll, nulled on consumption, never logged or listed.
 *   4. FAIL CLOSED. The gateway must validate the key at mint time (the same
 *      check the desktop repeats on restore); a gateway outage means no key,
 *      never a half-logged-in state.
 */

import { createHash } from 'node:crypto';
import {
  canCreateKey,
  assertModelsAllowed,
  buildKeyAlias,
  keyHashFor,
  keyLimitState,
  keyPrefixFor,
  mintKey,
} from '@/lib/keys/policy';
import { CUT_BUDGET } from '@/lib/entitlements/policy';
import { log } from '@/lib/log';
import { DeviceServiceError, type DeviceDeps, type DeviceTokenOutcome } from '@/lib/auth/device/types';
import { isCodeExpired, issueDeviceCode } from '@/lib/auth/device/policy';
import type { KeyGateway } from '@/lib/keys/types';
import type { OrgRole } from '@/db/schema';

export const DEVICE_KEY_NAME = 'OpenCode Desktop';
export const DEVICE_KEY_TTL_DAYS = 30;

function parseExpires(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ttlFromNow(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Mint (or rotate) a device-scoped gateway key for an organization.
 *
 * Called only from approveDeviceCode, after an Auth.js session and plan
 * eligibility have been established — the desktop app itself never calls
 * this.
 */
export async function issueDeviceKey(
  deps: { keys: DeviceDeps['keys']; gateway: DeviceDeps['gateway']; now(): Date },
  input: {
    organizationId: string;
    userId: string;
    models: string[];
  },
): Promise<{ keyId: string; plaintext: string; models: string[]; expiresAt: Date }> {
  const { keys, gateway } = deps;
  const now = deps.now();

  const org = await keys.orgWithTeam(input.organizationId);
  if (!org) {
    throw new DeviceServiceError('Organization not found.', 'not_found', 404);
  }
  if (!org.litellmTeamId) {
    throw new DeviceServiceError(
      'This organization is not connected to the gateway yet.',
      'upstream',
      502,
    );
  }

  const plan = await keys.planForOrg(input.organizationId);
  if (!plan) {
    throw new DeviceServiceError(
      'Choose a plan to sign in to Zaino Desktop.',
      'payment_required',
      402,
    );
  }
  if (plan.effect !== 'full') {
    throw new DeviceServiceError(
      'Your subscription is not active — sign in again after it is restored.',
      'payment_required',
      402,
    );
  }

  const models = assertModelsAllowed(input.models, plan.models);
  if (!models.ok) {
    throw new DeviceServiceError(models.error ?? 'Invalid models.', 'validation', 400);
  }

  // Rotate: revoke every previous device key for this organization first,
  // upstream and locally, so one device never holds two valid keys at once.
  const previous = (await keys.listActiveKeys(input.organizationId, 100)).filter(
    (row) => row.kind === 'device',
  );
  for (const previousKey of previous) {
    if (previousKey.litellmKeyHash) {
      try {
        await gateway.revoke(previousKey.litellmKeyHash);
      } catch (e) {
        log.error('device key: failed to revoke previous key upstream', {
          organizationId: input.organizationId,
          keyId: previousKey.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    try {
      await keys.markRevoked(previousKey.id, now);
    } catch (e) {
      log.error('device key: failed to mark previous key revoked', {
        organizationId: input.organizationId,
        keyId: previousKey.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const activeCount = await keys.countActiveKeys(input.organizationId);
  const limit = keyLimitState(activeCount, plan.maxKeys);
  if (!limit.canCreate) {
    throw new DeviceServiceError(limit.error ?? 'Key limit reached.', 'conflict', 409);
  }

  const pinnedUserId =
    (await keys.memberLiteLLMUserId(input.organizationId, input.userId)) ??
    `org-${org.slug}`;

  const { customerKey, gatewayKey } = mintKey();
  const keyAlias = buildKeyAlias({ orgSlug: org.slug, name: DEVICE_KEY_NAME });

  let issued;
  try {
    issued = await gateway.generate({
      key: gatewayKey,
      keyAlias,
      teamId: org.litellmTeamId,
      userId: pinnedUserId,
      models: models.models,
      maxBudgetUsd: plan.maxBudgetUsd > 0 ? plan.maxBudgetUsd : CUT_BUDGET,
      budgetDuration: plan.budgetDuration,
      // 0025: tokens (the model allowlist) are the ONLY request-blocking
      // control. rpm/tpm/concurrency are never pushed so nothing but token
      // exhaustion can block a request.
      rpmLimit: null,
      tpmLimit: null,
      maxParallelRequests: null,
      duration: '30d',
    });
  } catch (e) {
    log.error('device key: gateway refused issuance', {
      organizationId: input.organizationId,
      error: e instanceof Error ? e.message : String(e),
    });
    throw new DeviceServiceError(
      'The gateway could not issue a device key. Try again in a moment.',
      'upstream',
      502,
    );
  }

  // REFUSE unless the gateway stored exactly the body we chose (same
  // invariant as lib/keys/service.ts: a mismatched key is a dead key).
  if (issued.key !== gatewayKey) {
    try {
      await gateway.revoke(issued.token);
    } catch (cleanup) {
      log.error('device key: mismatch cleanup failed — MANUAL ACTION REQUIRED', {
        organizationId: input.organizationId,
        error: cleanup instanceof Error ? cleanup.message : String(cleanup),
      });
    }
    throw new DeviceServiceError(
      'The gateway issued an unexpected key, so it was revoked. Please try again.',
      'upstream',
      502,
    );
  }

  const expiresAt =
    issued.expires != null
      ? parseExpires(issued.expires) ?? ttlFromNow(now, DEVICE_KEY_TTL_DAYS)
      : ttlFromNow(now, DEVICE_KEY_TTL_DAYS);

  let row: { id: string };
  try {
    row = await keys.insertKey({
      organizationId: input.organizationId,
      createdBy: input.userId,
      name: DEVICE_KEY_NAME,
      keyPrefix: keyPrefixFor(customerKey),
      keyHash: keyHashFor(customerKey),
      litellmKeyName: issued.keyName,
      litellmKeyHash: issued.token,
      expiresAt,
      createdAt: now,
      kind: 'device',
    });
  } catch (e) {
    try {
      await gateway.revoke(issued.token);
    } catch (cleanup) {
      log.error('device key: orphan cleanup failed — MANUAL ACTION REQUIRED', {
        organizationId: input.organizationId,
        keyPrefix: keyPrefixFor(customerKey),
        error: cleanup instanceof Error ? cleanup.message : String(cleanup),
      });
    }
    throw new DeviceServiceError(
      'The device key could not be saved and has been revoked. Please try again.',
      'internal',
      500,
    );
  }

  await keys.appendAudit({
    actorId: input.userId,
    organizationId: input.organizationId,
    action: 'key.created',
    targetId: row.id,
    after: { name: DEVICE_KEY_NAME, models: models.models, kind: 'device' },
  });

  return { keyId: row.id, plaintext: customerKey, models: models.models, expiresAt };
}

/** Request a fresh device code. Returns the plaintext device code exactly once. */
export async function requestDeviceCode(
  deps: DeviceDeps,
  input: { now?: Date },
): Promise<{
  deviceCode: string;
  userCode: string;
  deviceCodeHash: string;
  expiresAt: Date;
  intervalSeconds: number;
}> {
  const now = input.now ?? new Date();
  const issuance = issueDeviceCode(now);
  await deps.store.insert({
    deviceCodeHash: issuance.deviceCodeHash,
    userCode: issuance.userCode,
    expiresAt: issuance.expiresAt,
    intervalSeconds: issuance.intervalSeconds,
  });
  return issuance;
}

/**
 * Approve a pending user code. Requires an Auth.js session (the actor) and
 * an eligible organization — the server decides, the browser merely asks.
 */
export async function approveDeviceCode(
  deps: DeviceDeps,
  input: {
    userCode: string;
    actorUserId: string;
    organizationId: string;
    role: OrgRole;
  },
): Promise<{ userCode: string; approved: boolean }> {
  if (!canCreateKey(input.role)) {
    throw new DeviceServiceError(
      'Your role cannot create API keys.',
      'forbidden',
      403,
    );
  }

  const code = await deps.store.findByUserCode(input.userCode);
  if (!code) {
    throw new DeviceServiceError('Unknown sign-in code.', 'validation', 400);
  }
  // Idempotent approval: if the code was already approved or consumed (e.g.
  // by a duplicate click, a retried request, or an account switch where the
  // previous account already collected the key), return success instead of
  // 409. The desktop app's poll collects the key exactly once because
  // consume() nulls the plaintext after the first successful poll; a second
  // approval for the same code cannot mint a second key.
  if (code.status === 'approved' || code.status === 'consumed') {
    return { userCode: input.userCode, approved: true };
  }
  if (code.status === 'expired') {
    throw new DeviceServiceError(
      'This sign-in code has expired — start a new sign-in on the desktop.',
      'expired',
      400,
    );
  }
  if (code.status !== 'pending') {
    throw new DeviceServiceError(
      `This sign-in code is already ${code.status}.`,
      'conflict',
      409,
    );
  }
  if (isCodeExpired(code, deps.now())) {
    await deps.store.consume(code.id, deps.now());
    throw new DeviceServiceError(
      'This sign-in code has expired — start a new sign-in on the desktop.',
      'expired',
      400,
    );
  }

  const plan = await deps.keys.planForOrg(input.organizationId);
  if (!plan || plan.effect !== 'full') {
    throw new DeviceServiceError(
      'Your subscription is not active — device sign-in requires an active plan.',
      'payment_required',
      402,
    );
  }

  const issued = await issueDeviceKey(
    { keys: deps.keys, gateway: deps.gateway, now: deps.now },
    {
      organizationId: input.organizationId,
      userId: input.actorUserId,
      models: plan.models,
    },
  );

  await deps.store.approve({
    id: code.id,
    userId: input.actorUserId,
    organizationId: input.organizationId,
    keyId: issued.keyId,
    keyPlaintext: issued.plaintext,
    at: deps.now(),
  });
  await deps.store.updateModels(code.id, issued.models);

  return { userCode: input.userCode, approved: true };
}

/**
 * Poll for a token. The device code authenticates the app — no session is
 * involved here, which is why the code itself must stay unguessable and
 * single-use.
 *
 * Returns `{ kind: 'granted', ... }` with the one-time key plaintext on
 * approval, or `{ kind: 'pending' }` while the user has not approved yet.
 * Expired / consumed / revoked codes throw a DeviceServiceError the route
 * maps to an OAuth-device-flow error code.
 */
export async function pollDeviceToken(
  deps: DeviceDeps,
  input: { deviceCode: string; now?: Date },
): Promise<DeviceTokenOutcome> {
  const now = input.now ?? new Date();
  const deviceCodeHash = createHash('sha256')
    .update(input.deviceCode, 'utf8')
    .digest('hex');

  await deps.store.expirePending(); // sweep: pending codes past their TTL

  const found = await deps.store.findByDeviceCodeHash(deviceCodeHash);
  if (!found) {
    throw new DeviceServiceError('Unknown device code.', 'validation', 400);
  }
  const code = found;

  if (code.status === 'expired') {
    throw new DeviceServiceError(
      'This sign-in code has expired — start a new sign-in on the desktop.',
      'expired',
      400,
    );
  }
  if (code.status === 'consumed') {
    throw new DeviceServiceError(
      'This sign-in code was already used — start a new sign-in on the desktop.',
      'invalid_grant',
      400,
    );
  }
  if (code.status === 'revoked') {
    throw new DeviceServiceError(
      'This sign-in code was revoked — start a new sign-in on the desktop.',
      'access_denied',
      400,
    );
  }

  if (code.status !== 'approved' && code.status !== 'pending') {
    // expirePending() should have swept this already — fail closed.
    throw new DeviceServiceError(
      'This sign-in code has expired — start a new sign-in on the desktop.',
      'expired',
      400,
    );
  }

  // code.status === 'approved' — release the one-time key plaintext exactly
  // once, then null it so a replayed poll can never collect it again.
  if (code.status === 'approved') {
    if (code.keyPlaintext == null) {
      throw new DeviceServiceError(
        'This sign-in code has no key to collect — start a new sign-in.',
        'internal',
        500,
      );
    }
    await deps.store.consume(code.id, now);
    return {
      kind: 'granted',
      token: code.keyPlaintext,
      models: code.models,
      user: {
        id: code.userId ?? '',
        email: code.userEmail ?? '',
        name: code.userName ?? null,
      },
      organization: {
        id: code.organizationId ?? '',
        slug: code.organizationSlug ?? '',
        name: code.organizationName ?? '',
      },
    };
  }

  // code.status === 'pending'
  if (isCodeExpired(code, now)) {
    await deps.store.consume(code.id, now);
    throw new DeviceServiceError(
      'This sign-in code has expired — start a new sign-in on the desktop.',
      'expired',
      400,
    );
  }

  // Enforce the server interval: polling faster than `interval` gets slow_down.
  const lastPolledAt = code.lastPolledAt;
  if (lastPolledAt != null) {
    const elapsed = (now.getTime() - lastPolledAt.getTime()) / 1000;
    if (elapsed < code.intervalSeconds) {
      throw new DeviceServiceError(
        'Polling too fast — wait longer between attempts.',
        'slow_down',
        400,
      );
    }
  }
  await deps.store.touchPolledAt(code.id, now);

  return {
    kind: 'pending',
    intervalSeconds: code.intervalSeconds,
    expiresInSeconds: code.expiresAt
      ? Math.max(0, (code.expiresAt.getTime() - now.getTime()) / 1000)
      : 0,
  };
}


