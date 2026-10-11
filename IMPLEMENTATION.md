# IMPLEMENTATION — build the platform on the VPS

**Where this runs:** the VPS (`/opt/gateway`). Local machine is editor + git
mirror only.
**Read first:** `README.md` → `DESIGN.md` → this file → `PLATFORM.md` (schema,
billing) → `LATENCY.md` (performance budgets) → `BLUEPRINT.md` (legal, threats).
**End state:** public GitHub repo with gateway + portal, deployed from `main`.

---

## 0. Objective and non-goals

**Objective:** a multi-tenant LLM SaaS. Customers sign up, subscribe to a plan,
get scoped API keys for `fast` / `smart` / `frontier` (Sonnet 5 / Opus 5.5 /
Fable 5.1), track usage on a dashboard, and pay through Stripe. Staff manage
everything from an admin console.

**Non-goals for this build:** annual plans, multi-currency, mobile app,
in-app invoicing (Stripe does it), custom analytics (PostHog + SQL), Model B
BYOK UI (schema supports it; UI waits for a customer), seat-based pricing.

**Current state (what already exists — do not rebuild):**

| Exists | Location |
|---|---|
| Gateway: Caddy + LiteLLM + Postgres + Redis, dual-format, latency-tuned | `docker-compose.yml`, `config/` |
| Price table (Sonnet 5 / Opus 5.5 / Fable 5.1) | `prices/models.yaml` |
| Ops scripts: probe, issue-key, report, reconcile, backup, smoke, measure-latency, deploy | `scripts/` |
| Portal DB schema (13 tables, 6 enums, seed plans) | `portal/db/migrations/0001_init.sql` |
| LiteLLM REST client (only sanctioned gateway path) | `portal/lib/litellm/client.ts` |
| Usage collector + rollup (idempotent, TTL-aware) | `portal/lib/jobs/collect-usage.ts` |
| Pricing library (single source of truth) | `portal/lib/pricing/index.ts` |
| Portal package manifest | `portal/package.json` |

**Not yet built (this file plans it):** Next.js app shell, auth wiring, all
pages, all API routes, job runner, Stripe integration, portal deploy config,
tests.

---

## 1. Roles and permissions matrix

Three subject classes. Staff are **never** org members (`staff_users` is a
separate table — a staff account can never authenticate as a customer).

### 1.1 Unauthenticated visitor

| Capability | Notes |
|---|---|
| View landing, pricing, docs | Static + `plans` where `public = true` |
| Sign up / sign in | Auth.js credentials; creates `users` row + personal org on first login |
| Nothing else | All app routes redirect to sign-in |

### 1.2 Organization roles

| Capability | viewer | developer | billing | admin | owner |
|---|---|---|---|---|---|
| View dashboard + usage | ✅ | ✅ | ✅ (cost only) | ✅ | ✅ |
| Export usage CSV | ❌ | ✅ | ✅ | ✅ | ✅ |
| Create API keys (≤ plan `max_keys`) | ❌ | own only | ❌ | ✅ | ✅ |
| Revoke keys | ❌ | own only | ❌ | ✅ | ✅ |
| Invite / remove members | ❌ | ❌ | ❌ | ✅ (not owner) | ✅ |
| Change member roles | ❌ | ❌ | ❌ | ✅ (below admin) | ✅ |
| View billing, invoices | ❌ | ❌ | ✅ | ❌ | ✅ |
| Change plan, payment method | ❌ | ❌ | ❌ (portal link only) | ❌ | ✅ |
| Edit org profile | ❌ | ❌ | ❌ | ✅ | ✅ |
| Manage BYOK credential | ❌ | ❌ | ❌ | ❌ | ✅ |
| Delete org | ❌ | ❌ | ❌ | ❌ | ✅ |

Enforcement is **server-side on every mutation**. UI hiding is not
authorization. The only way to obtain an `orgId` in code is
`requireOrgMembership()` (session → membership row → role check). Lint for
`params.orgId` reaching a query — that shape is an IDOR until proven
otherwise.

