/**
 * LiteLLM REST client — the ONLY way the portal touches the gateway.
 *
 * PLATFORM.md §1.1: never write SQL against LiteLLM's database. Its schema
 * is an internal implementation detail that changes between releases.
 *
 * All calls hit 127.0.0.1. The management API is not reachable from the
 * public internet — see config/Caddyfile, `allowed_routes`, and the
 * IP-gated admin host.
 */

import { LITELLM_BASE } from '@/lib/litellm/endpoint';

/** Never log the master key. */
function authHeaders(): Record<string, string> {
  const key = process.env.LITELLM_MASTER_KEY;
  if (!key) throw new Error('LITELLM_MASTER_KEY is not set');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export class LiteLLMError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'LiteLLMError';
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${LITELLM_BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }

  if (!res.ok) {
    throw new LiteLLMError(
      `LiteLLM ${path} → ${res.status}`, res.status, body,
    );
  }
  return body as T;
}

// ─────────────────────────────────────────────────────────────────────
//  Organizations → LiteLLM teams
// ─────────────────────────────────────────────────────────────────────

export async function createTeam(input: {
  teamAlias: string;
  maxBudgetUsd: number | null;
  budgetDuration: string;
  models: string[];
}): Promise<{ team_id: string }> {
  return call('/team/new', {
    method: 'POST',
    body: JSON.stringify({
      team_alias:        input.teamAlias,
      max_budget:        input.maxBudgetUsd,
      budget_duration:   input.budgetDuration,
      models:            input.models,
      key_generation_policy: undefined,
    }),
  });
}

/**
 * Update team spend ceiling.
 *
 * CRITICAL: a budget of 0 means UNLIMITED in LiteLLM's limiter, not "deny".
 * To cut a customer's access, use CUT_BUDGET (a tiny non-zero value) or
 * revoke keys outright. Passing 0 here would silently grant unlimited access.
 * See PLATFORM.md §5.1.
 */
export async function updateTeamBudget(
  teamId: string,
  input: { maxBudgetUsd: number | null; budgetDuration?: string },
): Promise<void> {
  await call(`/team/update`, {
    method: 'POST',
    body: JSON.stringify({
      team_id:         teamId,
      max_budget:      input.maxBudgetUsd,
      budget_duration: input.budgetDuration,
    }),
  });
}

// ─────────────────────────────────────────────────────────────────────
//  API keys
// ─────────────────────────────────────────────────────────────────────

export interface KeyLimits {
  models?: string[];
  maxBudget?: number | null;
  budgetDuration?: string;
  rpmLimit?: number | null;
  tpmLimit?: number | null;
  maxParallelRequests?: number | null;
  duration?: string;
}

export interface IssuedKey {
  key: string;             // PLAINTEXT — return to the caller exactly once
  key_name: string;
  token: string;           // LiteLLM's internal token hash
  team_id?: string;
  expires?: string;
  max_budget?: number;
  budget_duration?: string;
  models?: string[];
}

export async function generateKey(input: {
  keyAlias: string;
  teamId: string;
  userId: string;          // pinned — see PLATFORM.md §5.1
  models: string[];
  maxBudgetUsd: number | null;
  budgetDuration: string;
  rpmLimit?: number | null;
  tpmLimit?: number | null;
  maxParallelRequests?: number | null;
  duration?: string;
}): Promise<IssuedKey> {
  const key = await call<IssuedKey>('/key/generate', {
    method: 'POST',
    body: JSON.stringify({
      key_alias:              input.keyAlias,
      team_id:                input.teamId,
      user_id:                input.userId,
      models:                 input.models,
      max_budget:             input.maxBudgetUsd,
      budget_duration:        input.budgetDuration,
      rpm_limit:              input.rpmLimit,
      tpm_limit:              input.tpmLimit,
      max_parallel_requests:  input.maxParallelRequests,
      duration:               input.duration,
      metadata:               { source: 'portal' },
    }),
  });

  if (!key.key || !key.token) {
    throw new LiteLLMError('key/generate returned no token', 500, key);
  }
  return key;
}

export async function updateKey(
  keyName: string,
  limits: KeyLimits,
): Promise<void> {
  await call('/key/update', {
    method: 'POST',
    body: JSON.stringify({
      key:                   keyName,
      models:                limits.models,
      max_budget:            limits.maxBudget,
      budget_duration:       limits.budgetDuration,
      rpm_limit:             limits.rpmLimit,
      tpm_limit:             limits.tpmLimit,
      max_parallel_requests: limits.maxParallelRequests,
    }),
  });
}

/**
 * Alias used by the entitlement sync, which speaks in the entitlement
 * vocabulary rather than the LiteLLM field names. Keeping the alias means
 * sync.ts never has to know that `maxBudgetUsd` is `max_budget`.
 */
