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

### 5.16 Trials, anomaly alerts, admin console (2026-10-14, migration 0009)

The last three deferred dev features, now built and proven.

- **Trials.** Starter offers a 7-day trial (`plans.trial_days = 7`); Pro keeps
  `0` on purpose — a trial runs at the plan's FULL included spend, and Pro's
  ~$144 upstream grant is too large to switch on without a business decision.
  One trial per org, enforced by the append-only `subscription.trial_started`
  AUDIT row (`trialEligibility` reads the audit, not a mutable column, so the
  limit cannot be reset). The subscription goes straight to `trialing` with
  `current_period_start → trial_end`, so period-based surfaces need no special
  case; `STATUS_EFFECT.trialing = 'full'` means a trial exercises the real
  product. No payment row is invented. `expire_trials` flips an elapsed trial
  to `unpaid` — CUT, never revoked (D3).
- **Anomaly alerts.** `detect_anomalies` (job row restored) watches the
  customers, not the system: (1) one sender phone across several orgs; (2) a
  rejected-proof burst (≥3 in 24h); (3) a hard-cap breach — which MUST be
  impossible and is therefore a live money leak; (4) a single oversized
  request (≥ $25 customer). Authorization-number reuse is deliberately NOT a
  detector — `payments_d17.authorization_number` is UNIQUE, so the constraint
  is already the enforcement. Dedupe is per-finding in `system_alerts`
  (`anomaly:<kind>:<key>`); at most two mails per pass (new/changed +
  recovery). A cleared condition deletes its row.
- **Admin console.** `/admin` (staff-only, standalone `<main>` like
  `/admin/d17`) lists every non-deleted org and offers suspend / reactivate,
  a manual entitlement retry, and credit notes. Suspension is REAL: it flows
  through `syncOrganizationEntitlements`, which reads `organizations.status`
  and CUTs a non-active org (the reconciler now includes `suspended` too), so
  a suspended org is refused checkout/trial (403 `forbidden`) AND its gateway
  budget is cut. `credit_notes` is the record of a manual refund, because D17
  has no refund API. Roles: suspend/reactivate/credit = `admin`; list/retry =
  `support`.
- Routes: `POST /api/billing/trial`; `GET /api/admin/orgs`;
  `POST /api/admin/orgs/[id]/{suspend,reactivate,sync}`;
  `POST /api/admin/credits`. Service in `lib/billing/admin-console.ts`.
- Proven by `verify-metering` **§23–§27** (trial eligibility + one-per-org +
  expiry; suspend→CUT / reactivate→FULL / retry / credit); `tests/billing.test.ts`
  adds `forbidden`→403 and `summarizePlan().trialDays`.

### 5.17 Browser pass over the staff/customer UI + deploy dry-run (2026-10-15)

`verify-metering` §23–§27 drive the billing/admin service layer directly, so
the Phase E UI (§5.16) had never been *clicked*. Driving it in a real browser
found two defects that type-checking and the proofs both passed over.

- **The admin routes had no `<Toaster/>` — every operator message was silently
  dropped.** `Toaster` was mounted only in `app/(app)/layout.tsx`, and
  `/admin` + `/admin/d17` sit OUTSIDE that group. So an operator clicked
  Suspend, the server cut the gateway, the row updated — and *no toast ever
  appeared* for any of the 14 `toast.*` calls across `admin-orgs.tsx` and
  `d17-admin-queue.tsx`. Fixed by `app/admin/layout.tsx`, which mounts the
  toaster for the whole `admin` group. The root layout already provides
  `ThemeProvider`, so sonner's theme resolution works there unchanged.
- **"Retry sync" on an account with no subscription reported a gateway
  failure.** `syncOrganizationEntitlements` returns
  `{ok: false, error: 'no subscription'}` for a brand-new account — the sync
  ran and cut anything stale; there is simply no plan to push. The UI mapped
  `syncOk === false` to "Sync still failing — check the gateway", sending an
  operator to chase an outage that did not exist. Now `syncError === 'no
  subscription'` is reported as its own benign outcome ("Nothing to sync"),
  and `reactivate` no longer claims "Limits re-pushed" when the push failed.
  (That silence was latent, not caused by this fix: it applied to
  `reactivate` on a failing gateway too.)
- **Step 12 closed — staff session freshness.** `currentUser()` has applied
  `sessionIsFresh` since migration 0006; `requireStaff()` and
  `currentStaffRole()` read `auth()` directly and did not, so a staff cookie
  minted before a password change stayed valid for `maxAge`. Both now share a
  private `staffSessionIsFresh()` helper. It reads ONLY the
  `password_changed_at` stamp from `users` — never a role or an org — so the
  "staff are never customers" separation is untouched. Stale is `401`
  (re-authenticate), not `403`: a pre-change cookie is an unauthenticated
  cookie.
- **Also driven end-to-end in the browser:** sign-up → the verification
  banner's resend → the real dev-transport link → the `POST` confirm form →
  "Start 7-day free trial" (`trialing`, entitlement `synced`, the
  `subscription.trial_started` audit row), plus suspend / reactivate / retry /
  credit note and D17 approve (→ `paid`, subscription `active`, limits pushed)
  / reject-with-reason. All confirmed in the database, not just by HTTP 200.
