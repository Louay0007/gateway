# AI HANDOFF — LLM Gateway repo (`/Users/user/Workspace/gateway`)

Read this file first. It is the complete, verified state of the project.
Everything below was confirmed live against the running stack, not assumed.

## 1. What this project is

A self-hosted **LLM gateway**: LiteLLM proxy (OpenAI + Anthropic wire
formats) in front of one upstream model, with a Next.js customer portal
(Auth.js, self-hosted — no Clerk), two Postgres databases (`litellm`
owned by LiteLLM, `portal` owned by us — never query LiteLLM's via SQL,
REST only), Redis, background jobs (usage collection, rollups,
entitlement reconcile), and Caddy as the TLS edge (VPS only).

Docs: `README.md`, `MASTER_PROMPT.md`, `DESIGN.md`, `IMPLEMENTATION.md`,
`PLATFORM.md`, `BLUEPRINT.md`, `LATENCY.md`. Ops entry: `Makefile`.

## 2. Environments (do not confuse them)

- **VPS = production.** SSH `gateway`, repo `/opt/gateway`, branch `main`.
  Caddy runs there (host networking, real domains, Let's Encrypt). The VPS
  holds exactly one thing git does not: `.env`.
- **Local = dev.** This folder. Caddy is NEVER run locally. Services are
  hit directly: gateway `http://127.0.0.1:4000`, portal
  `http://127.0.0.1:3000`. Local `.env` is gitignored and holds the dev
  tunnel key — never commit it, never print it.

## 3. Current live state (verified)

- Branch `main`, all services healthy (`litellm`, `portal` healthy,
  `postgres`, `redis`, `jobs` up). `make health` green:
  portal `/api/health` = `{"status":"ok","database":true,"gateway":true}`,
  `GET /health/readiness` on LiteLLM = 200 (no auth).
- **Single served model.** Alias `fast` →
  `openai/cl/cline-free/step-5-preview`. Upstream =
  `https://rj8dp52.abc-tunnel.us/v1` (dev tunnel, free tier, OpenRouter-style).
  Real requests verified on BOTH wire formats (`/v1/chat/completions` and
  `/v1/messages`), streaming confirmed. `/v1` is part of `api_base`, so
  `LITELLM_ANTHROPIC_DISABLE_URL_SUFFIX=true` is required.
- **UPSTREAM TUNNEL CURRENTLY DOWN** (verified live): `.env`'s
  `rj8dp52.abc-tunnel.us` answers 530 (Cloudflare origin unreachable).
  Restart the tunnel before any real-request work; until then,
  meter/verify against the local mock (`make verify-metering`), which is
  deterministic and free.
- **MVP SCOPE (decided this session, supersedes the four-plan design):**
  individual accounts only (no teams/invites/seats), TWO plans
  (Starter $19 / Pro $99 — see `plans`), NO free tier, NO trials,
  subscriptions through a payment provider referred to as "D17" (still
  being finalised — `lib/billing/` is provider-agnostic with a working
  `dev` provider; `d17.ts` is a marked stub). Signup lands on the
  PAYWALL: org + LiteLLM team exist, no subscription, keys refused with
  `payment_required` until a plan is activated.
- **Pricing invariant — "one table, two consumers."**
  `prices/models.yaml` (per-MTok) and `config/litellm.yaml` `model_info`
  (per-token) MUST agree. Verified equal for step-5-preview
  (input $0.30/MTok, output $1.20/MTok — nominal DEV rates, upstream is
  free; non-zero keeps spend/budget pipeline testable). The metering
  proof re-derives the expected cost from `prices/models.yaml` and
  asserts it equals the ledger's `cost_upstream_usd`, then applies the
  plan multiplier (Starter 1.30, Pro 1.25) — the invariant and the
  margin are both checked on every run.
- **Data:** `organizations=11`, `usage_records=13`, `usage_periods=3`,
  `plans=2` (starter, pro), `billing_events=3` — real rows from the
  money-path proof runs (test accounts + their ledger evidence; nothing
  is deleted, keys are revoked).
- **Caddy:** `docker-compose.yml` defines caddy with NO profile, so a bare
  `make up` starts it. It works locally (`.localhost` domains, internal
  CA certs), but the documented local topology is loopback-direct — it was
  stopped after this session's `make up`. Do not run it (see §6).
- **Dev-only files (never deploy to VPS as-is):** `docker-compose.mock.yml`,
  `scripts/mock-upstream.mjs`, local `.env` pointing at the free tunnel.

## 4. Session history (commits on top of VPS `0848fba`, oldest → newest)

1. `9dc2f38` — stack bootable locally; management-route block moved from
   global `allowed_routes` to the Caddy `@mgmt` edge (global switch also
   blocked loopback `make key` + portal — architectural fix).
2. `a912c0e` — `SMOKE_BASE` override for local smoke; `issue-key.sh`
   stdout is pure pipeable JSON (guidance → stderr).
3. `ebbfa8f` — explicit per-token cost on ALL deployments (LiteLLM prices
   `openai/claude-*` at $0 → budgets were silently no-op); deterministic
   A-8 (bounded loop; key-spend cache lags one call), A-15 (sums
   authoritative `/spend/logs`, not lagging aggregates), A-12 (401 is a
   valid SSRF rejection), A-14 (edge-only; skipped on loopback).
4. `087b89f` — mock honors `cache_control` (A-6 deterministic);
   `reconcile.sh` reads the OSS spend ledger + re-prices aliases.
5. `b26cd5a` — single opencode `step-5-preview` model; portal probe
   `/health` → `/health/readiness`; prices + reconcile alias reconciled.
6. `45e903e` — usage pipeline fix: `getSpendLogs` sends `YYYY-MM-DD
   HH:MM:SS` (`/spend/logs/ui` 400s on date-only); new `extractUsage`
   reads LiteLLM v1.103.1 shape (top-level tokens +
   `metadata.usage_object.prompt_tokens_details`); reasoning tokens are
   NOT counted as cache reads. Collector rewired to it.

## 5. Money path, auth recovery, ops: BUILT and proven (migration 0006–0008 applied locally)

### 5.7 D17 (La Poste Tunisienne) manual payments — BUILT and proven
`make verify-d17` (portal/scripts/verify-d17.ts) passes every case:
amount (server-side only, TND millimes at the configured rate — default
$19 → 58.900 DT), proof submission with customer + ops emails, **duplicate
authorization number refused + audit-flagged**, amount-tamper resistance
(no amount input exists), **double approval activates exactly once**
(`billing_events` dedupe on `d17:<id>:approved`), **staff gate over HTTP**
(anonymous → 401, signed-in customer → 403, real session), window expiry
+ sweep, reject-with-reason + one resubmission, screenshot (content-typed,
EXIF-stripped, uuid filename, outside web root), reconciliation + CSV.
New: migration `0005_d17_payments.sql`, `lib/billing/d17*.ts` (provider,
proof, admin, config, ratelimit), `lib/i18n/d17.ts` (FR/AR/EN + RTL),
`/checkout/d17/[subscriptionId]` (instructions + form + language switch),
`/admin/d17` (queue + checklist + approve/reject), staff screenshot +
CSV routes, `docs/d17-payments.md` (config + QA checklist), env vars
(D17_RECEIVER_PHONE, PAYMENT_WINDOW_HOURS, AUTH_NUMBER_REGEX,
D17_USD_TND_RATE, …) on both compose services + a `data/d17-uploads`
volume. A dev staff account (`admin@verify.invalid`, staff_users role
owner) exists locally; the README documents creating your own.

**Deviations from the generic brief, because this is not a shop**: there
are no orders or stock — the purchased thing is a subscription, so
`order_id` is `subscription_id`; plan prices are USD, so the TND amount
is `usd_cents × D17_USD_TND_RATE` (VERIFY the rate before charging);
`expires_at` + `fx_rate`/`usd_amount_cents` columns were added to satisfy
the deadline + reconciliation requirements; admin 2FA is skipped (no TOTP
infrastructure); notifications are email (the lib/email seam), with no
SMS/Telegram provider configured. Bugs found while building: the proof
shape CHECK constraint rejected `expired` rows with no proof (fixed in
0005, applied live); the login throttle's policy (backoff on the 2nd
attempt) was wrong for proofs — replaced by `d17-ratelimit.ts` ("N per
hour", and a refused attempt does not extend the lockout); LiteLLM's
key-spend cache lags a re-activated budget by one call, so the proof's
re-subscribe check retries twice (documented in the script).

### 5.1 Money path (`make verify-metering` — all green)
`portal/scripts/verify-metering.ts` walks the REAL code paths and asserts
at each step — latest run: ALL GREEN:

paywall → checkout (dev provider) → **signed callback activates via the
real `POST /api/billing/callback` route** → replayed callback is a no-op
duplicate → key minted → 2 real requests (100/20 tokens) → collector
imports → ledger asserts exact tokens, `cost_upstream = $0.000054/call`
(recomputed from `prices/models.yaml`), `cost_customer = upstream × 1.30`
(Starter multiplier), `api_key_id` attributed to the minted key,
`billing_period`, dedupe hash → collector re-run inserts **zero**
duplicates → rollup sums match → `subscriptionBundle` (limits/usage/keys)
→ **changePlan to Pro pushes $600 live** → **cancel at period end: access
continues, a request still returns 200** → **`expire_subscriptions` rolls
it over: status flips, account cut, key → 429** → **re-subscribe
reactivates the same row, the key works again** → **immediate cancel:
429** → revoke: **401**. Gateway key carries the plan's $100 budget and
`['fast']` models (read back from `/key/info`).

NOT committed — commit when asked.
**The subscribe-first MVP backend is complete.** `make verify-metering`
(`portal/scripts/verify-metering.ts`, runs in the jobs container) walks
the REAL code paths and asserts at each step — latest run: ALL GREEN:

paywall → checkout (dev provider) → **signed callback activates via the
real `POST /api/billing/callback` route** → replayed callback is a no-op
duplicate → key minted → 2 real requests (100/20 tokens) → collector
imports → ledger asserts exact tokens, `cost_upstream = $0.000054/call`
(recomputed from `prices/models.yaml`), `cost_customer = upstream × 1.30`
(Starter multiplier), `api_key_id` attributed to the minted key,
`billing_period`, dedupe hash → collector re-run inserts **zero**
duplicates → rollup sums match → `subscriptionBundle` (limits/usage/keys)
→ **changePlan to Pro pushes $600 live** → **cancel cuts to CUT_BUDGET,
starved key → 429** → revoke → **401**. Gateway key carries the plan's
$100 budget and `['fast']` models (read back from `/key/info`).

NOT committed — commit when asked.

### 5.2 Account recovery — password reset (verified live)
`lib/auth/reset.ts` + `lib/auth/reset-tokens.ts` (pure crypto rules) +
`lib/auth/reset-actions.ts` + `/reset-password` and
`/reset-password/confirm` pages (linked from /sign-in). Verified live
against the stack: request for an unknown email answers the same as a
known one; the stored token is sha256(raw), 30-minute TTL; bogus token
and weak password refused; a real token changes the hash (new password
verifies, old one does not); replay is refused; all tokens for the
account are consumed. Raw tokens only ever exist in the email.
`EMAIL_TRANSPORT=dev` logs the link (dev); `resend` delivers for real
(`RESEND_API_KEY` + `MAIL_FROM`). KNOWN LIMIT: JWTs outlive a password
change up to `maxAge` (7 days) — documented in reset.ts.

### 5.3 Email transport
`lib/email/` — one seam, like billing: `resend.ts` (REST, no SDK),
`log.ts` (dev), selection by `EMAIL_TRANSPORT`/`RESEND_API_KEY`.
Receipts for the real payment provider reuse it.

### 5.4 Org + lifecycle APIs (verified live)
- `GET /api/orgs`, `PATCH /api/orgs/[id]` (C-09: name/slug, owner-only,
  org from session never the URL, slug re-resolved through `uniqueSlug`).
  Live: rename ok, bad slug → 400, wrong org → 404, anonymous → 401,
  audit row written.
- `POST /api/subscription/cancel` gained `{atPeriodEnd}`; new job
  `expire_subscriptions` (5 min) flips `cancel_at_period_end` +
  `current_period_end < now` → canceled + sync. SQL first, then push
  (PLATFORM §5.3).

### 5.5 Ops
- New job `send_alerts` (15 min): collector lag > 30 min, failed
  entitlement count, any job-runner error — emailed on state CHANGE
  only (`system_alerts` dedupe; silence means nothing changed), via the
  email transport to `OPS_ALERT_EMAIL`. Verified: fires once, dedupes,
  and emails a recovery.
- `make backup-drill` (`scripts/backup-drill.sh`): dump → scratch DB →
  sanity checks (plans ≥ 2, ledger non-empty, migrations ≥ 4) → drop.
  Passing.

### 5.6 Migration 0004 + housekeeping
`0004_ops_and_rollover.sql`: `system_alerts` + `job_runs` rows for
`expire_subscriptions`/`send_alerts`. The job runner now runs five jobs.
Also: deleted the two orphan LiteLLM teams (the recurring `unmapped=1`
in collector logs), removed the unused `stripe` dependency and the stale
STRIPE_* compose/env entries, patched the `mock-upstream` Makefile bug,
`/reset-password` added to the proxy's PUBLIC_PREFIXES (it was gated,
which made recovery unreachable), `MAIL_FROM` quoted in .env (`<...>`
reads as a redirect when shell-sourced).

