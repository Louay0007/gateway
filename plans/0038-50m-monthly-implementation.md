# Implementation handoff — 50M/month token budgets (migration 0038)

**Status:** core logic done and uncommitted in the working tree. 614/614 tests pass,
`tsc --noEmit` clean. This document lists exactly what is left, because the remaining
work is *cosmetic-looking but load-bearing*: several surfaces still advertise the old
100M/day shape, and two verification scripts will fail against a migrated database.

**Do not re-derive the economics.** They are settled and measured below.

---

## 1. Why this change exists (read once, do not re-litigate)

Token cost is **100 DT per 500M tokens = 0.20 DT per 1M**. The old model (migrations
0025 → 0029 → 0035) granted **100M to every alias every day**. Over a 30-day month that
is 3B tokens *per alias*:

| Plan | Old monthly exposure | Cost at 0.20 DT/M | Price | Result |
|---|---|---|---|---|
| Starter (fast + smart) | 6.0B | 1,200 DT | 50 DT | **24× loss** |
| Pro (smart + frontier + fable) | 9.0B | 1,800 DT | 90 DT | **20× loss** |

The bug was not the number, it was the **unit**: a *daily* cap on a *monthly*-priced
product. 0025 replaced a monthly wall with a daily one, and 0029 then forced every
subscription row onto it.

**New model — 50M blended tokens per MONTH, per plan, split across aliases:**

| Plan | Aliases | Monthly total | Cost at full burn | Price | Margin |
|---|---|---|---|---|---|
| Starter | fast 25M + smart 25M | 50M | 10.0 DT | 50 DT | 80% |
| Pro | smart 16.667M + frontier 16.667M + fable 16.666M | 50M | 10.0 DT | 90 DT | 89% |
| Trial (3 days) | fast 25M + smart 25M | 50M | 10.0 DT | free | — |

**Critical rule: the total is SPLIT across aliases, never repeated per alias.** Repeating
is precisely how 0025 multiplied exposure by alias count. The migration has a SQL guard
that fails if any plan's alias budgets sum above 50M.

---

## 2. What is already done (do not redo)

| File | Change |
|---|---|
| `portal/db/migrations/0038_monthly_50m.sql` | **NEW.** Rewrites `plans.token_limits` to monthly-split budgets for starter/pro/trial; flips every `subscriptions.daily_quota` to FALSE; sets the column DEFAULT to FALSE; `quota_cadence` → 'monthly'; rewrites `trial_codes.token_limits`; invalidates cached entitlements; three guards (≤50M sum, no daily rows, every served alias has a budget). |
| `portal/lib/entitlements/quota.ts` | Header docs rewritten for the monthly model; `outOfTokensMessage` / `mapGatewayModelError` default cadence `daily` → `period`. |
| `portal/lib/billing/service.ts` | `dailyQuota: false` on renewal and plan change; `cadence` added to the usage bundle type and its return (`'daily' \| 'period'`). |
| `portal/lib/trial/service.ts` | Two `dailyQuota: false`. |
| `portal/lib/admin/subscriptions.ts` | `dailyQuota: false` for grants. |
| `portal/db/schema.ts` | Comments updated; `dailyQuota` default **FALSE**; `quotaCadence` default **monthly**. |
| `portal/lib/admin/plan-schema.ts` | Monthly-budget docs on `tokenLimits`. |
| `portal/lib/chat/screen.ts` | Cadence-aware copy. |
| `portal/app/api/device/usage/route.ts` | Passes and exposes `bundle.cadence`. |
| `edge/server.mjs` | Customer-facing error copy updated. |
| `README.md`, `docs/opencode-desktop.md` | Schema history + docs updated. |
| `portal/components/marketing/faq-section.tsx`, `pricing-preview.tsx`, `portal/components/ui/interactive-pricing-component.tsx` | 50M/month copy. |
| `portal/components/dashboard/{dashboard-overview,quota-meter,billing-view}.tsx`, `portal/components/chat/model-picker.tsx` | Period-aware labels. |
| `portal/scripts/verify-token-wall.ts` | Rewritten to derive limits from `plans` and to seed a period-window fixture. |
| `portal/tests/token-quota.test.ts`, `portal/tests/pricing-consistency.test.ts` | Period-wording defaults; new 0038 sum/guard test. |

Everything above is **uncommitted on `main`**. Commit it as one change with the docs
sweep below, or land the logic first and the copy second — not interleaved.

---

## 3. Remaining work — ordered, with acceptance criteria

### Task 1 — `portal/components/dashboard/paywall-state.tsx` (blocking, user-visible)

The paywall is the upgrade screen. Its fallback table still prints **20× the real
allowance** per alias.

- Lines **52–62**: the doc comment claims "every live plan is billed daily and
  `plans.token_limits` says 100M per alias per day (migrations 0035/0036)" and that the
  old 80M/32M figures were understated. All false now. Rewrite for the 0038 monthly split.
