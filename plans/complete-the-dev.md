# Implementation Plan — completing the LLM gateway SaaS

**Status:** in execution — Phase A green; Steps 4–8 landed (renewals, included-spend
denomination, consistency sweep, email verification, usage summary); Step 9 deferred to
Phase E; Step 10 DONE (all residuals closed, incl. CSV row count); Step 11 DONE (live
Lighthouse pass: every dashboard surface, /admin, and the signed-out auth pages score
accessibility 1.0 in BOTH themes); Step 12 security review recorded (clean). **Phase E
dev features LANDED (2026-10-14, migration 0009): trials, anomaly alerts, admin console —
all proven by `verify-metering` §23–§27.** VPS deploy remains blocked on a missing `.env`
(out of scope).
**Created:** 2026-10-13
**Scope:** everything outstanding in `/Users/user/Workspace/gateway` after the Tier 1–4 repair work.
**Execution mode:** DIRECT (edit in place, deploy by rsync). Two remotes now: `gateway` (VPS)
and `origin` (public GitHub, `Louay0007/gateway`). `make deploy HOST=gateway` remains the
delivery path to the VPS (an SSH checkout — `git push gateway main` is refused because the
branch is checked out there).

### Execution log (append-only)

- **Step 4 (renewals)** — DONE. Migration `0007_d17_renewals.sql` applied locally. `begin()`
  reuses the one open payment; a partial unique index `payments_d17_one_open_idx` enforces
  at-most-one-open in the DATABASE (race backstop). Period roll-forward on approval; early
  renewal starts at the old period end. Proven by `verify-d17` T11.
- **Step 5 (included spend)** — DONE. Budgets are denominated in UPSTREAM USD on the gateway
  (`resolveBudgetUsd` divides customer cents by `rate_multiplier_bps`); the overage invariant
  `overage_markup_bps == rate_multiplier_bps − 10000` is documented and tested; usage window
  follows `current_period_start`. Proven by `verify-metering`.
- **Step 6 (sweep)** — DONE. See the corrected bullet on `/api/orgs` below. Card copy,
  navbar/footer "Documentation" link, and `/api/orgs` authz corrected; README/PLATFORM
  refresh is the remaining doc task.
- **Step 7 (email verification)** — DONE. Migration `0008_email_verification.sql`. Reuses the
  reset-token machinery (`lib/auth/tokens.ts` shared, `verify-email:` namespace); POST-confirm
  so mail scanners cannot burn the link; gate on `POST /api/checkout` and `POST /api/keys`;
  dashboard banner + resend. Proven by `verify-d17` T12. `AuthzError` was extracted to
  `lib/auth/errors.ts` so the proof runner no longer drags in `next/navigation` via
  `authorize.ts`.
- **Step 8 (usage summary)** — DONE. `GET /api/usage/summary?bucket=day|hour` with a DENSE,
  server-bucketed series (`generate_series` zero-fill, 1000-point cap → 400). The chart no
  longer re-buckets a page of rows; it consumes the series on both the overview and the usage
  page.
- **Step 9 (multi-org)** — MOVED to Phase E. A single-org product is correct today
  (`ensurePersonalOrg`); a signed org-selection cookie is a feature, not a correctness gap.
- **Step 10 (E2E coverage)** — DONE. `verify-d17` T11 (renewal), T12
  (email verification), T13 (password change invalidates the old session over HTTP);
  `verify-metering` §18b (renewal gates), §18c (usage series), §21 (deletion: key refused
  UPSTREAM 401, second delete 409), §22 (rename persists). The CSV residual is closed by
  §26: an HTTP-authenticated session drives `GET /api/usage/export`, and the streamed body's
  data-row count is asserted equal to the `X-Row-Count` header AND to `usageHistory().total`
  — the export and the table are one source of truth.