### Latent bugs the proof caught this session (all fixed, with tests)
1. **Cancel could not be enforced.** The entitlement sync resolved only
   LIVE subscriptions, so a `canceled` status found nothing to cut —
   "no live subscription" while the keys kept the old plan's budget.
   `resolveSubscription` now takes the org's row whatever its status
   (one row per org for life; prefers live on legacy multi-row orgs).
2. **Rollup crashed the job runner** when any org had usage but no live
   subscription (NOT NULL `plan_id`). Now those orgs are skipped — their
   spend stays in the ledger, which is the source of truth.
3. **`/key/info` shape misread** — the payload nests under `info`;
   reading the top level left the dashboard's models/last-used columns
   silently empty. Also `last_active`, not `last_used`.
4. Pre-existing: `collect-usage` cast the string `status` to int (22P02
   on the first mapped org); revoke/info passed LiteLLM's display mask
   (`sk-...w9Sg`) which 404s; `listTeamKeys` parsed `/key/list`'s hash
   strings as objects so per-key limits were never pushed; 4 typecheck
   errors. (Fixes from the earlier half of this session — see §4.)
5. This round: the `mock-upstream` Makefile target could never start
   the mock (`pgrep … && { …; }` exits 1 when not running → make
   aborted first); `docker compose run` reconciled dependencies and
   RECREATED litellm mid-proof while it was deliberately pointed at the
   mock (now `--no-deps`, commented in the Makefile); `/reset-password`
   was behind the auth proxy, making recovery unreachable;
   `resend.test.ts`-style import weight (pure helpers split into
   `reset-tokens.ts` so unit tests need no database); `MAIL_FROM`'s
   `<...>` broke shell-sourcing of `.env`.