- **Deploy dry-run** (no deploy performed). `verify-config` OK; `docker
  compose config` resolves; `verify-caddy` OK; `make health` OK (gateway 200,
  portal `database`+`gateway` true, jobs running); `backup-drill` passes
  (9 migrations, 171 ledger rows). Two things fixed: the `Caddyfile` was not
  `caddy fmt`-clean (whitespace only, revalidated), and **`make probe` could
  never pass** — its guard `: "$${UPSTREAM_BASE_URL:?...}"` ran BEFORE the same
  recipe sourced `.env`, so the documented `make init` → fill `.env` → `make
  probe` sequence always died with "source .env first". Source now comes
  first, and is skipped when `.env` is absent so the message is the useful
  one. The probe now runs and returns its real verdict: the upstream tunnel
  `rj8dp52.abc-tunnel.us` answers **530 on every wire format**, which is the
  known external blocker, not a defect.

### 5.18 Deployed to the VPS (2026-10-15) — live at *.15-224-52-176.sslip.io

First real deploy. It surfaced three faults that no local gate could catch, because
all three only exist on a machine that is not the dev box.

- **`make init` was broken everywhere, not just on Linux.** Two bugs stacked: the guard
  `test -f .env &&` meant the *success* path (no `.env` yet) exited 1 and aborted the
  target before writing anything, and the recipe used BSD `sed -i ''` that GNU sed
  treats as a filename. Now `test ! -f .env ||` + temp-file-and-move; verified on BSD
  and GNU sed, mode 600, second run refuses.
- **`.env.example` was missing eight required keys** — `BILLING_DEV_SECRET` most
  importantly, which `docker-compose.yml` demands with `:?`. So the documented
  `make init` → `make up` first-deploy path failed on any fresh host. Fixed in the
  template, not papered over on the VPS.
- **`make deploy` could not authenticate.** No `-e` to rsync, so the `ssh -i` alias in
  `~/.ssh/config` is ignored and it fails `Permission denied (publickey)`. Now accepts
  `SSH_KEY=` and passes it to both tools.

**Live state:** all four vhosts hold real Let's Encrypt certs (verified by issuer),
HTTP→HTTPS 308s, migrations 0001–0009 applied to a fresh DB, `make health` green
(gateway 200, portal `database`+`gateway` true, jobs running). `api` and `portal` answer
200; `admin` and `code` are IP-gated in the Caddyfile and answer 403 from outside.
Two demo accounts exist (customer + staff/admin), both created with
`portal/scripts/create-accounts.ts` — which calls `createLocalUser()` rather than
writing SQL, because the credential column is a scrypt hash and a subtly wrong INSERT
yields an account that cannot sign in and reports nothing. The staff identity has a
`staff_users` row and no org, per PLATFORM.md §1.2.

**Backups:** `/opt/gateway/_rescue/` holds both prior DB volumes (one test user,
`alex@example.com`), the pre-deploy tree, and a git diff patch.

**Blocked externally, not by code:** the upstream tunnel answers **530** on every wire
format from both here and the VPS, so the gateway enforces budgets but no real
completion can flow. `LITELLM_SALT_KEY` and `AUTH_SECRET` exist only in the VPS `.env` —
losing them bricks stored credentials and signs every user out, so back them up
off-box now.

### 5.19 Customer keys are `zn-` — and the auth edge that makes it honest (2026-10-15)

Every key the portal issues now starts with `zn-`. This did not work, and the
reason is worth keeping.

**LiteLLM's `sk-` is structural, not cosmetic.** `/key/generate` hard-codes
`data.key.startswith("sk-")` with no setting to change it, and — the part that
actually blocks it — the normalizer in `proxy/_types.py` only calls
`hash_token()` when the value starts with `sk-`. Anything else is treated as an
*already-hashed* token and looked up verbatim, so a `zn-` value can never match
the sha256 the gateway stores. Verified against the pinned `v1.103.1` image,
not assumed. `sk-` is also branched on in `/key/block`, key-info, and two
spend-tracking paths.

**What we did.** The portal generates the random *body* (32 bytes →
43 base64url chars), shows the customer `zn-<body>`, registers `sk-<body>` at
the gateway, and a new **`edge/`** service restores the prefix on the way in.
One body, two prefixes — verified cryptographically on the live key:
`sha256("sk-" + body)` equals LiteLLM's stored token.

**What we rejected, and why.** *Patching LiteLLM* would put a change in the
normalizer and in spend tracking — the code that enforces budgets, where a
mistake fails silently as unmetered usage. *Doing it in Caddy* was tested
against the real binary and fails in two silent ways: `header_up` with a
`.replace.` placeholder **drops the header**, and a plain placeholder forwards
the unexpanded literal. `request_header` and `map` do not exist in Caddy
2.11.7's Caddyfile. Both failures turn a request anonymous without an error.

**The edge's rules** (`edge/server.mjs`): fail closed (502, never 200, when
the gateway is down); never log a credential (boolean only); stream, so SSE is
unbuffered; refuse a bodiless `zn-` key rather than minting `sk-short`; deny
the management surface as defence in depth. Binds `127.0.0.1` only, reached
exclusively from Caddy.

