# Dashboard architecture — the user-friendly redesign

Status: proposal. Nothing here is built yet.
Scope: `app/(app)/dashboard/*`, `components/dashboard/*`, and the routes they read.
Out of scope: chat, admin console, marketing.

---

## 0. The verdict in one paragraph

The dashboard is **correct but not orienting**. Every number on it is real,
every state is handled, and the copy is honest — that is rarer than it sounds
and it should not be thrown away. What it lacks is a point of view about what
a person opened it to find out. Today `/dashboard` is a stack of five equally
weighted panels (checklist, three stat cards, budget meter, one chart, two
side panels, a footer note). Nothing on the page says *"you are fine"* or
*"you are about to have a problem"*. A customer with 94% of their pool spent
sees the same visual weight as one who has used nothing, and the only banner
appears at 100% — after the damage.

The fix is not more widgets. It is **one answer at the top, evidence below it,
and the customer's own actions attached to the thing that raised the question**.

---

## 1. What already works — do not touch these

These are load-bearing and better than most competitors:

| Thing | Why it stays |
|---|---|
| `states.tsx` — five distinct states | first-use ≠ no-results ≠ cleared. Most dashboards collapse these. |
| `QuotaExhaustedBanner` at the *period* end, not "tomorrow" | Honest. The alternative sends people to bed for nothing. |
| `QuotaPoolMeter` — one bar, one pool | Matches the actual product. Per-alias bars would describe a split that no longer exists. |
| Filters in the URL on `/dashboard/usage` | Back button, refresh and shareable links all work. |
| CSV export built from the same query as the table | An export that disagrees with the screen is the worst kind of bug. |
| `KeysView` — plaintext once, 402 → paywall not toast, 409 → server wins | Correct trust model. |
| "Latency column deliberately removed" | Not showing a metric the system does not have is a discipline worth keeping. |

---

## 2. The problems, ranked

### P1 — There is no single answer at the top

A customer opens the dashboard to ask one of three questions:
*Am I about to run out? Did I just break something? What should I do next?*

The page answers none of them above the fold. The first thing rendered is a
checklist (which disappears once done — good), then three stat cards whose
relationship to "am I in trouble" has to be computed by the reader.

### P2 — The customer never sees money

`SubscriptionBundle.usage.costCustomerUsd` is fetched on every dashboard load
and rendered **only in the site header**. `UsagePageResponse.totals.costCustomerUsd`
is fetched on the usage page and **never rendered at all**.

The FAQ, the pricing page and the playground all promise a visible meter —
*"the playground shows the real cost of the call"*, *"failed requests never
billed"*. The dashboard is where that promise should be kept, and it is the one
place it is not.

### P3 — Alerts only reach us, never them

`lib/jobs/anomaly-alerts.ts` detects hard-cap breaches, runaway single
requests, and rejected-proof bursts, and emails **`OPS_ALERT_EMAIL`**. There is
no customer-facing threshold alert of any kind. A user discovers exhaustion
when a request returns an error — the single most common way a gateway loses a
customer's trust.

### P4 — No team surface, despite selling teams

`organization_members` has five roles (`owner`, `admin`, `developer`,
`billing`, `viewer`), `GET /api/orgs` exists, and Team/Business plans sell 30
and 100 keys. There is **no UI anywhere** to invite a member, change a role,
or remove someone. The schema is ahead of the product by a whole feature.

### P5 — "By model" is per-page, and admits it

`ModelBreakdown` aggregates `rows` — the current 25-row page — and the hint
says so: *"Counts this page only… Aggregates per model land with the CSV
export."* That is an honest placeholder, but it is the tab a customer clicks
specifically to understand where their pool went, and it can be wrong by
orders of magnitude.

### P6 — Copy promises a period the page does not use

`DashboardOverview` says *"Here is what your gateway has been doing today"*,
then renders period-to-date figures with a monthly reset. One word, but it is
the first sentence under the heading.

