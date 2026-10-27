# Zaino AI — LLM Gateway + SaaS Platform

One subscription, three model tiers, 100M blended tokens per tier per day.
No per-minute rate limits, no dollar caps on top — the daily token budget
per tier is the only limit.

```
                            ┌──────────── CONTROL PLANE ────────────┐
customer ──▶ portal ──▶ Next.js dashboard, auth, billing, admin    │
                            │           ▲                           │
                            │           │ usage (REST, never SQL)    │
                            ▼           │                           │
                            └──── DATA PLANE ───────────────────────┘
your client ──zn-your-key──▶ api.zaino.soon.it ──sk-your-key──▶ upstream
                                (Caddy + auth-edge + LiteLLM)   (both formats)
```

The **gateway** issues scoped keys and enforces per-tier daily token budgets.
The **portal** turns that into a product: dashboards, plans, payments, and an
admin console.

## Docs

| File | What it is |
|---|---|
| **[IMPLEMENTATION.md](IMPLEMENTATION.md)** | Build plan: roles, features, API contract, infra, phases 0–9 |
| **[MASTER_PROMPT.md](MASTER_PROMPT.md)** | Paste to the VPS AI: mission, conventions, git/GitHub to `louuuu007` |
| **[PLATFORM.md](PLATFORM.md)** | **Start here if building the SaaS.** Business models, pricing economics, schema, billing (D17 manual transfer) |
| **[LATENCY.md](LATENCY.md)** | What the provider's "24 ms" means; agentic latency scenarios; SLA guidance |
| **[DESIGN.md](DESIGN.md)** | Locked tech choices, dual-format design, 17 acceptance tests |
| [BLUEPRINT.md](BLUEPRINT.md) | Analysis: legal, cost accounting, threat model, runbook |
| [docs/auth-edge.md](docs/auth-edge.md) | The `zn-` → `sk-` credential boundary, denial mapping |
| [docs/d17-payments.md](docs/d17-payments.md) | Manual D17 payment flow (La Poste Tunisienne) |
| [docs/device-code-flow.md](docs/device-code-flow.md) | Browser device sign-in for the desktop app |

## Stack

**Gateway:** Caddy (TLS) → auth-edge (`zn-`→`sk-`, loopback `:4001`) →
LiteLLM Proxy v1.103.1 (loopback `:4000`) → PostgreSQL 16 + Redis 7
**Portal:** Next.js 16 + TypeScript + Drizzle + Auth.js (self-hosted) + D17
manual transfer (La Poste Tunisienne) — there is no card path; Stripe was removed.

Docker Compose, single VPS. Gateway infra ~$5/mo, with portal ~$12/mo.

## Models served

Three aliases, three upstreams. The alias is what customers request; LiteLLM
resolves it through `config/litellm.yaml` `model_list` and allowlists keys by
alias name — the edge deliberately forwards the alias as-is (rewriting it to
the upstream name would be denied with 403).

| Alias | Upstream | Context in / out | Request it with |
|---|---|---|---|
| `fast` | Haiku 5.5 | 1M / 64k | `"model": "fast"` |
| `smart` | Sonnet 5.5 | 1M / 64k | `"model": "smart"` |
| `frontier` | Opus 5.5 | 1M / 64k | `"model": "frontier"` |

All three share: `timeout 600`, `num_retries 6`, `reasoning_effort max`,
`verbosity high`, `temperature 0.2`, `top_p 0.9`,
`supported_endpoints [/v1/chat/completions]` only (`/v1/responses` is
translated to chat at the edge, `/v1/messages` by LiteLLM),
`usage-based-routing-v2`, `default_max_parallel_requests 100`.
Unknown model names are rejected at the edge with a clear `400`; unknown
aliases on LiteLLM surface as a `403` that the edge maps to the
out-of-tokens message below.

Per-token list rates (mirrored in `config/litellm.yaml` and
`prices/models.yaml`, divergence-checked by `pricing-consistency.test.ts`):

| Alias | Input | Output | 5m/1h cache write | Cache read |
|---|---|---|---|---|
| `fast` | $1.00 | $5.00 | $2.00 | $0.10 |
| `smart` | $3.00 | $15.00 | $6.00 | $0.30 |
| `frontier` | $15.00 | $75.00 | $30.00 | $1.50 |

…per 1M tokens. What the customer effectively pays is upstream × plan
multiplier: Starter `13000` (1.30×), Pro `12500` (1.25×).