**Two bugs the tests caught**, both mine, both silent:
- The edge never piped the **request body** — every POST would have reached
  LiteLLM with an empty body and hung on its own `Content-Length`.
- `verify-metering` calls LiteLLM directly, so its `zn-` key got no rewrite
  and **every** API call 401'd. Internal callers must present the gateway form
  (`toGatewayKey`); the edge is on the external path only.

**Also corrected:** a test asserted that the two forms hash alike. They do not —
the prefix is part of the hashed input. Now pinned deliberately, since the
instinct is wrong and would bite anyone verifying a presented `zn-` key.

Proven live on the VPS: a portal-minted `zn-` key returns **200** from
`/v1/models` through Caddy and the edge, via both `Authorization` and
`x-api-key`; a wrong `zn-` key is 401; `zn-short` is refused **by the edge**
(`auth_edge_error`) and never reaches LiteLLM; `/key/generate` is 404 on the
public host. Full docs in `docs/auth-edge.md`.

### 5.20 Upstream is now OpenRouter `poolside/laguna-s-2.1:free` (2026-10-15)

Proven end-to-end on the VPS, both wire formats.

**Chosen because it is the best free *coding* model reachable.** Surveyed
OpenRouter's catalogue: `poolside/laguna-s-2.1:free` — Poolside's open-weight
**agentic-coding** model, 256k context, 32k max output, served directly by
Poolside, priced `$0/$0`. Its paid sibling (`poolside/laguna-s-2.1`) costs
$0.09/$0.18 per Mtok, which is what the nominal rates are anchored to.

**Config** (`config/litellm.yaml` + `prices/models.yaml`, one table two
consumers): `model: openai/poolside/laguna-s-2.1:free`, `api_base` from
`UPSTREAM_BASE_URL=https://openrouter.ai/api/v1`. Registered as `openai/`,
NOT `openrouter/` — the pinned LiteLLM build has **no `model_cost` entry** for
the `openrouter/` provider, and the `openai/` path is the verified one.
`supported_endpoints` keeps BOTH `/v1/chat/completions` and `/v1/messages`
untranslated.

**Nominal rates, deliberately non-zero** (input $0.60, output $2.40/Mtok): the
upstream is genuinely $0, and a $0 model makes every budget a no-op and hides
pipeline bugs. This is the pattern already documented in `prices/models.yaml`.
Note LiteLLM exposes only ONE `cache_creation_input_token_cost`, so it is set
to the **1h tier** (2.0x), not the 5m one — the two tables now agree on the
value LiteLLM actually uses.

**It is a reasoning model, and that matters operationally.** A completion
with `max_tokens: 90` returned **empty text** — all 90 tokens went to
`reasoning_tokens`. At `max_tokens: 1024` it returned
`def reverse_str(s): return s[::-1]` (224 reasoning + 11 content). Operators
must not set a tiny `max_tokens` against this model, or every response looks
like a silent failure.

**Live results** (portal-minted `zn-` key → Caddy → auth-edge → LiteLLM →
OpenRouter):
- `GET /v1/models` → `["fast"]`
- `POST /v1/chat/completions` → 200, real code, `cost: 0`
- `POST /v1/messages` (Anthropic) → 200, `type: message`, `WIRE_FORMAT_OK`

**Known behaviour: OpenRouter's free pool is rate-limited.** Both formats
intermittently return **429** and succeed on retry (~1 in 2 calls). This is an
upstream capacity limit, not a config fault, and it is the main reason the
nominal-budget machinery matters.

**Three credentials were tried first and rejected on evidence** — worth
recording so nobody re-litigates them:
- **opencode** (`oc_sk_…`): all ten `*-free` models → 403 `FreeTierError`
  ("can only be used from within OpenCode"); paid models → 402, no funds.
- **Kilo** (`eyJ…` JWT): inference → 401 `INVALID_TOKEN` (token has
  `"apiTokenPepper": null`) while `/models` still returned 200; paid models
  fail identically.
- **Vercel AI Gateway** (`vck_…`): key valid, catalog readable, the model IS
  there — but every inference → 403 "requires a valid credit card on file".

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

---

### 5.21 Upstream is now `space-bunny` via `api.howtofix.id` (2026-10-15)

Replaces §5.20 (OpenRouter `poolside/laguna-s-2.1:free`). The 9Router hop
tried before that was reverted — see "reverted" below.

**Config.** `config/litellm.yaml` — one `fast` deployment:
`model: openai/space-bunny`, `api_base`/`api_key` from
`UPSTREAM_BASE_URL` / `UPSTREAM_API_KEY`. `prices/models.yaml` — one
`space-bunny` row. `scripts/reconcile.sh` — `ALIAS = {"fast": "space-bunny"}`.
`portal/scripts/verify-metering.ts` — price probe uses `openai/space-bunny`.

**The URL in the provider's own docs is wrong.** `https://howtofix.id/v1/...`
404s from nginx. The working base is **`https://api.howtofix.id/v1`** —
`api.howtofix.id` is the only subdomain that resolves, and `https://howtofix.id/models`
returning 200 is the SPA's HTML catch-all, not an API.