### P7 — Four sequential reads on one page

`/dashboard` issues `/api/subscription`, `/api/keys`, `/api/usage` and
`/api/usage/summary` as four independent client fetches. Three of them need
the bundle's plan to decide what to render, so the page paints in stages and
`PanelSkeleton` can flash more than once. On the shared VPS this is the
slowest customer-facing page in the product.

---

## 3. The proposed shape

### 3.1 Information architecture

```
Sidebar (unchanged)
  Chat
  Overview      ← the answer
  Usage         ← the evidence
  API keys
  Billing
  Docs
  ─────────
  Team          ← NEW, replaces "Redeem a code" in the secondary block
  Settings
  [Operations]  staff only

Settings tabs (unchanged): Profile · AI · Notifications ← NEW · Danger
```

**Why Team gets a primary slot and Redeem does not.** Redeem is a one-time
action that at most a third of accounts ever take; it currently sits in the
secondary block where it gets nearly the same weight as Settings. Team is a
recurring job for every Team and Business customer, and today it is
unreachable. Move Redeem into `Settings → Profile` as a one-line "Have a
promo code?" action, and delete the standalone page.

### 3.2 The Overview page, top to bottom

```
┌──────────────────────────────────────────────────────────────┐
│  STATUS STRIP — one sentence, one tone, one action            │
│                                                              │
│  ● Healthy — 31M of 50M left, resets 15 Dec     [Upgrade]    │
│  ● 87% used — about 4 days left at this rate    [Add tokens] │
│  ● Out of tokens — every model paused           [Upgrade]    │
└──────────────────────────────────────────────────────────────┘

┌─ Pool ─────────┐ ┌─ Burn ─────────┐ ┌─ Cost ─────────┐
│ 19M / 50M      │ │ 1.2M / day     │ │ $24.80         │
│ ▓▓▓▓▓░░░░░ 38% │ │ runs out in 26d│ │ this period    │
└────────────────┘ └────────────────┘ └────────────────┘

┌─ Usage this period ────────────────────── 30d ▾ ┐
│  (area chart — unchanged component)             │
│  Yesterday: 1.4M · 412 calls · 86% cached       │
└─────────────────────────────────────────────────┘

┌─ Activity ──────────────────┐ ┌─ Keys ──────────────┐
│ recent 8 calls, unchanged   │ │ 2 of 3 · last used  │
└─────────────────────────────┘ └─────────────────────┘
```

**The afternoon is a pass on the checklist.** `GettingStarted` renders and
then leaves forever; once it is gone there is no replacement onboarding for
"the thing works, now what". Add a fourth, permanent, dismissible step —
*connect a tool* — that links to `/connect` and survives dismissal for 30
days.

### 3.3 The rule behind the layout

> **The top of the page answers "are you okay", the middle shows why, the
> bottom shows what changed.** Anything that does not serve one of those three
> does not belong on Overview — it belongs on Usage, Billing or Team.

That rule is what deletes four panels. `OverviewKeysPanel` and
`RecentActivity` both survive only because they are *actionable* (last-used
timestamp) and *recent* (what changed) — not because they are informative.

---

## 4. Missing components

Each entry: what it is, what it needs, where the data already lives.
**Eleven of the fourteen need no new API route.**

### 4.1 `StatusStrip` — the single most important component

Replaces `QuotaExhaustedBanner` as the top-of-page element, and subsumes it
(it renders the exhausted state as one of its tones).

```ts
type StatusTone = 'healthy' | 'watching' | 'warning' | 'blocked' | 'trial' | 'none';

interface StatusStripProps {
  tone: StatusTone;
  headline: string;        // "31M of 50M left" / "Out of tokens"
  detail: string;          // "resets 15 December" / "about 4 days at this rate"
  cta?: { label: string; href: string };
  secondary?: { label: string; href: string };
}
```

