<div align="center">

<img src="portal/public/logo/zaino-icon.svg" width="104" alt="Zaino AI" />

# Zaino AI

**One API for every model.** OpenAI- and Anthropic-compatible endpoints, one
key, one shared token pool, priced in dinars.

[zaino.soon.it](https://zaino.soon.it) · [API](https://api.zaino.soon.it/v1) · [Docs](https://zaino.soon.it/docs) · [Status](https://zaino.soon.it/status)

</div>

---

Zaino is a self-hosted LLM gateway and the SaaS around it. A customer signs up,
picks a plan, and gets a `zn-` key that speaks both the OpenAI and the Anthropic
wire formats. Behind that key, four model aliases resolve to upstream
deployments; the customer never sees an upstream model name, so the engine
under an alias can be swapped without breaking a single integration.

The gateway enforces one thing: a **shared monthly token pool** per plan,
measured in weighted units over the subscription period. There are no
per-minute rate limits, no concurrency ceilings and no dollar caps standing
between a paying customer and inference.

## Architecture

```
                        ┌──────────────── CONTROL PLANE ────────────────┐
   customer ──▶ portal ──▶  Next.js 16 · auth · billing · admin console  │
                        │        │              ▲                        │
                        │        │ usage        │ entitlements (REST)    │
                        ▼        ▼              │                        │
                        └──────────────── DATA PLANE ────────────────────┘
   your client ──zn-key──▶ api.zaino.soon.it ──sk-key──▶ upstream
                             Caddy → auth-edge → LiteLLM
```

| Layer | What it does |
|---|---|
| **Caddy** | TLS, the `@modelApi` path allowlist (everything else 404s), body ceilings |
| **auth-edge** | The `zn-` → `sk-` boundary. Validates the customer key, resolves the alias, fails closed |
| **LiteLLM** | Alias → deployment routing, retries, cooldowns, spend logs |
| **engine** (Rust) | Document extraction and full-text search for attachments — axum + tantivy |
| **portal** (Next.js) | Dashboard, chat, keys, usage, billing, admin console |
| **jobs** | Ten background jobs: metering, entitlement sync, expiry, alerts, retention |
| **Postgres + Redis** | The ledger, the plans, the sessions, the locks |

Nine Compose services, five named volumes, one VPS. Gateway infrastructure runs
at roughly $5/month; with the portal, about $12.

## Quick start

```bash
curl https://api.zaino.soon.it/v1/chat/completions \
  -H "Authorization: Bearer zn-your-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "smart", "messages": [{"role": "user", "content": "Hello"}]}'
```

```python
from openai import OpenAI

client = OpenAI(api_key="zn-…", base_url="https://api.zaino.soon.it/v1")
client.chat.completions.create(model="smart", messages=[{"role": "user", "content": "Hello"}])
```

```python
from anthropic import Anthropic

client = Anthropic(api_key="zn-…", base_url="https://api.zaino.soon.it")
client.messages.create(model="smart", max_tokens=1024, messages=[{"role": "user", "content": "Hello"}])
```

```bash
# Claude Code — ANTHROPIC_API_KEY must be empty, or the SDK prefers it
export ANTHROPIC_BASE_URL=https://api.zaino.soon.it
export ANTHROPIC_AUTH_TOKEN=zn-your-key
export ANTHROPIC_API_KEY=""
```

`/v1/responses` is translated to chat at the edge; `/v1/messages` is served
natively. Unknown model names are rejected at the edge with a `400` naming the
aliases that exist.

## Models

Four aliases, one per capability class. The alias is the product: it is what
customers request, what the plan tables list, and what the ledger records.

| Alias | Context in / out | Input | Output | Cache write | Cache read |
|---|---|---|---|---|---|
| `fast` | 1M / 64k | $1.00 | $5.00 | $2.00 | $0.10 |
| `smart` | 1M / 64k | $3.00 | $15.00 | $6.00 | $0.30 |
| `frontier` | 1M / 64k | $15.00 | $75.00 | $30.00 | $1.50 |
| `fable` | 1M / 64k | $15.00 | $75.00 | $30.00 | $1.50 |

Per 1M tokens. Cache writes are priced at 2× input for every alias.

Four further names — `claude-fast`, `claude-smart`, `claude-frontier`,
`claude-fable` — exist only so Claude Desktop's model picker accepts them. They
are separate LiteLLM model groups on purpose (one cooldown must not take down
both names), and the ledger resolves them back to their tier, so
`usage_records.model` is never a `claude-*` value.

Rates live in two files that must agree — `prices/models.yaml` (the operator's
view) and `config/litellm.yaml` `model_info` (what LiteLLM bills against).
`portal/tests/pricing-consistency.test.ts` fails the build on drift.

## Plans

Five public plans and a hidden trial. Every plan gets **one shared pool**,
spendable on any model the plan unlocks, in any proportion.

| Plan | Price | Pool | Models | Keys | Daily cap |
|---|---|---|---|---|---|
| **Solo** | 39 DT/mo | 35M | `fast`, `smart` | 2 | 3.5M |
| **Starter** | 50 DT/mo | 50M | `fast`, `smart` | 3 | 3M |
| **Pro** | 90 DT/mo | 50M | `smart`, `frontier`, `fable` | 15 | 8M |
| **Team** | 250 DT/mo | 150M | `smart`, `frontier`, `fable` | 30 | 15M |
| **Business** | 500 DT/mo | 400M | `smart`, `frontier`, `fable` | 100 | 40M |
| *Trial* | free | 1M | `fast`, `smart` | 1 | 250k |

Pro differs from Starter by **model class and key count**, not by volume — the
pool is the same 50M. Team and Business are bigger pools and more keys on one
invoice; seats were removed in `0044_remove_seats.sql` because a seat is a
billing concept the gateway cannot enforce.

The pool is stated once, on a single alias key in `plans.token_limits`. The key
is where the total is written, not what it may be spent on — `plans.models`
decides that. Repeating the total on every alias is the `0025` mistake that
made a 50 DT plan worth 1,200 DT of tokens.

### What counts: weighted units

One unit is one fresh `smart` input token. Everything else is converted:

```
units = ( fresh_input
        + output            × 5
        + cache_writes      × 2
        + min(cache_read, 64_000) / 10 )
      × model_weight          # fast ⅓ · smart 1 · frontier 5 · fable 5
```

The weights are not arbitrary: they track the upstream price ratio, so a
customer who spends their whole pool on `frontier` costs the same as one who
spends it on `smart`. Cache reads are capped at 64k per request because a
desktop client re-sends the entire conversation every turn — a chat turn bills
about 70 cached tokens, a Desktop session 602,080.

`prompt_count` counts only a `200` — a rejected or failed request is not a
prompt. The token sums are not filtered by status, so a request that failed
after the upstream had already reported usage still bills its tokens.

### The window

The wall sums `usage_records` over the **subscription period**, not the
calendar day and not the calendar month. `usageWindowForSubscription()` in
`portal/lib/entitlements/quota.ts` is the single definition; the dashboard
bundle and the gateway wall both call it, so the number a customer is shown and
the number that blocks them cannot diverge. At renewal the new period starts
empty and the plan re-allows automatically.

`plans.daily_token_cap` is a second, independent ceiling measured per Tunis
day. It exists because one runaway agent loop can spend a month of margin in an
hour. It is a safety rail, not the product's quota.

### The wall

```
allowed = entitled WHERE units_used < pool
```

At `49,999,999` of a 50M pool the plan serves; at `50,000,000` the allowlist
becomes `[]` and every alias on that plan stops at once. There is no per-alias
exhaustion: the pool is shared, so `computeTokenAllowedModels()` returns the
whole entitled list or nothing. Inference then returns:

```
403  Out of tokens for this period. Upgrade for more or wait for renewal.
```

A missing or `0` pool means *unlimited* in LiteLLM's own semantics, which is
the most expensive possible failure — so a migration guard refuses to ship a
public plan without a pool and a dinar price.

## Repository layout

```
config/            litellm.yaml (aliases, rates, routing) · Caddyfile (public surface)
edge/              auth-edge: the zn- → sk- boundary, the Responses shim, the upstream guard
engine/            Rust: axum + tantivy document extraction and search
portal/            Next.js 16 app — dashboard, chat, billing, admin, API routes
  app/             41 pages · 76 API routes
  components/      16 dirs — ui/ (Base UI primitives) · ai/ · chat/ · admin/ · marketing/ · docs/
  lib/             25 dirs — chat/ (26 modules) · entitlements/ · billing/ · pricing/ · models/
  scripts/         jobs.ts — the ten background jobs
  db/migrations/   52 forward-only SQL migrations, each with its reasoning in the header
  tests/           86 files, 1,347 assertions
docs/              11 operator documents (see below)
prices/            models.yaml — the rate table the ledger reconciles against
scripts/           db-init, db-migrate, smoke, backup, restore, reconcile, probes
```

## Local development

Local machine = editor and git. The stack also runs locally for proofs, but the
VPS is the only place it serves traffic — latency measured anywhere else is
fiction, because every layer between the client and the upstream adds a hop you
cannot model from a laptop.

```bash
make init            # .env from template, secrets generated
make probe           # ⭐ detect which wire formats the upstream supports — run this first
make up              # the full stack
make health          # gateway, portal, jobs, Postgres, pricing wiring
make accounts        # seed a customer + staff login
make plan            # put the local account on a plan so chat works
```

```bash
cd portal
npm install
npm run typecheck    # tsc --noEmit
npm test             # vitest — 1,347 assertions
npm run build        # next build (standalone)
```

`make help` lists all 43 documented targets. The ones used most:

| Target | What it proves |
|---|---|
| `make verify-config` | YAML and shell parse — runs anywhere, no containers |
| `make verify-engine` | Rust extraction and search, no Docker needed |
| `make verify-metering` | Metering end to end: ledger, cost, dedupe, revoke |
| `make verify-d17` | The manual D17 path: duplicate, expiry, double-approve, staff gate |
| `make verify-dodo` | The card path: checkout, signed webhook, replay, grace, cancel |
| `make verify-grant` | Manual plan grant: one row, idempotent window, audit, cut |
| `make smoke KEY=…` | The acceptance suite (A-1…A-16) against a live tenant key |
| `make backup-drill` | Dump → scratch DB → sanity checks → drop |

## Deploy

Push to `main`. Nothing else.

A self-hosted GitHub Actions runner on the production box
(`.github/workflows/deploy.yml`) refuses a dirty tree, fast-forwards, runs
`make db-init && make db-migrate` **before** the new code is up, rebuilds,
restarts LiteLLM for its bind-mounted config, then gates on: ≥8 model groups
from `/model/info`, gateway readiness, portal `/api/health` reporting
`"database":true`, the jobs runner alive, the engine answering `"ok":true`, and
searxng returning a real JSON search. One deploy at a time; the latest commit
wins.

```bash
git push origin main
gh run list --repo Louay0007/gateway --limit 3
```

Two rules the pipeline enforces, both learned the hard way:

1. **Never hand-edit tracked files on the VPS.** The deploy refuses a dirty
   tree, including hotfixes made over SSH during an incident. Back the diff up,
   commit it properly from local, push.
2. **Migrations are forward-only and ledger-guarded.** Each `*.sql` applies
   exactly once (`schema_migrations`). Recovery is `make restore`, never a
   down-migration.

`make deploy HOST=gateway@<ip>` remains as a manual fallback for first-time
bootstrap; it runs the same migrate → rebuild → health sequence and never
copies `.env`.

## Documentation

| Document | What it answers |
|---|---|
| [`docs/deploy.md`](docs/deploy.md) | Host, runner, work directory, the ten-step deploy order |
| [`docs/ROUTING.md`](docs/ROUTING.md) | Which alias resolves to which deployment, and why |
| [`docs/auth-edge.md`](docs/auth-edge.md) | The `zn-` → `sk-` boundary and its fail-closed rules |
| [`docs/aipilot-upstream.md`](docs/aipilot-upstream.md) | Using AiPilot as the gateway upstream |
| [`docs/claude-desktop.md`](docs/claude-desktop.md) | Claude Desktop against the gateway |
| [`docs/opencode-desktop.md`](docs/opencode-desktop.md) | OpenCode Desktop client setup |
| [`docs/device-code-flow.md`](docs/device-code-flow.md) | Desktop sign-in without pasting a key |
| [`docs/d17-payments.md`](docs/d17-payments.md) | D17 (La Poste Tunisienne) — the manual rail |
| [`docs/dodo-payments.md`](docs/dodo-payments.md) | Dodo Payments — the international card rail |
| [`docs/usage-tracking-gaps.md`](docs/usage-tracking-gaps.md) | The portal ↔ desktop usage contract, and every gap in it |
| [`docs/ux-world-class-plan.md`](docs/ux-world-class-plan.md) | The UX, IA and design plan |
| [`portal/docs/dashboard-architecture.md`](portal/docs/dashboard-architecture.md) | Dashboard architecture |
| [`portal/docs/dashboard-ux-plan.md`](portal/docs/dashboard-ux-plan.md) | The dashboard's UX plan |
| [`portal/docs/hardening-round-1.md`](portal/docs/hardening-round-1.md) | Gaps closed in the first hardening round |

The code comments are the authoritative record for each decision. Every
migration header states the problem it solves and what it supersedes; every
non-obvious module explains *why* it exists, not what it does.

## Payments

Two rails, deliberately independent:

- **D17** (La Poste Tunisienne) — a transfer, verified by staff or by the
  auto-verification agent (`0050_d17_auto_verify.sql`). Priced in
  `plans.price_tnd_millimes`. Works for every plan.
- **Dodo Payments** — card, USD, priced in `plans.price_cents`. Live for
  Starter and Pro; the newer tiers have a display price but no provider price
  id yet, and checkout fails with an error naming the plan rather than
  silently charging the wrong amount.

Neither price is derived from the other (`0037_dodo_and_seat_prices.sql`).
`BILLING_PROVIDER` sets the default rail; the customer's choice at checkout
overrides it per session.

## Operations console

The staff console is the portal's `/admin`, on its own host
(`CONSOLE_DOMAIN`). It is not IP-gated and has **no shared access code**: sign-in
is a username and password held in `staff_credentials`, and the console cookie
is a different cookie from the customer session (`authjs.staff-session-token`),
so neither credential can act as the other. Four tiers —
`read_only < support < admin < owner` — resolved from `staff_users` on every
request, never from a customer's org. Staff are never org members, and there is
no impersonation.

| Page | What it answers |
|---|---|
| `/admin/ops` | Job health and ledger freshness |
| `/admin/customers` | Search a **person**, every org they belong to |
| `/admin/customers/[id]` | One human: orgs, verification, login state, unlock / re-send |
| `/admin/orgs` | Account roster: retry sync, grant plan, record credit, suspend, reactivate |
| `/admin/orgs/[id]` | One account: actions, subscription lifecycle, keys (revoke), devices, notes, members, D17 payments, history |
| `/admin/subscriptions` | What expires next: cancel, resume, remove, extend |
| `/admin/payments` | Cross-org D17 ledger + the webhooks that never completed |
| `/admin/payments/[id]` | One payment: transfer, decision, automatic-verifier readings |
| `/admin/d17` | Approve or reject a payment proof |
| `/admin/usage` | Per-account revenue, upstream cost, margin |
| `/admin/credits` | The refund ledger, read back |
| `/admin/trials` | Campaign codes: create, cap, deactivate, redemptions |
| `/admin/system` | Locked-out logins and unverified accounts |
| `/admin/plans` | Plan CRUD (owner only) |
| `/admin/audit` | Who changed what |
| `/admin/staff` | Grant, change, revoke staff access (owner only) |

Removing a subscription is a **status change, not a DELETE**: `payments_d17`
cascades from it, so a delete would take the evidence that money arrived.

LiteLLM's own Admin UI has **no public vhost**. Reach it over SSH:

```bash
ssh -L 4000:localhost:4000 gateway@<ip>   # then http://localhost:4000/ui
```

## Operating notes

**Postgres is mandatory.** Without it LiteLLM's budgets are silently no-ops.
`make health` checks this.

**Cache writes are priced by TTL.** `cache_creation_input_tokens` is a single
merged field; 5m and 1h writes are priced identically here (2× input), which
under-bills a 1h write if the upstream charges more. `make reconcile` detects
the drift against a real invoice.

**Taking payment for model access is resale.** Anthropic's Commercial ToS
permits powering your own products (§A.1) and forbids reselling the Services
without express approval (§D.2). A payment processor permitting it is not the
upstream permitting it. Private and team use can proceed; third-party use
should wait for a written answer. If your own upstream is itself a reseller,
you inherit its exposure.

**`rate_multiplier_bps` is the business model.** At 1.30 the gross margin is
about 23%. Below roughly 1.20 you subsidise your heaviest users, and your
heaviest users always use their full allowance. The overage invariant
(`markup == multiplier − 10000`) is asserted in `portal/tests/security.test.ts`.

## Licence

Proprietary. `Cargo.toml` declares `license = "proprietary"`; there is no
LICENSE file granting rights. All rights reserved.

Third-party trademarks and logos used on the marketing and docs surfaces are
attributed in [`portal/public/logos/ATTRIBUTION.md`](portal/public/logos/ATTRIBUTION.md)
and [`portal/public/logos/ATTRIBUTION-PROVIDERS.md`](portal/public/logos/ATTRIBUTION-PROVIDERS.md).