## Plans & daily limits — the whole quota system

Each tier gets **100M blended tokens per day, resetting at midnight Tunis
time**. That is the entire quota. There are no per-minute rate limits, no
spend caps, no concurrency ceilings standing between a live customer and
inference.

| Plan | Models | Daily budget per tier | Keys | Price |
|---|---|---|---|---|
| **Starter** | `fast` + `smart` | 100M `fast` + 100M `smart` | 3 | 50 DT/mo |
| **Pro** | `smart` + `frontier` | 100M `smart` + 100M `frontier` | 15 | 90 DT/mo |
| **Trial** | `fast` + `smart` | 100M `fast` + 100M `smart` | 1 | free, 3 days |

(`fast` is Starter-only since the Pro refocus: each tier has one clear job —
high-volume Starter work on Fast, balanced work on Smart, hardest reasoning
on Frontier.)

### What counts: blended tokens

One meter, five ledger columns, summed per alias:

```
billable = input + output + cache_write_5m + cache_write_1h + cache_read
```

Blended tokens count every token that passes through the gateway, so a long
agentic session that resends full history each turn consumes proportionally
more of the budget. Only **successful inference calls are metered** — failures
never consume quota. `prompt_count` stays in the ledger for historical
analytics but is never read by any enforcement path.

### The window: the Tunis calendar day

```
Tunis = UTC+1 year-round — no DST — so a Tunis day is exactly 23:00Z → 23:00Z.
```

The wall sums `occurred_at >= day_start AND < day_start + 24h`, where
`day_start` is midnight Tunis (`portal/lib/entitlements/quota.ts`
`tunisDayWindow()` — pure integer arithmetic on the UTC clock, no locale or
date-string parsing, DST-safe precisely because Tunis has none).

At midnight Tunis time the new day starts with zero usage in it, so every
exhausted alias automatically re-allows — no manual reset, no sync needed.

### The token wall: the ONLY thing that can block a request

Rule, enforced identically by the 5-minute enforcer, the sync path, and the
hourly backstop (all through one helper — they cannot disagree):

```
allowed = entitled WHERE tokens_used < token_limit
```

- At `99,999,999` the alias serves. At `100,000,000` it is cut. The next
  token would be `limit + 1`.
- A missing or `0` budget entry means **unlimited**, never deny — the
  fail-open covers only plans nobody configured (shipped plans carry a
  migration guard forcing a budget on every served alias).