### 1.3 Staff roles (`staff_users`)

| Capability | read_only | support | admin | owner |
|---|---|---|---|---|
| View all orgs, subs, usage, audit | ✅ | ✅ | ✅ | ✅ |
| Retry failed entitlement sync / webhook | ❌ | ✅ | ✅ | ✅ |
| Suspend / unsuspend org | ❌ | ✅ | ✅ | ✅ |
| Revoke any key | ❌ | ✅ | ✅ | ✅ |
| Extend trial / comp subscription | ❌ | ❌ | ✅ | ✅ |
| Edit plans (entitlement templates) | ❌ | ❌ | ✅ | ✅ |
| Manage staff | ❌ | ❌ | ❌ | ✅ |
| Authenticate as a customer | ❌ | ❌ | ❌ | ❌ |

No impersonation, ever. Support views customer state through read-only
staff views; every staff action writes an `audit_log` row with the staff
identity.

---

## 2. Feature catalog

### 2.1 Customer portal

| # | Feature | Route | Reads | Writes |
|---|---|---|---|---|
| C-01 | Signup / signin / org switcher | `/sign-in`, `/sign-up` (Auth.js) | — | `users`, `organizations`, `organization_members` |
| C-02 | Dashboard: spend vs plan, quota bars, TTFT/total p50/p95, key list, quickstart snippet | `/dashboard` | `usage_periods`, `entitlements`, `api_keys`, `subscriptions` | — |
| C-03 | Usage explorer: time series by day/model/route/key; token-class split; cache-savings banner | `/dashboard/usage` | `usage_records` (paginated, server-side) | — |
| C-04 | CSV export (same filters as C-03, max 100k rows) | `/dashboard/usage` action | `usage_records` | — |
| C-05 | Key management: create (name + models within plan), full value shown **once**, revoke | `/dashboard/keys` | `api_keys` | LiteLLM `/key/generate`, `/key/delete` |
| C-06 | Team: invite (email → pending invite), role change, remove | `/dashboard/team` | `organization_members`, `users` | `pending_invites` (self-hosted; no external IdP) |
| C-07 | Billing: current plan, usage-vs-included bar, overage MTD, invoices, "Manage plan" (Stripe Customer Portal) | `/dashboard/billing` | `subscriptions`, `plans`, Stripe invoices | Stripe Checkout + Portal sessions |
| C-08 | Upgrade/downgrade: pricing table → Checkout (new) / Portal (existing) | `/pricing`, `/dashboard/billing` | `plans` (public) | Stripe; webhook applies (§4) |
| C-09 | Settings: org name/slug, notification prefs | `/dashboard/settings` | `organizations` | `organizations` |
| C-10 | BYOK credential store (hidden until Model B launches; API + table ready) | `/dashboard/settings/keys` | `organizations.byok_last4` | `organizations.byok_ciphertext` (envelope-encrypted, never returned) |

**Cost display rule:** customers see `cost_customer_usd` only. `cost_upstream_usd`
is staff-only. The one transparency exception: the cache-savings banner
("Cached reads saved you $X this period") — it lowers your COGS and their bill
simultaneously.

### 2.2 Admin console (staff only, `/admin`)