### Still open
- **D17 API details** — everything is ready; `lib/billing/d17.ts` is the
  only file that changes.
- No Stripe anything (decided). `plans.provider_price_id` is the
  genericized column for the provider's price ids.
- BYOK, anomaly alerts, marketing pages beyond hero+pricing — deferred
  past MVP.

### 5.9 Frontend rebuilt AND wired to the API (2026-10-13, uncommitted)

Supersedes §5.8. The UI was rebuilt (shadcn `base-nova` on Base UI,
Tailwind v4, route groups `(marketing)` / `(app)`) and then **wired to the
live endpoints**. `lib/dashboard/mock-data.ts` is DELETED — nothing in the
app renders invented data any more.

**Data layer:** `lib/api/use-api.ts` — one `useApi` hook + `apiSend`.
Unwraps the `{error:{code,message}}` envelope, keeps old data on screen
while refreshing, drops superseded responses by sequence number.
`lib/api/types.ts` holds the payload contracts.

**Endpoints now called by the UI (were: zero callers):**
`POST /api/checkout`, `POST /api/subscription/change-plan`,
`POST /api/subscription/cancel`, `POST /api/subscription/resume` (NEW),
`GET/POST /api/keys` + `DELETE /api/keys/[id]`, `GET /api/subscription`,
`GET /api/usage`, `GET /api/plans`, `GET /api/orgs` +
`PATCH /api/orgs/[id]`, `GET /api/admin/d17/export`, plus
`PATCH /api/profile`, `POST /api/profile/password`,
`POST /api/account/delete`, `GET /api/usage/export`,
`GET /api/billing/payments` — all NEW (see §5.10).