- **Step 11 (a11y)** — DONE (live browser pass completed 2026-10-14). `browser.lighthouse`
  (axe-backed) run against `/`, `/dashboard`, `/dashboard/{keys,usage,billing,settings}`,
  `/admin`, and the signed-out `/sign-in`, `/sign-up`, `/reset-password`: **accessibility
  1.0, zero failures, in both light and dark.** Fixes that closed it: reduced-motion global
  rule; labeled icon-only controls; the sidebar theme toggle's accessible name now contains
  its visible label; `--muted-foreground` 0.556→0.54 (muted-surface AA); `--destructive`
  0.577→0.51 (the soft destructive button's red-on-its-own-10%-tint was 4.37:1 — note alpha
  composites in sRGB, so a 10% tint of a red cannot clear 4.5:1 at the shadcn default);
  `SidebarGroupLabel` `sidebar-foreground/70`→`/85` (2.97:1 on the light sidebar);
  `TabsTrigger` inactive `foreground/60`→`muted-foreground`; the disabled profile-email
  field became readOnly (the 50% disabled dim left its placeholder at 1.64:1). Also added
  the `(app)` **anonymous redirect**: an unauthenticated request used to render the full
  shell and stall on "Loading…" because every client fetch answered 401 — it now 307s to
  `/sign-in`.
- **Step 12 (security review)** — DONE. Targets clean; three observations recorded in the
  Step 12 section below (chief among them: `requireStaff()` does not apply session
  freshness — no trigger today, must be wired if a staff password-change path is added).
- **Phase E (deferred dev features)** — LANDED (2026-10-14). Migration
  `0009_trials_anomalies_admin.sql` applied locally (credit_notes; job_runs rows
  `expire_trials` + `detect_anomalies`; `plans.trial_days = 7` for starter; an
  `organizations.active/suspended` index).
  - **Trials:** Starter-only, 7 days, one per org (enforced by the append-only
    `subscription.trial_started` audit row — `trialEligibility` reads the audit, so it
    cannot be reset). Goes straight to `trialing` with the period = the trial; grants FULL;
    no phantom payment row. `expire_trials` flips an elapsed trial to `unpaid` (CUT, never
    revoked). `lib/billing/service.ts: startTrial / trialEligibility`; `POST /api/billing/trial`.
  - **Anomaly alerts:** `detect_anomalies` (4 detectors: mule phone, rejected-proof burst,
    hard-cap breach, oversized request; per-finding dedupe in `system_alerts`; ≤2 mails/pass;
    recovery deletes the row). Auth-number reuse intentionally NOT a detector (UNIQUE
    constraint is the enforcement). `lib/jobs/anomaly-alerts.ts`.
  - **Admin console:** `/admin` (staff-only) — suspend / reactivate (REAL: flows through
    `syncOrganizationEntitlements`, which CUTs a non-active org; reconciler widened to
    `suspended`), manual entitlements retry, credit notes (`credit_notes`). Roles:
    suspend/reactivate/credit = `admin`; list/retry = `support`. `lib/billing/admin-console.ts`;
    `POST /api/admin/orgs/[id]/{suspend,reactivate,sync}`, `POST /api/admin/credits`,
    `GET /api/admin/orgs`.
  - **Proven** by `verify-metering` §23 (trial + one-per-org + expiry), §24 (admin powers),
    §25 (anomaly scan + dedupe + recovery), §26 (CSV row count), §27 (trial expiry); plus
    `tests/billing.test.ts` (`forbidden`→403, `summarizePlan().trialDays`).

---

## 0. Read this first — the state you are inheriting

92 files are uncommitted. Everything below assumes that is fixed in Step 1 and that
you are **not** the agent who wrote that code.

- `HANDOFF.md` §5.9–§5.11 documents the last session's work and is accurate.
- `lib/dashboard/mock-data.ts` is deleted. No UI renders invented data.
- Migrations `0006_account_operations.sql`, `0007_d17_renewals.sql` and
  `0008_email_verification.sql` are all applied to the LOCAL database. `0006`–`0008`
  are still unapplied on the VPS, which has no `.env` and has never been deployed.
- `make verify-metering` and `make verify-d17` pass locally with the new cases.

### Non-negotiable rules (from `HANDOFF.md` §6 — read it, it is short)

- `.env` is gitignored. Never commit or print key material. Lengths/redacted only.
- Never run Caddy locally. It is VPS-only.
- After ANY code change, rebuild the images that run it:
  `docker compose build portal && docker compose build jobs && docker compose up -d`.
  `make up` does **not** rebuild. Both `portal` and `jobs` hold copies of `lib/`.