| # | Feature | Reads | Writes |
|---|---|---|---|
| A-01 | Overview: MRR, active/trialing/past-due counts, **gross margin first tile**, top orgs by spend, anomaly flags | `subscriptions`, `plans`, `usage_periods` | — |
| A-02 | Org list: search (slug/email), filter (plan/status), paginate | `organizations`, `users` | — |
| A-03 | Org detail: profile, members, keys (prefixes only), subscription + period, usage chart, entitlement sync status, audit trail | all org tables | — |
| A-04 | Suspend / unsuspend org | — | `organizations.status` + entitlement sync (cut = `CUT_BUDGET`, never key revoke) |
| A-05 | Revoke any key | — | LiteLLM `/key/delete` + `api_keys.revoked_at` |
| A-06 | Plans editor: all entitlement columns; change applies on next sync + audit row | — | `plans` |
| A-07 | Subscription override: extend trial, comp period, force sync | — | `subscriptions` + sync |
| A-08 | Webhook inbox: `stripe_events` list, filter unprocessed, retry button | `stripe_events` | re-process |
| A-09 | Entitlement queue: `pending`/`failed` rows, error text, retry | `entitlements` | sync |
| A-10 | Global usage: spend by model/route/day, margin by plan, anomaly list | `usage_records` rollups | — |
| A-11 | Audit log viewer: filter by org/action/actor | `audit_log` | — |

### 2.3 Marketing / static

Landing (`/`), pricing (`/pricing`, rendered from `plans` where `public`),
docs (`/docs`: quickstart snippets per SDK + model table), status page link,
legal (terms, privacy, refund policy: "usage is non-refundable").

---

## 3. Backend API contract

Base: Next.js Route Handlers under `portal/app/api`. All responses JSON.
Auth: Auth.js session → `requireOrgMembership()` (customer) or `requireStaff()`.
Authorization is never read from the session alone; every mutation
re-checks the database.
Validation: Zod at every boundary. Errors: `{ error: { code, message } }`
with `code ∈ {unauthorized, forbidden, not_found, conflict, validation,
upstream, internal}`. Never leak stack traces, key material, or Stripe
objects to the client.

### 3.1 Customer routes

| Method + path | Auth | Body / query | Effect |
|---|---|---|---|
| `GET /api/orgs` | user | — | Orgs the caller belongs to |
| `POST /api/orgs` | user | `{name, slug}` (zod) | Create org + `owner` membership + LiteLLM team + free subscription + sync |
| `GET /api/orgs/[id]/overview` | member | — | C-02 bundle: period rollup, entitlement, sub status, keys (prefixes) |
| `GET /api/usage` | member | `?from&to&model&route&key&page` | Paginated `usage_records` for the org |
| `GET /api/usage/export` | developer+ | same filters | CSV stream, 100k cap |
| `GET /api/keys` | member | — | Active keys: id, name, prefix, models, last_used, created |
| `POST /api/keys` | per matrix | `{name, models[]}` | Plan checks (`max_keys`, models ⊆ plan) → LiteLLM `/key/generate` → store prefix+hash → **return plaintext once** |
| `DELETE /api/keys/[id]` | per matrix | — | LiteLLM `/key/delete` + `revoked_at` |
| `GET /api/team` | member | — | Members + roles |
| `POST /api/team/invite` | admin+ | `{email, role}` | Pending invite row; membership row on accept |
| `PATCH /api/team/[uid]` | admin+ | `{role}` | Role change within matrix bounds |
| `DELETE /api/team/[uid]` | admin+ | — | Remove (never the last owner) |
| `GET /api/subscription` | member | — | Plan, status, period, usage-vs-included, overage MTD |
| `POST /api/checkout` | owner | `{plan_code}` | Stripe Checkout session (subscription mode, trial per plan, `metadata.organization_id`) → URL |
| `POST /api/portal` | owner/billing | — | Stripe Customer Portal session → URL |
| `POST /api/webhooks/stripe` | Stripe sig | raw body | §4 handler (public route, signature-verified) |
| `POST /api/webhooks/clerk` | Clerk sig | Svix-verified | Sync `users` mirror on create/update/delete |

### 3.2 Admin routes (`/api/admin/*`, staff only)

