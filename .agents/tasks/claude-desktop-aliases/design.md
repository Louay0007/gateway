# claude-* aliases — design (no files edited)

Read-only. Branch not created. `config/Caddyfile` untouched, still awaiting the user.

## Finding that changes the brief's recommendation

The brief ranks `router_settings.model_group_alias` first ("5 lines, drop four blocks
to six"). It is cheaper and it breaks metering.

`aliasForRow` (`portal/lib/pricing/alias.ts:196-208`) prefers `model_group`, then
`toAlias(map, group)`. `toAlias` (`:77-92`) passes `TIER_ALIASES` through, else
exact-maps, else **prefix-maps** (`bare.startsWith(k)`). `model_group_alias` reports
the *requested* name in `model_group` — so the ledger sees `claude-fast`, which is
not a tier alias and has no `aliases:` key => `toAlias` returns `unknown` =>
`collect-usage.ts:120-127` pushes it to `unmappedModels`.

Cannot be patched by adding `claude-fast: fast` to `prices/models.yaml` `aliases:` —
that map is upstream-model -> alias and the suite rejects orphan keys
(`pricing-consistency.test.ts:196-204`, `stale`); `claude-fast` is not a deployment's
`bare`, so the key fails the build.

Second problem: `model_group_alias` gives the alias one shared deployment, so
`claude-fast` and `fast` are the *same* group and a cooldown reads as an outage for
both names (`config/litellm.yaml:186-190`).

**Verdict: four separate `model_list` entries.**

Metering still needs one more thing, because even a distinct `model_name` logs
`claude-fast` as `model_group`. LiteLLM's response-rewrite (issue 38761) rewrites the
response `model` field, not the spend log's `model_group`, so it does not rescue this.

## 1. `config/litellm.yaml` — four entries after `fable` (line 172)

Full YAML for one; the other three identical except `model_name`, `model`, rates.

```yaml
  # Claude Desktop's custom-model dialog needs a name it recognises. These are
  # the SAME deployments as the four tier aliases above, under the name the
  # client's picker accepts. `claude-fast` and `fast` are separate model groups
  # on purpose: one cooldown must not take down both names, and the tier
  # aliases stay the only names in the plan tables. The ledger resolves
  # `claude-*` back to its tier in portal/lib/pricing/alias.ts, so
  # usage_records.model is never `claude-*`.
  - model_name: claude-fast
    litellm_params:
      model: openai/haiku-5.5
      api_base: os.environ/UPSTREAM_BASE_URL
      api_key: os.environ/UPSTREAM_API_KEY
      timeout: 600
      num_retries: 6
      cooldown_time: 3
      reasoning_effort: max
      verbosity: high
      temperature: 0.2
      top_p: 0.9
    model_info:
      supported_endpoints: ["/v1/chat/completions", "/v1/messages"]
      input_cost_per_token: 0.000001
      output_cost_per_token: 0.000005
      cache_creation_input_token_cost: 0.000002
      cache_read_input_token_cost: 0.0000001
      max_input_tokens: 1048576
      max_output_tokens: 65536
```

Deltas for the other three (`model_name` / `model` / 5 rate fields only):

| model_name | model | in | out | cache_write | cache_read |
|---|---|---|---|---|---|
| claude-smart | `openai/sonnet-5.5` | 0.000003 | 0.000015 | 0.000006 | 0.0000003 |
| claude-frontier | `openai/opus-5.5` | 0.000015 | 0.000075 | 0.00003 | 0.0000015 |
| claude-fable | `openai/gpt-6-astra` | 0.000015 | 0.000075 | 0.00003 | 0.0000015 |

`max_input_tokens` / `max_output_tokens` / `supported_endpoints` / all
`litellm_params` identical across all four. Rates copied from the existing blocks so
`pricing-consistency.test.ts:227-250` passes unchanged. **No `prices/models.yaml`
change** — each new deployment's `bare` is already registered.

Parser constraint (checked): `stripComments` + `flush()` keep a trailing comment
inside a block (`pricing-consistency.test.ts:41-131`). A comment between
`- model_name:` and `litellm_params:` is safe only if it does not match
`/^[a-z_]+:$/`. The comment sits *before* the entry, which is safe.

## 2. `scripts/reconcile.sh` — `ALIAS` map (line 111)

`pricing-consistency.test.ts:344-351` requires a mapping for **every** `model_name`,
so all four are mandatory:

```python
ALIAS = {
    "fast": "haiku-5.5",
    "smart": "sonnet-5.5",
    "frontier": "opus-5.5",
    "fable": "gpt-6-astra",
    # Claude Desktop names — same deployments, same rates. Listed because the
    # pricing suite requires a mapping per served alias; leaving one out fails
    # the build, not a runtime check.
    "claude-fast": "haiku-5.5",
    "claude-smart": "sonnet-5.5",
    "claude-frontier": "opus-5.5",
    "claude-fable": "gpt-6-astra",
}
```

The reverse check (`maps unknown alias` / `which no deployment serves`) passes
because both sides exist after the litellm.yaml edit. **§1 and §2 must land in the
same commit** or the suite is red either way.

## 3. Metering edit — `portal/lib/pricing/alias.ts`, inside `toAlias`

Before the `TIER_ALIASES` check:

```ts
  // Claude Desktop's model picker sends `claude-fast`, `claude-smart`, … Those
  // are gateway routing names (config/litellm.yaml), not product tiers: they
  // must never reach usage_records.model or the DB CHECK. Strip the prefix so
  // the ledger still records the tier the customer actually used.
  // ponytail: the prefix is client-only forever — if `claude-*` ever becomes a
  // real fifth tier, this strip is the line to delete.
  const tier = bareModelName(model).replace(/^claude-/, '');
  if (TIER_ALIASES.includes(tier as TierAlias)) return tier;
```

The existing exact/prefix mapping continues for everything else. Plus one assert in
`portal/tests/pricing-alias.test.ts`: `toAlias(map, 'claude-fast') === 'fast'` and
idempotence.

## 4. Confirmed OUT

- **`plans.models`** — unchanged. `assertModelsAllowed`
  (`portal/lib/keys/policy.ts:215-248`) keeps rejecting a key minted for
  `claude-fast`; correct, it is not a plan model and Claude Desktop mints no keys.
- **`TIER_ALIASES`** — unchanged (`alias.ts:37`). §3 is what keeps it out.
- **`usage_records.model`** — no `claude-*` ever written; §3 resolves before insert.
- **DB CHECK** — not touched, no migration. `0011_usage_aliases.sql:98-103` stays.
  The only enforcement path is the insert value, which §3 fixes upstream.

## 5. Every site that enumerates aliases

| # | Site | Needs `claude-*`? | Why |
|---|---|---|---|
| 1 | `config/litellm.yaml:66-172` | **YES** | the four new entries — the mechanism |
| 2 | `scripts/reconcile.sh:111-116` | **YES** | suite requires a mapping per `model_name` |
| 3 | `portal/lib/pricing/alias.ts:37` `TIER_ALIASES` | **NO** | plan tiers only; §3 handles naming |
| 4 | `portal/lib/pricing/alias.ts:77` `toAlias` | **YES (strip)** | else `unknown` in the ledger |
| 5 | `prices/models.yaml:70-75` `aliases:` | **NO** | keyed on upstream names; a `claude-*` key fails the orphan check |
| 6 | `portal/lib/pricing/facts.ts:65,109` `RATES`/`PLAN_FACTS.models` | NO | exact-array assertions, plan surfaces |
| 7 | `portal/components/docs/docs-data.ts:24,86` `TIERS`/`CONTEXT_WINDOW` | NO | exact-order assertion |
| 8 | `portal/components/chat/aliases.ts:58` `ALIAS_ORDER` | NO | picker shows four tiers; a fifth name is the bug |
| 9 | `portal/components/dashboard/quota-meter.tsx:118,226` | NO | one shared pool, four rows |
| 10 | `portal/app/api/playground/route.ts:58`, `scheduled/route.ts:35`, `scheduled/[id]/route.ts:27` | NO | `z.enum` product surfaces |
| 11 | `portal/lib/keys/policy.ts:215` `assertModelsAllowed` | NO | correct as-is |
| 12 | `portal/lib/auth/provision.ts:54` `DEFAULT_MODELS` | NO | wall stays on tiers |
| 13 | `edge/server.mjs:130` `MODEL_ALIAS` | **NO — verified safe** | guards only `/v1/chat/completions` (`:443-461`); `/v1/messages` (`:427-441`) never calls `modelRejection`, so `claude-*` reaches LiteLLM untouched. Adding it would be dead code |
| 14 | `edge/server.mjs:264` `displayAlias` | NO | log label only; returns `null` => gateway log shows no alias for `claude-*`. Cosmetic. Optional 4-line add |
| 15 | `portal/lib/entitlements/quota.ts:338,340,351` | NO | error-message attribution only; a 403 for `claude-fast` falls back to the generic out-of-tokens text — the *intended* message (`:316-326`) |
| 16 | `scripts/mock-upstream.mjs:247` | NO | local smoke catalog; cosmetic |
| 17 | `docs/opencode-desktop.md:81-89` | **YES (prose)** | the doc is the catalog spec; one sentence on the `claude-*` names |
| 18 | `portal/tests/connect-snippets.test.ts:24` `ALIASES` | NO | iterates the four tiers |
| 19 | `portal/lib/litellm/client.ts:291` `allowlistFor` | NO — see risk | pushes tiers to team/key; whether a key allowlisted `fast` may call `claude-fast` is unproven |

## 6. 1M context

Already live: `max_input_tokens: 1048576` on all four, published by `GET /v1/models`.
No `/v1/messages` field carries it — the wire format has none. **Nothing in this
change caps it**; `claude-*` entries carry the same 1048576.

Only gateway-side cap: Caddy's blanket `request_body { max_size 10MB }` on the API
vhost (`config/Caddyfile:57-59`); edge ceiling 32 MB (`edge/server.mjs:596`), so Caddy
is the wall. **Not part of this change** — and that is the user-owned Caddyfile, off
limits. If it moves: matcher pair (`@messages path /v1/messages` => 24MB, else 10MB),
staying under 32 MB.

## 7. Risks needing one live curl each, post-deploy

1. **Key allowlist.** `allowlistFor` pushes `['fast','smart','frontier','fable']`.
   Whether LiteLLM v1.103.1 lets that key call `claude-fast` (a different model
   group) or 403s it. If it 403s, the fix is pushing both names from
   `client.ts:291-313` — which **widens what every existing key may call**, so that
   is a product decision, not an edit.
2. **`/v1/messages` body rewrite.** `sanitizeRequest` only rewrites PDF/URL-image
   blocks and leaves `model` alone (`edge/server.mjs:427-441`), so `claude-fast`
   should pass verbatim. Same smoke.

## Verification plan

1. `make verify-config` — YAML + `bash -n` on every script.
2. `cd portal && npx vitest run tests/pricing-consistency.test.ts tests/pricing-alias.test.ts`
3. `cd portal && npx vitest run` — exact-array tests stay green (proves `claude-*` stayed out).
4. Post-deploy: one curl per name on `/v1/messages` with `anthropic-version: 2023-06-01`,
   then `make report USER=<slug> DAYS=1` to confirm the ledger still reads `fast`.