Data: **already in `SubscriptionBundle`** — `poolTokens`, `poolUsedTokens`,
`period.end`, `subscription.status`, `subscription.cancelAtPeriodEnd`.

The one new number is *days remaining at the current burn rate*, computed as
`(poolTokens - poolUsedTokens) / (poolUsedTokens / daysElapsed)`. Pure
derivation, no route.

**Tone thresholds must match the meter**, or the two will disagree:
`>=80%` → watching, `>=95%` → warning, `used >= limit` → blocked.

### 4.2 `BurnRateCard`

Answers "when do I run out", which no current card does.

```ts
{ tokensPerDay: number; daysRemaining: number | null; trend: 'rising' | 'flat' | 'falling' }
```

Data: `usage/summary` points, last 7 days. Derive in the client from points
already fetched.

### 4.3 `CostCard` — the promise the FAQ makes

```ts
{ costThisPeriod: number; currency: 'USD' | 'TND'; requests: number; avgCostPerRequest: number }
```

Data: `bundle.usage.costCustomerUsd` and `.requests`. **Zero new plumbing.**
This is the single highest-value, lowest-cost addition on the page.

### 4.4 `NotificationSettings` — Settings tab, closes P3

```ts
interface AlertPrefs {
  quotaThresholds: number[];   // e.g. [80, 95]
  channel: 'email' | 'none';
  onExhausted: boolean;
  onAnomaly: boolean;          // a single call costing > N× the daily average
}
```

Data: needs a table — `org_alert_prefs` — and a change to `send_alerts` to fan
out to customers as well as ops. This is the **only** component in this list
requiring a migration and a job change.

### 4.5 `RequestVolumeSpark` (usage page header)

24-hour call volume beside the request count, so "412 requests" has a shape.
Data: `usage/summary?bucket=hour`. The endpoint already supports hour buckets
(`UsageBucket = "day" | "hour"`); the UI simply never asks.

### 4.6 `ModelBreakdown` — fix, not replace (closes P5)

Add `GET /api/usage/by-model?from&to` returning true aggregates rather than
summing the visible page. ~40 lines of SQL, one route, and the tab stops
carrying a disclaimer.

### 4.7 `TeamView` (new page, closes P4)

```
┌ Members ─────────────────────────────── [Invite] ┐
│ louay@…        owner    you                      │
│ sarah@…        developer  last active 2d   ⋮     │
└──────────────────────────────────────────────────┘
┌ Roles ───────────────────────────────────────────┐
│ owner      billing, members, delete org          │
│ admin      keys, plans, everything but delete    │
│ developer  keys + usage, no billing              │
│ billing    invoices and payment method only      │
│ viewer     read-only, no key plaintexts          │
└──────────────────────────────────────────────────┘
```

New routes: `GET/POST /api/orgs/[id]/members`, `PATCH/DELETE …/members/[userId]`.
The role table should be **rendered to everyone**, not just owners — the
existing `/admin/staff` page already established this pattern
(*"THE RANK TABLE IS RENDERED UNDER THE TABLE, not just used to gate"*), and
it is right.

### 4.8 `RoleGate` — a permission primitive, not a component

```ts
can(role, 'billing:write' | 'keys:write' | 'members:invite' | 'org:delete'): boolean
```

Today authorization is `requireActiveOrg()` — any member of any role can
create a key or change the plan. With five roles in the schema and none
enforced, adding Team UI without this ships a privilege bug. **This must land
before `TeamView`.**

### 4.9 `EmptyOrgState` (billing)