| Method + path | Staff | Effect |
|---|---|---|
| `GET /api/admin/overview` | all | A-01 bundle |
| `GET /api/admin/orgs?q&plan&status&page` | all | A-02 |
| `GET /api/admin/orgs/[id]` | all | A-03 bundle |
| `POST /api/admin/orgs/[id]/suspend` | support+ | A-04 |
| `POST /api/admin/orgs/[id]/unsuspend` | support+ | status → active + sync |
| `DELETE /api/admin/keys/[id]` | support+ | A-05 |
| `GET /api/admin/plans` + `PATCH /api/admin/plans/[id]` | admin+ | A-06 (zod: numeric ranges; `free` plan invariant enforced) |
| `POST /api/admin/subs/[id]/extend-trial` | admin+ | `{days}` → Stripe + local |
| `POST /api/admin/sync/[orgId]` | support+ | Force entitlement sync |
| `GET /api/admin/events?unprocessed` + `POST /api/admin/events/[id]/retry` | support+ | A-08 |
| `GET /api/admin/entitlements?status` | support+ | A-09 |
| `GET /api/admin/usage?group&from&to` | all | A-10 |
| `GET /api/admin/audit?org&action&page` | all | A-11 |

### 3.3 Stripe webhook → action map (the money path)

`checkout.session.completed` → attach org/sub. `customer.subscription.created/
updated` → upsert + **always sync**. `deleted` → `canceled` + sync (cuts).
`paused/resumed` → sync. `trial_will_end` → email. `invoice.payment_succeeded`
→ receipt. `invoice.payment_failed` → **banner only, never cut** (cut on
`unpaid`). `charge.dispute.created` → alert + flag. Handler: verify raw-body
signature → `stripe_events` insert `ON CONFLICT DO NOTHING` (replay-safe) →
process → mark `processed_at`; throw → 500 so Stripe retries.

---

## 4. Data, jobs, billing flow

Schema is final: `portal/db/migrations/0001_init.sql` (do not hand-edit;
new changes go in `0002_*.sql` via `drizzle-kit generate`).

```
LiteLLM spend logs ──collect_usage (5m)──▶ usage_records (dedupe_hash)
        │                                          │
        │ Rollup (15m)                             │ push_meters (1h)
        ▼                                          ▼
usage_periods ──dashboard                    Stripe meter events (identifier =
                                             sha256(org|period|version))
plan/webhook ──sync_entitlements──▶ entitlements ──▶ LiteLLM /team|/key update
```

Job runner: Postgres `SKIP LOCKED` (`job_runs` table), stale lock 10 min.
Jobs: `collect_usage, rollup_usage, push_meters, expire_trials (5m),
reconcile_entitlements (1h), reconcile_costs (1d), detect_anomalies (15m)`.
Rules: ingestion idempotent (`ON CONFLICT DO NOTHING`); rollups rebuilt, never
incremented; meter `identifier` stable per (org, period, version).

---

## 5. Infrastructure changes

### 5.1 `docker-compose.yml`: add `portal` service

```yaml
  portal:
    build: ./portal
    restart: unless-stopped
    command: ["node", "server.js"]        # Next.js standalone output
    environment:
      DATABASE_URL: postgresql://portal:${POSTGRES_PASSWORD}@postgres:5432/portal
      LITELLM_INTERNAL_URL: http://litellm:4000
      LITELLM_MASTER_KEY: ${LITELLM_MASTER_KEY:?set in .env}
      CLERK_SECRET_KEY: ${CLERK_SECRET_KEY:?set in .env}
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:?set in .env}
      STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY:?set in .env}
      STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET:?set in .env}
      PRICE_FILE: /app/prices/models.yaml
      APP_URL: https://portal.${BASE_DOMAIN:?set in .env}
      LITELLM_LOG: ERROR
    volumes:
      - ./prices:/app/prices:ro           # portal reads the SAME price table
    ports:
      - "127.0.0.1:3000:3000"             # loopback only, Caddy fronts it
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
      litellm:  { condition: service_started }
```

`portal/Dockerfile`: `node:22-alpine`, `npm ci`, `npm run build`
(`output: 'standalone'` in `next.config`), run as non-root `nextjs` user.
No secrets in build args — runtime env only.

### 5.2 Postgres: second database