**Verified live before wiring (not inferred):**

| Capability | Result |
|---|---|
| `POST /v1/chat/completions` | real completions |
| tool calling | `finish_reason: tool_calls`, well-formed `arguments` |
| full agentic loop (call → tool result → answer) | works |
| SSE streaming | correct framing — 36 `\n`, 18 `data:` frames, `[DONE]` |
| `POST /v1/messages` | works, Anthropic-native, emits `thinking` blocks |
| `POST /v1/responses` | **404 — NOT offered** |

**The `/v1/responses` gap is the significant one.** codex-cli 0.156 dropped
`wire_api = "chat"` and speaks Responses exclusively, and LiteLLM does *not*
translate here — it forwards `/v1/responses` to the upstream, which 404s
(verified through the gateway: `http=404 ... "Not found" ... Model Group=fast`).
So **codex-cli cannot drive `space-bunny`**, which reverses the §5.20 Codex
setup. `/v1/responses` is deliberately absent from `supported_endpoints`;
declaring an endpoint the upstream lacks only moves the 404. Closing this
needs a Responses→Chat shim (the auth-edge shape), not a config change.

**Reasoning model.** `max_tokens: 90` returns empty content — every token goes
to reasoning. Tiny `max_tokens` reads as silent failure; use ≥1024.

**Cooldown is punishing.** A single failure (the `/v1/responses` 404) puts the
only deployment in cooldown for **60s** — "No deployments available … Try again
in 60 seconds" — despite `cooldown_time: 3`. With one deployment under the alias
there is nothing to fall through to, so any failure is a 60s outage. Adding a
second model to the `fast` group is the mitigation, not more retries.

**Prices are NOMINAL, not real.** This provider's `/v1/models` carries **no
`pricing` object** — only `id`, `object`, `created`, `owned_by`,
`supported_endpoint_types` — and completions return no `usage.cost`. The rates
($0.30 in / $1.20 out per Mtok) are a documented placeholder so the
spend/budget/rollup pipeline stays exercisable. Replace before customer money
depends on them.

**Model id mismatch (harmless).** The catalogue lists `space-bunny`; responses
report `"model":"space-bunny-free"`. Pricing resolves on the bare name LiteLLM
logs, which is `space-bunny`.

**Reverted — do not resurrect.** The 9Router integration is gone:
`edge/normalise.mjs`, `portal/tests/upstream-normaliser.test.mjs`, the
`upstream-edge` compose service, and litellm's `extra_hosts` are all removed;
`edge/Dockerfile` is back to `CMD ["node","server.mjs"]` with one entry point.
The orphan container `gateway-upstream-edge-1` was `docker rm -f`'d on the VPS
afterwards — `docker compose ps` is clean. For the record, the normaliser was
working when abandoned: 9Router wraps success bodies as
`{"data":{…},"success":true}` **and** appends `\ndata: [DONE]\n\n` even to
non-streaming responses, so `JSON.parse` throws "Extra data: line 2 column 1".
It also mislabels non-streaming responses `text/event-stream`, so streaming must
be detected by sniffing the first bytes for a `data:` prefix, never from the
content-type. `https://api.howtofix.id/v1` needs none of this — plain OpenAI.

---

### 5.22 `/v1/responses` shim — Codex CLI works against space-bunny (2026-10-15)

Closes the §5.21 blocker. codex-cli 0.156 speaks Responses only; the upstream
404s on `/v1/responses`; LiteLLM forwards rather than translates. So the
translation now happens **in the auth-edge process**, in front of LiteLLM.

**Why at the edge and not as a separate service.** Metering. LiteLLM prices and
logs `/v1/chat/completions`, which is the shape the upstream is actually called
in. Translating in front of LiteLLM keeps the money path on the one endpoint
LiteLLM already handles correctly, instead of inventing a second priced shape
that would need its own rates, its own ledger mapping, and its own proof.

**Files.**
- `edge/responses-shim.mjs` — pure translator, no I/O. Importable and
  testable without binding a port.
- `edge/server.mjs` — intercepts `POST /v1/responses` only. Every other route
  is the original pure proxy, byte-for-byte.
- `edge/Dockerfile` — `COPY server.mjs responses-shim.mjs ./` (one entry point,
  the shim is in-process).
- `portal/tests/responses-shim.test.mjs` — 25 unit tests on the translation.
- `portal/tests/responses-route.test.mjs` — 10 tests over real HTTP against the
  shipped entry point.
- Kill switch: `RESPONSES_SHIM=off` restores pure passthrough. Needed because a
  future upstream that speaks Responses natively would make this dead weight.

**Verified live through the public edge with a real `zn-` key:**
`/v1/responses` non-streamed 200 · tool calling → `function_call` with
`call_id` + parsed arguments · streaming 22 events, sequence
`created → in_progress → output_item.added → reasoning_summary_text.delta →
… → completed`, reassembling to `"1 2 3"`.

**Verified with codex-cli 0.156.1 against the deployed gateway:**
- prompt → `exec` tool call → tool result → correct answer
- prompt → read `greet.js` → write `add.js` → run it → report `5`
  (multi-step, and it matched the existing CommonJS module style)