An org with no subscription, no keys and no usage currently gets the paywall
panel, which is correct but cold. A three-line orientation ("pick a plan → get
a key → send a call") does the job the marketing site already does well.

### 4.10 `PeriodSelector` (shared)

Three pages re-implement `from`/`to` from a day count with slightly different
code (`usage-view.tsx` has it twice, in `query` and `summaryQuery`, with a
third copy in `exportQuery`). One hook, `useUsageWindow()`, returning
`{range, from, to, setRange}`.

### 4.11 `RefreshContext`

Four independent `useApi` calls on Overview means four spinners. One provider
holding all four, exposing `refreshing = any(...)`, so there is one
`RefreshingBar` and one refresh button.

### 4.12 `KeyHealthBadge`

On the keys table: last used, never used, expiring soon, unused > 30 days.
Data: `KeyView.lastUsedAt` / `.expiresAt` — already returned. "Never used" is
how a customer finds the key they created and forgot to paste.

### 4.13 `QuotaWarningInline` (chat)

`ChatUsage` already computes per-conversation cost. Add a one-line inline
warning when the conversation alone has spent >20% of the daily cap. Closes
the loop between "the meter" and "the thing burning it".

### 4.14 `CopySnippet` (connect/docs)

Not dashboard, but it is the missing rung between "I have a key" and "I sent a
request", and the checklist's last step points at `/connect`.

---

## 5. What to delete or merge

| Item | Action | Why |
|---|---|---|
| `/dashboard/redeem` page | Move into Settings → Profile | One-time action occupying a nav slot |
| `QuotaMeters` / `QuotaMeter` (per-alias) | Delete | Dead since 0039. Only `QuotaPoolMeter` is used. Verified: no live caller. |
| `BillingView` (1180 lines) | Split into `CurrentPlan`, `PaymentMethod`, `InvoiceHistory`, `PlanCompare` | It is the largest component in the repo and does four unrelated jobs |
| `SettingsForms` (590 lines) | Split per tab | Same reason, smaller |
| `"doing today"` copy | → "this period" | P6 |
| Duplicate `from`/`to` math | → `useUsageWindow()` | Three copies drift |

---

## 6. Sequencing

Each phase ships independently and leaves the product working.

**Phase 0 — truth (1 day).** Fix the "today" copy. Delete the dead per-alias
meter. Land `useUsageWindow()` and `RefreshContext`. No visual change; removes
the three sources of disagreement.

**Phase 1 — the answer (2–3 days).** `StatusStrip` + `BurnRateCard` +
`CostCard`. This is the highest user-visible return in the whole plan and
needs no new route.

**Phase 2 — the evidence (2 days).** True `ModelBreakdown` aggregates;
hour sparkline; key health badges.

**Phase 3 — the loop (2–3 days).** `org_alert_prefs` + customer threshold
mail in `send_alerts` + the Notifications settings tab. This is the only phase
touching the schema and the job runner.

**Phase 4 — the team (4–5 days).** `RoleGate` **first**, then `TeamView`,
members routes, and moving Redeem into Settings.

**Phase 5 — the split (2 days).** Break `BillingView` and `SettingsForms` into
named panels. No behaviour change; do it last because it is the only phase
that risks regressions without adding capability.

---

## 7. What I would not build

- **A dismissible onboarding tour.** The checklist is better because it is
  state-driven and vanishes on its own.
- **Customisable dashboard widgets.** Nobody rearranges a five-panel page, and
  it would make every screenshot in support threads incomparable.
- **A second chart type.** One area chart, one sparkline. Competitors with
  five charts have five because they have five products.
- **Per-alias remaining budgets in the UI.** They do not exist in the product.
  Showing them re-creates the exact confusion migration 0039 removed.
- **Latency, until it is measured.** The code already made this call
  correctly; keep it.

---

## 8. The risk in this plan

`RoleGate` is the only piece with a security consequence, and it is the one
that is easy to get wrong in the direction of *"looks gated, isn't"*. Enforcing
it must be a change in `lib/auth/authorize.ts` — the server — with the UI
reflecting it, never the reverse. A disabled button is not a permission check.

The second risk is scope: Phase 1 alone changes how the product feels. Phases
2–5 are improvements on top of an already-correct foundation. If only one
phase ships, ship Phase 1.