- LiteLLM is pinned to v1.103.1 by behaviour. Do not bump without re-reading
  `lib/litellm/client.ts` — the spend-log shape and `/ui` datetime contract are load-bearing.
- Test accounts and ledger rows left behind by proofs are **evidence, not garbage**.

---

## Decision log — read before Step 4

Three items need a product answer before they can be built. Recommended defaults
are given so work is not blocked; overriding them is fine but must be recorded here.

| # | Question | Recommended default |
|---|---|---|
| D1 | When a D17 period lapses unpaid, does access **cut** or go to **grace**? | Grace for 7 days, then cut. Mirrors `past_due` → `unpaid` already in `STATUS_EFFECT`. |
| D2 | Is "included spend" a real allowance, or a display threshold? | **Real allowance.** `included_spend_cents` is a discount pool; overage bills at `overage_markup_bps`. Otherwise delete the word "included" from the UI and stop pretending. |
| D3 | Do unpaid renewals keep the org's keys alive? | Yes — starve to `CUT_BUDGET`, never revoke. Matches `cancelSubscription`'s stated rule ("do not revoke keys, starve them"). |

---

## Phase A — Deploy readiness (blocks everything)

### Step 1 — Land the uncommitted work

**Why first:** 92 modified/untracked files, including a schema migration. Everything
downstream needs a clean tree to diff against and a real database to test on.

- [x] Confirm green: `cd portal && npm run typecheck && npm test && npm run build`
- [x] `make verify-config` (local, no Docker needed)
- [x] Secret scan the diff: `git diff HEAD | grep -nE 'sk-[A-Za-z0-9]{16,}|LITELLM_MASTER_KEY=|RESEND_API_KEY=|BILLING_DEV_SECRET=[^$]'` — must return nothing. `.env` is gitignored; confirm it is still ignored. (`scripts/scrub-check.sh` clean; a test constant was renamed to a placeholder.)
- [x] `git add -A && git commit` with a message describing the Tier 1–4 repair.
- [x] **Verify the push path before relying on it.** `git push gateway main` will be
      *rejected* if `/opt/gateway` is a checked-out working tree without
      `receive.denyCurrentBranch=updateInstead`. Do not spend time fighting this:
      the delivery path is `make deploy`, which rsyncs and excludes `.env`.
      Record the outcome in this plan.

**Exit criteria:** working tree clean; one commit; green local checks recorded in the commit body.
**Rollback:** `git reset --hard HEAD~1`. Nothing has been deployed, so nothing to undo in production.

### Step 2 — Deploy and apply migration 0006

> **⛔ BLOCKED (2026-10-13).** The VPS has no `.env` and has never been deployed.
> Every checkbox below needs domains + secrets + a working upstream first. This is
> environment setup, not dev work; it does not block Phases B–D, which are done locally.

**Why:** `password_changed_at` is `NOT NULL` with no default on existing rows until the
migration runs. **Deploying without it breaks sign-in for every user.**

- [ ] `make deploy HOST=gateway@<VPS_IP>` (rsync; excludes `.env`)
- [ ] `make db-migrate` — applies 0006. Verify: `SELECT count(*) FROM users WHERE password_changed_at IS NULL;` returns 0.
- [ ] `docker compose build portal && docker compose build jobs && docker compose up -d`
- [ ] `make health` — portal `/api/health` 200, LiteLLM `/health/readiness` 200
- [ ] `make verify-caddy` — the Caddyfile gained a scoped `route /api/checkout/d17/proof*`
      block with a 4MB body limit. Unvalidated until this runs.
- [ ] **Expect one forced re-login for every existing session.** That is migration 0006
      working as designed, not a regression. Confirm the reason is visible in the log
      (`auth: session predates the last password change`).

**Exit criteria:** all containers healthy; migration applied; Caddyfile validates.
**Rollback:** `make restore FILE=<latest backup>` (`make backup` first, always).

### Step 3 — First live verification of the new surface

**Why:** the five new endpoints have only ever run against a dead database. This is
the step that finds out whether they work.