export const updateKeyLimits = updateKey;

/**
 * Every key under a team.
 *
 * Entitlement sync must push to each key individually: a partial failure
 * that moved three of four keys leaves one key on the old plan, and the
 * customer keeps access they no longer pay for. See PLATFORM.md §5.
 */
export async function listTeamKeys(teamId: string): Promise<{ key_name: string }[]> {
  const raw = await call<{ keys?: { key_name?: string }[] }>(
    `/key/list?team_id=${encodeURIComponent(teamId)}`,
  );
  return (raw.keys ?? [])
    .map((k) => k.key_name)
    .filter((n): n is string => Boolean(n))
    .map((key_name) => ({ key_name }));
}

/** Update the team model allowlist. */
export async function updateTeamModels(teamId: string, models: string[]): Promise<void> {
  await call('/team/update', {
    method: 'POST',
    body: JSON.stringify({ team_id: teamId, models }),
  });
}

/** Rotate the team model allowlist while preserving spend. */
export async function updateTeam(teamId: string, input: {
  models?: string[];
  maxBudgetUsd?: number | null;
  budgetDuration?: string;
  teamAlias?: string;
}): Promise<void> {
  await call('/team/update', {
    method: 'POST',
    body: JSON.stringify({
      team_id: teamId,
      models: input.models,
      max_budget: input.maxBudgetUsd,
      budget_duration: input.budgetDuration,
      team_alias: input.teamAlias,
    }),
  });
}

/** Soft revoke — LiteLLM keeps the record so usage history survives. */
export async function deleteKey(keyName: string): Promise<void> {
  await call('/key/delete', {
    method: 'POST',
    body: JSON.stringify({ keys: [keyName] }),
  });
}

export async function getKeyInfo(keyName: string): Promise<{
  spend: number;
  max_budget: number | null;
  models?: string[];
  rpm_limit?: number;
  tpm_limit?: number;
  last_used?: string | null;
}> {
  return call(`/key/info?key=${encodeURIComponent(keyName)}`);
}

export async function getUserSpend(userId: string): Promise<{ spend: number }> {
  return call(`/user/info?user_id=${encodeURIComponent(userId)}`);
}

// ─────────────────────────────────────────────────────────────────────
//  Usage (read-only)
// ─────────────────────────────────────────────────────────────────────

export interface SpendLogRow {
  id?: string;
  startTime?: string;
  endTime?: string;
  model?: string;
  api_key?: string;
  user_id?: string;
  team_id?: string;
  spend?: number;
  request_id?: string;
  status?: string;
  endpoint?: string;
  model_info?: Record<string, unknown>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation?: {
      ephemeral_5m_input_tokens?: number;
      ephemeral_1h_input_tokens?: number;
    };
  };
  cache_hit_rate?: number;
  startTimeSeconds?: number;
}

/**
 * Spend logs for a window. The response shape varies by LiteLLM version
 * (bare array vs {data: []} vs {spend_logs: []}); normalise defensively.
 */
export async function getSpendLogs(input: {
  startDate: string;   // YYYY-MM-DD
  endDate: string;     // YYYY-MM-DD
  page?: number;
  pageSize?: number;
}): Promise<SpendLogRow[]> {
  const q = new URLSearchParams({
    start_date: input.startDate,
    end_date:   input.endDate,
    page:       String(input.page ?? 1),
    page_size:  String(input.pageSize ?? 500),
  });

  const raw = await call<SpendLogRow[] | { data?: SpendLogRow[]; spend_logs?: SpendLogRow[] }>(
    `/spend/logs/ui?${q}`,
  );

  if (Array.isArray(raw)) return raw;
  return raw.data ?? raw.spend_logs ?? [];
}

/**
 * Reconcile against the provider's own accounting (first-party Anthropic
 * keys only). A third-party reseller will not have this endpoint — and its
 * absence is itself a finding: you cannot independently verify a provider's
 * reporting. See BLUEPRINT.md §2.3.
 */
export async function getProviderUsage(input: {
  startingAt: string;  // ISO
  endingAt: string;
  bucketWidth?: '1m' | '1h' | '1d';
}): Promise<{ data: unknown[] } | null> {
  const base = process.env.UPSTREAM_BASE_URL ?? '';
  if (base !== 'https://api.anthropic.com') return null;

  const q = new URLSearchParams({
    starting_at:  input.startingAt,
    ending_at:    input.endingAt,
    bucket_width: input.bucketWidth ?? '1d',
  });

  const res = await fetch(`https://api.anthropic.com/v1/organizations/usage_report/messages?${q}`, {
    headers: {
      'x-api-key':           process.env.UPSTREAM_API_KEY ?? '',
      'anthropic-version':   '2023-06-01',
    },
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) return null;
  return res.json() as Promise<{ data: unknown[] }>;
}