**`~/.codex/config.toml`.** `[models.fast]` added — `model_provider = "zaino"`,
`model = "fast"`, `model_context_window = 262144`, `model_max_output_tokens =
32768`. Without it codex prints "Model metadata for `fast` not found" and uses
guessed fallback metadata. Backup: `~/.codex/config.toml.bak-before-shim-*`.

Use: `codex -c model_provider=zaino -c model=fast`. The model override is
required — codex otherwise sends the global default (`oc/step-5-preview-free`),
which LiteLLM correctly rejects with 403.

**Deliberate refusals, not silent drops.** These are the cases where quietly
dropping an unsupported field would produce a 200 that looks fine while the
model works from truncated context:
- `previous_response_id` → **400** with an explanatory message. Codex uses
  `store:false` and sends full `input` each turn, so this should not fire.
- multimodal parts (`input_image`, `input_audio`) → dropped (upstream is
  text-only; forwarding them would 400 mid-stream).
- `reasoning` effort/summary → accepted and dropped.

**Hard rules the implementation encodes** (each has a test):
- Reasoning NEVER becomes visible text. `reasoning_content` maps to
  `response.reasoning_summary_text.delta` on its own reasoning item; splicing
  it into `output_text.delta` would put the model's scratchpad inside the
  answer it is about to give.
- A stream ALWAYS terminates on `response.completed`, including when the
  upstream sent zero chunks. Otherwise a client blocks until its own timeout.
- `finish()` is idempotent — an upstream that sends a terminal chunk and then
  closes must not produce two `response.completed` events.
- An upstream error keeps its status. A 429 becomes a 429, never a 200 with an
  empty completion, which would make an agent believe the model answered.
- Frames split on `\n\n`, never a bare newline, so a frame split across a TCP
  segment is not corrupted. An unparseable frame is skipped, not fatal.
- Refusals happen BEFORE the upstream call, so a rejected request never spends
  a billable model call (asserted with a call counter in the route tests).

**Cost:** the shim buffers the request body (capped at `MAX_BODY_BYTES`,
32 MiB) because a Responses request must be parsed whole to be translated.
Response bodies are never aggregated on the streaming path.

---

### 5.23 Model catalogue at api.howtofix.id — 15 models, 11 agentic (2026-10-15)

Probed with `scripts/probe-upstream-models.sh` (capability) and
`scripts/probe-coding-quality.py` / `scripts/probe-hard-tasks.py` (quality).

**Capability.** Each model tested for tool calling, argument validity, the
tool-result→answer turn, SSE framing, and `/v1/messages`.

AGENTIC (all four checks pass):
`space-bunny` · `cat-jam` · `deepseek-v4.1-flash` · `grok-4.6-liberated` ·
`nemotron-3.5-lightning` · `mimo-v2.6-flash` · `mimo-v2.6` · `big-pickle` ·
`longcat-2.5-preview` · `muse-spark-1.3-contributor` ·
`muse-spark-1.2-contributor`

Not qualified:
- `step-5-preview` — `x429` on every call (rate limited, not broken)
- `mimo-v2.5` — `x400` on every call
- `claude-haiku-5.5`, `deepseek-v4-flash` — tool calling works but the
  tool-result→answer turn fails (`loop=no`). An agent would stall after its
  first tool call, which is worse than not supporting tools at all.

**Quality — the 3/3 tie was the finding.** The first quality pass (reverse a
string, fix an off-by-one, order-preserving dedupe) put ALL ELEVEN at 3/3.
Three easy tasks do not discriminate; a tie is not a decision. Do not read
"11/11 pass" as "these models are equivalent" — it means the probe was too
weak. `scripts/probe-hard-tasks.py` exists because of that.

**Cloudflare gotcha that fakes a total outage.** The provider sits behind
Cloudflare, which returns **`error code: 1010`** (browser-signature ban) for
Python's default `Python-urllib/3.x` User-Agent. Every model then looks like a
hard 403. `curl` works. The Python probes now send an explicit
`User-Agent: curl/8.7.1`; without it a provider-level block reads as
"all 15 models are broken".

---

### 5.24 The mock upstream cannot reach itself from a container on Linux (2026-10-15)

`make verify-metering` failed 9 checks on the VPS with
`OpenAIException - Connection error`. Not a model or config problem: the mock
was not running at all.

Two separate causes, both real:

1. **No `node` on the VPS host.** `make mock-upstream` shells out to `node`,
   which exists only inside the containers. The target's readiness probe was
   `pgrep -f 'mock-upstream.mjs'`, which matches the *make command line
   itself* — so it printed "mock already running on :8787" while nothing was
   listening. The probe is now an actual `curl /health`, which cannot lie.

2. **Loopback is unreachable from a bridge container on Linux.**
   `scripts/mock-upstream.mjs` bound `127.0.0.1`, but
   `docker-compose.mock.yml` points LiteLLM at
   `http://host.docker.internal:8787`, which on Linux resolves to the docker
   bridge gateway (172.17.0.1) — and that cannot reach the host's 127.0.0.1.
   This file was written for Docker Desktop, where `host.docker.internal` does
   reach the host's interfaces. Fixed with an opt-in `MOCK_HOST` (default
   still `127.0.0.1`); on the VPS the mock runs as a host-network container
   with `MOCK_HOST=0.0.0.0`, which is safe only because the Lightsail
   firewall admits 22/80/443.