- Lines **63–77** `DEFAULT_FEATURE_VALUES`: only used when `plan.token_limits` is empty
  (a plan an operator created before 0023). It must still state the truth:
  - `starter`: `d17.feat_fast_tokens: '25M'`, `d17.feat_smart_tokens: '25M'`, keys 3, rpm 60, tpm 100,000
  - `pro`: `d17.feat_smart_tokens: '17M'`, `d17.feat_frontier_tokens: '17M'`, `d17.feat_fable_tokens: '17M'`, keys 15, rpm 300, tpm 500,000
- `planFeatureValues()` (line ~86) already reads the live row via `compact(limit)` and
  wins when present — **do not change its logic**, only confirm it still renders.

**Why 17M not 16.667M:** these are marketing bullets, rounded down so the paywall can
never promise more than the wall enforces. Never round up.

**Acceptance:** a Starter paywall shows 25M/25M; Pro shows ~17M × 3. Total per plan
never reads as 50M *per model*.

### Task 2 — `portal/public/partnership.html` (blocking, externally visible)

A live, indexable partner page still selling the old shape in three places:

- **Line 1132** — `<span>Daily budget per tier</span><span>100M tokens</span>` → `Monthly budget per plan` / `50M tokens`
- **Line 1218** — `Custom daily budgets beyond 100M per tier` → `Custom monthly budgets beyond 50M per plan`
- **Line 1451** — FAQ: "each with a 100M blended-token daily budget per tier" → "each plan includes 50M blended tokens per month, split across the models it unlocks"

**Leave lines 1541–1542 alone.** `lt-100m` / `100m-500m` are partnership *volume*
brackets in a form select, not plan allowances.

**Acceptance:** `rg -c "100M" portal/public/partnership.html` returns `2` (only the form
options) and `rg "daily budget" portal/public/partnership.html` returns nothing.

### Task 3 — verification scripts that will FAIL on a migrated DB (blocking)

These are not comments; they assert the old model and will break the VPS runbook.

- **`portal/scripts/verify-grant.ts:142`**
  `check('dailyQuota true (0025 model)', bareSubs[0]?.dailyQuota === true);`
  → must assert `dailyQuota === false` and be renamed to the 0038 model. A grant created
  today gets a **period** window; asserting TRUE fails post-0038.
- **`portal/scripts/verify-metering.ts:1385`**
  the "mule" subscription is inserted with `dailyQuota: true` → `false`, so the fixture
  matches what production writes.

**Acceptance:** both scripts pass against a DB that has run 0038.

### Task 4 — stale comments that mislead the next engineer (non-blocking, do in the same sweep)

| File:line | Problem |
|---|---|
| `portal/lib/admin/plans.ts:212` | Validation message says `raw tokens per day`. → `raw tokens per PERIOD (the plan's monthly total, split across aliases)`. |
| `portal/lib/entitlements/policy.ts:130-137` | `resolveTokenLimits` docs say "0025 made it DAILY (`{fast: 100000000}` per Tunis day)". → monthly, and note a missing alias is UNLIMITED by design. |
| `portal/lib/jobs/enforce-prompt-limits.ts:1-20` | Header says the window is the Tunis day, 100M per alias per day, and that the 403 body says "for today". → period window; behavior already correct via `usageWindowForSubscription`. |
| `portal/app/api/device/usage/history/route.ts:2-11` | Claims it groups by "the SAME Tunis calendar day the wall resets on". The wall no longer resets daily. The **behavior is still right** (a per-day *spend trend* is genuinely per-day) — only the justification is wrong. Say it is a historical trend, independent of the quota window. |
| `docs/usage-tracking-gaps.md:130, 188, 211-217` | Describes the quota as daily-resetting at 00:00. Update to period. |

**Do NOT touch** migrations `0023`, `0025`, `0029`, `0035`, `0036`. They are a historical
record of what shipped; rewriting them corrupts forward-only history. `0038` supersedes them.

### Task 5 — test suite reflects stale numbers but passes (do after Task 1–3)

614/614 pass today, so this is about intent, not a red build.

- **`portal/tests/token-quota.test.ts`**
  - Header (lines 1–8): "DAILY since 0025 … per TUNIS DAY … Starter fast/smart 100M each" → monthly.
  - Constants at lines **28** and **31**: `STARTER_TOKENS = { fast: 100_000_000, smart: 100_000_000 }` and `PRO_TOKENS` — change to the 0038 split (`25_000_000` each; Pro `16_666_667`/`16_666_667`/`16_666_666`).
  - `describe('100M/day boundary — 99,999,999 allowed, 100,000,000 cut')` (line 218) → rename to the monthly boundary and update the literals.
  - Keep the existing period-vs-daily wording tests; they already cover the escape hatch.
- **`portal/tests/cache-accounting.test.ts:209-230`**
  `describe('daily window — every live subscription sums the Tunis day (0029)')` asserts
  `dailyQuota: true`. That is now the *legacy escape hatch*, not the live rule. Rename to
  "an explicit dailyQuota row still resolves the Tunis day" and keep it — it guards the
  one-row escape hatch. Optionally add the mirror test that `dailyQuota: false` sums the
  period.