- [x] `make verify-metering` — the money path end to end. Must be ALL GREEN.
- [x] `make verify-d17` — manual payments end to end. Must pass.
- [x] Extend nothing yet; just record the result. If either fails, **stop and fix here**
      before starting Phase B — every later phase assumes these two are green.
- [ ] Browser check with a real account, in this order:
      1. `/dashboard` — real numbers, no mock, no "Demo data" badge
      2. `/dashboard/keys` — create a key, copy the plaintext, revoke it
      3. `/dashboard/usage` — change filters, confirm the URL updates and Back works
      4. `/dashboard/billing` — payment history renders (possibly empty; that is correct)
      5. `/dashboard/settings` — rename the org, save; check the DB row changed
      6. `/api/usage/export` — downloads a CSV whose row count matches the table
      7. Change password → **confirm you are signed out and must sign in again**
      8. Delete account on a **throwaway org** → keys stop working upstream
- [ ] Confirm the portal still answers 401 (not 200/500) for anonymous requests to every route.

**Exit criteria:** both proofs green; the 8 browser checks pass.
**Rollback:** none needed — verification only.

---

## Phase B — Correctness gaps (product money, do before features)

### Step 4 — Renewals do not exist 🔴

**Why this is first in the phase:** a D17 customer can pay **once** and stay active
forever. `beginCheckout` throws 409 for any live subscription
(`lib/billing/service.ts`), and `expire_subscriptions` only flips rows where
`cancel_at_period_end = true` — so `current_period_end` lapses and nothing happens.
Meanwhile the Billing page has a button labelled **"Renew or add a payment"** that
returns 409 for every paying customer.

**Structural blocker you will hit first:** `payments_d17.subscription_id` is
`.unique()` (`db/schema.ts`). You cannot create a second payment row for the same
subscription, so a renewal would have to *overwrite* the previous one — destroying
the payment history `GET /api/billing/payments` was just built to show. Fix the
schema first or the history is worthless after one renewal.

- [x] **Migration 0007**: dropped the unique constraint on `payments_d17.subscription_id`;
      replaced with `payments_d17_sub_created_idx` + a partial unique index
      `payments_d17_one_open_idx` (at most one OPEN payment per subscription — the race
      backstop, since `begin()` alone cannot win two concurrent inserts).
- [x] `lib/billing/d17.ts` — `begin()` reuses the ONE open row (pending/proof/rejected)
      with a fresh window, and inserts a new row only once the prior row is terminal
      (paid/expired). This is what keeps history without piling up phantom attempts.
- [x] **Renewal trigger — on-demand, not a pre-create job.** `beginCheckout` gains a
      renewal path: the same plan on a live subscription is renewable inside the 7-day
      window (`RENEWAL_WINDOW_DAYS`) or once lapsed; a different plan still 409s
      (`changePlan` is the path). No `renew_due` job was added — the Billing page opens
      checkout when the window is open, which is simpler and has no phantom rows.
- [x] `applyCallback` on a renewal rolls `current_period_start/end` forward from the OLD
      end, so an early renewal never loses overlap days.
- [x] `expireSubscriptions` — honours **D1/D3**: `active`→`past_due` at period end, then
      `past_due`→`unpaid` after `RENEWAL_GRACE_DAYS` (7); cut to `CUT_BUDGET`, never revoke.
- [x] Button label corrected (`billing-view.tsx`): "Pay with D17" / "Renew for next
      period" / a disabled state naming when renewal opens.

**Exit criteria:** a D17 customer can pay for period 2; `/api/billing/payments` shows
both payments; a lapsed subscription cuts at the deadline + grace.
**Verify:** `scripts/verify-d17.ts` T11 (renewal) — green.
**Rollback:** none. Migrations here are FORWARD-ONLY (HANDOFF §6): 0007 drops a constraint
and adds columns, so a down-migration would strand the period data it introduced. Recovery
is `make restore`, not a reverse migration.

### Step 5 — `included_spend` is never enforced 🔴

**Why:** the SpendMeter — the most prominent element on the Overview and Billing
pages — says *"$0.36 of $20.00 included"*. `resolveBudgetUsd()`
(`lib/entitlements/policy.ts`) returns `hard_cap_cents ?? included_spend_cents` as a
**single number**, so the $20 allowance is never applied to anything.
`overage_markup_bps` (3000/2500) is written by migration 0003 and **read by no code**.
The frontend currently describes a billing model the engine does not implement.

