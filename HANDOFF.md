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
