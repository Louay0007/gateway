# Dashboard UX plan

**Status:** Phases 0–3 SHIPPED (2026-11-24); Phases 4–5 proposed ·
**Scope:** `app/(app)/dashboard/*`, `components/dashboard/*`,
`app/api/usage/*`, `lib/auth/authorize.ts` · **Out of scope:** chat, admin console,
marketing.

**Relationship to `dashboard-architecture.md`.** That document diagnosed the
product; this one is the execution plan. Where the two disagree, this file wins
only on sequencing — the diagnosis there is sound and every "do not touch"
item is preserved below.

---

## 0. The problem in one paragraph

Every number on the dashboard is real and every state is handled, which is rare.
What is missing is a point of view: `/dashboard` is six equally weighted panels
with no sentence saying *"you have 31M of 50M left and about 12 days at this
rate"*. A customer at 96% of their pool sees the same visual weight as one at
0%, the daily cap is enforced but invisible on the page they actually open, the
money they spent is rendered only in a header dropdown, and two components
(`QuotaMeter`, `QuotaMeters`) are dead code kept alive by habit. The fix is not
more widgets — it is **one answer at the top, the evidence under it, the actions
attached to whatever raised the question**, plus deletion of what no longer
matches the product.

---

## 1. Verified current state

Read from source on 2026-11-24, not from prior notes.

| Fact | Evidence |
|---|---|
| Overview issues 4 client fetches, and re-fetches the bundle the shell already holds | `dashboard-overview.tsx:50-53` vs `shell-identity.tsx:71` |
| `dailyTokenCap` / `dailyUsedTokens` exist in the bundle | `lib/api/types.ts` (`SubscriptionBundle`) |
| …but the daily cap is rendered only on Billing | `billing-view.tsx:579-580`; `dashboard-overview.tsx` omits both props |
| The page says "today" over period-to-date figures | `dashboard-overview.tsx:120` |
| Money is rendered in exactly one place | `site-header.tsx:146` (`costCustomerUsd`) |
| `GettingStarted.lastRequestAt` is declared and never passed | `getting-started.tsx:36` |
| Window math is written three times | `usage-view.tsx` `query`, `summaryQuery`, `exportQuery` |
| "By model" aggregates the visible page and says so | `usage-view.tsx:453-462` |
| No per-model aggregate route exists | `app/api/usage/` = `route.ts`, `summary/`, `export/` |
| `QuotaMeter` / `QuotaMeters` have no live caller | grep: only the doc and their own file |
| No member/invite route; roles exist in schema only | `app/api/**` has no `members` path |
| `dark:` variants are capped below 100 by CI | `tests/design-system.test.ts:73` |
| Every product page is covered by one e2e smoke | `e2e/authenticated-pages.spec.ts:40` |

### What must not regress

Carried over from the architecture doc, all of it still true in code:

- The five distinct states in `states.tsx` (first-use ≠ no-results ≠ cleared).
- `QuotaExhaustedBanner` naming the **period** end, never "tomorrow".
- `QuotaPoolMeter`: one bar for one pool.
- Filters in the URL; CSV built from the same query as the table.
- `KeysView`: plaintext once, `402` → paywall panel, `409` → server wins.
- No latency column until latency is measured.

---

## 2. Design principles for this pass

1. **One answer above the fold.** Every screen opens with a sentence that a
   person can act on without doing arithmetic.
2. **Tone thresholds are shared, never re-typed.** `80%` and `95%` are defined
   once and imported by the strip, the meter and any badge.
3. **Tokens, not literals.** No new hex; the `dark:` budget must not grow.
4. **Delete before adding.** Two components and one copy string are removed in
   Phase 0; a panel only earns its place by being actionable or recent.
5. **A disabled button is not a permission check.** Any access rule lands in
   `lib/auth/authorize.ts` first.
6. **No new route unless derived data cannot answer.** Phase 1 needs zero new
   endpoints.

---

## 3. Phases

Each phase ships independently and leaves production working. Effort assumes one
engineer familiar with the codebase.

### Phase 0 — truth (SHIPPED)

All six items landed. Two deviations from the plan, both recorded here:

- `GettingStarted.lastRequestAt` was **deleted**, not wired: nothing in the
  component ever read it, and inventing a caller would have added a prop to
  satisfy a type rather than a screen.
- The bundle dedupe went further than "read the shell's bundle": the shell now
  exposes `refreshing`, so the page's `RefreshingBar` and its new refresh button
  are driven by the same request that feeds the header's spend figure.