- [x] Resolve **D2** — **resolved as: real allowance, and the bug was the DENOMINATION.**
      The gateway `max_budget` is UPSTREAM USD; `hard_cap_cents`/`included_spend_cents`
      are CUSTOMER cents. `resolveBudgetUsd()` now DIVIDES customer cents by
      `rate_multiplier_bps` before pushing the budget, so the number the gateway enforces
      and the number the SpendMeter shows are the same money in different units.
      Implemented as a uniform multiplier rather than a per-row free-then-bill split:
      `cost_customer_usd = cost_upstream_usd × rate_multiplier_bps / 10000` for EVERY row
      (so `overage_markup_bps === rate_multiplier_bps − 10000`), which keeps reconcile and
      the collector in lockstep with no running-total ordering problem. See §5.14.
  - [x] `cost_customer_usd` invariant asserted in `tests/security.test.ts` and by
        `make verify-metering` at the exact point it asserts `customer = upstream × 1.3`.
  - [x] The gateway budget stays the **hard cap** (what stops traffic), converted to
        upstream USD.
- [x] `PLATFORM.md` carries a superseded-billing banner pointing at `HANDOFF.md`
      (full §4.3 rewrite deferred with the Stripe-era text).

**Exit criteria:** the number on the SpendMeter is a number the engine computes.
**Verify:** `make verify-metering` must assert the new formula at the exact point it
currently asserts `cost_customer = upstream × multiplier`.
**Rollback:** the ledger is append-only and `price_table_version` is already stamped —
recompute, do not migrate history.

### Step 6 — Consistency and correctness sweep

- [x] `GET /api/orgs` returns `200 {orgs: []}` to anonymous callers while every sibling
      route returns 401. Not a leak (empty array), but it is the one route that does not
      follow the convention. **Corrected:** gate on `currentUser()` (401 when anonymous),
      NOT `requireActiveOrg()` — a signed-in user with no org yet must still get their
      (empty) list, and `requireActiveOrg()` would 403 them. It also filters
      `orgStatus !== 'deleted'`.
- [x] Audit every error message a customer can see for what/why/what-next, and for
      leaked internals (`lib/api/errors.ts` already replaces `internal`/`upstream` text —
      confirm nothing bypasses it). **Done:** every JSON route goes through `jsonError`/
      `errorResponse`; the only raw-text path was the streamed CSV failure comment, now a
      fixed sentence (detail stays in the log).
- [x] Card-payment copy: `hero.tsx` (badge + paragraph), `features.tsx`. There is no
      card path; Stripe was removed. **Done.**
- [x] `navbar.tsx` — "Documentation" points at `/pricing`. **Done** (navbar + footer).
- [x] `README.md` and `PLATFORM.md` still describe the pre-frontend state. Bring them
      in line with what now exists (`/pricing`, the 25 routes, migration 0006). **Done:**
      README refreshed (D17 flow, portal section, migrations 0006–0008); PLATFORM carries
      a superseded-billing banner pointing at `HANDOFF.md`.

---

## Phase C — Product completeness

### Step 7 — Email verification

`lib/auth/create-user.ts` writes `emailVerified: null` with a comment deferring it.
Signups are unverified indefinitely — anyone can sign up with an address they do not
own, and D17 proof submission trusts the email for status mail.

- [x] Reuse the reset-token machinery exactly: same `auth_verification_tokens` table,
      new `IDENTIFIER_PREFIX` (`verify-email:`). Do not invent a second token system.
- [x] Token TTL, single-use, hash-at-rest, "always answer 200" — identical rules to
      `lib/auth/reset.ts`. Extract the shared shape rather than copy-pasting it.
      Shared primitives now live in `lib/auth/tokens.ts`.
- [x] Gate it somewhere meaningful: **before** `POST /api/checkout` and before key
      creation, not at sign-in (which would break the existing proofs).
- [x] Resend is already wired (`lib/email`). Dashboard banner + resend shipped.

**Exit criteria:** an unverified account cannot reach checkout; the link is single-use.
**Verify:** add a case to `verify-d17.ts` — it already creates real accounts.

