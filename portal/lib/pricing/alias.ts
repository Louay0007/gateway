/**
 * Model → alias resolution.
 *
 * WHY. The customer-facing surface shows one name — `fast` — and never an
 * upstream model name. That is not cosmetic: a customer who learns
 * `nemotron-3.5-super-vl-120b-a12b` is on our `fast` tier can build against a
 * model we are free to swap tomorrow, and every later change becomes a
 * support conversation about breaking their integration.
 *
 * The mapping is declared in prices/models.yaml under `aliases:`, beside the
 * rates it travels with, rather than hardcoded here. That is deliberate — an
 * earlier hand-written map went stale the moment a model moved tiers, and the
 * failure was silent: the ledger wrote a resolved name into `usage_records`
 * and the dashboard faithfully rendered it.
 *
 * Reading from the price file also means this needs no new config mount:
 * `prices/` is already bind-mounted into both the portal and the jobs
 * container, while `config/` is not.
 */

import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

const PRICE_FILE = process.env.PRICE_FILE ?? 'prices/models.yaml';

/**
 * The aliases the gateway sells.
 *
 * Listing all three here is what makes a single `aliases:` registry entry
 * serve every tier. `toAlias` passes a value through unchanged when it is
 * already one of these, so the alias the client REQUESTED (`model_group`,
 * which `aliasForRow` prefers) survives end to end even though all three
 * resolve to one upstream model today. That is the mechanism — NOT three
 * rows in `prices/models.yaml`, which is a `model → alias` mapping and
 * cannot hold one key under three values.
 */
export const TIER_ALIASES = ['fast', 'smart', 'frontier'] as const;
export type TierAlias = (typeof TIER_ALIASES)[number];

/** model → alias, exactly as declared under `aliases:`. */
export type AliasMap = Record<string, string>;

/**
 * A value we are willing to display when it is NOT in the alias map.
 *
 * The alternative — rendering whatever arrived — is how an upstream model
 * name ends up on a customer's screen. An unmapped model means a deploy
 * forgot to register a model in `aliases:`, and this is what it looks like
 * instead. `verify-metering` and the pricing-consistency test both fail on an
 * unregistered model, so reaching this in practice means the row predates the
 * registry and has not been backfilled.
 */
export const UNKNOWN_ALIAS = 'unknown';

/**
 * Normalise whatever the gateway reported into a bare model name.
 *
 * The gateway is inconsistent about this and all three forms occur:
 *   `openai/space-bunny`       — provider-qualified (LiteLLM's own form)
 *   `space-bunny-free`         — what the UPSTREAM echoes back in its payload
 *   `space-bunny`              — bare
 */
export function bareModelName(model: string): string {
  const bare = model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model;
  // Strip a trailing `-free` / `:free` the upstream appends to its own ids.
  return bare.replace(/-free$/, '').replace(/:free$/, '');
}

/**
 * Resolve a model to its alias.
 *
 * Longest-key-wins, so a model whose name is a prefix of another cannot
 * shadow it. Falls back to UNKNOWN_ALIAS rather than passing the raw name
 * through: leaking an upstream name is the one outcome this module exists to
 * prevent.
 */
export function toAlias(map: AliasMap, model: string | null | undefined): string {
  if (!model) return UNKNOWN_ALIAS;

  // An alias that reached us intact stays intact, so re-mapping an already
  // resolved value is idempotent.
  const trimmed = model.trim();
  if (TIER_ALIASES.includes(trimmed as TierAlias)) return trimmed;

  const bare = bareModelName(trimmed);
  const exact = map[bare];
  if (exact) return exact;

  const key = Object.keys(map)
    .filter((k) => bare === k || bare.startsWith(`${k}-`) || bare.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? map[key]! : UNKNOWN_ALIAS;
}

/** Load the alias registry from the price file. */
export async function loadAliasMap(): Promise<AliasMap> {
  const raw = await readFile(PRICE_FILE, 'utf8');
  const parsed = parseYaml(raw) as { aliases?: AliasMap };
  return parsed.aliases ?? {};
}

/**
 * True when `model` is one of our own aliases — used to tell "already
 * resolved" apart from "an upstream name we failed to map".
 */
export function isAlias(value: string): value is TierAlias {
  return (TIER_ALIASES as readonly string[]).includes(value);
}

/**
 * The customer-facing route for one spend row.
 *
 * The gateway log's `model` field says which MODEL served the request; it
 * says nothing about which WIRE FORMAT the client spoke. That signal is
 * `call_type`, LiteLLM's own vocabulary, and it is a NOT NULL column in the
 * spend table — which is why this reads it rather than guessing from the
 * model name or from the legacy `endpoint` field (absent on current rows,
 * hence the wall of `unknown` the dashboard used to show).
 */
const ROUTE_BY_CALL_TYPE: Record<string, string> = {
  acompletion: 'chat',
  anthropic_messages: 'messages',
  aresponses: 'responses',
};

export function routeForCallType(callType: string | null | undefined, endpoint?: string | null): string {
  const ct = (callType ?? '').trim();

  const mapped = ROUTE_BY_CALL_TYPE[ct];
  if (mapped) return mapped;

  // Non-inference calls (`/v1/models`, `/key/info`) still land in the ledger
  // as zero-cost rows. Label them with what they are rather than `unknown`:
  // a model-list call showing route `models` is truthful; showing `unknown`
  // reads as a broken import.
  if (ct) {
    const cleaned = ct.replace(/^\/+/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
    // `v1-models` still carries the version prefix customers never use.
    if (cleaned) return cleaned.replace(/^v1-/, '');
  }

  // Legacy rows that carried an endpoint keep it — but only if it is one of
  // the routes we actually sell, so a stale value cannot reintroduce noise.
  const ep = (endpoint ?? '').trim();
  if (ep === 'chat' || ep === 'messages' || ep === 'responses') return ep;

  return 'unknown';
}

/**
 * Resolve one spend row to the alias the ledger stores.
 *
 * `model_group` is preferred: it is the alias the client requested, logged
 * separately from the resolved upstream id in `model`. It is empty on some
 * zero-token rows, which is when the registry mapping of `model` takes over.
 * Either path returns an alias or `unknown` — never a raw upstream name.
 */
export function aliasForRow(
  map: AliasMap,
  row: { model?: string | null; model_group?: string | null },
): string {
  const group = (row.model_group ?? '').trim();
  if (group) {
    const resolved = toAlias(map, group);
    if (resolved !== UNKNOWN_ALIAS) return resolved;
  }
  return toAlias(map, row.model);
}
