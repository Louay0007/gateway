# Implementation Plan — completing the LLM gateway SaaS

**Status:** in execution — Phase A green; Steps 4–8 landed (renewals, included-spend
denomination, consistency sweep, email verification, usage summary); Steps 9–12 remain.
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

- [ ] Confirm green: `cd portal && npm run typecheck && npm test && npm run build`
- [ ] `make verify-config` (local, no Docker needed)
- [ ] Secret scan the diff: `git diff HEAD | grep -nE 'sk-[A-Za-z0-9]{16,}|LITELLM_MASTER_KEY=|RESEND_API_KEY=|BILLING_DEV_SECRET=[^$]'` — must return nothing. `.env` is gitignored; confirm it is still ignored.
- [ ] `git add -A && git commit` with a message describing the Tier 1–4 repair.
- [ ] **Verify the push path before relying on it.** `git push gateway main` will be
      *rejected* if `/opt/gateway` is a checked-out working tree without
      `receive.denyCurrentBranch=updateInstead`. Do not spend time fighting this:
      the delivery path is `make deploy`, which rsyncs and excludes `.env`.
      Record the outcome in this plan.

**Exit criteria:** working tree clean; one commit; green local checks recorded in the commit body.
**Rollback:** `git reset --hard HEAD~1`. Nothing has been deployed, so nothing to undo in production.

### Step 2 — Deploy and apply migration 0006

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

- [ ] `make verify-metering` — the money path end to end. Must be ALL GREEN.
- [ ] `make verify-d17` — manual payments end to end. Must pass.
- [ ] Extend nothing yet; just record the result. If either fails, **stop and fix here**
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

- [ ] Resolve **D2**. If the allowance is real:
  - [ ] Period-cumulative charge: a request is free while the period's cumulative
        upstream cost is under the allowance, and bills at `overage_markup_bps` after.
        This needs a running total — do NOT recompute per row from the ledger without
        a deterministic order, or rounding will not be reproducible.
  - [ ] `cost_customer_usd` in `lib/jobs/collect-usage.ts` changes shape.
  - [ ] `scripts/reconcile.sh` on the gateway must implement the same rule; it is
        the authority when the two disagree (`lib/pricing/index.ts`).
  - [ ] The gateway budget stays the **hard cap** (what stops traffic), not the allowance.
- [ ] If the allowance is cosmetic instead: delete `includedSpendCents` from the UI
      copy, drop the meter, and say "billed at 1.30× upstream up to your cap".
- [ ] Either way, update `PLATFORM.md §4.3` so the document matches the code.

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
- [ ] Audit every error message a customer can see for what/why/what-next, and for
      leaked internals (`lib/api/errors.ts` already replaces `internal`/`upstream` text —
      confirm nothing bypasses it).
- [ ] Card-payment copy: `hero.tsx` (badge + paragraph), `features.tsx`. There is no
      card path; Stripe was removed.
- [ ] `navbar.tsx` — "Documentation" points at `/pricing`.
- [ ] `README.md` and `PLATFORM.md` still describe the pre-frontend state. Bring them
      in line with what now exists (`/pricing`, the 25 routes, migration 0006).

---

## Phase C — Product completeness

### Step 7 — Email verification

`lib/auth/create-user.ts` writes `emailVerified: null` with a comment deferring it.
Signups are unverified indefinitely — anyone can sign up with an address they do not
own, and D17 proof submission trusts the email for status mail.

- [ ] Reuse the reset-token machinery exactly: same `auth_verification_tokens` table,
      new `IDENTIFIER_PREFIX` (`verify-email:`). Do not invent a second token system.
- [ ] Token TTL, single-use, hash-at-rest, "always answer 200" — identical rules to
      `lib/auth/reset.ts`. Extract the shared shape rather than copy-pasting it.
- [ ] Gate it somewhere meaningful: **before** `POST /api/checkout` and before key
      creation, not at sign-in (which would break the existing proofs).
- [ ] Resend is already wired (`lib/email`).

**Exit criteria:** an unverified account cannot reach checkout; the link is single-use.
**Verify:** add a case to `verify-d17.ts` — it already creates real accounts.

### Step 8 — Daily usage summary (the chart is lying by omission)

`/dashboard/usage` buckets **one page of rows** (25) client-side and labels it a
date range. The chart can never show more than ~25 days and silently omits the rest.

- [ ] `GET /api/usage/summary?bucket=day|hour&from&to` → a real series.
      Same filters, same `totals` discipline as `/api/usage`.
- [ ] `components/dashboard/usage-area-chart.tsx` consumes the series instead of
      re-bucketing rows. Delete the client-side bucketing.
- [ ] Keep the honest empty state: a day with no traffic is a zero, not a gap.

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
- **Observation (low):** `requireStaff()` does NOT apply the freshness check, so a
  stolen STAFF token survives a staff password change for the token's `maxAge`. Staff
  live in `staff_users` with no in-portal password-change path today, so there is no
  trigger — but if one is added, staff session invalidation must be wired the same way.
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