**Acceptance:** `cd portal && npx vitest run` → 614+ pass, and no test title mentions
100M/day as the shipped model.

---

## 4. Two product decisions this handoff does NOT make

Both were surfaced and never answered. **Apply only if the operator says so**; the
migration as written ships exactly 50M total.

### 4a. Pro gets LESS per model than Starter — an inversion

Because both plans cap at **50M total**, Pro's budget splits three ways:

```
starter  fast 25M, smart 25M            -> 25M per model
pro      smart/frontier/fable ~16.7M    -> 16.7M per model
```

A Pro customer hits a per-alias wall **sooner** than a Starter customer on a plan costing
1.8× more, and Pro carries the expensive aliases (frontier/fable list at 15× the fast rate).
Two options, documented in the migration's header comment:

- **(a) Recommended — Pro = 50M per alias (150M total).** Cost 30 DT vs 90 DT = **67%**
  worst-case margin, and every model gets the full 50M. Removes the inversion.
- **(b) Pro = 50M total, Starter drops to 30M.** Restores the gap, shrinks Starter's
  headline number.

If (a) is chosen: add `0039_pro_per_alias.sql` (a **new** migration — never edit 0038 after
it has run anywhere), relax the ≤50M guard for `pro` only, and update the three marketing
surfaces plus `pricing-consistency.test.ts` in the same change.

### 4b. Trial is now cheap enough to widen, and is still unguarded

The trial used to cost **120 DT** per redemption; it now costs **10 DT** at full burn.
And `portal/app/api/trial/redeem/route.ts` still has **no email-verification gate** — it
calls `currentUser()` and `requireActiveOrg()` but never `requireVerifiedEmail`, so an
unverified account can redeem. `ZAINO-FREE-NOV26` has also shipped with unlimited
redemptions before.

Recommended, both in one change: add `requireVerifiedEmail` to the redeem route, and give
the code an explicit `max_redemptions`. Widening the allowance without closing the
redemption hole multiplies the exposure the migration just fixed.

---

## 5. Verification runbook

```bash
# 1. Types
cd portal && npx tsc --noEmit

# 2. Unit tests (expect 614+ passing, 0 failing)
cd portal && npx vitest run

# 3. Copy sweep — must return nothing in shipping surfaces
cd /Users/user/Workspace/gateway && rg -n "100M|100000000|per day|daily budget|midnight Tunis" \
  portal/components portal/app portal/lib portal/public \
  --glob '!node_modules' | rg -v "migrations/|paywall-state|history/route|100MB"

# 4. Confirm the budget shape invariant
cd /Users/user/Workspace/gateway && rg -n "25000000|16666667|16666666" portal/db/migrations/0038_monthly_50m.sql
```

**Linting is unavailable in this repo** — `npx eslint` fails ("couldn't find an
eslint.config.*"; ESLint 10 needs flat config, the repo has `.eslintrc`, and there is no
`lint` script). Do not treat that as a regression; rely on `tsc` + vitest.

### Applying the migration (cannot be done locally)

There is **no local Postgres, no `psql`, and no docker DB** in this environment. The
migration has been validated only by typecheck, unit tests, and JSON-sum assertions —
**never by an actual `make db-migrate`**. It must run on the VPS.

- **Forward-only.** `make restore` is the only recovery path.
- Guards are deliberately fatal: if a plan sums above 50M, or any subscription row is
  still `daily_quota = TRUE`, the migration raises and rolls back rather than shipping
  a per-day budget by accident. A raise here is a **correct** outcome — fix the data,
  re-run.
- Cached entitlements are invalidated by bumping `entitlements.synced_at` back 2 hours,
  because `planForOrg()` reads the cached row before the plan.
- Deploy is a push to `main`.

**Post-migration smoke check on the VPS:**
```sql
-- must be 0
SELECT count(*) FROM subscriptions WHERE daily_quota = TRUE;
-- must be <= 50000000 for starter, pro, trial
SELECT code, (SELECT sum(value::bigint) FROM jsonb_each_text(token_limits)) AS total
  FROM plans WHERE code IN ('starter','pro','trial');
```

---

## 6. Definition of done

- [ ] Tasks 1–3 applied; Tasks 4–5 applied in the same sweep
- [ ] `npx tsc --noEmit` clean, `npx vitest run` all passing
- [ ] No shipping surface (code, HTML, i18n) advertises 100M/day or a midnight reset
- [ ] `verify-grant.ts` and `verify-metering.ts` assert `dailyQuota === false`
- [ ] Migration applied on the VPS; both smoke queries return 0 and ≤50M
- [ ] Open decisions 4a/4b either explicitly rejected by the operator or shipped as a **new** migration
- [ ] Committed on `main` in two logical commits: (1) migration + logic + tests, (2) copy/docs sweep
