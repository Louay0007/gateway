# Platform Design — Multi-tenant LLM SaaS

**Status:** Architecture + implementation plan (design document).
**Date:** 2026-10-11 (this document); billing path amended 2026-10-13.
**Builds on:** `DESIGN.md` (gateway) and `BLUEPRINT.md` (analysis/legal).
**Supersedes:** nothing. Adds the control plane that `DESIGN.md` assumed absent.

> **⚠️ Current-state note (2026-10-13) — read `HANDOFF.md` for what is actually built.**
>
> The **payment path is manual D17 transfer (La Poste Tunisienne), NOT Stripe.**
> Stripe was removed: the gateway runs in a market where card processing is not
> available, so a customer transfers to a D17 wallet, uploads a proof, and staff
> approve it. Every Stripe reference below (§2.2, §6, the `stripe_*` columns,
> `stripe_events`, Stripe Meters) describes the ORIGINAL design and is
> **superseded** by:
>
> - `portal/lib/billing/d17*.ts` — checkout, proof intake, staff approval;
> - migration `0005_d17_payments.sql` (+ `0007_d17_renewals.sql`) — the real
>   payment tables (`payments_d17`, `billing_events`);
> - `HANDOFF.md` — the authoritative description of the shipped surface;
> - `plans/complete-the-dev.md` — the completed execution log.
>
> The economics, tenancy model, schema shape, and enforcement architecture in
> this document still hold; only the provider integration section is stale.

---

## 0. Read this first — the business model determines the architecture

Adding payments changes the legal position, not just the feature set. There are
three viable structures. **Pick one before writing code.**

### Model A — Resale (you hold the key, customers pay you)

```
customer → pays you → you hold upstream key → upstream
```

- Revenue: markup over token cost.
- **Requires express approval from your upstream.** Anthropic's Commercial ToS
  §D.2 forbids reselling "except as expressly approved by Anthropic." A Google
  developer forum thread from Sep 2026 shows developers asking this exact
  question about Gemini and still awaiting a clear answer — assume silence is
  not permission.
- Stripe permits it. Stripe's restriction is not your restriction.
- **Also need:** cardholder verification, velocity limits, chargeback reserve.
  Instant-consumed digital goods are the classic fraud target.

### Model B — BYOK (customer holds the key, you sell the software)

```
customer → holds own upstream key → upstream
customer → pays you → your platform (routing, budgets, dashboards, teams)
```

- You sell software, not tokens. The resale clause is not triggered because you
  never touch the tokens.
- Customers bring their own provider relationship, pricing, and ToS compliance.
- You still get: metering, budgets, dashboards, team management, alerting,
  prompt-management, evals — which is what `DESIGN.md` already builds.
- **Lower revenue, dramatically lower legal and fraud exposure.**

### Model C — Internal / private team only

No payments. Dashboard for your own team. Everything in `DESIGN.md` applies
unchanged. Ship this first regardless of which model you pick — the portal's
usage and admin surfaces are identical across all three.

### Recommendation

**Build C, keep BYOK (B) in the design, pursue written approval for (A).**

The portal, metering pipeline, and admin console are ~85% identical across all
three. Only two things change:
1. Who holds the upstream credential (a column in your `organizations` table).
2. Whether usage is metered against a subscription or reported for awareness.

Do not hardwire the decision. §6 specifies the schema so it can hold either.

---

## 1. Architecture — control plane / data plane

The gateway and the portal must not be one application. The gateway's job is to
be fast, unauthenticated-except-by-key, and never fail because a dashboard query
is slow. The portal's job is to be correct about money and never be on the
critical path of an API call.