After both fixes `make verify-metering` passes end-to-end against the new
`space-bunny` price row (2 requests, 2 ledger rows, $0.000108 upstream /
$0.000140 customer at the 1.30× starter multiplier).

---

### 5.25 Three aliases over eleven deployments (2026-10-15)

`fast` / `smart` / `frontier`, replacing the single `fast` alias. These names
were never invented here — `portal/lib/keys/policy.ts` already documented them
as the canonical aliases ("never upstream names"), and `scripts/smoke.sh`
already expected `SMOKE_MODEL_RICH=smart`. The gateway was the only thing
behind them.

| alias | deployments | nominal rate |
|---|---|---|
| `fast` | 4 | $0.15 / $0.60 per Mtok |
| `smart` | 4 | $0.30 / $1.20 |
| `frontier` | 3 | $0.60 / $2.40 |

Membership is by **measured latency**, not by brand name:

- **fast** — `nemotron-3.5-lightning` (0.90s ttft) · `space-bunny` (1.13s) ·
  `cat-jam` (1.51s) · `deepseek-v4.1-flash` (1.54s)
- **smart** — `longcat-2.5-preview` (2.58s) · `mimo-v2.6` (3.12s) ·
  `mimo-v2.6-flash` (3.82s) · `big-pickle` (4.05s)
- **frontier** — `grok-4.6-liberated` (4.62s) ·
  `muse-spark-1.3-contributor` (5.16s) · `muse-spark-1.2-contributor` (5.25s)

(median of 5 streamed runs, `scripts/probe-latency.py`. Free shared pools, so
this is one sample of a distribution, not a constant.)

**Why latency and not quality — because quality could not be measured.**
`scripts/probe-hard-tasks.py` first appeared to discriminate (a 6/6 at the top,
4/6 at the bottom), which would have been a usable ranking. It was an artefact:
two of its six checks used `^$` as a "forbidden" pattern, and with `re.M` that
matches ANY text ending in a newline. Nearly every correct answer was scored
WRONG. After fixing both checks, all eleven score 6/6 — a complete tie, twice
over, on both the easy and the hard set.

So: **these eleven models are not distinguishable by the probes that were
built, and the tier split above is a latency ordering, not a quality
ranking.** Do not read `frontier` as "best model" — it is the highest-priced
tier and happens to contain the slowest models measured. A real quality
ranking needs a real benchmark (SWE-bench Verified, say), not six regexes.

**Several deployments per alias is the point, not decoration.** With ONE
deployment under an alias, any failure is a 60-second outage: LiteLLM puts the
failed deployment in cooldown and reports "No deployments available … Try
again in 60 seconds" with nothing to fall through to. With 3–4, a rate-limited
pool is skipped and the request is served by the next.

Every deployment inside a tier carries **identical** rates, which keeps the
spend math deterministic regardless of which deployment served a request —
`verify-metering`'s expected-cost assertions and `reconcile.sh`'s alias map
(one representative per alias) both depend on that invariant.

---

### 5.26 Bug: the TEAM's model list was never pushed (§5.25 exposed it)

Symptom, on the VPS, with a correctly configured key:

    key.models   = {fast,smart}   ← correct
    team.models  = {fast}         ← stale
    POST /v1/chat/completions {"model":"smart"} → 403
      "The requested model 'smart' is not available for this API key"

`GET /v1/models` returned `["fast","smart"]`, so the key looked perfect. The
403 blames the API key, which sends the investigation at the wrong object.

Cause: LiteLLM resolves a key's effective access as the **intersection** of
the key's `models` and its **team's** `models`. `syncOrganizationEntitlements`
pushed the team's *budget* (`updateTeamBudget`) but never the team's *models*
— it only set models on each key. A team is created once with
`DEFAULT_MODELS` and kept that list forever, so it permanently narrowed every
key beneath it.

This was invisible while every plan allowed exactly `['fast']`, which matched
`DEFAULT_MODELS` by coincidence. **Widening a plan allowlist is what exposed
it**, and it would have stayed hidden as long as no plan was ever wider than
the creation-time default.

Fix in `portal/lib/entitlements/sync.ts`:
- `sync()` now calls `updateTeamModels(teamId, allowedModels)` — the function
  already existed in `lib/litellm/client.ts` and had no callers.
- `forceCut()` cuts the team's models too, so a key added out of band cannot
  inherit access that no entitlement backs. Re-subscribing restores it,
  because sync now pushes team models on the way up.
- `DEFAULT_MODELS` in `lib/auth/provision.ts` is now all three aliases, so a
  new org is no narrower before subscribing than after.

New `getTeamInfo()` in `lib/litellm/client.ts`, because until the team can be
read back there is no way to tell "key is mis-scoped" from "team is stale".

`verify-metering` now asserts the **intersection**, not the two lists
separately: every alias must survive `key ∩ team`. Asserting each list alone
is what let this ship.