**API contract fixes the wiring forced:**
- `usageHistory()` returns a `UsageRowView` projection, not a raw row.
  `cost_*_usd` were STRINGS (NUMERIC via postgres-js — `subscriptionBundle`
  always `Number()`-ed them, this one did not); timestamps were `Date`s;
  `keyName` is now joined from `api_keys` so the Key column works.
  Adds `model` / `apiKeyId` filters and a `totals` aggregate over the same
  WHERE, so the summary cards cannot disagree with the table.
- `latency_ms` is written NULL by the collector (never measured), so the
  Usage page's latency column and "Avg latency" card were rendering
  `0 ms` with a real-looking unit. **Both removed** — cache reads replaced
  the stat card. `status_code` NULL now renders "failed", not the string
  "null".

**Deliberately removed as fiction, not wired:** the hardcoded notification
feed (replaced by an Account-status menu built from the bundle, with an
unread dot only when a sync actually failed), the invented user identity
in header/sidebar (now from `/api/orgs` via `ShellIdentityProvider` — there
is no "current user" endpoint and the personal name is not shown until one
exists), and the pricing page's hardcoded **"19 DT/month"** for a plan the
database stores as `$19` USD.

### 5.10 Account operations + session invalidation (2026-10-13, NEW)

Migration **`0006_account_operations.sql`** + `lib/account/service.ts`.

