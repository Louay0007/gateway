/**
 * The org's chat credential — one long-lived LiteLLM key per organization.
 *
 * WHY A KEY OF OUR OWN. The browser must never hold a credential, and a
 * customer's `zn-` key is a developer credential: they rotate it, revoke
 * it, and paste it into scripts. A chat product whose every page breaks
 * when a customer rotates their API key is two products sharing a secret.
 *
 * WHY ONE PER ORG, NOT PER USER. Spend attribution by member already
 * travels on the request (`user_id` is pinned, like every key we mint),
 * so per-user keys would only multiply churn.
 *
 * WHY NOT `createApiKey()`. Three of its rules are wrong here and one is
 * dangerous: it enforces the caller's ROLE (a `viewer` may still chat), it
 * returns the plaintext for one-time display (nothing may ever display
 * this), and it enforces `maxKeys` — which reused unchanged would let a
 * chat turn silently eat one of a Starter customer's three slots. The
 * symptom ("I have 2 keys but it says I'm at the limit") is
 * indistinguishable from a UI bug, so `countActiveKeys` excludes
 * `kind='chat'` as well: either guard alone is a single point of failure.
 *
 * The api_keys row is still written, because `collect_usage` attributes a
 * spend row to a key by matching `litellm_key_hash`; without it every chat
 * turn would land in the ledger with `api_key_id = NULL`.
 *
 * THE ALLOWLIST IS NOT MAINTAINED HERE. A key's `models` is owned by
 * `syncOrganizationEntitlements` (plan changes) and `enforcePromptLimits`
 * (every 5 minutes, walking the team's keys). This file writes it once at
 * birth and never again — a second writer is a second source of truth.
 */

import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { generateKey, deleteKey } from '@/lib/litellm/client';
import { buildKeyAlias, keyHashFor, keyPrefixFor, mintKey } from '@/lib/keys/policy';
import { seal, open } from '@/lib/crypto/sealed';
import { log } from '@/lib/log';

/** Everything the chat path is allowed to know about a credential. */
export interface ChatCredential {
  /** The `sk-` plaintext. Never leaves the server, never logged. */
  gatewayKey: string;
  /** LiteLLM's token id — the identifier its key routes accept. */
  keyToken: string;
}

export class ChatKeyError extends Error {
  constructor(
    message: string,
    readonly code: 'payment_required' | 'upstream' | 'internal' = 'internal',
  ) {
    super(message);
    this.name = 'ChatKeyError';
  }
}

/**
 * Get the org's chat key, creating it on first use.
 *
 * `models` must be the live `getAllowedModels().entitled` list, not a
 * constant: the key's allowlist is a second wall, and freezing a plan's
 * models at creation time is how an upgraded customer ends up unable to
 * use the tier they just paid for.
 */
export async function getChatCredential(input: {
  organizationId: string;
  userId: string;
  models: string[];
}): Promise<ChatCredential> {
  if (input.models.length === 0) {
    throw new ChatKeyError('Choose a plan to start chatting.', 'payment_required');
  }

  const existing = await readCredential(input.organizationId);
  if (existing) return existing;

  return createCredential(input);
}