```
┌───────────────────────────────────────────────────────────────────────┐
│  PORTAL — control plane                                               │
│                                                                       │
│  Next.js 16 App Router (TypeScript)                                  │
│  ┌─────────────┬─────────────┬──────────────┬────────────────────┐  │
│  │  Marketing  │  Customer   │  Billing     │  Admin console     │  │
│  │  /pricing   │  dashboard  │  checkout    │  users, subs, keys │  │
│  └─────────────┴─────────────┴──────────────┴────────────────────┘  │
│                                                                       │
│  Route handlers: /api/plans /api/keys /api/usage /api/subscription    │
│                  /api/stripe/webhook  /api/admin/*                   │
└───────────────┬───────────────────────────────────┬──────────────────┘
                │                                   │
       ┌────────▼─────────┐              ┌──────────▼──────────┐
       │  portal DB       │              │  Stripe             │
       │  (Postgres)      │              │  Billing + Meters   │
       │  users, orgs,    │              └──────────▲──────────┘
       │  subs, entitle-  │                         │ meter events
       │  ments, usage    │                         │ (idempotent)
       └────────▲─────────┘                         │
                │                                   │
                │  REST only                        │
       ┌────────┴───────────────────────────────────┴──────────────────┐
       │  USAGE COLLECTOR (cron worker)                               │
       │  LiteLLM spend logs → portal.usage_records → Stripe meters   │
       └────────▲────────────────────────────────────────────────────┘
                │
┌───────────────┴───────────────────────────────────────────────────────┐
│  GATEWAY — data plane                                                 │
│  Caddy (TLS) → LiteLLM Proxy (keys, budgets, teams, rate limits)    │
│  Postgres (litellm schema) + Redis                                   │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.1 The one architectural rule that matters

> **The portal talks to LiteLLM only through its REST API. Never write SQL
> against LiteLLM's database.**

LiteLLM's schema (`LiteLLM_VerificationToken`, `LiteLLM_SpendLogs`,
`LiteLLM_TeamTable`, …) is an internal implementation detail that changes
between releases. Direct SQL works until the next upgrade, then silently
corrupts your entitlement sync.

```
✅  POST /key/generate, /key/update, /team/new, /user/info, /spend/logs/ui
❌  SELECT * FROM LiteLLM_VerificationToken WHERE ...
```

Exception: the usage collector may call the documented `/spend/logs/ui`
endpoint. If its schema is insufficient, fall back to querying LiteLLM's own
daily-usage endpoints, not raw tables.

### 1.2 Two databases, one cluster

```
Postgres 16
├── database: litellm    ← owned by LiteLLM. Portal has read-only REST access.
└── database: portal     ← owned by you. Full control, you write its schema.
```

Separate databases, not schemas. LiteLLM runs Prisma migrations; you must never
be in its migration path.

### 1.3 Sync direction

```
Portal DB  ──(writes entitlements)──▶  LiteLLM REST API  ──▶  LiteLLM enforcement
LiteLLM    ──(REST, read-only)─────▶  Portal DB           ──▶  dashboards
```

Entitlements flow **down** (portal → gateway, push on change). Usage flows
**up** (gateway → portal, pull on a schedule). Never the reverse. The gateway
must never call the portal.

---

## 2. Locked tech stack

| Layer | Choice | Pin | Rationale |
|---|---|---|---|
| **Portal framework** | **Next.js 16** (App Router) | `16.x` | Server Components + Route Handlers in one deploy. RSC keeps the billing secret server-side by construction |
| Language | TypeScript | `5.x` | `strict: true`, no `any` |
| **Auth** | **Auth.js (NextAuth v5)** | `5.0.0-beta.32` (exact) | **DECIDED — self-hosted.** No external IdP, no third-party service in the auth path (PLATFORM.md §14 #2, answered) |
| **Auth (alternative)** | Clerk | `@clerk/nextjs ^7` | Reconsidered only if managed abuse protection + prebuilt org UI becomes worth an external dependency |
| **ORM** | **Drizzle** | `0.x` | Type-safe, SQL-transparent, no runtime. Pairs natively with Postgres |
| DB | PostgreSQL | `16` | Shared cluster with the gateway |
| **Billing** | **Stripe Billing + Meters** | latest | Real-time streaming meters, not end-of-month recalculation |
| **UI kit** | shadcn/ui + Tailwind | latest | Accessible primitives, you own the source, no vendor lock |
| Charts | Recharts | `2.x` | — |
| Tables | TanStack Table | `8.x` | Headless, works with server-side pagination |
| Validation | Zod | `3.x` | One schema at every boundary |
| Email | Resend | — | Receipts, trial-ending, payment-failed |
| Tax | Stripe Tax | — | Digital goods across jurisdictions, automatic |
| Jobs | Postgres + `FOR UPDATE SKIP LOCKED` | — | No Redis/BullMQ for v1. See §7.4 |
| Tests | Vitest + Playwright | — | Unit/integration + E2E on the money path |
| Runtime | Node 22 LTS | — | — |
| Deploy | Docker Compose (same VPS) | — | One box until ~10k DAU |

### 2.1 Clerk vs Auth.js — DECIDED: Auth.js

**Answered 2026-10-11: Auth.js (NextAuth v5), fully self-hosted.** No
external identity provider participates in authentication. Rationale: no
third-party dependency in the auth path, credentials hashed locally with
scrypt, and identity data never leaves the VPS. This is §14 open decision #2,
resolved — not a reversal of a locked DESIGN.md §11 row (auth provider was
never in that table).

| | Clerk | Auth.js ← **chosen** |
|---|---|---|
| Setup | 5–15 min via CLI | 15–45 min + DB + UI |
| Organizations / teams | Built in | Build it (schema exists) |
| Self-host possible | **No** | Yes |
| Managed abuse protection | Yes | No — we implement it (see below) |
| Cost | Free ≤50k MRU, then paid | Free, you pay infra |

**What we now own, and how it is covered.** Choosing self-hosting means
owning the controls Clerk would have provided:

| Concern | Control | Where |
|---|---|---|
| Password storage | scrypt, N=2^16, self-describing hash, rehash-on-login | `portal/lib/auth/password.ts` |
| Brute force | Progressive backoff, identity-keyed, in Postgres | `portal/lib/auth/throttle.ts` |
| Account enumeration | KDF runs even for unknown users; identical error copy | `password.ts`, `actions.ts` |
| Session revocation | DB-verified on **every** request (see below) | `portal/lib/auth/authorize.ts` |
| Password reset / email verify | Not yet — needs a mail transport (Phase 6) | — |

**Two Auth.js v5 constraints, found by running it (not documented in
these docs):**

1. **Credentials ⇔ JWT only.** The Credentials provider cannot be used with
   database sessions — `Signing in with credentials only supported if JWT
   strategy is enabled`. Sessions are therefore JWTs, so session deletion
   cannot revoke an already-issued token. Immediate revocation is instead
   enforced one level up: `requireOrgMembership()` / `requireStaff()`
   re-read `users` / `staff_users` on every protected action, so deleting
   an account kills access on the next request even for a token copied
   beforehand. This is stronger than dropping a session row. Session
   `maxAge` is 7 days.
2. **No adapter.** With no OAuth provider and JWT sessions an adapter has
   nothing to persist, and its account-linking path fails with
   `CallbackRouteError`. `auth_users` / `auth_credentials` are written
   directly by the app.

`AUTH_DEBUG=true` logs Auth.js internals **including the POST body**, which
for the credentials callback contains the plaintext password. It is
gated off by default and must never be enabled in production.

Mirror users into `portal.users`. Never read user profile data from the
auth provider at request time — it couples every page render to a
third-party API and its latency.

### 2.2 Clerk Billing vs Stripe Billing — pick one

Clerk has its own subscription management (0.7% + Stripe fees, same cost as
Stripe Billing). Its plans live in the Clerk Dashboard and **do not sync with
Stripe Products**.

**Use Stripe Billing directly.** You need Stripe Meters for usage billing, and
running plans in two systems creates a reconciliation problem you cannot
debug. Clerk is for auth and orgs only.

---

## 3. Domain model

### 3.1 Entity relationships

```
auth_user (Clerk) ──1:1──► users
                                │
                                ├──*──1── organizations ──1──*── organization_members
                                │            │                        (user, role)
                                │            │
                                │            ├──1:1── subscriptions
                                │            │            ├── plan_id
                                │            │            ├── stripe_customer_id
                                │            │            ├── stripe_subscription_id
                                │            │            └── status
                                │            │
                                │            ├──1:1── entitlements  (derived, cached)
                                │            │
                                │            ├──1:1── api_keys
                                │            │            ├── litellm_token_hash
                                │            │            ├── litellm_key_name
                                │            │            └── key_prefix  (sk-ab…x9f2)
                                │            │
                                │            ├──*──*── usage_records  (immutable)
                                │            │
                                │            └──1:1── usage_periods  (current-period rollup)

plans ──1:*── subscriptions
plans ──1:1── entitlements_template
```

### 3.2 Why `organizations`, not just `users`

A plan is bought by a **company**, not a person. Seats are org members. API keys
belong to an org and share its subscription and budget. Modelling a
`plan_id` directly on `users` forces you to rewrite the schema the first time
someone invites a colleague — which is week two.

This maps **exactly** onto LiteLLM teams:

| Portal | LiteLLM |
|---|---|
| `organizations` | `LiteLLM_TeamTable` (team) |
| `organization_members` | keys under `team_id` |
| Subscription budget | `team_max_budget` + `budget_duration` |
| Plan model allowlist | `team.models` / per-key `models` |
| Member attribution | `user_id` on the key |

### 3.3 Schema

```sql
-- ═══════════════════════════════════════════════════════════════════
--  users — mirror of the auth provider. Authoritative for domain logic.
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_provider   TEXT        NOT NULL,        -- 'clerk' | 'authjs'
  auth_id         TEXT        NOT NULL,        -- provider user id
  email           CITEXT      NOT NULL,
  name            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_auth_provider_auth_id_key UNIQUE (auth_provider, auth_id)
);
CREATE UNIQUE INDEX users_email_key ON users (email);

-- ═══════════════════════════════════════════════════════════════════
--  organizations — the billing entity
-- ═══════════════════════════════════════════════════════════════════
CREATE TYPE org_status AS ENUM ('active','suspended','deleted');

