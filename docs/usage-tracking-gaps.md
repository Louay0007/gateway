# Usage tracking: portal ↔ desktop — full contract and every gap

Written 2026-11-07. Scope: the complete path a token takes from a keystroke in
the desktop app to a number on the quota panel, and every place that path is
broken, unverified, or lying.

---

## 1. The contract, end to end

```
desktop renderer          gate.ts        POST /v1/... + isSpendingPath
   ↓ fetch             (60 s TTL, per-alias inflight)
portal  GET /api/device/usage[?model=]
   ↓ subscriptionBundle()
   plans + plan_models → entitled aliases
   usage_records  SUM( fresh_input + output + cache_write_5m + cache_write_1h + cache_read )
                  WHERE org_id AND model IN entitled
                  AND created_at ∈ [00:00 Tunis, next 00:00 Tunis)
   ↓ Response.json { planCode, models, tokenLimits, tokensByModel,
                     remainingTokensByModel, tokenExhausted, exhaustedByModel,
                     periodStart, periodEnd }
desktop main  quota.ts fetchUsage → deriveQuota → Ok | Exhausted | Unauthorized
   ↓ IPC (aliases and numbers only, never the zn- key)
renderer      picker (usableAliases) + quota-panel (quotaRows)
```

The write side, which feeds the sum:

```
desktop sidecar → edge (zn-→sk-) → LiteLLM → upstream
                                  ↓
                        LiteLLM spend logs (per request)
                                  ↓ collect_usage, every 5 min, 15-min lookback
                        portal.usage_records (dedupe_hash ON CONFLICT DO NOTHING)
                                  ↓ enforce_prompt_limits, every 5 min
                        team + key model allowlist  ← the actual wall
```

Three properties define the contract:

1. **Units are raw blended tokens**, not cost, not prompts. One alias has one
   number: `100_000_000` per Tunis calendar day.
2. **The wall is an allowlist, not a budget.** LiteLLM budgets sit at $10 000
   and never move (`CUT_BUDGET = 0.000001` because LiteLLM reads `0` as
   UNLIMITED). Enforcement is `models: allowed` pushed onto the team and every
   key. A model absent from that list cannot be called; a model on it has no
   token ceiling.
3. **The desktop is a courtesy, the portal is the judge.** The client
   pre-checks to avoid a doomed round-trip. The 429 comes from the portal.

---

## 2. Gaps

Severity is customer-visible impact. Each entry now records its disposition:
**FIXED** (shipped), **DECIDED** (a product call, documented), or
**DISPROVEN** (not a gap).

### G1 — `/v1/models` advertises no context or output limit  ✗ DISPROVEN

**This gap does not exist.** An authenticated `GET /v1/models` against the live
gateway returns `"max_input_tokens": 1048576` and `"max_output_tokens": 65536`
on every deployed alias. LiteLLM publishes the per-deployment
`max_input_tokens`/`max_output_tokens` itself; no `model_info` /
`public_model_info` block is needed.