### Step 8 — Daily usage summary (the chart is lying by omission)

`/dashboard/usage` buckets **one page of rows** (25) client-side and labels it a
date range. The chart can never show more than ~25 days and silently omits the rest.

- [x] `GET /api/usage/summary?bucket=day|hour&from&to` → a real series.
      Same filters, same `totals` discipline as `/api/usage`.
- [x] `components/dashboard/usage-area-chart.tsx` consumes the series instead of
      re-bucketing rows. Delete the client-side bucketing.
- [x] Keep the honest empty state: a day with no traffic is a zero, not a gap.
      `generate_series` zero-fill; proven dense by `verify-metering` §18c.

**Exit criteria:** the chart range matches the selected filter over the full window.

### Step 9 — Multi-org support → MOVED to Phase E

**Deferred, not done.** A single-org product is correct today:
`ensurePersonalOrg` gives every account exactly one org, so `memberships[0]` is right by
construction. Multi-org is a feature with a real security surface (a signed, httpOnly
org-selection cookie — never a URL param, which is the IDOR `authorize.ts` exists to
prevent) and no correctness gap while the count is one. It now lives in Phase E.

---

## Phase D — Quality gates

### Step 10 — E2E proof coverage for everything added

Unit tests cannot see a gateway that answers with an unexpected shape, a budget that
does not stop, or a session that does not die. That is what
`scripts/verify-*.ts` are for — follow the existing pattern, not a new framework.

- [x] `verify-metering.ts` — add: profile rename persists (§22); change-password **kills the
      session** (done in `verify-d17` T13, over HTTP: old cookie → 401, new sign-in → 200);
      delete-account on a throwaway org (§21: org → deleted, subscription → canceled, key
      revoked locally AND refused upstream 401, second delete 409); payment history reflects
      an approval (covered by `verify-d17` T5 + T11 — two paid rows kept).
- [x] `verify-d17.ts` — add: renewal (Step 4, T11), email-verification gate (Step 7, T12),
      password-change session invalidation (T13).
- [x] `deleteAccount` ordering is the one that must not regress: the customer must be
      cut off BEFORE cleanup, so a failed gateway call can never leave a live key
      (proven by §21 — the deleted key is refused upstream, not merely marked here).
- [ ] Residual: CSV export row count equals the table. The export is HTTP-streamed and
      needs a live usage-bearing session; §18c already proves the shared series source is
      internally consistent, so this is a thin add when a live account is available.

### Step 11 — Accessibility and responsive pass, against real data

Every component was designed against invented data. Re-run the UX checklist with a
live account: three empty states distinguished, loading never blanks visible content,
every error says what to do, 44px touch targets, focus visible, `prefers-reduced-motion`,
and the dashboard at 375px.

New surfaces reviewed this cycle (2026-10-13): the verification page + dashboard banner
use `role="status"`/`role="alert"` with `aria-live`, labeled submit buttons with pending
states, and a POST confirmation button (good for both a11y and scanners). A full live
pass with a real browser session against a seeded account is still **pending** — it needs
a running account and is the natural first task on the next live session.

### Step 12 — Security review

