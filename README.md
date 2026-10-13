# LLM Gateway + SaaS Platform

Two components:

```
                            ┌──────────── CONTROL PLANE ────────────┐
customer ──▶ portal ──▶ Next.js dashboard, auth, billing, admin    │
                            │           ▲                           │
                            │           │ usage (REST, never SQL)    │
                            ▼           │                           │
                            └──── DATA PLANE ───────────────────────┘
your client ──sk-your-key──▶ api.yourdomain.com ──real-key──▶ upstream
                             (Caddy + LiteLLM)                (both formats)
```

The **gateway** issues scoped keys and enforces token/spend ceilings. The
**portal** turns that into a product: dashboards, plans, payments, and an
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

## Stack

**Gateway:** Caddy (TLS) → LiteLLM Proxy v1.103.1 → PostgreSQL 16 + Redis 7
**Portal:** Next.js 16 + TypeScript + Drizzle + Auth.js (self-hosted) + D17 manual
transfer (La Poste Tunisienne) — there is no card path; Stripe was removed.

Docker Compose, single VPS. Gateway infra ~$5/mo, with portal ~$12/mo.

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
git add -A && git commit -m "..." && git push

# ── deploy ────────────────────────────────────────────────────
make deploy HOST=gateway@<VPS_IP>  # rsync (never copies .env), restarts

# ── VPS, first time only ──────────────────────────────────────
ssh gateway@<VPS_IP>
cd /opt/gateway && make init       # .env is created HERE, never in git
$EDITOR .env                       # API_DOMAIN, UPSTREAM_*, secrets
make probe                         # ⭐ detects upstream format support
make up && make health
make key ALIAS=acme MODELS=fast,smart BUDGET=50
make smoke KEY=sk-...              # 17-test acceptance suite
```

## Why the probe comes first

If your upstream is **OpenAI-compatible only**, LiteLLM must *translate*
`/v1/messages` requests — and its own docs confirm this **drops
`cache_control`**. Prompt caching then silently fails, and a cache-read token
that should cost 0.1× is billed at 1×. That's a ~10× cost increase on repeated
prefixes, with nothing in the logs indicating a problem.

`make probe` tells you which situation you're in before you build on it.

## Clients

```bash
# Claude Code  — note ANTHROPIC_API_KEY MUST be empty
export ANTHROPIC_BASE_URL=https://api.yourdomain.com
export ANTHROPIC_AUTH_TOKEN=sk-your-key
export ANTHROPIC_API_KEY=""
```

```python
# OpenAI SDK
OpenAI(api_key="sk-…", base_url="https://api.yourdomain.com/v1")

# Anthropic SDK
Anthropic(base_url="https://api.yourdomain.com", api_key="sk-…")
```

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
# then: https://code.yourdomain.com
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

## Portal

The portal is a Next.js app under `portal/` — **26 API routes** covering auth,
orgs, keys, usage, billing, D17 payments, admin, profile and account deletion.
Payments are **manual D17 transfers** verified by staff: the customer submits a
proof, staff approve it, and the subscription activates. There is no card path.

```bash
cd portal
npm install
npm run typecheck                    # tsc --noEmit
npx vitest run                       # unit tests (120)
npm run build                        # next build (standalone)

# Migrations are forward-only and applied from the repo root:
make db-migrate                      # applies 0001..0008, once each
```

Current schema migrations: `0006_account_operations` (session invalidation),
`0007_d17_renewals` (per-period payment history, renewals), `0008_email_verification`.

Implementation order matters — entitlements and payment activation are where
"customer paid but has no access" and "customer paid twice" bugs live. Both are
silent. See [PLATFORM.md §12](PLATFORM.md#12-implementation-plan) and the
authoritative current-state notes in [HANDOFF.md](HANDOFF.md).

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
```