- `updateProfile` — self-scoped; **email is not editable** (it is the
  identity `authorize.ts` bridges on; changing it would orphan every
  membership and audit row).
- `changePassword` — **requires the current password** (without it this is
  a takeover primitive), rejects reuse, validates against the real policy.
- `deleteAccount` — owner only, **type-the-slug confirmation checked
  server-side**. SOFT delete: the subscription is canceled, every key is
  revoked upstream, the team is starved at `CUT_BUDGET`, and the org is
  marked `deleted` (after which `requireOrgMembership` answers 404).
  `usage_records` is RETAINED — it is the billing record. Cut-off happens
  BEFORE cleanup, deliberately.

**Session invalidation — the important part.** `users.password_changed_at`
is stamped on every credential change, copied into the JWT at sign-in
(`auth.ts`), and compared on every request by `sessionIsFresh`
(`lib/auth/session-freshness.ts`, pure, unit-tested). Auth.js v5 permits
Credentials only with the JWT strategy, so a copied cookie previously
survived a password change for `maxAge` (7 days). This closes the KNOWN
LIMIT that §5.2's reset flow documented — `completePasswordReset` now
stamps it too, so a reset taken because a password may be stolen actually
kills the stolen session. **Migration 0006 invalidates every session issued
before it; one forced re-login on deploy is expected.**