Migration `0010_model_tiers.sql` also has to force every cached `entitlements`
row due (`synced_at` back 2 hours), because `planForOrg()` reads the cached
entitlement first and only falls back to the live subscription. Without that,
widening `plans.models` changes nothing for an org that already has a cached
entitlement, and the `reconcile-entitlements` backstop would leave them on the
old allowlist for up to `BACKSTOP_INTERVAL_MINUTES` (60).

---

### 5.27 Config-drift guard: the two rate tables are now checked

`config/litellm.yaml`'s `model_info` and `prices/models.yaml` are the same
numbers in two files. They have drifted before, and the failure is silent and
expensive in both directions — litellm.yaml higher means the gateway meters
more than it bills (margin silently negative); lower means customers are
overcharged against the advertised rate. Nothing at runtime compares them.

`portal/tests/pricing-consistency.test.ts` (11 tests) parses both files from
disk and fails on:
- a deployment with no price row (spend silently unpriced)
- an orphan price row for a model no deployment serves
- **any per-token disagreement** between the two tables
- a tier whose deployments disagree with each other (breaks reconcile.sh)
- non-increasing tier rates (a tier that does not differentiate)
- an alias declared in `supported_endpoints` the upstream lacks — the exact
  §5.22 404 trap
- a deployment with no `num_retries` / `cooldown_time`
- a reconcile.sh alias that names a model no deployment serves, or misses one

Verified non-vacuous: injecting a deliberate 0.3 → 0.9 drift into
`prices/models.yaml` fails 3 of the 11.

---

### 5.28 Smoke A-6 was a false failure, and D17 is unconfigured (2026-10-15)

**A-6 (`cache_control` on the Anthropic path) now skips instead of failing.**
The upstream is OpenAI-compatible and has no prompt-caching primitive, so
LiteLLM translates `/v1/messages` and drops `cache_control` — the documented
lossy path (DESIGN.md §4.2/§4.6, "BLOCK B" in `config/litellm.yaml`). The
suite was reporting it as a red ❌, which is how people learn to ignore smoke
output and therefore how a REAL A-6 regression would slip through. It is now a
`⏭` with an explanation. `SMOKE_UPSTREAM_HAS_PROMPT_CACHE=1` restores the hard
failure for the day an upstream that actually caches.

Full public-edge smoke through a real `zn-` key:
**passed 8, failed 0, skipped 3** (A-6 no prompt cache; A-8/A-15 need
`LITELLM_MASTER_KEY`, which is not on the Mac by design).

**`make verify-d17` cannot run: `D17_RECEIVER_PHONE` is unset.** This is
pre-existing and unrelated to anything above — the six `D17_*` keys were absent
from `.env.example` entirely, so a fresh deploy hit a bare
`D17_RECEIVER_PHONE is not configured` crash with no hint that the key was
never documented. They are now documented in `.env.example`, with
`D17_RECEIVER_PHONE` deliberately left to be filled in: it is a real La Poste
payout number, and a placeholder default invites a deploy that looks
configured and is not. **Set it (and the other five) before `verify-d17` will
pass.** The dev billing provider ignores them all.

Codex CLI 0.156.1 verified against `smart` as well as `fast` (multi-step:
create `sum.js`, run it, report `42`). `[models.fast]`, `[models.smart]` and
`[models.frontier]` are all declared in `~/.codex/config.toml`.

---

### 5.29 One unreproduced 400 from the upstream (2026-10-15)

Observed twice while driving codex-cli against `fast`, never reproduced:

    litellm.BadRequestError: OpenAIException - Invalid request
    (request id: 202610151344276123347438268d9d6…)

LiteLLM treats 400 as terminal — `num_retries` covers 429 and 5xx, not 4xx —
so the request fails instead of falling through to another deployment in the
group. That is LiteLLM's correct general behaviour: a genuine bad request
should not be retried, and blindly retrying every 400 would turn one typo into
six model calls.

**Could not reproduce.** ~150 requests across the failing path, all clean:
- 30 identical simple requests per `fast` model, direct to the upstream
  (120 total) — 0 failures
- `max_tokens` 8192 and 32768 on all four `fast` models — all 200
- 25 requests with a 5-tool Codex-shaped catalogue, direct — all 200
- 8 requests through the shim with the EXACT codex shape (instructions +
  5 tools + stream + `max_output_tokens: 32768`) — all 200

**Not yet mitigated, deliberately.** A bare 400 with no detail field cannot be
distinguished from a genuinely malformed request, so the gateway does not
retry it. If this rate turns out to matter, the fix belongs at the provider
adapter, not in the retry config: retry only a 400 whose body carries no
`error.type`/`error.param` (i.e. malformed upstream, not a real rejection), and
count it in the spend ledger as an upstream fault so it stays visible.

**Rate is roughly 1 in 150 on the codex path** and Codex recovers on its own
retry. Recorded here so the next occurrence is a confirmation rather than a
new investigation.

---

### 5.30 The ledger and dashboard speak in aliases only (2026-10-15)