Fresh-eyes pass over what was added this cycle. Highest-value targets:
`/api/account/delete` (irreversible), `/api/usage/export` (bulk data egress),
`/api/admin/d17/*` (staff gates), CSV formula injection, and the session-freshness
comparison (a sign flip is either "everyone logged out hourly" or "a compromised
account is unrecoverable").

Reviewed 2026-10-13 — clean, with three documented observations:

- `/api/account/delete` — owner-gate at the route, self-scoped (no body id, so IDOR is
  unrepresentable), slug confirmation, cut-off-first ordering.
- `/api/usage/export` — org-scoped by `requireActiveOrg`; `csvCell` prefix-guards
  `= + - @ tab CR` BEFORE RFC-4180 quoting; streamed with `MAX_ROWS`; the failure path
  now writes a fixed sentence, never raw internal driver text (fixed this cycle).
- `/api/admin/d17/*` — every route `requireStaff` at least privilege
  (`approve`/`reject` = `admin`, list/export = `support`, screenshot = `read_only`);
  the screenshot filename comes from the DB row and is charset-validated (no traversal).
- session-freshness — fails closed, compared as epoch ms (not text), wired into
  `currentUser()` so every customer route enforces it.
- **Observation (low): CLOSED 2026-10-15.** `requireStaff()` did NOT apply the freshness
  check, so a stolen STAFF token survived a staff password change for the token's
  `maxAge`. Staff live in `staff_users` with no in-portal password-change path today, so
  there was no trigger — but it is now wired regardless: `requireStaff()` and
  `currentStaffRole()` share a private `staffSessionIsFresh()` that reads only the
  `password_changed_at` stamp from `users` (never a role or an org, so the
  staff-are-never-customers separation holds). Stale → `401`, not `403`. Verified live:
  a fresh staff token reaches `/admin`, and a token older than a bumped
  `password_changed_at` is refused (nav hidden, `/api/admin/orgs` → 401). See §5.17.
- **Observation (informational):** the CSV failure path commits as HTTP 200 (the stream
  is already open), so the signal is an in-file comment row, not a status code. By design;
  the header can't be changed after the body starts.
- **Observation (informational):** `payments_d17` history is immutable from the customer
  side; only staff endpoints write status, and both `approve`/`reject` are audit-logged.

---

## Phase E — Deferred (only after Phase A–D are green and proven)

Explicitly out of scope until then, in dependency order:

1. **D17 real API** — `lib/billing/d17.ts` is the only file that changes. Everything is
   built so this is a drop-in, not a rewrite.
2. **Anomaly alerts** — spend spikes, auth-number reuse across accounts, repeated
   duplicate proofs. `audit_log` already carries the evidence.
3. **Admin console** — beyond the D17 queue: org suspension, entitlement retry by hand,
   refund/credit notes.
4. **Trials** — `trial_days` and `plan.trialDays` exist; `trialing` is already mapped in
   `STATUS_EFFECT` and `planStateFromStatus`. The machinery is there and unused.
5. **BYOK** — `organizations.key_ownership` and `byok_*` columns exist, `bytea` is
   declared in the schema, and nothing writes them. Model B in `PLATFORM.md §0`, and the
   legal-clean way to sell this product.
6. **Real upstream + real pricing** — the tunnel is 530 and prices are nominal dev rates.
   `config/litellm.yaml` says so in three places; do not ship dev rates.

**Also unresolved and outside engineering:** the Anthropic Commercial ToS §D.2 resale
question. `README.md` and `PLATFORM.md §0` both say third-party use should wait for a
written answer. No amount of code settles it.

---

## Phase G — First real deploy to the VPS (2026-10-15)

The first deploy found two faults that no local gate could, because both only
exist on a machine that is not this one.

- [x] **`make init` could never succeed anywhere.** Two independent bugs: the guard
      was `test -f .env &&`, so the *success* path (no `.env` yet) exited 1 and aborted
      the target before it wrote anything; and the recipe used BSD `sed -i ''`, which GNU
      sed reads as a filename and leaves the file untouched. Rewritten to
      `test ! -f .env ||` plus a temp-file-and-move. Verified on both BSD (this Mac) and
      GNU (the VPS): secrets generated, mode 600, second run refuses.
- [x] **`.env.example` was missing eight keys the stack requires.** Most importantly
      `BILLING_DEV_SECRET`, which compose demands via `:?` — so `make init` → `make up`
      fails on ANY fresh environment. Added all eight (billing, email, `APP_URL`) with
      comments, and taught `make init` to generate `BILLING_DEV_SECRET`. This was a
      broken repo, not a broken VPS.
- [x] **`make deploy` could not authenticate.** It called `rsync` with no `-e`, so an
      `ssh -i` alias in `~/.ssh/config` is silently ignored by rsync and the deploy dies
      with `Permission denied (publickey)`. Now honours an optional `SSH_KEY=`, passed to
      both `rsync -e` and `ssh`, and still works with config/agent alone.
- [x] **`portal/scripts/create-accounts.ts`** provisions a customer and a staff identity
      from env vars. It calls `createLocalUser()` rather than inserting SQL, because
      `auth_credentials.password` is a scrypt hash — a hand-written INSERT that is subtly
      wrong creates an account that cannot sign in and reports nothing. Staff get an
      identity and a `staff_users` row but deliberately NO org, per PLATFORM.md §1.2.
- [x] Deployed at `*.15-224-52-176.sslip.io` with real Let's Encrypt certs on all four
      vhosts (verified by issuer), HTTP→HTTPS 308, migrations 0001–0009 applied to a
      fresh database, `make health` green. Backups of both prior DB volumes + the old
      tree are in `/opt/gateway/_rescue/`.

**Still open, and not engineering:** the upstream tunnel answers **530** on every wire
format from both here and the VPS, so no real completion can flow. `LITELLM_SALT_KEY`
and `AUTH_SECRET` exist only in the VPS `.env` and need an off-box backup. And
`admin`/`code` are IP-gated in the Caddyfile, which is why they answer 403 from
anywhere but a whitelisted address.

---

## Phase F — Browser pass + deploy dry-run (2026-10-15)

Every proof drives the service layer in-process, so a green `verify-metering` says
nothing about whether the *buttons* work. Phase E (trials, admin console) shipped with
backend proofs and no UI proof at all.

- [x] Drive every Phase E surface in a real browser, not just assert on HTTP status:
      `/dashboard/billing` trial, `/admin` (suspend / reactivate / retry / credit),
      `/admin/d17` (approve / reject-with-reason), plus the email-verification resend →
      link → `POST` confirm. Confirm each in the database afterwards.
- [x] **Found: the admin routes mounted no `<Toaster/>`** (it lived only in the `(app)`
      group), so all 14 `toast.*` calls on `/admin` + `/admin/d17` rendered nothing — the
      operator got no feedback on any manual power. Fixed by `app/admin/layout.tsx`.
- [x] **Found: "Retry sync" on a subscription-less org reported a gateway failure.**
      `no subscription` is a benign outcome (the sync ran and cut), not an outage. Now
      reported as its own message; `reactivate` no longer claims success on a failed push.
- [x] Close the Step 12 staff-freshness observation (wired, and verified both directions
      live: fresh token in, stale token out).
- [x] Deploy dry-run without deploying: `verify-config`, `docker compose config`,
      `verify-caddy`, `make health`, `backup-drill` — all green. Fixed the `Caddyfile`
      (`caddy fmt`) and **`make probe`, which could never pass**: its
      `: "${UPSTREAM_BASE_URL:?…}"` guard ran before the same recipe sourced `.env`.
- [ ] Still blocked externally, not by code: the upstream tunnel answers **530** on
      every wire format, so `make probe`'s verdict is "neither format worked". Real
      upstream + real pricing remain unshippable until that endpoint answers.

---

## Dependency graph

```
Step 1 (commit) ──┐
                  ├──► Step 2 (deploy + migrate 0006) ──► Step 3 (live verify)
                  │                                              │
                  │        ┌─────────────────────────────────────┤
                  │        │                    │                │
                  ▼        ▼                    ▼                ▼
            Step 4     Step 5              Step 7            Step 10
            renewals   included spend      email verify      E2E proofs
                  │        │                    │
                  └────────┴────────┬───────────┘
                                  ▼
                            Step 6 (sweep)
                                  │
                    ┌─────────────┼──────────────┐
                    ▼             ▼              ▼
              Step 8 (summary) Step 9 (multi-org) Step 11 (a11y)
                                                      │
                                                      ▼
                                              Step 12 (security)
```

**Safe to run in parallel:** Steps 6, 8 and 11 touch disjoint files.
**Must be serial:** 4 → 5 (both rewrite `lib/billing`); 4 and 7 both take the next
migration number; 10 depends on 4, 5 and 7 existing.

---

## What "done" means

- `make verify-metering` and `make verify-d17` green on the VPS, with the new cases.
- Every page renders live data with no invented values anywhere in the tree.
- `grep -rn "mock\|TODO\|not implemented" portal/components portal/app` returns only
  genuine deferred markers.
- Migration 0006 applied; every session invalidated once, as designed.
- A new D17 customer can pay for month 1 **and** month 2.
- The SpendMeter shows a number the billing engine actually computed.
- `HANDOFF.md` matches the code.