| Task | File | Done when |
|---|---|---|
| "doing today" → "this period" | `dashboard-overview.tsx:120` | Copy matches the window the numbers use |
| Pass `dailyCap` / `dailyUsed` into the Overview meter | `dashboard-overview.tsx` | A customer at the cap sees it without opening Billing |
| Pass `lastRequestAt` (or delete the prop) | `getting-started.tsx:36` | No declared-but-unused prop |
| Delete `QuotaMeter`, `QuotaMeters` | `quota-meter.tsx` | Grep for both returns only the doc |
| Extract `useUsageWindow(range)` | new `lib/dashboard/use-usage-window.ts` | One implementation replaces the three copies in `usage-view.tsx` |
| Dedupe the bundle read | `dashboard-overview.tsx` | Overview reads `useShellIdentity().bundle`, or the shell is refreshed — never both fetched |

**Acceptance:** `npx tsc --noEmit` clean, `npx vitest run` unchanged, no visual
diff beyond the copy string, `usage-view.tsx` line count drops.

**Risk:** low. The only behavioural change is the daily cap becoming visible,
which is the point.

---

### Phase 1 — the answer (SHIPPED)

Built as planned, with the wording extracted so it is testable without a DOM
(this repo's vitest runs `environment: 'node'`, so a render test was not an
option and adding jsdom for one component was not worth the dependency):

| File | Role |
|---|---|
| `lib/dashboard/quota-tone.ts` | `quotaTone` / `quotaPercent` / `daysRemainingAtRate` / `needsAttention` |
| `lib/dashboard/status-copy.ts` | every tone's headline, detail and CTA |
| `lib/dashboard/use-usage-window.ts` | the one "last N days" window (Phase 0 item, used by Usage) |
| `components/dashboard/status-strip.tsx` | presentation only |
| `components/dashboard/dashboard-overview.tsx` | strip + burn + cost, bundle from the shell |

`QuotaPoolMeter` now paints from `quotaTone`, so the bar and the sentence share
one threshold. Tests: `dashboard-quota-tone`, `dashboard-status-copy`,
`dashboard-usage-window` — 25 cases, all node-only.

Verified: `npx tsc --noEmit` exit 0; `npx vitest run` 80 files / 1282 tests
passing; `/dashboard` still redirects to `/sign-in` without a session, which is
the shell's guard and not a regression. **Not visually verified** — this machine
has no Postgres, so no signed-in render was possible.

Introduce three components and a shared threshold module. **No new API route.**

**`lib/dashboard/quota-tone.ts`** (new, pure, unit-tested)

```ts
export type QuotaTone = 'healthy' | 'watching' | 'warning' | 'blocked' | 'unlimited';
export function quotaTone(used: number, limit: number | null): QuotaTone;
// >=95% or used>=limit -> blocked/warning, >=80% -> watching, else healthy
// limit null/0 -> unlimited
```

`QuotaPoolMeter` switches from its inline `percent >= 95 / 80` literals to this
module, so the strip and the bar cannot disagree.

**`StatusStrip`** — replaces `QuotaExhaustedBanner` at the top (the banner stays
as one of its tones, so nothing is lost).

| Tone | Headline | Detail | CTA |
|---|---|---|---|
| healthy | "31M of 50M left" | "resets 15 December" | Upgrade |
| watching | "87% used" | "about 4 days at this rate" | Add tokens |
| warning | "96% used" | "resets 15 December" | Upgrade |
| blocked | "Out of tokens" | "every model paused until renewal" | Upgrade |
| unlimited | "No token cap on this plan" | — | — |
| none | paywall copy | — | Choose a plan |

Data: **entirely from `SubscriptionBundle`** — `poolTokens`, `poolUsedTokens`,
`period.end`, `subscription.status`, `plan`. Days-remaining is derived:
`(pool - used) / (used / daysElapsed)`, guarded against zero.

**`BurnRateCard`** and **`CostCard`** — two `StatCard`s, no new plumbing:

- Burn: `bundle.usage` + `period.start` → tokens/day and days-remaining; trend
  from the last 7 points of `/api/usage/summary` (already fetched).
- Cost: `bundle.usage.costCustomerUsd`, `.requests`, average per request.

**Layout after Phase 1**

```text
[ StatusStrip: one sentence, one action ]
[ Pool 38% ] [ Burn 1.2M/day ] [ Cost $24.80 this period ]
[ Usage this period (existing chart, unchanged) ]
[ GettingStarted (until complete) ]
[ Keys | Recent activity ]
```