- When one alias is exhausted it is removed from the gateway allowlist (team
  models + every key's models). The sibling alias keeps serving. When all
  entitled aliases are exhausted the allowlist becomes `[]` and every
  inference `403`s.

What is deliberately **not** blocking, even though the columns exist on the
plan (kept for display + rollback safety):

| Control | Stored | Pushed to the gateway | Effect |
|---|---|---|---|
| Token allowlist | `token_limits` | allowlist of aliases | **the only request-blocking control** |
| RPM / TPM | `rpm_limit`, `tpm_limit` | always `null` | never blocks |
| Concurrency | `max_concurrent_requests` | always `null` | never blocks |
| Dollar budget | fixed $10,000 upstream | $10,000 (backstop) | catastrophic backstop only — the token wall always hits first |
| Key count | `max_keys` | — | enforced in-app at key creation, not on the request path |

`0` is never written to LiteLLM (it reads `0` as *unlimited*), and a cut org
gets `[]` + a `0.000001` budget so keys stay alive for instant reactivation
without serving anything.

### What the customer sees when a tier is spent

```
403  Out of <alias> tokens for today — resets at midnight Tunis time.
     Upgrade for more.
```

The edge maps LiteLLM's generic denial to this per-alias wording on both the
proxy and `/v1/responses` paths (naming the alias from the body, the model
the customer actually requested, or a translated upstream name like
`sonnet-5.5` → `smart` — never the raw JSON `"error"` key). The dashboard
banner, remaining-tokens cards, and marketing/FAQ copy all use the same
daily wording, and the "Resets" card counts down to midnight Tunis time.

### Old subscriptions are untouched until renewal

`subscriptions.daily_quota` (`0025_daily_100m.sql`): `TRUE` sums the Tunis
day, `FALSE` keeps the legacy monthly window (subscription period when known,
else calendar month). Existing live paid rows were backfilled `FALSE`, so
**nothing mid-period changes under them** — they flip to daily at their next
renewal (`subscription.activated`), plan changes flip immediately, trials and
new checkouts start daily from the first second. The dashboard bundle reads
the same window helper as the gateway wall, so the numbers a customer is
shown and the numbers that block them are one definition.

### Status → access

`active`, `past_due` (7-day grace keeps serving), `trialing` → full daily
quotas. `unpaid`, `canceled`, `paused`, `incomplete`, or no subscription →
cut (`models []`). Expiry and trial-expiry jobs run on top of the same rule,
so every path converges instead of racing.

## Enforcement loop (all server-side, all from the ledger)

`usage_records` is the truth. Everything else derives from it:

| Job | Cadence | What it does |
|---|---|---|
| `collect_usage` | 5m | polls LiteLLM `/spend/logs`, resolves alias via `prices/models.yaml`, dedupes by hash (`ON CONFLICT DO NOTHING`) |
| `enforce_prompt_limits` | 5m | recomputes `getAllowedModels()` per org, narrows/restores team + key allowlists; anyone under quota self-heals to the full plan list |
| `rollup_usage` | 15m | rebuilds `usage_periods` month buckets from the ledger (chart accelerator — quota never reads it) |
| `reconcile_entitlements` | 60m | hourly backstop: same wall push as sync, heals any drift |
| `expire_subscriptions` | 5m | period end → `past_due` + 7d grace → `unpaid` + cut |
| `expire_trials` | 60m | `trialing` past `trial_end` → `canceled` |

`billing_period` on the ledger is `date_trunc('month', occurred_at)` — a
calendar-month bucket for charts and history. Allowance math uses the quota
window (Tunis day / legacy period), never the month bucket: a D17
subscription starting mid-month spans two buckets, and one bucket can hold
two periods, so month math would attribute spend to the wrong allowance.

## Two things to read before selling anything

**1. Taking payment for model access is resale.** Anthropic's Commercial ToS
§A.1 permits powering your own products; §D.2 forbids reselling "except as
expressly approved by Anthropic." Stripe permits it — Stripe's restriction is
not your upstream's. [PLATFORM.md §0](PLATFORM.md#0-read-this-first--the-business-model-determines-the-architecture)
lays out three viable structures; **BYOK** (customer holds the key, you sell
the software) avoids the clause entirely.

**2. `rate_multiplier_bps` is your business.** At 1.30 you keep ~23% gross
margin. Below ~1.20 you subsidise your heaviest users, and your heaviest users
always use their full allowance. [PLATFORM.md §4.3](PLATFORM.md#43-unit-economics--the-constraint-that-actually-matters)

**3. Daily 100M budgets are generous on purpose — size the margin for the
ceiling, not the average.** A customer who burns the full 100M Smart tokens
in a day costs you upstream × 1.25; the plan price must survive that day
repeated, not the median day. Watch `verify-metering` margins per tier after
any price or budget change.

## Quick start

Local machine = editor + git. The stack also runs locally for proofs
(`make verify-metering`, `make verify-d17`), but the VPS is the only place it
serves traffic. `make verify-config` is the one check that runs without
containers; latency numbers measured anywhere but the VPS are fiction — see
LATENCY.md §9.

```bash
# ── local ─────────────────────────────────────────────────────
$EDITOR config/litellm.yaml        # change something
make verify-config                 # YAML + shell syntax, runs anywhere
git add <files> && git commit -m "..." && git push   # deploys (below)
```

## Deploy — push to main, nothing else

The VPS runs a **self-hosted GitHub Actions runner** (`.github/workflows/deploy.yml`).
Pushing to `main` (or "Run workflow" by hand) deploys: refuse a dirty tree →
fast-forward → `make db-init && make db-migrate` (**migrations run before the
new code is up**, so a deploy never serves code that expects a column the
database doesn't have yet) → `docker compose up -d --build` → readiness +
portal-health + jobs-runner gates. One deploy at a time (concurrency group,
latest commit wins).

```bash
# ── normal deploy ─────────────────────────────────────────────
git push origin main               # runner does migrate → rebuild → health
gh run list --repo Louay0007/gateway --limit 3   # watch it

# ── VPS, first time only ──────────────────────────────────────
ssh gateway@<VPS_IP>
cd /opt/gateway && make init       # .env is created HERE, never in git
$EDITOR .env                       # API_DOMAIN, UPSTREAM_*, secrets
make probe                         # ⭐ detects upstream format support
make up && make health
make key ALIAS=acme MODELS=fast,smart BUDGET=50
make smoke KEY=zn-...              # 17-test acceptance suite
```

Two hard rules the pipeline enforces, learned the painful way:

1. **Never hand-edit tracked files on the VPS.** The deploy refuses a dirty
   tree (`M edge/server.mjs … Refusing to deploy`) — including hotfixes made
   over SSH during an incident. The 2026-10-27 edge hotfix (alias-rewriting
   outage + `Model 'error'` denial bug) blocked the daily-limits deploy for
   exactly this reason: the fix was real, it lived only on the box, and the
   runner correctly refused to deploy over it. Back the diff up
   (`git diff > /tmp/hotfix-backup.patch`), commit it properly from local,
   push — then the tree is clean and the deploy flows.
2. **Migrations are forward-only, ledger-guarded, and run before the build.**
   `scripts/db-migrate.sh` applies each `portal/db/migrations/*.sql` exactly
   once (`schema_migrations` ledger); recovery is `make restore`, never a
   down-migration. Currently through `0025_daily_100m` (daily 100M budgets +
   `daily_quota` flag with grandfathering + guard).

`make deploy HOST=gateway@<VPS_IP>` (rsync, never copies `.env`) remains as
the manual fallback; it runs the same migrate → rebuild → health sequence.

## Why the probe comes first

If your upstream is **OpenAI-compatible only**, LiteLLM must *translate*
`/v1/messages` requests — and its own docs confirm this **drops
`cache_control`**. Prompt caching then silently fails, and a cache-read token
that should cost 0.1× is billed at 1×. That's a ~10× cost increase on repeated
prefixes, with nothing in the logs indicating a problem.

`make probe` tells you which situation you're in before you build on it.

## Clients

### OpenCode Desktop (official)

Download from the portal download page. Sign in with the browser device flow
(see docs/device-code-flow.md and docs/opencode-desktop.md) — no key pasting.
The key lives in the OS keychain; config only carries `{env:ZAINO_API_KEY}`.
Only the models your plan allows appear in the picker: Fast + Smart on
Starter, Smart + Frontier on Pro.

```bash
# Claude Code  — note ANTHROPIC_API_KEY MUST be empty
export ANTHROPIC_BASE_URL=https://api.zaino.soon.it
export ANTHROPIC_AUTH_TOKEN=zn-your-key
export ANTHROPIC_API_KEY=""
```

```python
# OpenAI SDK
OpenAI(api_key="zn-…", base_url="https://api.zaino.soon.it/v1")

# Anthropic SDK
Anthropic(base_url="https://api.zaino.soon.it", api_key="zn-…")
```

Spend the day's 100M on one tier and that tier answers `403 … for today`
until midnight Tunis time while the other tier keeps serving — plan key
scopes and model pickers around that, not around a monthly pool.

## Code from the web

`opencode web` runs on the VPS as a systemd unit (`opencode-web`,
loopback `:4096`, project `/opt/gateway`). Two ways to reach it:

```bash
# Option A — no public surface at all (recommended for daily use):
ssh -L 4096:localhost:4096 gateway
# then open http://localhost:4096 in your browser

# Option B — TLS subdomain (needs DNS + your IP in the allowlist):
#   1. DNS: code A <VPS_IP>
#   2. CODE_DOMAIN in .env
#   3. replace 203.0.113.4/32 in config/Caddyfile {$CODE_DOMAIN} block
#      with your public IP, redeploy
# then: https://code.zaino.soon.it
```

`opencode web` has no built-in auth — the IP allowlist (Option B) or the
SSH tunnel (Option A) **is** the security. Never remove the `@blocked`
gate.

## Two things that will bite you if you skip them

1. **Postgres is mandatory.** Without it LiteLLM's budgets are silently
   no-ops. `make health` checks this. Test **A-8** proves it.
2. **Cache writes are priced by TTL.** `cache_creation_input_tokens` is a
   single merged field; 1h-TTL writes cost 2.0× vs 1.25× for 5m. Pricing them
   all at the 5m rate under-bills by ~19%. `make reconcile` detects this.
3. **The token wall is per-day now, not per-period.** Any runbook, alert, or
   support macro that says "wait for renewal" or "resets next period" is
   stale — the answer is "resets at midnight Tunis time." Grep for it after
   every quota change.

## Portal

The portal is a Next.js app under `portal/` — API routes covering auth,
orgs, keys, usage, billing, D17 payments, admin, profile and account deletion.
Payments are **manual D17 transfers** verified by staff: the customer submits a
proof, staff approve it, and the subscription activates (and flips
`daily_quota` on). There is no card path.

```bash
cd portal
npm install
npm run typecheck                    # tsc --noEmit
npx vitest run                       # full suite: quota wall, billing, edge, auth
npm run build                        # next build (standalone)

# Migrations are forward-only and applied from the repo root, before deploys:
make db-migrate                      # every pending *.sql once each, ledger-guarded
```

Schema, newest-first: `0025_daily_100m` (100M/day budgets per tier,
`daily_quota` flag, grandfathering, shipped-plan guard), `0024_plan_base_prices`
(50/90 DT catalog), `0023_tokens_only` (tokens are the only quota),
`0022_token_limits` (per-alias budgets), `0021` (trial extension),
`0019_pro_smart_frontier` (Fast is Starter-only), `0018`, `0010_model_tiers`,
`0007_d17_renewals`, `0006_account_operations`, `0015_admin_console`, back to
`0001_init`.

Implementation order matters — entitlements and payment activation are where
"customer paid but has no access" and "customer paid twice" bugs live. Both are
silent. See [PLATFORM.md §12](PLATFORM.md#12-implementation-plan) and the
authoritative current-state notes in [HANDOFF.md](HANDOFF.md).

The single most expensive invariant: **bundle and wall share one window
helper.** `subscriptionBundle()` (what the customer sees) imports
`usageWindowForSubscription()` from `lib/entitlements/quota.ts` — the exact
function `getAllowedModels()` (what blocks them) sums over. If those two ever
diverge again, dashboards lie while the gateway cuts, or vice versa.

## Operations console

The staff-facing console is the Next.js app on its **own, IP-gated host**:

```
{$CONSOLE_DOMAIN}   →   127.0.0.1:3000   (the portal's /admin)
```

| Page | What it answers |
|---|---|
| `/admin` | Is the pipeline healthy, is money waiting, is the business healthy |
| `/admin/orgs` | Filterable account roster (search, plan, status, over-cap, failed sync) |
| `/admin/orgs/[id]` | One account: keys, members, payments, credits, audit |
| `/admin/d17` | Approve or reject a payment proof |
| `/admin/usage` | Per-account revenue, upstream cost and margin |
| `/admin/credits` | The refund ledger — read back, not just recorded |
| `/admin/plans` | Plan CRUD (owner only) — budgets are RAW TOKENS per day; rpm/tpm/concurrency stored are display-only, never pushed |
| `/admin/audit` | Who changed what, filterable |
| `/admin/ops` | Job health and ledger freshness |
| `/admin/staff` | Grant, change and revoke staff access (owner only) |

Four staff tiers, `read_only < support < admin < owner`, resolved from
`staff_users` on every request — a revoked account loses the console on its
next navigation, and no role is ever read from a customer's org.

**`CONSOLE_DOMAIN` is not `ADMIN_DOMAIN`.** LiteLLM's own Admin UI
(`127.0.0.1:4000`, master-key-only) has **no public vhost at all**; reach it
over SSH:

```bash
ssh -L 4000:localhost:4000 gateway@<VPS_IP>   # then http://localhost:4000/ui
```

Before first use, replace `203.0.113.4/32` in the `{$CONSOLE_DOMAIN}` block of
`config/Caddyfile` with your public IP (`curl -s ifconfig.me`), or the console
will 403 you — including from localhost's perspective on a fresh install.

## Before serving third parties

Read [BLUEPRINT.md §2](BLUEPRINT.md#2-legal-and-policy-analysis). Anthropic's
Commercial ToS permits powering your own products (§A.1) but forbids reselling
the Services without express approval (§D.2). If your upstream is itself a
reseller, you inherit its exposure. **Private/team use can proceed now;
third-party use should wait for a written answer.**

## Commands

```
make help          # all targets
make probe         # detect upstream capabilities
make up | down | restart | logs | ps
make health        # health + Postgres + pricing wiring
make key           # mint tenant key
make report USER=x # usage for a tenant
make reconcile     # cost cross-check
make smoke KEY=…   # acceptance suite
make backup        # pg_dump
make pull          # new gateway image (review release notes)
make verify-config # validate YAML + shell syntax
make db-migrate    # apply pending portal migrations (before deploys do it too)
make verify-metering # end-to-end quota/billing proof (needs live stack)
```