Migration 0006 is **NOT yet applied to any database** — run
`make db-migrate` before deploying, or sign-in will fail on the missing
column.

### 5.11 Two dead paths found and fixed (2026-10-13)

- **Both checkout URLs 404'd.** `devCheckoutUrl()` → `/billing/confirm`
  and `d17.ts` → `/checkout/d17/<id>` pointed at pages deleted in the
  frontend removal, so *nobody could ever subscribe* — only
  `verify-metering`, which signs the callback itself, could reach an
  activation. Both pages now exist; the dev one POSTs to the real
  `/api/billing/callback` so signature verification, `billing_events`
  dedupe and the entitlement push are genuinely exercised. The activation
  `event_id` carries a per-render nonce: a double click dedupes, and a
  later re-subscription is NOT deduped against it.
- **Every password-reset link silently failed.** `resetLink()` built
  `/reset-password/confirm?token=…`, which resolved against
  `[token]/page.tsx` with `params.token === "confirm"` — the page rendered
  and the form submitted the literal string "confirm". The unit test
  *asserted the same wrong shape*, which is why it passed. Fixed to a path
  segment; old links still work via a query-param fallback.
- **Caddy would have 413'd every D17 screenshot** — the portal vhost caps
  bodies at 2MB but `SCREENSHOT_MAX_BYTES` is 3MB and the customer-facing
  copy says "3 Mo maximum". Scoped `route` block raises it to 4MB for
  `/api/checkout/d17/proof*` only.
- **White-on-white on every fixed-white page in dark mode.** `<html
  class="dark">` made `--foreground` near-white inside pages painting
  `bg-white`; a shared error heading and button were in the DOM,
  `innerText`-visible and fully opaque, and invisible on screen. Fixed
  with a `.light-surface` token scope in `globals.css`, applied to the
  marketing/auth routes. The dashboard keeps the dark theme.

### 5.12 Canonical payment plan corrected + `/api/usage/summary` (2026-10-13)

- **`scripts/verify-d17.ts` and `verify-metering.ts` were extended, not
  duplicated.** New cases land inside the existing walk. `verify-d17` gains
  **T11 (renewal)**, **T12 (email verification)** and **T13 (password change
  invalidates every existing session, proven over HTTP)**; `verify-metering`
  gains **§18b (renewal gates)**, **§18c (usage series)**, **§21 (account
  deletion: cut off first, the deleted key is refused UPSTREAM 401, cleanup
  best-effort, second delete 409)** and **§22 (profile rename persists on
  re-read)**. Everything runs against a real Postgres + real gateway, so unit
  tests still cannot fake what these catch.
- **`GET /api/usage/summary?bucket=day|hour`** — a DENSE, server-bucketed
  series (`generate_series` zero-fill, 1000-point cap → 400). The dashboard
  chart used to bucket ONE page of rows client-side and label that page's
  extent a "date range"; it now consumes the series on both the overview and
  the usage page. `lib/billing/service.ts:usageHistorySeries`.
- **`AuthzError` moved to `lib/auth/errors.ts`** and re-exported by
  `authorize.ts`. The proof runner imports `verify-email.ts` (which throws a
  403), and `authorize.ts` imports `next/navigation` + `@/auth`, neither of
  which resolve in the jobs container. The extraction is what keeps the proof
  runnable; every `import { AuthzError } from '@/lib/auth/authorize'` still
  works.