Same container, new database. Mount `./portal/db/init/01-portal-db.sql`
containing `SELECT 'CREATE DATABASE portal' WHERE NOT EXISTS (...)` equivalent
(`CREATE DATABASE` can't run in a DO block — use a shell-form init script or
create via `docker compose exec` once and document it). Portal connects with
the same `litellm` role in v1 (separate `portal` role at growth stage).
Backups: extend `scripts/backup.sh` to dump **both** databases.

### 5.3 Caddy: portal vhost

```caddyfile
{$PORTAL_DOMAIN} {
	encode zstd gzip
	request_body { max_size 2MB }
	reverse_proxy 127.0.0.1:3000 {
		flush_interval -1
		transport http {
			dial_timeout 10s
			response_header_timeout 60s
			read_timeout 120s
			write_timeout 120s
			keepalive_interval 30s
			keepalive_idle_conns_per_host 64
		}
	}
	log {
		output stdout
		format json
	}
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		-Server
	}
}
```

Notes: no `log_append` here (no reverse_proxy placeholders beyond the
standard ones apply usefully); Stripe webhook route must not be behind
anything that buffers (`flush_interval -1` covers it); portal timeouts are
short (60–120 s) because portal handlers must never wait on model
generation — only on LiteLLM REST + Postgres + Stripe.

### 5.4 DNS + firewall

`portal A <VPS_IP>` alongside `api`/`admin`. No firewall change (443 already
open). SSH already restricted to your IP.

### 5.5 Secrets added (VPS `.env` only, never git)

`CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`
(test `sk_test_` first, live at launch), `STRIPE_WEBHOOK_SECRET`,
`BASE_DOMAIN`, `PORTAL_DOMAIN`, `RESEND_API_KEY` (phase 6+).

---

## 6. System design (end state)

```
                        ┌──────────── CONTROL PLANE ────────────────┐
                        │  Caddy :443                               │
customer ──HTTPS──▶     │   portal.yourdomain.com ──▶ portal :3000  │
                        │   admin-gw host ──▶ litellm (IP-gated)    │
                        │                                           │
                        │  portal (Next.js, Clerk, Stripe)          │
                        │   ├─ pages: /, /pricing, /dashboard/*,    │
                        │   │          /admin/*                     │
                        │   ├─ api: §3 routes                       │
                        │   └─ jobs: §4 (Postgres SKIP LOCKED)      │
                        │        │                │                 │
                        │   REST only ─┐    ┌─────┴── Stripe API    │
                        └──────────────┼────┼───────────────────────┘
                                       │    │
                    ┌──────────────────┘    └─────────┐
                    ▼                                 ▼
          ┌──────────────────┐              ┌──────────────────┐
          │ GATEWAY (design) │              │ Stripe Billing   │
          │ Caddy → LiteLLM  │              │ Checkout, Portal,│
          │ → upstream       │              │ Meters, webhooks │
          └──────────────────┘              └──────────────────┘
                    │                                 │
          ┌─────────┴──────────┐                      │
          ▼                    ▼                      │
   Postgres:litellm     Postgres:portal ◄─────────────┘
   (LiteLLM-owned)      (portal-owned)    usage → meters
   Redis (both: gateway limiter; portal does NOT queue here)
```

Trust additions: browser never sees `STRIPE_SECRET_KEY`, `LITELLM_MASTER_KEY`,
or any key plaintext except once at creation; Stripe → portal webhook is
signature-verified on raw bytes; portal → LiteLLM over loopback REST with the
master key; portal DB credentials never leave the VPS.

---

## 7. Build phases (in order — do not skip)