**Acceptance**

- A 96%-used org shows `warning` in the strip **and** the same tone in the bar.
- Strip renders with only `SubscriptionBundle` mocked; no network in the unit test.
- `tests/design-system.test.ts` still passes (no new `dark:`).
- Playwright: Overview shows the strip's headline before any panel skeleton.

**Risk:** medium-low. Tone thresholds are the only behaviour that can be wrong;
they are unit-tested in one module.

---

### Phase 2 — the evidence (SHIPPED)

| Task | Detail |
|---|---|
| True `ModelBreakdown` | Add `GET /api/usage/by-model?from&to&model&apiKeyId` returning `{model, blendedTokens, requests, costCustomerUsd}[]` with the **same WHERE** as `/api/usage`; delete the "counts this page only" hint |
| Hour sparkline | `usage/summary?bucket=hour` already supported; render a 24h sparkline beside "Requests" |
| Key health badges | `Never used` / `Unused 30d` / `Expires in Nd`, derived from `KeyView.lastUsedAt` and `.expiresAt` |

**Why a route here and not before:** per-model aggregates cannot be derived from
a paginated page; the other two need no route.

**Shipped.** `/api/usage/by-model` (same `from`/`to`/`model`/`apiKeyId`
contract), the breakdown now reads it and orders by quota-weighted tokens, the
sparkline rides `summary?bucket=hour`, and key health is `never-used` / `unused
30d`.

Two deviations recorded: **no `expiresAt` badge** — the portal's `KeyView` does
not expose the field, and a countdown derived from a value that is not there
would be invented; and the sparkline is 24 divs rather than a chart library,
because one 24-point strip does not justify one.

---

### Phase 3 — the loop (SHIPPED; the only schema change)

Close the gap where the customer learns about exhaustion from a `403`.

1. Migration `0051_org_alert_prefs.sql`: thresholds (`int[]`), channel, and two
   booleans (`onExhausted`, `onAnomaly`), keyed by `organization_id`.
2. `send_alerts` fans out to customer prefs **in addition to** `OPS_ALERT_EMAIL`;
   ops mail must keep flowing even if the prefs row is missing.
3. `Settings → Notifications` tab (fourth tab), reading/writing that row.

**Acceptance:** an org at 80% receives exactly one mail per threshold per period
(idempotent on `(org, period, threshold)`); `send_alerts` still passes with zero
prefs rows; ops alerts unaffected.

**Shipped.** `0051_org_alert_prefs` (+ `org_alert_sent` as the dedupe),
`customer_quota_alerts` registered as its own 15-minute job, `GET/PATCH
/api/notifications`, and a Notifications tab.

Changes from the plan, deliberately:

- The ledger insert is **the gate**, and it happens BEFORE the send. Send-then-
  record re-sends after a crash; record-then-send costs at most one mail.
- **At most one mail per pass, highest threshold first.** A jump from 79% to
  97% sends the 95 mail, not 80-then-95 — the inbox stays proportional to the
  situation.
- The customer job is **separate from `send_alerts`**, not merged into it: a
  broken customer preference must never suppress a platform outage alert.
- Defaults are a real row-less default (`{80,95}`, email on, exhausted on,
  anomaly off), so the feature works for orgs that never open the tab.
- No owner email ⇒ the ledger row still lands (no retry loop) and a warning is
  logged; that gap is visible rather than silent.

---

### Phase 4 — the team (4–5 days; `RoleGate` first)

1. **`can(role, permission)` in `lib/auth/authorize.ts`**, enforced server-side on
   key creation, billing and members. Roles already exist in schema; today
   `requireActiveOrg()` lets any member mint keys.
2. `GET/POST /api/orgs/[id]/members`, `PATCH/DELETE …/members/[userId]`.
3. `TeamView` page + nav entry; role table rendered to everyone (the
   `/admin/staff` pattern).
4. Move "Redeem a code" into `Settings → Profile`; delete the standalone page and
   redirect `?tab=` style.

**Acceptance:** a `viewer` gets `403` from `POST /api/keys` (route test, not a
disabled button); an `owner` can invite and demote; removing the last owner is
refused.

**Risk:** the only security-consequential phase. Do not ship `TeamView` before
`RoleGate` is merged and tested.

---

### Phase 5 — the split (1.5–2 days, no behaviour change)