CREATE TABLE organizations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               TEXT        NOT NULL UNIQUE,
  name               TEXT        NOT NULL,
  status             org_status  NOT NULL DEFAULT 'active',

  -- Upstream credential ownership. See §0.
  -- 'platform' = we hold the key (Model A) — requires written approval.
  -- 'byok'     = customer holds their own key (Model B).
  key_ownership      TEXT        NOT NULL DEFAULT 'platform'
                       CHECK (key_ownership IN ('platform','byok')),

  -- Model B: encrypted customer-supplied credential. NEVER log this.
  byok_provider      TEXT,
  byok_ciphertext    BYTEA,
  byok_last4         TEXT,

  litellm_team_id    TEXT UNIQUE,   -- created via POST /team/new
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);
CREATE INDEX organizations_status_idx ON organizations (status) WHERE status <> 'deleted';

CREATE TYPE org_role AS ENUM ('owner','admin','developer','billing','viewer');

CREATE TABLE organization_members (
  organization_id  UUID     NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          UUID     NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  role             org_role NOT NULL DEFAULT 'developer',
  litellm_user_id  TEXT,                    -- for per-member attribution
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX organization_members_user_idx ON organization_members (user_id);

-- ═══════════════════════════════════════════════════════════════════
--  plans — catalog. Rows here are the ONLY source of entitlement truth.
-- ═══════════════════════════════════════════════════════════════════
CREATE TYPE plan_interval AS ENUM ('month','year');

CREATE TABLE plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              TEXT        NOT NULL UNIQUE,  -- 'free','starter','pro','business'
  name              TEXT        NOT NULL,
  description       TEXT,
  public            BOOLEAN     NOT NULL DEFAULT true,
  sort_order        INT         NOT NULL DEFAULT 0,

  -- Stripe. NULL for the free plan.
  stripe_price_id   TEXT UNIQUE,

  price_cents       INT         NOT NULL DEFAULT 0,
  interval          plan_interval NOT NULL DEFAULT 'month',

  -- ── Entitlement template ────────────────────────────────────────
  -- Every number that becomes a LiteLLM limit lives here. Adding a new
  -- plan dimension is a row update, not a code change.
  included_spend_cents     INT NOT NULL DEFAULT 0,   -- monthly allowance
  overage_markup_bps       INT NOT NULL DEFAULT 3000, -- 30% over upstream cost
  hard_cap_cents           INT,                       -- NULL = unlimited
  rpm_limit                INT,
  tpm_limit                INT,
  max_concurrent_requests  INT,
  max_keys                 INT NOT NULL DEFAULT 1,
  max_seats                INT NOT NULL DEFAULT 1,
  rate_multiplier_bps      INT NOT NULL DEFAULT 10000, -- customer-facing rate
  models                   TEXT[] NOT NULL DEFAULT '{}',
  trial_days               INT NOT NULL DEFAULT 0,
  features                 JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════
--  subscriptions
-- ═══════════════════════════════════════════════════════════════════
CREATE TYPE sub_status AS ENUM (
  'trialing','active','past_due','canceled','unpaid','paused','incomplete'
);

CREATE TABLE subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id                  UUID NOT NULL REFERENCES plans(id),
  status                   sub_status NOT NULL,
  stripe_customer_id       TEXT,
  stripe_subscription_id   TEXT UNIQUE,
  current_period_start     TIMESTAMPTZ,
  current_period_end       TIMESTAMPTZ,
  cancel_at_period_end     BOOLEAN NOT NULL DEFAULT false,
  trial_end                TIMESTAMPTZ,

  -- Last Stripe event applied. Guards webhook reordering.
  last_stripe_event_id     TEXT,
  last_stripe_event_at     TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_org_idx  ON subscriptions (organization_id);
CREATE INDEX subscriptions_status_idx ON subscriptions (status);
-- One live subscription per org.
CREATE UNIQUE INDEX subscriptions_one_live_idx ON subscriptions (organization_id)
  WHERE status IN ('trialing','active','past_due','paused');

-- ═══════════════════════════════════════════════════════════════════
--  entitlements — DERIVED from (plan × subscription.status). Never write
--  these by hand; sync_entitlements() is the only writer.
-- ═══════════════════════════════════════════════════════════════════
CREATE TYPE sync_status AS ENUM ('pending','synced','failed');

CREATE TABLE entitlements (
  organization_id      UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id              UUID NOT NULL REFERENCES plans(id),
  plan_code            TEXT NOT NULL,

  effective            JSONB NOT NULL,   -- full plan row snapshot at sync time
  status               sync_status NOT NULL DEFAULT 'pending',
  synced_at            TIMESTAMPTZ,
  last_error           TEXT,
  attempts             INT NOT NULL DEFAULT 0,
  next_retry_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════
--  api_keys — we store the hash. The plaintext is shown exactly once.
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE api_keys (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by           UUID NOT NULL REFERENCES users(id),
  name                 TEXT NOT NULL,

  -- Prefix for display: "sk-live-ab…9f2". Never store the full key.
  key_prefix           TEXT NOT NULL,
  key_hash             TEXT NOT NULL,   -- sha256, if you need verification

  litellm_key_name     TEXT,            -- lookup handle for /key/update
  litellm_key_hash     TEXT,            -- LiteLLM's own token_hash

  revoked_at           TIMESTAMPTZ,
  last_used_at         TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_org_idx ON api_keys (organization_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX api_keys_litellm_name_idx ON api_keys (litellm_key_name)
  WHERE litellm_key_name IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════
--  usage_records — immutable ledger. Append only.
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE usage_records (
  id                    BIGSERIAL PRIMARY KEY,
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  api_key_id            UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  member_user_id        UUID REFERENCES users(id)   ON DELETE SET NULL,

  occurred_at           TIMESTAMPTZ NOT NULL,
  billing_period        DATE NOT NULL,          -- DATE(first day of period)

  model                 TEXT NOT NULL,
  route                 TEXT NOT NULL,          -- '/v1/messages'
  upstream_key_hash     TEXT,                   -- LiteLLM side, for dedupe

  input_tokens          INT NOT NULL DEFAULT 0,
  output_tokens         INT NOT NULL DEFAULT 0,
  cache_write_5m_tokens INT NOT NULL DEFAULT 0,
  cache_write_1h_tokens INT NOT NULL DEFAULT 0,
  cache_read_tokens     INT NOT NULL DEFAULT 0,
  latency_ms            INT,
  status_code           INT,

  -- ═══════════════════════════════════════════════════════════════
  --  Cost columns. Both are stored, deliberately.
  --
  --  cost_upstream_usd   what the provider charged US (or what a first-party
  --                      key reports). Drives plan profitability.
  --  cost_customer_usd   what we bill THEM (cost × rate_multiplier).
  --
  --  The gap between them is your margin. Storing only one makes the
  --  business invisible.
  -- ═══════════════════════════════════════════════════════════════
  cost_upstream_usd     NUMERIC(14,8) NOT NULL DEFAULT 0,
  cost_customer_usd     NUMERIC(14,8) NOT NULL DEFAULT 0,

  price_table_version   TEXT,                   -- historical rows stay auditable

  -- Dedupe: the collector retries, and upstream keys are not unique
  -- per request.
  dedupe_hash           TEXT NOT NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX usage_records_dedupe_idx ON usage_records (dedupe_hash);
CREATE INDEX usage_records_org_period_idx ON usage_records (organization_id, billing_period);
CREATE INDEX usage_records_occurred_idx    ON usage_records (occurred_at);

-- ═══════════════════════════════════════════════════════════════════
--  usage_periods — rollup for dashboards. Rebuilt from usage_records.
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE usage_periods (
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  billing_period    DATE NOT NULL,
  plan_id           UUID NOT NULL REFERENCES plans(id),
  rate_multiplier_bps INT NOT NULL,

  requests          BIGINT NOT NULL DEFAULT 0,
  input_tokens      BIGINT NOT NULL DEFAULT 0,
  output_tokens     BIGINT NOT NULL DEFAULT 0,
  cache_read_tokens BIGINT NOT NULL DEFAULT 0,

  cost_upstream_usd NUMERIC(14,8) NOT NULL DEFAULT 0,
  cost_customer_usd NUMERIC(14,8) NOT NULL DEFAULT 0,

  stripe_metered_at TIMESTAMPTZ,      -- last time this was pushed to Stripe
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, billing_period)
);

-- ═══════════════════════════════════════════════════════════════════
--  stripe_events — webhook idempotency
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE stripe_events (
  id                 TEXT PRIMARY KEY,      -- Stripe event id
  type               TEXT NOT NULL,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at       TIMESTAMPTZ,
  attempts           INT NOT NULL DEFAULT 0,
  last_error         TEXT
);
CREATE INDEX stripe_events_unprocessed_idx ON stripe_events (processed_at) WHERE processed_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════
--  audit_log — who changed what. Required for a money-moving product.
-- ═══════════════════════════════════════════════════════════════════
CREATE TYPE audit_actor AS ENUM ('user','system','stripe');

CREATE TABLE audit_log (
  id               BIGSERIAL PRIMARY KEY,
  actor_type       audit_actor NOT NULL,
  actor_id         TEXT,
  organization_id  UUID REFERENCES organizations(id) ON DELETE SET NULL,
  action           TEXT NOT NULL,      -- 'subscription.upgraded'
  target_type      TEXT,
  target_id        TEXT,
  before           JSONB,
  after            JSONB,
  ip               INET,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_time_idx ON audit_log (organization_id, created_at DESC);
CREATE INDEX audit_log_action_idx    ON audit_log (action, created_at DESC);
```

**Why `CITEXT` for email:** case-insensitive uniqueness without `LOWER()` on
every comparison. Extension: `CREATE EXTENSION IF NOT EXISTS citext;`

**Why `upstream_key_hash` + `dedupe_hash`:** the collector polls, so the same
LiteLLM spend-log row appears twice on retry. `dedupe_hash =
sha256(upstream_key_hash || startTime || model || request_id)` makes ingestion
idempotent via `ON CONFLICT DO NOTHING`.

---

## 4. Plan design

### 4.1 Pricing model: hybrid, not seat-based

Stripe's own AI-SaaS guidance and Bessemer's playbook converge on the same
conclusion:

> "A common AI SaaS pricing mistake is charging per seat when value scales with
> usage; it creates a margin problem that compounds as your best customers grow."

> "Mature AI SaaS businesses converge on hybrid pricing: a predictable base fee
> with a variable usage component that protects margins without creating bill
> shock."

**Seats gate seats. Tokens are metered.** Never price purely per seat — your
worst customer's inference bill is unbounded and your revenue is not.

### 4.2 The tier table

Numbers below are **illustrative**. Replace `included_spend_cents` with your
actual COGS × target margin. The *structure* is the deliverable.

| | Free | Starter | Pro | Business |
|---|---|---|---|---|
| Base price | $0 | $19 | $99 | $499 |
| Included upstream spend | $0 | $20 | $180 | $1,000 |
| Overage | — | 30% markup | 25% | 20% |
| Hard cap | $0 | $100 | $600 | $5,000 |
| Models | `fast` | `fast` | `fast`,`smart` | all |
| RPM | 10 | 60 | 300 | 1,200 |
| TPM | 20k | 200k | 1.5M | 8M |
| Concurrency | 1 | 5 | 20 | 80 |
| API keys | 1 | 3 | 15 | 100 |
| Seats | 1 | 2 | 10 | 50 |
| Trial | — | 7 days | 14 days | 14 days |
| Dashboard | basic | + 90-day history | + exports | + SSO, audit API |

### 4.3 Unit economics — the constraint that actually matters

```
Your COGS per request           = upstream tokens × provider price
Customer price                  = upstream tokens × provider price × multiplier

gross_margin = 1 − (1 / multiplier)

multiplier 1.00 →   0%   ← you lose money on every request
multiplier 1.25 →  20%
multiplier 1.30 →  23.1%
multiplier 1.50 →  33.3%
```

**`rate_multiplier_bps` is the single most important number in your business.**
At 1.30 you clear payment fees (~2.9% + $0.30 amortised), support, fraud
reserve, and still profit. Below ~1.20 you are subsidising your heaviest users.

Non-negotiable: **your `included_spend_cents` must be ≥ your true upstream
COGS × 1.3.** Publishing a plan whose included allowance is below cost means
every customer who uses it in full loses you money, and your heaviest users
always use it in full.

### 4.4 The caching trap in customer-facing pricing

This is where most LLM resellers quietly lose money.

Upstream cache reads cost **0.1×** input. If you price customers the same 0.1×,
a customer whose workload is 95% cached reads is nearly free to serve — and your
margin there is the same ratio, so a well-optimised customer can be your least
profitable one at high volume.

Two defensible choices:

| Strategy | How | Trade-off |
|---|---|---|
| **Pass-through caching** | Charge 0.1× reads to customers too | Simple, honest, attracts cache-heavy users |
| **Flatten caching** | Charge all input at 1×, no cache discount | Higher margin per token, needs clear disclosure |

Flattening is common but **must be disclosed in your pricing page**. Hiding it
and being discovered is a chargeback and a reputation problem.

Whichever you pick: `scripts/reconcile.sh` from the gateway must be the thing
that computes your billable quantity. Not LiteLLM's number, not a guess.

### 4.5 Tiering your own meters

Stripe meters support tiers. Recommended meter events:

```json
{
  "event_name": "llm_tokens",
  "payload": {
    "value":        "184320",            // customer-facing billable units
    "upstream_value": "141784"           // your actual cost, for margin reporting
  }
}
```

```jsonc
// Stripe meter: sums value; tiers apply at aggregation time.
{
  "event_name": "llm_tokens",
  "aggregation": { "formula": "sum" },
  "customer_mapping": { "type": "by_id", "event_payload_key": "org_id" },
  "value_settings": {
    "event_payload_key": "value",
    "unit": "token"
  },
  "default_aggregation": { "formula": "sum" },
  "tiers": [
    { "up_to":  1000000, "unit_amount": 0 },
    { "up_to": 10000000, "unit_amount": 15 },   // $0.15 per 1M over the tier
    { "up_to": null,     "unit_amount": 12 }    // better rate at volume
  ]
}
```

Volume discounts reward large customers without giving away margin on small
ones — and they reduce churn, since the marginal cost of staying is zero.

---

## 5. Entitlement sync — plan → gateway

This is the heart of the system. **One function, one writer, idempotent.**

```
  Stripe webhook                    OR                     User action
  (subscription.updated)          (admin overrides)
        │                                                   │
        └─────────────────┬─────────────────────────────────┘
                          ▼
              ┌───────────────────────┐
              │  1. BEGIN            │
              └───────────┬───────────┘
                          ▼
              ┌───────────────────────┐
              │ 2. Resolve plan       │
              │    (rows in `plans`)  │
              └───────────┬───────────┘
                          ▼
              ┌───────────────────────┐
              │ 3. Map status →       │
              │    EFFECTIVE or       │
              │    SUSPENDED          │
              └───────────┬───────────┘
                          ▼
              ┌───────────────────────┐
              │ 4. Write entitlements │  ← the cache
              │    status='pending'   │
              └───────────┬───────────┘
                          ▼
              ┌───────────────────────┐
              │ 5. Push to LiteLLM    │
              │    /key/update ×N     │
              │    /team/update       │
              └───────────┬───────────┘
                          ▼
              ┌───────────────────────┐
              │ 6. entitlements       │
              │    status='synced'    │  ← only after every push succeeded
              └───────────────────────┘
```

### 5.1 Status → effect mapping

This table is the whole failure-mode surface of a paid product.

| `subscriptions.status` | Effect | `max_budget` | Keys |
|---|---|---|---|
| `trialing` | Full plan access until `trial_end` | plan value | active |
| `active` | Full plan access | plan value | active |
| `past_due` | **Grace period** — do not hard-cut immediately | plan value | active |
| `unpaid` | Cut access | `0.000001` | active but starved |
| `canceled` | Cut access | `0.000001` | revoked |
| `paused` | Suspended, resumable | `0.000001` | active |
| `incomplete` | Cut access (first payment never succeeded) | `0.000001` | active |

**The `past_due` trap.** Stripe retries failed payments for days. If you
revoke on the first `invoice.payment_failed`, a customer with an expired card
loses service over a typo. Cut on `unpaid`, not `past_due`. Show a banner and
nudge the payment method.

**The revocation order matters.** To cut access, do *not* revoke keys —
revocation is confusing and irreversible from the customer's perspective. Set
`max_budget` to a tiny non-zero value instead. Their next request gets a clean
`429 budget_exceeded`, their dashboard shows exactly why, and reactivating is
one webhook, not a support ticket.

Set the budget to `0.000001`, **not** `0`. LiteLLM's limiter treats `0` as
"unlimited" (see `BLUEPRINT.md` §9.4). Zero would *grant* unlimited access.

### 5.2 The sync implementation

```ts
// lib/entitlements/sync.ts
import { db } from '@/db';
import { plans, subscriptions, entitlements, auditLog } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { updateTeamBudget, updateKeyLimits } from '@/lib/litellm/client';

type Effect = 'full' | 'throttled' | 'cut';

const STATUS_EFFECT: Record<string, Effect> = {
  trialing:  'full',
  active:    'full',
  past_due:  'full',      // grace period — cut on `unpaid`, not here
  unpaid:    'cut',
  canceled:  'cut',
  paused:    'cut',
  incomplete:'cut',
};

/** Smallest budget that reliably trips the limiter.
 *  MUST be > 0: LiteLLM reads 0 as "unlimited". */
const CUT_BUDGET = 0.000001;

export async function syncOrganizationEntitlements(
  organizationId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const [sub] = await db
    .select({ sub: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.plan_id))
    .where(and(
      eq(subscriptions.organization_id, organizationId),
      // only the live subscription
      eq(subscriptions.status, 'active'),   // ← replaced below; see note
    ))
    .limit(1);

  // Real query must not hardcode 'active' — trialing/paused are also live.
  // In practice use the partial unique index subscriptions_one_live_idx.
  const live = await getLiveSubscription(organizationId);
  if (!live) return { ok: false, error: 'no live subscription' };

  const plan = live.plan;
  const effect = STATUS_EFFECT[live.sub.status] ?? 'cut';

  const target = effect === 'full'
    ? { maxBudgetUsd: plan.included_spend_cents / 100 + plan.hard_cap_cents! / 100 || null }
    : { maxBudgetUsd: CUT_BUDGET };

  // ── 1. Cache the intended state so the dashboard is correct even if
  //       the push below fails.
  await db.insert(entitlements).values({
    organization_id: organizationId,
    plan_id: plan.id,
    plan_code: plan.code,
    effective: {
      effect, planCode: plan.code,
      rpm: plan.rpm_limit, tpm: plan.tpm_limit,
      concurrency: plan.max_concurrent_requests,
      models: plan.models, maxBudgetUsd: target.maxBudgetUsd,
    },
    status: 'pending',
    next_retry_at: new Date(),
  }).onConflictDoUpdate({
    target: entitlements.organization_id,
    set: { effective: {...}, status: 'pending', attempts: 0 },
  });

  // ── 2. Push down. Every key individually — a partial failure must not
  //       leave one key on an old plan.
  const keys = await getActiveKeys(organizationId);
  const failures: string[] = [];

  for (const k of keys) {
    try {
      await updateKeyLimits(k.litellm_key_name!, {
        models:            plan.models,
        rpm_limit:         plan.rpm_limit,
        tpm_limit:         plan.tpm_limit,
        max_parallel_requests: plan.max_concurrent_requests,
        ...(effect === 'full'
          ? { max_budget: plan.hard_cap_cents ? plan.hard_cap_cents / 100 : null }
          : { max_budget: CUT_BUDGET }),
      });
    } catch (e) {
      failures.push(`${k.litellm_key_name}: ${String(e)}`);
    }
  }

  if (failures.length) {
    await db.update(entitlements)
      .set({ status: 'failed', last_error: failures.join('; '), attempts: 0 })
      .where(eq(entitlements.organization_id, organizationId));
    return { ok: false, error: failures.join('; ') };
  }

  await db.update(entitlements)
    .set({ status: 'synced', synced_at: new Date(), last_error: null })
    .where(eq(entitlements.organization_id, organizationId));

  await db.insert(auditLog).values({
    actor_type: 'system', action: 'entitlements.synced',
    organization_id: organizationId,
    after: { effect, reason, plan: plan.code },
  });

  return { ok: true };
}
```

### 5.3 Trial expiry

A trial that does not expire on schedule is free compute.

```sql
-- Run every 5 minutes.
UPDATE subscriptions s
   SET status = 'incomplete'
  FROM organizations o
 WHERE s.organization_id = o.id
   AND o.status = 'active'
   AND s.status = 'trialing'
   AND s.trial_end < now();

-- Then sync each affected org (see §7.2 for the job runner).
```

Do this in SQL first, then push to the gateway. Doing it gateway-first leaves a
window where the dashboard says "trial expired" but the key still works.

---

## 6. Stripe integration

### 6.1 Why Billing Meters, not end-of-month recalculation

The naïve approach — compute usage monthly, create an invoice item — is a race
condition and will eventually double-bill or lose a period. Stripe's guidance
is to stream usage events in real time with an idempotency key.

```ts
// lib/stripe/meter.ts
export async function reportUsage(params: {
  orgId: string;
  stripeCustomerId: string;
  billableTokens: number;
  upstreamTokens: number;
  idempotencyKey: string;      // ← REQUIRED. See below.
}) {
  await stripe.billing.meterEvents.create({
    event_name: 'llm_tokens',
    payload: {
      org_id:        params.orgId,
      value:         String(params.billableTokens),
      upstream_value: String(params.upstreamTokens),
    },
    identifier: params.idempotencyKey,   // dedupes on retry
    timestamp: Math.floor(Date.now() / 1000),
  }, {
    idempotencyKey: `meter:${params.idempotencyKey}`,
  });
}
```

**`identifier` is what stops double-billing.** Your collector will crash and
retry. Without a stable identifier derived from the source row, you will
eventually charge a customer twice for the same tokens. Use
`sha256(org_id || billing_period || rollup_version)`.

### 6.2 Webhook handler

```ts
// app/api/stripe/webhook/route.ts
import { headers } from 'next/headers';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = await req.text();                 // raw bytes, BEFORE json()
  const sig  = (await headers()).get('stripe-signature')!;

  let event: Stripe.Event;
  try {
    // Verifies the signature. Do not parse first — parsing loses the bytes.
    event = await stripe.webhooks.constructEventAsync(
      body, sig, process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch {
    return new Response('invalid signature', { status: 400 });
  }

  // Idempotency: a replayed event returns 200 without reprocessing.
  const { rows } = await db.insert(stripeEvents)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing()
    .returning({ id: stripeEvents.id });

  if (rows.length === 0) {
    return new Response('already processed', { status: 200 });
  }

  try {
    await handleStripeEvent(event);
    await db.update(stripeEvents)
      .set({ processed_at: new Date() })
      .where(eq(stripeEvents.id, event.id));
  } catch (e) {
    await db.update(stripeEvents)
      .set({ attempts: sql`${stripeEvents.attempts} + 1`, last_error: String(e) })
      .where(eq(stripeEvents.id, event.id));
    // 500 → Stripe retries with backoff. Correct behaviour.
    return new Response('processing failed', { status: 500 });
  }

  // 200 fast. Heavy work happens in a job, not in the webhook response.
  return new Response('ok', { status: 200 });
}
```

### 6.3 Event → action map

| Event | Action |
|---|---|
| `checkout.session.completed` | Create/attach org, subscription record |
| `customer.subscription.created` | Insert subscription, `trialing`/`active` → sync |
| `customer.subscription.updated` | Update status/period, **always sync** |
| `customer.subscription.deleted` | Status `canceled`, **sync (cuts access)** |
| `customer.subscription.paused` | Status `paused`, sync |
| `customer.subscription.resumed` | Status `active`, sync |
| `customer.subscription.trial_will_end` | Email: trial ends in 3 days |
| `invoice.payment_succeeded` | Reset usage period, send receipt |
| `invoice.payment_failed` | **Banner only — do NOT cut access** |
| `charge.dispute.created` | Alert ops, audit log, flag org |

> If you later enable the Enterprise tier, `litellm_settings.allow_user_auth`
> lets gateway keys validate a signed JWT you mint, so `litellm` can reject
> unsubscribed orgs itself instead of relying on a webhook landing in time.
> That is defence in depth, not a replacement — the budget ceiling remains the
> hard guarantee.

### 6.4 Checkout

Use **Stripe Checkout** for v1. Do not build a card form. You are not
PCI-DSA-compliant and must not touch raw card data.

```
/pricing → [Choose plan] → POST /api/checkout
                           → stripe.checkout.sessions.create({
                               mode: 'subscription',
                               customer: org.stripe_customer_id,
                               line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
                               success_url: `${APP_URL}/dashboard?upgraded=1`,
                               cancel_url:  `${APP_URL}/pricing`,
                               subscription_data: {
                                 trial_period_days: plan.trial_days,
                                 metadata: { organization_id: org.id },
                               },
                               metadata: { organization_id: org.id },
                             })
                           → redirect
```

**`metadata.organization_id` on both the session and the subscription is not
optional.** It is how you map an inbound webhook back to a tenant. Without it
you are guessing from email addresses.

Upgrades: use Stripe's **Customer Portal** for self-serve plan changes. It
handles proration, which you will get wrong if you build it yourself.

---

## 7. Background jobs

### 7.1 Why not BullMQ

v1 needs four jobs on a schedule. Redis is already running for the gateway, but
coupling your billing pipeline to its availability is how you end up billing
customers from a half-restarted queue. Use Postgres with `SKIP LOCKED` — it is
transactional, inspectable, and has no new failure mode.

### 7.2 Job runner

```ts
// lib/jobs/runner.ts
export async function claimJob<T>(name: string, fn: () => Promise<T>) {
  const { rows } = await db.execute(sql`
    UPDATE job_runs
       SET locked_at = now(), attempts = attempts + 1
     WHERE name = ${name}
       AND (locked_at IS NULL OR locked_at < now() - interval '10 minutes')
    RETURNING name`);
  if (rows.length === 0) return;            // someone else has it

  try {
    await fn();
    await db.execute(sql`
      UPDATE job_runs SET last_run_at = now(), last_error = NULL,
             locked_at = NULL WHERE name = ${name}`);
  } catch (e) {
    await db.execute(sql`
      UPDATE job_runs SET last_error = ${String(e)}, locked_at = NULL
       WHERE name = ${name}`);
    throw e;
  }
}
```

`locked_at` with a 10-minute stale threshold means a crashed job self-heals.

### 7.3 Job schedule

| Job | Cadence | What |
|---|---|---|
| `collect_usage` | 5 min | Pull LiteLLM spend logs → `usage_records` |
| `rollup_usage` | 15 min | `usage_records` → `usage_periods` |
| `push_meters` | 1 h | `usage_periods` deltas → Stripe meters |
| `expire_trials` | 5 min | Trial → `incomplete`, sync affected orgs |
| `reconcile_entitlements` | 1 h | Re-push `pending`/`failed` rows |
| `reconcile_costs` | 1 d | Re-price against current `prices/models.yaml` |
| `detect_anomalies` | 15 min | Spike/abuse detection (§9.3) |

### 7.4 Why usage collection is idempotent

The collector polls a window. Any restart, timeout, or network blip replays
rows. `usage_records.dedupe_hash` with `ON CONFLICT DO NOTHING` makes ingestion
safe. Stripe's `identifier` does the same for metered billing. Neither is
optional.

---

## 8. Dashboard design

### 8.1 Customer dashboard pages

| Route | Contents |
|---|---|
| `/dashboard` | Spend vs plan, quota bars, key list, quickstart snippet |
| `/dashboard/usage` | Time series by day/model/route; token class breakdown |
| `/dashboard/usage/cost` | Upstream vs customer cost, margin, cache savings |
| `/dashboard/keys` | Create/revoke; full value shown exactly once |
| `/dashboard/team` | Members, roles, invite |
| `/dashboard/billing` | Plan, payment method, invoices, portal link |
| `/dashboard/settings` | Org name, webhook secret, BYOK credential |

### 8.2 The dashboard must never become the only source of truth

Every number shown must be derivable from `usage_records`. If a chart cannot be
reproduced by a SQL query, it will disagree with support later.

### 8.3 Showing cost to customers

Show them `cost_customer_usd`. Never `cost_upstream_usd` — that is your
margin, and publishing it invites margin disputes you will lose.

**But do show cache savings**, framed positively:

```
Cached reads saved you $4.12 this period (72% of input tokens were cache hits)
```

This educates customers to structure prompts well, which lowers your COGS and
their bill simultaneously. It is the one place transparency directly serves
both sides.

### 8.4 Admin console pages

| Route | Contents |
|---|---|
| `/admin` | MRR, active subs, churn, **gross margin**, top orgs |
| `/admin/organizations` | Search, filter by plan/status, suspend |
| `/admin/organizations/[id]` | Keys, members, subscription, usage, audit log |
| `/admin/plans` | Edit entitlements; changes apply on next sync |
| `/admin/subscriptions` | Status, period, MRR; manual override |
| `/admin/webhooks` | `stripe_events` table, retry failed |
| `/admin/usage` | Global spend, model mix, anomaly flags |

**Gross margin must be the first tile on `/admin`.** Without it you cannot tell
whether the business is working. `1 − Σ(cost_upstream) / Σ(cost_customer)`.

### 8.5 RBAC

| Role | Can |
|---|---|
| `owner` | Everything incl. delete org, change billing |
| `admin` | Manage members, keys; not billing or delete |
| `developer` | Create/revoke own keys; read usage |
| `billing` | Billing only; read usage |
| `viewer` | Read usage and dashboard |

Staff access is a separate `staff_users` table — never an `org_role`. Staff must
not be able to authenticate as an org member.

---

## 9. Fraud, abuse, and risk

This is the part that turns a hobby gateway into a business that gets shut down.

### 9.1 Card-not-present fraud

Stolen card → instant signup → drain your token budget → chargeback. Your loss:
upstream spend you cannot recover.

| Control | Setting |
|---|---|
| Stripe Radar | Enable; default rules catch a lot |
| Hard cap on new orgs | Free tier: `$0` spend, no trial on payment-required plans |
| Trial requires card | Yes — but the trial's hard cap is `$0`, not the plan value |
| Velocity | Max N orgs per card; flag above threshold |
| First-invoice hold | Consider manual capture until payment intent settles |

**The most important line:** the free tier's `included_spend_cents` is `0` and
`hard_cap_cents` is `0`. A free signup must not be able to spend your money
before the card is verified.

### 9.2 Chargeback exposure

Instant-consumed digital goods carry a high dispute rate, and you are the
merchant of record.

| Mitigation | Effect |
|---|---|
| Clear refund policy: "usage is non-refundable" | Weakens the claim, but not reliable alone |
| Delivery timestamp evidence | Log `usage_records` with `occurred_at`; dispute responses need it |
| Customer-visible usage dashboard | A customer disputing a charge they could see in real time loses |
| Reserve | Hold 3–5% of revenue against disputes |
| High-value orgs | Manual invoicing / NET terms instead of card |

### 9.3 Anomaly detection

```sql
-- 10× the customer's own 7-day median hourly spend
WITH hourly AS (
  SELECT organization_id,
         date_trunc('hour', occurred_at) AS h,
         SUM(cost_upstream_usd) AS usd
  FROM usage_records
  WHERE occurred_at > now() - interval '24 hours'
  GROUP BY 1, 2
),
baseline AS (
  SELECT organization_id, AVG(usd) AS mean, STDDEV(usd) AS sd
  FROM usage_records
  WHERE occurred_at > now() - interval '30 days'
  GROUP BY 1
)
SELECT h.organization_id, h.h, h.usd
  FROM hourly h JOIN baseline b USING (organization_id)
 WHERE h.usd > GREATEST(b.mean * 10, b.mean + 4 * b.sd, 1.00)
 ORDER BY h.usd DESC;
```

Alert → email the customer *and* ops. A sudden legitimate 10× spike is usually
a bug in their code shipping to production, and they will thank you for telling
them before the invoice arrives.

### 9.4 Prompt-injection / SSRF via your own gateway

Already covered in `DESIGN.md` §6.2, and **still true now that customers exist.**
A customer can put anything in a prompt. Never render model output as HTML
without escaping. Never let a customer-supplied URL be fetched by your services
(the gateway's image-URL handling downloads up to 50MB — that is a deliberate
SSRF-adjacent surface; ensure it cannot reach internal ranges).

---

## 10. Security

| Threat | Control |
|---|---|
| Billing secret leaked to browser | Server Components + Route Handlers. Never `NEXT_PUBLIC_*` for `STRIPE_SECRET_KEY` |
| Webhook forgery | `constructEventAsync` on raw bytes; event-id dedupe |
| IDOR across orgs | Every query filtered by `organization_id` from the **session**, never from a URL param |
| Privilege escalation | Role check server-side on every mutation. UI hiding is not authorization |
| Key material in logs | Never log the `key` field; log `key_prefix` only |
| Customer prompts at rest | `store_prompts_in_spend_logs: false` — enforced in `DESIGN.md` §6.3 |
| Admin over-reach | Staff auth separate from org roles; all actions audited |
| SQL injection | Drizzle parameterised; no string-built SQL |
| Session fixation | Managed by Clerk/Auth.js; rotate on privilege change |
| Webhook SSRF | Stripe signature verification before any DB write |

### 10.1 The IDOR note deserves emphasis

The most common SaaS breach is a missing tenant filter:

```ts
// ❌ NEVER — trusts the URL
const sub = await db.query.subscriptions.findFirst({
  where: eq(subscriptions.organization_id, params.orgId) });

// ✅ ALWAYS — trusts the session
const { orgId } = await requireOrgMembership();     // 403 if not a member
const sub = await db.query.subscriptions.findFirst({
  where: and(eq(subscriptions.organization_id, orgId),
             eq(subscriptions.plan_id, params.planId)) });
```

Make `requireOrgMembership()` the only way to obtain an `orgId`. Lint for
`params.orgId` reaching a query.

---

## 11. Observability

| Signal | Where |
|---|---|
| Gateway health | LiteLLM `/health`, Prometheus |
| Portal errors | Sentry or equivalent |
| Product analytics | PostHog (self-hostable) — signup, upgrade, key-created |
| Business metrics | Daily: MRR, active subs, **gross margin**, churn |
| Alerts | Entitlement sync failures, collector lag >30 min, margin <0, dispute rate |

Three alerts that matter on day one:

1. **`entitlements.status = 'failed'`** — a customer may have paid and not have
   access. Page someone.
2. **`collect_usage` lag > 30 min** — you are billing on stale data.
3. **Gross margin < 0 for any org** — you are losing money and nobody noticed.

---

## 12. Implementation plan

Phases are ordered by **risk**, not convenience. Money correctness precedes UI.

| Phase | Deliverable | Gate |
|---|---|---|
| **0** | Legal: written upstream answer on Model A | Written. If no, ship BYOK/internal only |
| **1** | Portal scaffold: Next.js, Drizzle, migrations, Clerk | Signup → org → dashboard renders |
| **2** | Read-only usage dashboard | Org usage matches `scripts/reconcile.sh` within 2% |
| **3** | **Key management** — create/revoke via LiteLLM REST | Revoked key 401s within 5 s |
| **4** | **Entitlement sync + admin console** | Upgrade plan → LiteLLM limits change; downgrade cuts access |
| **5** | Usage collector + rollups | Dedupe survives a forced double-run |
| **6** | Stripe checkout + webhooks | Replayed webhook does not double-apply |
| **7** | Stripe meters | Meter events idempotent under retry |
| **8** | Billing dashboard + customer portal | Invoice matches `usage_records` for that period |
| **9** | Fraud controls: Radar, caps, anomaly alerts | Free tier cannot spend >$0 |
| **10** | Hardening: RBAC audit, IDOR lint, load test | 10× current peak without error |
| **11** | Launch | — |

### 12.1 Phase 4 and 6 are the ones to test hardest

Phase 4 (entitlements) is where "customer paid but has no access" bugs live.
Phase 6 (webhooks) is where "customer paid twice" bugs live. Both are silent —
nothing errors, money is just wrong. Write integration tests against a real
Stripe CLI test-mode account before shipping either.

### 12.2 Do not build yet

- Seat-based pricing (see §4.1)
- Annual plans (add later; it is one Stripe price + one column)
- In-app invoicing (use Stripe)
- Custom analytics (PostHog + SQL is enough for a year)
- Multi-currency (Stripe handles it; add a column when a customer asks)
- Mobile app (nobody has ever wanted this)

---

## 13. Costs

| Item | Solo / small | Growing | Notes |
|---|---|---|---|
| VPS (portal + gateway) | $12 | $48 | 2 vCPU / 4 GB to start |
| Managed Postgres | $0 | $25 | Same cluster until ~5k orgs |
| Clerk | $0 | $25 | Free ≤50k MRU |
| Stripe | 2.9% + $0.30 | — | Plus disputes |
| Resend | $0 | $20 | |
| Sentry | $0 | $26 | |
| **Infra** | **~$12/mo** | **~$144/mo** | Excludes upstream tokens |

Upstream token cost scales with revenue; plan so your **gross margin**, not
infrastructure cost, funds the business.

---

## 14. Open decisions

| # | Question | Default if unanswered |
|---|---|---|
| 1 | Written upstream approval for Model A? | **Ship Model C/B only** |
| 2 | Clerk or Auth.js? | **ANSWERED: Auth.js**, self-hosted (§2.1) |
| 3 | Pass-through or flattened cache pricing? | Pass-through (honest), revisit at scale |
| 4 | Multiplier per tier? | 1.30 / 1.25 / 1.20 |
| 5 | Annual plans? | Monthly only |
| 6 | Trials on paid plans? | 7–14 days, **hard cap $0** |
| 7 | Do orgs see upstream model names or your aliases? | Aliases only |
| 8 | BYOK encryption key management? | Envelope encryption, KMS-backed |
| 9 | Who handles support? | You, until volume justifies otherwise |
| 10 | Refund policy? | Usage non-refundable; stated at checkout |

---

## 15. Source citations

| Claim | Source |
|---|---|
| Meters stream usage in real time; `identifier` gives idempotency | [Stripe meter events](https://docs.stripe.com/api/billing/meter-event), [usage-based billing](https://docs.stripe.com/billing/subscriptions/usage-based-legacy/recording-usage) |
| "Resell LLM tokens" is a Stripe-supported model via Metronome | [Stripe: billing for LLM tokens](https://docs.stripe.com/billing/token-billing) |
| Seat-based pricing causes margin collapse; hybrid converges | [Stripe AI SaaS pricing guide](https://stripe.com/en-br/resources/more/ai-saas-pricing-models), [Bessemer playbook](https://www.bvp.com/atlas/the-ai-pricing-and-monetization-playbook) |
| Anthropic §D.2 forbids resale without approval | [Commercial ToS](https://www.anthropic.com/legal/commercial-terms) |
| Developers actively asking providers to clarify resale | [Gemini forum, Sep 2026](https://discuss.ai.google.dev/t/confirming-resale-reseller-policy-scope-for-the-gemini-api/181039) |
| `invoice.payment_failed` should not cut access; cut on `unpaid` | [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks) |
| Subscription event list | [Stripe Subscriptions API](https://docs.stripe.com/api/subscriptions) |
| Clerk Organizations + billing cost, plan sync caveat | [Clerk B2C billing](https://clerk.com/docs/nextjs/guides/billing/for-b2c) |
| Auth selection guidance; data-layer checks matter most | [Next.js auth guide 2026](https://clerk.com/articles/nextjs-authentication-guide-2026.md) |
| LiteLLM team budgets and team-scoped keys | [Team budgets](https://docs.litellm.ai/docs/proxy/team_budgets), [Service accounts](https://docs.litellm.ai/docs/proxy/service_accounts) |
| Cache multipliers and TTL pricing | [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) |
| Gateway controls inherited from `DESIGN.md` | [DESIGN.md](DESIGN.md) |

---

## Appendix — Service tiers at a glance

| Concern | v1 | Growth | Scale |
|---|---|---|---|
| Tenants | <100 | 100–5,000 | 5,000+ |
| Portal deploy | Same VPS | Same VPS | Separate, managed DB |
| Gateway replicas | 1 | 2 + Redis | K8s / LiteLLM microservices |
| Auth | Clerk | Clerk | Clerk + SSO |
| Jobs | `node-cron` | Dedicated worker | Queue service |
| Billing | Stripe direct | Stripe direct | Stripe + Metronome |
| Metering | Hourly | 15 min | Near-real-time |
| Cost model | Plan COGS×1.3 | Add volume tiers | Negotiated enterprise |

Move to the next column when a column's limits actually hurt, not in advance.