| Phase | Goal | Key tasks | Acceptance |
|---|---|---|---|
| **0 — Groundwork** | VPS ready, repo public, gateway green | Harden VPS (§13 BLUEPRINT); `git init`, first push (§8 MASTER_PROMPT); `make up`, `make probe`, `make smoke` green on VPS | A-1…A-17 pass on the VPS |
| **1 — App shell + auth** | Signup → org → empty dashboard | Next.js scaffold (TS strict, standalone), Drizzle wiring, Auth.js (proxy, sign-in/up, scrypt + throttle), org auto-provision + free sub + LiteLLM team + sync on first login | New signup lands on `/dashboard` with $0 usage, team exists in LiteLLM |
| **2 — Usage dashboard** | Read-only C-02/C-03 | Collector + rollup jobs running; overview + explorer pages; cache-savings banner | Dashboard numbers match `scripts/reconcile.sh` within 2% |
| **3 — Keys** | C-05 | `GET/POST/DELETE /api/keys` + page; plaintext-once flow; revoked key 401s ≤5 s | Create → use → revoke → 401, all via UI |
| **4 — Entitlements + admin v1** | C-06 (basic), A-01…A-05, A-09, A-11 | Sync function (§5 PLATFORM); team invite; admin org list/detail/suspend/revoke/queue/audit | Plan change in DB → LiteLLM limits change; suspend → 429 with budget reason |
| **5 — Jobs hardening** | All §4 jobs + anomaly | Runner, schedules, `expire_trials`, `detect_anomalies`, alerting (email) | Kill -9 mid-collect → rerun inserts zero duplicates |
| **6 — Stripe money** | C-07/C-08, §3.3 | Checkout, Portal, webhook handler, trial emails, receipts | Stripe CLI test: subscribe → webhook → sync → invoice matches `usage_records` |
| **7 — Meters** | Overage billing | `push_meters`, meter config, billing page overage MTD | Retry a meter push → single Stripe event (identifier dedupe) |
| **8 — RBAC + audit** | Full §1 matrices | Per-action role checks, staff separation tests, IDOR lint pass | Matrix test: each role × each action = expected allow/deny |
| **9 — Launch** | Public | Load test 10× peak; backup restore drill; refund/terms pages; live Stripe keys; margin alert | Checklist §10 all green |

**Phases 4 and 6 get double testing time.** Silent-money bugs live there
("paid but no access", "paid twice"). Both against real Stripe test-mode.

---

## 8. Testing strategy

- **Unit (Vitest):** pricing lib (TTL split, Fable/Opus exceptions,
  rounding), dedupe hash stability, entitlement status map, Zod schemas.
- **Integration:** collector double-run (zero dupes), sync failure →
  `failed` + retry → `synced`, webhook replay (no double-apply), trial
  expiry job.
- **E2E (Playwright):** signup → subscribe (Stripe test clock) → create key
  → call gateway → usage appears → cancel → access cut.
- **Gateway (existing):** `make smoke` after every infra change.
- **Load:** k6 or equivalent at 10× expected peak before phase 9; watch
  `in_flight_requests`, `x-litellm-overhead-duration-ms` p99, PG connections.

---

## 9. Definition of done (launch gate)

- [ ] All phase acceptances green on the VPS (not locally)
- [ ] `make smoke` + `make reconcile` + `make latency` green
- [ ] Free tier cannot spend >$0 (attempt → 429, test it)
- [ ] Backup restores both databases; salt key stored separately
- [ ] Live Stripe keys, webhook secret rotated to live, test clock cleaned
- [ ] Terms/privacy/refund pages published; "usage non-refundable" at checkout
- [ ] Gross-margin alert + entitlement-failure alert + collector-lag alert live
- [ ] No secret has ever touched git (run `scripts/scrub-check.sh` on full history)
- [ ] Public repo contains no `.env`, no dumps, no `latency.csv`

---

## 10. Open decisions (unchanged — PLATFORM.md §14 owns them)

Model A vs B (written upstream approval gates third-party resale);
cache pricing pass-through vs flatten; multipliers
1.30/1.25/1.20; monthly only; trials with $0 hard cap.

RESOLVED: Clerk vs Auth.js → **Auth.js, self-hosted** (PLATFORM.md §2.1).