- **Scrub-check fix**: a long-lived test constant
  (`portal/tests/billing.test.ts`) tripped the generic "credential literal"
  rule. Renamed to a self-describing placeholder value; scrubbed clean.

### 5.13 Renewals + period roll-forward (2026-10-13, migration 0007)

`payments_d17.subscription_id` was UNIQUE — one row per subscription for life.
Renewals were impossible without overwriting history. 0007 turns it into a real
per-period ledger:

- plain index `payments_d17_sub_created_idx(subscription_id, created_at DESC)`
  and `payments_d17_sub_status_idx(subscription_id, status)`;
- **partial unique `payments_d17_one_open_idx` on `(subscription_id)
  WHERE status IN ('pending_payment','proof_submitted','rejected')`** — the
  at-most-one-open invariant enforced in the DATABASE, because two concurrent
  `begin()` calls both see no open row and both insert. `begin()` catches the
  23505 and re-selects/updates.
- `period_start` / `period_end` on each payment (provisional at creation,
  corrected to the actual period on approval).
- **Renewal trigger is on-demand, not a `renew_due` job.** A live subscription
  on the SAME plan may re-checkout inside the 7-day window
  (`RENEWAL_WINDOW_DAYS`) or once lapsed; a different plan still 409s
  (`changePlan` is the path). No phantom rows.
- **Early renewal rolls the period from the OLD end**, so overlap days are not
  lost. `expireSubscriptions` follows D1/D3: `active`→`past_due` at period end,
  `past_due`→`unpaid` after `RENEWAL_GRACE_DAYS` (7), cut to `CUT_BUDGET` —
  never revoke.
- Proven by `verify-d17` **T11** and `verify-metering` **§18b**.

### 5.14 Budget denomination + included spend (2026-10-13)

- `hard_cap_cents` / `included_spend_cents` are **CUSTOMER** cents. The gateway
  `max_budget` is **UPSTREAM** USD: `resolveBudgetUsd` divides customer cents by
  `rate_multiplier_bps` (`lib/entitlements/policy.ts`).
- Overage invariant: customer cost = upstream × `rate_multiplier_bps` for EVERY
  row; therefore `overage_markup_bps` MUST equal `rate_multiplier_bps − 10000`
  (13000→3000, 12500→2500). No second multiplier anywhere in code. Asserted in
  `tests/security.test.ts`.
- Usage window follows the **subscription period** (`current_period_start`)
  when present, calendar month otherwise. The rollup cache keeps calendar
  buckets; a customer-shown number comes from the ledger, never the cache.
- Proven by `verify-metering` (upstream budget asserts + §15 upgrade).

### 5.15 Email verification (2026-10-13, migration 0008)

- `createLocalUser` used to write `email_verified: null` forever, and the D17
  flow TRUSTS that address for status mail.
- Reuses the reset-token machinery, NOT a second system: `lib/auth/tokens.ts`
  holds the shared primitives; `verify-tokens.ts` adds the `verify-email:`
  namespace (`hashToken`, case-insensitive email, path-segment link).
- **Confirmation is a POST button, not a GET link**, so a mail scanner cannot
  consume the single-use token before the human clicks it.
- Gate lives at `POST /api/checkout` and `POST /api/keys`
  (`requireVerifiedEmail`), NOT at sign-in — so existing lib-level proofs keep
  working.
- Migration 0008 adds `users.email_verified_at`, **grandfathers every existing
  row as verified** (stranding real accounts at the paywall would be worse than
  the risk), and mirrors to `auth_users.email_verified`. Only NEW signups start
  unverified.
- Dashboard shows a resend banner; `verify-email/[token]` is the confirm page.
- Proven by `verify-d17` **T12** + `tests/verify-email.test.ts`.