Split `billing-view.tsx` (1,180 lines) into `CurrentPlan`, `PaymentMethod`,
`InvoiceHistory`, `PlanCompare`; split `settings-forms.tsx` (590) per tab; add
`RefreshContext` so the shell has one refresh affordance and one bar.

**Acceptance:** every existing billing/settings test passes unmodified; no route
changes; screenshot diff limited to spacing.

---

## 4. Component inventory

| Component | Phase | New route? | Source of data |
|---|---|---|---|
| `quota-tone.ts` | 1 | no | pure |
| `StatusStrip` | 1 | no | `SubscriptionBundle` |
| `BurnRateCard` | 1 | no | bundle + summary points |
| `CostCard` | 1 | no | `bundle.usage` |
| `useUsageWindow` | 0 | no | pure |
| `ModelBreakdown` (real) | 2 | **yes** | `/api/usage/by-model` |
| `RequestVolumeSpark` | 2 | no | `summary?bucket=hour` |
| `KeyHealthBadge` | 2 | no | `KeyView` |
| `NotificationSettings` | 3 | **yes** | `org_alert_prefs` |
| `RoleGate` | 4 | n/a | `authorize.ts` |
| `TeamView` + member routes | 4 | **yes** | `organization_members` |
| `RefreshContext` | 5 | no | context |

Two of eleven need a table; three need a route; six are derivation.

---

## 5. Test strategy

| Layer | What it must prove |
|---|---|
| Unit (`vitest`) | `quotaTone` boundaries at 79/80/94/95/100 and unlimited; `useUsageWindow` returns identical `from`/`to` for the three former copies |
| Route (`vitest`) | `/api/usage/by-model` equals the page sum; `send_alerts` idempotency per threshold; `RoleGate` denies `viewer` writes |
| Component | `StatusStrip` renders every tone from a fixture bundle with no network |
| e2e (`playwright`) | Overview headline appears before skeletons; a blocked org shows the blocked tone on Overview and the banner on Usage; `/pricing` and `/faq` unchanged |
| Guards | `design-system.test.ts` (`dark:` < 100), `theme-colors.test.ts`, `marketing-theme.test.ts` if reinstated |

Run order: `npx tsc --noEmit` → `npx vitest run` → `npx playwright test` for the
touched spec only.

---

## 6. Sequencing and cut line

```text
Phase 0 (0.5d) ─▶ Phase 1 (2-3d) ─┬─▶ Phase 2 (2d)
                                  ├─▶ Phase 3 (2-3d)
                                  ├─▶ Phase 4 (4-5d)
                                  └─▶ Phase 5 (2d)
```

Phase 1 does not depend on 2–5 and should ship alone if only one phase lands. If
two land, take **1 then 0** — the copy fix is cheap but the strip is what changes
how the product feels.

**Cut line:** Phases 3–5 are improvements on a correct foundation. Phase 4 is the
only one with a security surface; if it cannot be staffed with review time, ship
nothing there rather than a UI-only gate.

---

## 7. Deliberately not building

- **A dismissible tour.** The checklist is state-driven and self-removing; a tour
  is a second onboarding system to maintain.
- **Customisable widgets.** Five panels do not need rearrangement, and it makes
  every support screenshot incomparable.
- **A second chart type.** One area chart plus one sparkline.
- **Per-alias remaining budgets.** They do not exist in the product; showing them
  reintroduces exactly the confusion migration `0039` removed.
- **A latency panel.** Unmeasured. The code already made this call correctly.
- **Money as a second primary metric.** `costCustomerUsd` appears as one card,
  not a fourth headline; tokens are the quota.

---

## 8. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Tone thresholds drift between strip and meter | medium | one exported module, boundary tests |
| `RoleGate` looks gated but is not | **high** | enforce in `authorize.ts`, route test per role, no UI-only checks |
| Alert mail double-sends | medium | idempotency key `(org, period, threshold)`; ops path unchanged |
| `dark:` budget exceeded during restyle | low | CI already fails above 100 |
| Duplicate bundle fetch persists | low | Phase 0 grep for `"/api/subscription"` should return shell only |
| Billing split regresses a payment state | medium | Phase 5 last, no behaviour change, tests unmodified |

---

## 9. Definition of done (per phase)

1. `npx tsc --noEmit` exits 0.
2. `npx vitest run` passes with new tests for the phase's pure logic.
3. No new literal hex; `dark:` count did not rise.
4. No component ships without loading / empty / error / partial states.
5. A sentence in the UI states the phase's promise (e.g. "31M of 50M left").
6. The diff contains the deletion the phase promised, not only additions.