/** Read + decrypt, or null when there is no usable row. */
async function readCredential(organizationId: string): Promise<ChatCredential | null> {
  const rows = (await db.execute(sql`
    SELECT c.litellm_key_hash, c.key_ciphertext, k.id AS key_id
      FROM chat_credentials c
      LEFT JOIN api_keys k
        ON k.organization_id = c.organization_id
       AND k.litellm_key_hash  = c.litellm_key_hash
       AND k.revoked_at IS NULL
     WHERE c.organization_id = ${organizationId}::uuid
     LIMIT 1
  `)) as unknown as {
    litellm_key_hash: string;
    key_ciphertext: Buffer;
    key_id: string | null;
  }[];

  const row = rows[0];
  // No row, or a row whose api_keys twin is revoked (so the gateway no
  // longer accepts it): either way, mint a fresh one.
  if (!row?.key_id) return null;

  try {
    return { gatewayKey: open(row.key_ciphertext), keyToken: row.litellm_key_hash };
  } catch (e) {
    // CHAT_KEY_SECRET rotated, or the row was tampered with. SealedError
    // is deliberately opaque; without this log the operator sees a 500 on
    // every chat turn with no clue that a secret changed.
    log.error('chat key: could not decrypt stored credential', {
      organizationId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

async function createCredential(input: {
  organizationId: string;
  userId: string;
  models: string[];
}): Promise<ChatCredential> {
  const orgRows = (await db.execute(sql`
    SELECT slug, litellm_team_id FROM organizations
     WHERE id = ${input.organizationId}::uuid AND status = 'active'
     LIMIT 1
  `)) as unknown as { slug: string; litellm_team_id: string | null }[];

  const org = orgRows[0];
  if (!org) throw new ChatKeyError('Organization not found.');
  if (!org.litellm_team_id) {
    // Provisioning created the org but the team never attached. Minting
    // here would produce a key outside every limit we enforce.
    throw new ChatKeyError('This organization is not connected to the gateway yet.', 'upstream');
  }

  // Whatever row is being replaced. `getChatCredential` only reaches here
  // when there is no USABLE credential, which includes the case where a row
  // exists but its api_keys twin is revoked or its ciphertext will not open.
  // In both, the gateway may still be holding a live key we can no longer
  // present — revoke it AFTER the new one is stored, so a failure here
  // never leaves the org with no credential at all.
  const superseded = await supersededToken(input.organizationId);

  const { gatewayKey } = mintKey();

  let issued;
  try {
    issued = await generateKey({
      key: gatewayKey,
      keyAlias: buildKeyAlias({ orgSlug: org.slug, name: 'chat' }),
      teamId: org.litellm_team_id,
      userId: await pinnedUserId(input.organizationId, input.userId, org.slug),
      models: input.models,
      // $10,000 upstream, NOT CUT_BUDGET. CUT_BUDGET is the KILL value
      // (0.000001, lib/entitlements/policy.ts) — a key minted with it can
      // not spend a single token, so the first message of every org would
      // 402 at the gateway while our own wall said it was allowed. Tokens
      // are the only quota (0023); this budget is a catastrophe stop that
      // must never trigger first. Must also never be 0: LiteLLM reads a
      // zero budget as UNLIMITED.
      maxBudgetUsd: 10000,
      budgetDuration: '30d',
      // 0025: tokens are the only request-blocking control on a key.
      rpmLimit: null,
      tpmLimit: null,
      maxParallelRequests: null,
    });
  } catch (e) {
    log.error('chat key: gateway refused', {
      organizationId: input.organizationId,
      error: e instanceof Error ? e.message : String(e),
    });
    throw new ChatKeyError('The gateway could not start a chat. Try again in a moment.', 'upstream');
  }

  try {
    await db.transaction(async (tx) => {
      // Retire any previous chat row FIRST, or a re-mint accumulates one
      // unrevoked `kind='chat'` row per rotation. They cost no key slot
      // (countActiveKeys excludes the kind) but they do show up in every
      // admin `key_count`, and a table of live credentials that no longer
      // exist at the gateway is exactly the kind of drift that makes an
      // operator distrust the console.
      await tx.execute(sql`
        UPDATE api_keys
           SET revoked_at = now()
         WHERE organization_id = ${input.organizationId}::uuid
           AND kind            = 'chat'
           AND revoked_at IS NULL
      `);

      await tx.execute(sql`
        INSERT INTO api_keys (
          organization_id, created_by, name, key_prefix, key_hash,
          litellm_key_name, litellm_key_hash, kind
        ) VALUES (
          ${input.organizationId}::uuid, ${input.userId}::uuid, 'Chat',
          ${keyPrefixFor(gatewayKey)}, ${keyHashFor(gatewayKey)},
          ${issued.key_name}, ${issued.token}, 'chat'
        )
      `);

      await tx.execute(sql`
        INSERT INTO chat_credentials (
          organization_id, litellm_key_hash, litellm_key_name, key_ciphertext, models
        ) VALUES (
          ${input.organizationId}::uuid, ${issued.token}, ${issued.key_name},
          ${seal(gatewayKey)}, ${sql.raw(textArray(input.models))}
        )
        ON CONFLICT (organization_id) DO UPDATE SET
          litellm_key_hash = EXCLUDED.litellm_key_hash,
          litellm_key_name = EXCLUDED.litellm_key_name,
          key_ciphertext   = EXCLUDED.key_ciphertext,
          models           = EXCLUDED.models,
          rotated_at       = now()
      `);
    });
  } catch (e) {
    // The gateway already stored a live key. Leaving it orphaned would be
    // an unmetered-by-us credential, so revoke it before throwing.
    log.error('chat key: persist failed, revoking at the gateway', {
      organizationId: input.organizationId,
      error: e instanceof Error ? e.message : String(e),
    });
    await deleteKey(issued.token).catch(() => {
      // Best effort: the original error is the one worth reporting, and
      // the orphan is bounded by the budget and by the team allowlist.
    });
    throw new ChatKeyError('The gateway could not start a chat. Try again in a moment.', 'upstream');
  }

  // The new credential is safely stored. Now drop the old one at the
  // gateway, or it stays live with a $10,000 budget and full model access
  // forever — the precise thing a re-mint is supposed to end. Best effort:
  // a failure here is an orphaned key bounded by the team allowlist, and
  // throwing would fail a chat turn the user has no way to fix.
  if (superseded && superseded !== issued.token) {
    await deleteKey(superseded).catch((e: unknown) => {
      log.error('chat key: could not revoke superseded key', {
        organizationId: input.organizationId,
        error: e instanceof Error ? e.message : String(e),
      });
    });
  }

  return { gatewayKey, keyToken: issued.token };
}

/**
 * Retire the stored credential after the gateway rejects it with 401.
 *
 * Revoking the `api_keys` twin is what makes `readCredential` return null
 * on the next call, which is the existing re-mint path — no second writer,
 * no duplicated mint logic. The sealed row is left alone: `createCredential`
 * overwrites it and its `rotated_at` records the rotation.
 *
 * Returns the token id that was revoked, or null when there was nothing
 * usable to revoke (the caller then knows a retry cannot help).
 */
export async function retireCredential(organizationId: string): Promise<string | null> {
  const rows = (await db.execute(sql`
    UPDATE api_keys k
       SET revoked_at = now()
      FROM chat_credentials c
     WHERE c.organization_id = ${organizationId}::uuid
       AND k.organization_id = c.organization_id
       AND k.litellm_key_hash = c.litellm_key_hash
       AND k.revoked_at IS NULL
    RETURNING k.litellm_key_hash
  `)) as unknown as { litellm_key_hash: string }[];

  const token = rows[0]?.litellm_key_hash ?? null;
  if (token) {
    log.warn('chat key: retired after the gateway rejected it', { organizationId });
  }
  return token;
}

/**
 * The token id of the credential row this org is replacing, if any.
 *
 * Read only for cleanup — the row's plaintext may be unopenable or its
 * `api_keys` twin revoked, and both are exactly the cases that lead to a
 * re-mint. `null` when there is nothing to revoke.
 */
async function supersededToken(organizationId: string): Promise<string | null> {
  const rows = (await db.execute(sql`
    SELECT litellm_key_hash FROM chat_credentials
     WHERE organization_id = ${organizationId}::uuid
     LIMIT 1
  `)) as unknown as { litellm_key_hash: string }[];
  return rows[0]?.litellm_key_hash ?? null;
}

/**
 * The LiteLLM `user_id` to pin. Without a pin a client can move its spend
 * onto an arbitrary end user and per-member attribution disappears.
 * Prefers the member's provisioned id, then the org — the same fallback
 * `createApiKey` uses, so both key types attribute alike.
 */
async function pinnedUserId(
  organizationId: string,
  userId: string,
  orgSlug: string,
): Promise<string> {
  const rows = (await db.execute(sql`
    SELECT litellm_user_id FROM organization_members
     WHERE organization_id = ${organizationId}::uuid
       AND user_id = ${userId}::uuid
     LIMIT 1
  `)) as unknown as { litellm_user_id: string | null }[];
  return rows[0]?.litellm_user_id ?? `org-${orgSlug}`;
}

/**
 * A `text[]` literal for a parameter position.
 *
 * THE QUOTES MUST BE SINGLE. In SQL, `"fast"` is an identifier — a column
 * reference — so `ARRAY["fast","smart"]::text[]` fails with
 * `column "fast" does not exist`. That is what this emitted before, and it
 * broke the FIRST chat turn of every new organization: the key is minted at
 * the gateway, the INSERT throws, the catch block revokes the key it just
 * created, and the user gets "The gateway could not complete the request"
 * on an otherwise healthy stack. A returning org never hit it, because
 * `readCredential` returns before this path runs.
 *
 * A quote inside the value is doubled, per the SQL standard, and a
 * backslash is escaped under Postgres's default
 * `standard_conforming_strings = on`. Aliases are `[a-z]` today; the
 * escaping is here because the values come from a plan row, not a constant.
 */
function textArray(values: string[]): string {
  const escaped = values.map((v) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`);
  return `ARRAY[${escaped.join(',')}]::text[]`;
}