The customer surface shows three model names — `fast`, `smart`, `frontier` —
and never an upstream one. That was the intent from §5.25, but the ledger
contradicted it: `usage_records.model` held whatever the gateway reported per
request (`openai/space-bunny`, `space-bunny-free`, `poolside/laguna-s-2.1:free`
…), **twenty distinct spellings** of eleven models on the live database, all
rendered verbatim by the dashboard table, the "by model" breakdown, and the
CSV export.

Fixed in three layers:

1. **Write time** (`portal/lib/jobs/collect-usage.ts`). The collector resolves
   to an alias BEFORE inserting. It prefers `model_group` — the alias the
   client requested, logged separately from the resolved upstream id — and
   falls back to the `aliases:` registry in `prices/models.yaml` for rows
   whose group is empty. Either path returns an alias or `unknown`; a raw name
   can no longer reach the ledger through this path. It also resolves the
   ROUTE from `call_type` (`acompletion`→`chat`, `anthropic_messages`→
   `messages`, `aresponses`→`responses`), because reading the legacy
   `endpoint` field is what produced the dashboard's wall of `unknown` —
   current spend rows do not carry it. Non-inference calls (`/v1/models`,
   `/key/info`) keep a truthful label instead of `unknown`.
2. **History** (migration `0011_usage_aliases.sql`). Backfills every existing
   row to its alias — 213 fast, 17 smart, 10 frontier, 11 unknown — then adds
   a CHECK constraint so the column can never hold anything else. A future
   deploy that writes an unmapped name fails at the INSERT, loudly, instead
   of silently rendering a provider's name on a customer dashboard. The
   mapping is written out explicitly so an auditor can read what each old
   value became. The `unknown` escape hatch is deliberate: rejected attempts
   (`__not_allowed__`) have no model, and they must not need a second one.
3. **Routes** (`portal/scripts/backfill-routes.ts`). A migration cannot join
   the portal DB to LiteLLM's spend table, so this runs from the jobs image
   with `--apply`, matching on (team, exact timestamp, token counts). Dry run
   first: **237/237 matched, 0 ambiguous, 0 missing** — then written. Only
   touches rows still reading `unknown`; re-running changes nothing.

The `aliases:` registry lives in `prices/models.yaml` beside the rates, not
hardcoded in TypeScript — an earlier hand-written map went stale the moment a
model moved tiers, silently. `tests/pricing-consistency.test.ts` asserts the
registry covers every deployment and no removed model; `verify-metering`
asserts the collector maps every import and every ledger row reads as an
alias. `getSpendLogs` needed no change — the fields were already in the API
response, just never read.

One honest footnote: `model_group` is empty on some zero-token rows, which is
why the registry fallback exists at all. And the backfill script's first
version matched nothing because raw SQL returns `occurred_at` while the
interface read `occurredAt` — every timestamp parsed as NaN. It now selects
into the right names and says so in a comment.

---

### 5.31 The tables looked narrow — the bug was in the Tabs primitive (2026-10-15)

The usage table left ~190px of dead space on the left and clustered its
columns on the right. It looked like a table CSS problem, and two rounds of
`colgroup` work made it *worse* (the flexible column absorbed the slack and
widened the gap).

**It was never the table.** Measured in the browser:

    tabs root        display:flex   flex-direction: row    width 912px
    child 1 (px-6)   width 179px   left 280px   ← the tab list
    child 2 (panel)  width 740px   left 467px   ← the table, squeezed

`components/ui/tabs.tsx` had:

    "group/tabs flex gap-2 data-horizontal:flex-col"

Tailwind's `data-horizontal:` shorthand expands to `[data-horizontal]`, but
base-ui emits **`data-orientation="horizontal"`**. The variant never matched,
so the root stayed `flex-row` and laid the tab list out BESIDE the panel
instead of above it — the panel lost 179px, and the table inherited the loss.

Worse, it was silent: `data-orientation` was present in the DOM, the tab list
looked correct, and nothing errored. The same broken shorthand appeared 11
more times as `group-data-horizontal/tabs:` in the same file (trigger heights,
the underline pseudo-element, vertical-orientation rules) and in
`components/ui/separator.tsx`, where it left separators with NO orientation
styling at all.

Fixed by using the attribute that actually exists —
`data-[orientation=horizontal]:` and `group-data-[orientation=horizontal]/tabs:`
— in both primitives. `usage-view.tsx` is currently the only consumer of Tabs,
so the blast radius was one page, but Separator is shared.

**Lesson worth keeping: measure the layout before editing the layout.** Two
attempts at "fixing the table" moved pixels around without touching the cause,
and both would have looked like reasonable work in review. One
`getComputedStyle` on the ancestor chain answered it.

The `colgroup` changes are kept because they are right on their own terms, but
as **percentages summing to 100%**, not the `w-[148px]` fixed widths from the
first attempt. Fixed pixel widths under-fill whenever the viewport is narrower
than their sum, which is the same class of bug from the other direction.
Verified after deploy: `flex-direction: column`, table width = card width =
912px, columns `[119, 82, 82, 201, 109, 109, 119, 91]` summing to exactly 912.
The "By model" panel lost its `px-6` for the same reason — it was 48px
narrower than its sibling, so switching tabs visibly shifted the layout.