### 5.8 Frontend removed (2026-10-11) — SUPERSEDED by §5.9
All page-level UI was deleted at the user's request — the frontend is
being built fresh. Gone: `app/page.tsx`, `globals.css`, `sign-in/`,
`sign-up/`, `pricing/`, `dashboard/**` (layout, nav, overview, keys
manager, all 4 stubs), `checkout/d17/**` pages, `admin/d17/` pages,
`reset-password/**`, `tailwind.config.ts`, `postcss.config.mjs`,
`proxy.ts` (the page-only auth gate — the authoritative checks live in
`lib/auth/authorize.ts`, so nothing security-relevant was lost), and
`lib/billing/d17-actions.ts` (the `'use server'` form bridge; the service
it called, `d17-proof.ts`, is untouched).

Kept: `app/api/**` (15 route handlers — the entire customer surface is
now HTTP JSON), `lib/**`, `db/**`, `scripts/**`, `tests/**`, `auth.ts`,
and a deliberately minimal `app/layout.tsx` (the App Router requires a
root layout for `next build` to pass — replace its `<html>/<body>` when
the new UI lands).

Verified after the removal: typecheck clean, 98 unit tests pass,
`docker compose build portal` succeeds, `/api/plans` 200, `/api/usage`
401 (anonymous), `/api/health` 200, all pages 404, and BOTH proofs still
green (`make verify-d17`, `make verify-metering`). One consequence worth
remembering: with no sign-in page, the only way to obtain a session is
the Auth.js endpoint directly (`GET /api/auth/csrf` → `POST
/api/auth/callback/credentials`) — which is exactly what `verify-d17`
T6 does to test the staff gate.

## 6. Rules for any AI working here

- `.env` is gitignored. NEVER commit keys, NEVER print key values
  (lengths/redacted only). Run `make verify-config` + secret-scan before
  every commit.
- Don't run Caddy locally. Don't deploy local `litellm.yaml`/`.env` to
  the VPS — the tunnel + nominal prices are DEV-only. VPS deploys go via
  `make deploy HOST=…` (rsync, excludes `.env`), then migrate + rebuild.
- LiteLLM version pinned by behavior above (spend-log shape, `/ui`
  datetime contract, `reasoning_content`/`thinking` passthrough). If the
  image is upgraded, re-verify §5's assumptions first.
- Smoke: `SMOKE_BASE=http://127.0.0.1:4000 ./scripts/smoke.sh <key>`
  locally; A-14 only asserts over `https://` (public edge).
- Metering/billing/subscription changes: `make verify-metering` is the
  end-to-end proof of the money path (paywall → subscribe → use →
  upgrade → cancel@period-end → rollover cut → re-subscribe → cancel →
  revoke) and the first thing to run after touching `lib/billing`,
  `lib/keys`, `lib/litellm`, `lib/jobs`, or provisioning. It is
  deterministic (mock upstream) and re-runnable.
- `.env` additions this session: `EMAIL_TRANSPORT`, `RESEND_API_KEY`,
  `MAIL_FROM` (QUOTED — `<...>` breaks shell-sourcing), `OPS_ALERT_EMAIL`,
  `APP_URL`, `BILLING_*`. Both compose services pass them.
- Portal checks: `npm run typecheck` and `npm test` (98 tests).
- D17/manual-payment changes: `make verify-d17` is the end-to-end proof
  (it creates its own accounts and leaves its evidence behind).
- `make health` immediately after `make verify-metering` can race the
  litellm restore; the target now waits for readiness before finishing.
  `npm run lint` is DEAD — `next lint` was removed in Next 16 and the
  project has no ESLint config or dependency.
- After ANY code change, recreate the images/containers that run it:
  the portal and jobs containers both hold copies of `lib/`. `make up`
  does NOT rebuild — use `docker compose build <svc> && docker compose
  up -d <svc>`, or rely on `make verify-metering` (it builds the jobs
  image itself) plus an explicit portal rebuild.
- The minted test accounts/orgs/teams the proof leaves behind are
  evidence, not garbage — do not delete rows to "clean up"; the ledger
  rows are the billing record.