Left here for the record because the reasoning was plausible and the check
was cheaper than the fix: the original claim was inferred from
`config/litellm.yaml` plus upstream issue reports (#25293, #21855), and an
anonymous probe had only ever returned 401, so nothing observed it. One
authenticated call settled it.

**Disposition:** no change. The desktop's `catalogLimits` receives 1M/64K and
does not fall back to `FALLBACK_LIMITS`.

### G2 — latency never reaches the ledger

`portal/lib/jobs/collect-usage.ts:228` writes a literal `NULL` into
`latency_ms`. The spend-log row carries the timing; it is discarded before
insert. Any per-request or p50/p95 latency view built on `usage_records` is
permanently empty. **Fix:** read the field off the spend row (defensively; it
moves between versions), pass it through.

### G3 — Prometheus callback with no Prometheus

`litellm.yaml:243` `success_callback: ["prometheus"]`, and nothing on the VPS
listens. Every success attempt to emit metrics is wasted work or a logged
error, and there is no operational dashboard. **Fix:** either run
prometheus + grafana in compose, or drop the callback and rely on spend logs.

### G4 — the edge is blind to tokens and models

`edge/server.mjs` `log()` emits `{msg, method, path, status, ms,
prefix_substituted, route, error}`. No model, no token counts, no key id. When
a customer disputes usage there is no edge-side record — only LiteLLM's, which
is what the collector reads. **Fix:** add `model` (post alias-resolution) and
`key_prefix` to the log line; parse usage from the response only if cheaper
forensics become necessary.

### G5 — up to ~20 minutes of unmetered spend

`collect_usage` runs every 5 min with a 15-min lookback (`scripts/jobs.ts:60`),
so a request can sit invisible for 20 minutes. The desktop's gate trusts a
60-second-old snapshot. Worst case: the gate says go, the request runs, the
wall was already stale. This is inherent to polling; the size is not. **Fix:**
either shorten the collector interval at the cost of LiteLLM load, or accept
and document the overshoot budget as a product decision (a user can overspend
one day's quota by whatever 20 minutes of work costs).

### G6 — the wall can be a step behind the ledger

`enforce_prompt_limits` also runs every 5 min, reading `getAllowedModels`. A
request that pushed an alias over budget lands in `usage_records` at T, the
allowlist updates at T+5..10. Between the two, the gateway still accepts. Same
class as G5, separate timer, so the two can stack. **Fix:** run the enforcement
immediately after collection in the same job, not on an independent schedule.

### G7 — a partially spent plan shows no warning

`quota.ts deriveQuota` returns `Ok` whenever ANY alias has budget. One alias at
99% and three untouched renders as fully healthy: `tightest` exists on the
`Ok` value but nothing surfaces "Fast is nearly gone". **Fix:** derive a
`warn` state from `remaining/limit < threshold` per alias and render it in the
panel.

### G8 — the exhausted copy gives the wrong advice

`renderer/zaino/messages.ts:39` — "Your {models} token allowance is used up.
**Upgrade your plan to keep going.**" The quota is daily and resets at 00:00
Tunis. Every exhausted user is told to pay more for a quota that returns free
in a few hours. The portal already has the right string
(`lib/entitlements/quota.ts outOfTokensMessage`). **Fix:** name the reset date
from `snapshot.periodEnd`.

### G9 — retired fields still in the wire and the gate

`shared/ipc-rpc/zaino.ts:45-46` still declares `promptLimits` /
`promptsByModel`, and `renderer/zaino/gate.ts:187-192` still falls back to them.
Nothing writes them. They are dead weight that reads as live contract to anyone
new, and `gate.test.ts:181` keeps them alive by testing them. **Fix:** delete
both fields and the fallback; drop the test case.

### G10 — `remainingTokensByModel` and `exhaustedByModel` are transported, never read

The portal computes both (`api/device/usage/route.ts`, `billing/service.ts:180-360`)
and the desktop's schema carries them, but `quota-panel.tsx` renders from
`quotaRows(limits, Ok.remaining)` and nothing anywhere renders
`exhaustedByModel`. Two sources of truth for one number; the rendered one is
the recomputed one. **Fix:** render the portal's numbers, or delete the fields
from the wire — do not ship both.

### G11 — pasted-key sign-in has no expiry warning

`sign-in.tsx submitPasted` sets `{_tag:"Approved", models}` with no
`expiresAt`, so the `keyExpiresSoon` path never fires for a pasted key. Device
keys expire; a pasted key that expires dies silently against a 401. **Fix:**
read `expires_at` from the portal in `setPastedKey` (it already calls
`fetchUsage` there) and pass it through.

### G12 — 401 and sign-out leave a live-looking config

`main/ipc-handlers/zaino.ts`, `ZainoUsageRead` unauthorized branch and
`ZainoKeyClear`: both call `clearKey()` and stop. `zaino.json` keeps its full
four-alias provider block, so the picker lists models that can only 401 and the
user sees "signed out" next to a working-looking model list. **Fix:** call
`writeProvider([])` on both paths before restarting.

### G13 — revoke is best-effort and silent

`quota.ts revokeDeviceKey` POSTs and swallows failure. If the POST fails, the
local key is gone (or the user thinks it is) and a live `zn-` credential
remains valid in the portal for its full 30-day TTL. **Fix:** on failure, keep
the key locally and surface "sign-out failed, try again" rather than pretending.

### G14 — no usage history reaches the desktop

`usage_records` has one row per request. Nothing serves it to the client, so
there is no trend, no per-day chart, no "you used X yesterday". The panel shows
one instant. **Fix:** a `GET /api/device/usage/history?days=7` returning
per-day per-alias sums, rendered as a sparkline. This is the single cheapest
retention feature on the roadmap.

### G15 — `docs/opencode-desktop.md` is wrong on three points

`docs/opencode-desktop.md:60-90` states three aliases only (there are four),
that "only the prompt count limits usage" and tokens "are effectively
unlimited" (false since the daily token wall), and that `/v1/models` advertises
limits (see G1). Anyone building a client from this doc builds the wrong
client. **Fix:** rewrite that section against shipped behaviour.

### G16 — `/api/device/usage` has no rate limit

The gate can call it once per prompt, and each call runs the full
`subscriptionBundle` — plan lookup, entitlement query, and two `usage_records`
aggregates. There is no limit at the route. **Fix:** a simple per-key limiter
(e.g. 30/min) at the route, plus the existing 60 s client cache.

### G17 — a second device silently revokes the first

Approving a device key revokes every prior `kind='device'` key for the org. The
first machine is never told; it discovers on its next call, gets 401, and drops
to sign-in with no explanation. **Fix:** return the revocation count on
approval for a banner ("this signed out 1 other device"), and in the client
treat a 401 with a stored key as "signed out elsewhere" rather than a generic
error.

### G18 — `usage_periods` cannot answer "what did I use today"

`rollupUsage` keys on `billing_period = date_trunc('month', ...)`
(`collect-usage.ts`). The live wall is daily. The rollup cannot serve the
question the product actually asks. **Fix:** add a daily rollup keyed on the
Tunis day, which is also what G14's history endpoint needs.

### G19 — device keys are org-scoped, so two machines share one ledger

Both machines draw from the same per-alias daily allowance and neither can see
which spend is whose. This may be intended (one subscription, one person), but
it is not stated anywhere and it makes G17's silent revocation worse — the
second machine looks like a plan downgrade. **Decision needed:** per-org (as
now) or per-device. If per-org, say so in the panel.

### G20 — unmapped models are free

`lib/entitlements/quota.ts computeTokenAllowedModels` sums per entitled alias.
Rows whose `model` resolved to `UNKNOWN_ALIAS = 'unknown'` count against
nothing, so a model the alias map does not cover is unlimited. Today the
gateway only serves four aliases, so this is latent — but `aliases:` in
`prices/models.yaml` is the only thing keeping it closed, and a new upstream
added to LiteLLM without an alias entry opens it. **Fix:** count `unknown`
against every alias, or fail the collect job loudly on an unmapped model.

---

## 3. What could not be verified

Nothing in this document is now inferred. G1 — whether the catalog carries
`max_input_tokens` / `max_output_tokens` — was the one open question, and an
authenticated probe from the host settled it: both fields are present on
every deployed alias. Everything else is from read source or live queries.

`LiteLLM_SpendLogs.request_duration_ms` was also checked live at the same
time: NOT NULL, populated on 5342 of 5342 rows, which is what makes G2
fixable from data already in the row rather than from a new column.

## 4. Disposition — all twenty, as shipped

| # | Disposition | What changed |
|---|---|---|
| G1 | **DISPROVEN** | `/v1/models` does advertise 1M/64K. No change. |
| G2 | **FIXED** | `collect-usage.ts` reads `request_duration_ms`; non-finite/negative → NULL, never 0. |
| G3 | **FIXED** | `prometheus` callback removed from `litellm.yaml`. |
| G4 | **FIXED** | `edge/server.mjs` logs `model` (post-alias-resolution) and `key_prefix` (first 8 chars of the bearer) on every proxy and responses log site. |
| G5 | **DECIDED** | The overshoot budget is accepted, not fixed: ≤20 min of spend can exceed one day's allowance. Bounded by the 5-min collect + 15-min lookback, and only reachable by a client that ignores the gate. Shortening the interval is the lever if it ever matters; it costs LiteLLM load, not correctness. |
| G6 | **FIXED** | `collect_usage` now chains `enforcePromptLimits()` in the same tick. The standalone `enforce_prompt_limits` job entry is gone. |
| G7 | **FIXED** | `quota-rows.ts` derives `usedRatio` + `warningRow` (≥80%); the panel names the alias and its percentage. |
| G8 | **FIXED** | Copy names the midnight-Tunis reset instead of only selling an upgrade. |
| G9 | **FIXED** | `promptLimits`/`promptsByModel` deleted from the wire schema and from `gate.ts apply()`; the legacy test now asserts the gate stays OPEN on a prompt-only payload (it used to read as exhausted). |
| G10 | **FIXED** | Deleted, not rendered: `remainingTokensByModel`/`exhaustedByModel` are out of `ZainoUsageSnapshot` and `UsageSnapshot`. `deriveQuota` computes both from `tokenLimits` + `tokensByModel`. The portal still sends them — a wire may carry extra fields — but nothing on the client can now disagree with the wall. |
| G11 | **FIXED** | `/api/device/usage` returns `keyExpiresAt` (from `api_keys.expires_at`, same query as the org lookup); `setPastedKey` passes it through, the panel renders it separately from the daily reset. |
| G12 | **FIXED** | `writeProvider([])` on both the 401 branch of `ZainoUsageRead` and on `ZainoKeyClear`. |
| G13 | **FIXED** | `ZainoKeyClear` returns `revoked`; the sign-in surface says the credential may still be live upstream. Sign-out still always succeeds locally — the key is not kept, because holding a credential for a user who asked to sign out is worse than a stale TTL. |
| G14 | **FIXED** | `GET /api/device/usage/history?days=7`, zero-filled server-side, grouped on the Tunis calendar date. |
| G15 | **FIXED** | `docs/opencode-desktop.md` rewritten: four aliases, per-model transport split, tokens as the only limit, allowlist enforcement, plan lineups. |
| G16 | **FIXED** | 60/min per key digest on `/api/device/usage` and the history route. Answers `rate_limited` (429), deliberately a different shape from `quota_exhausted`. Shared key resolution extracted to `lib/device/auth.ts`. |
| G17 | **FIXED** | `approveDeviceCode` returns `revokedDevices`; the device page says how many computers were signed out. The revoking client is told by the 401 branch, which now also clears the provider config. |
| G18 | **DECIDED — not built** | No daily rollup table. The history endpoint answers the question with one grouped scan over `usage_records_org_occurred_idx`, and a rollup is a second copy of the wall's arithmetic that has to be kept in step with it. Add one only when a scan over the retained window stops being fast enough; the response shape does not change. |
| G19 | **DECIDED** | Per-org, deliberately. One subscription is one person's allowance; a second machine does not get a second budget. The panel says so (the sign-in surface already carried `singleDevice`). |
| G20 | **FIXED** | `chargedTokensFor()` adds the `unknown` bucket to every alias. Over-charging is the correct direction; the collector already names unmapped models loudly. |

### Two things this work added that the plan did not ask for

1. **`portal/lib/device/auth.ts`.** The bearer→org lookup existed twice, and one
   copy compared the plaintext against `key_hash` — which can never match, so
   that endpoint answered 401 for every caller. Both routes now share one
   implementation, and it is where `keyExpiresAt` came from for free.
2. **A rate limit on the history route.** Left off entirely it would have been
   the cheapest unauthenticated-ish way to make Postgres aggregate.

### Not done, and why

- The desktop still re-reads the whole snapshot every 60 s per alias
  (`gate.ts`). The per-alias 429 is the cheap path; the TTL is fine.
- Nothing renders the history endpoint yet. It is served and tested by shape;
  the sparkline is UI work with no metering content.
