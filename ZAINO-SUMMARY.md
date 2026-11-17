# Zaino AI — Business & Technical Summary

Verified against the repository at `~/Workspace/gateway` on 13 November 2026.
Everything below was read from source, migrations, or a test run — not from
prior notes. Where the repo contradicts itself, both sides are stated.

---

## 1. What the business is

Zaino AI sells access to frontier AI models to developers in Tunisia and the
wider Maghreb, priced in dinars and paid through D17 (La Poste Tunisienne's
mobile wallet). The pitch is narrow and honest: a developer in Tunis cannot
easily buy a Claude or GPT subscription — no international card, no USD
billing, no local invoice — so they either borrow a colleague's account, use
a grey-market reseller, or give up. Zaino is the legal, local, monthly-priced
way in.

It is a resale business with a software moat: the product is not the models,
it is the metering, quota enforcement, billing rails and dashboard wrapped
around them. That distinction matters for both the margin story and the legal
risk, and the repo is unusually clear-eyed about it.

---

## 2. Product and architecture

The system is two planes. The **control plane** is a Next.js 16 portal
(`portal/`) handling auth, organisations, API keys, usage dashboards, billing,
a staff admin console and a built-in chat UI. The **data plane** is
Caddy → a custom `auth-edge` service → LiteLLM Proxy → Postgres/Redis, all on
one VPS under Docker Compose.

The edge is the security boundary: it swaps the customer's `zn-` key for the
upstream `sk-` key, so the upstream credential never leaves the box. It fails
closed, rejects unknown model names with a `400`, and rewrites LiteLLM's
generic denials into a customer-readable per-alias message. It also carries a
Responses→Chat shim, because the upstream is OpenAI-compatible only.

Four model aliases are sold, never the upstream names: `fast` (Haiku-class),
`smart` (Sonnet-class), `frontier` (Opus-class) and `fable` (served by
`gpt-6-astra`, but every response reports `opus-5.5`, so it is priced
identically to frontier).

The quota design is the genuinely good engineering here. There is exactly one
meter — blended tokens, summed across five ledger columns — and exactly one
rule: `allowed = entitled WHERE tokens_used < token_limit`. Rate limits,
concurrency caps and dollar budgets are stored but deliberately never pushed
to the gateway, so nothing except the token wall can block a request. Three
separate jobs (5-minute sync, 5-minute enforcer, hourly backstop) all call the
same helper, which is why they cannot drift apart. And critically, the
dashboard bundle and the enforcement path import the *same* window function —
the README calls this "the single most expensive invariant", and it is right:
if those two ever diverge, the dashboard lies while the gateway cuts.

---

## 3. Pricing — authoritative state

Migration 0039 is the current truth, not the README (which still describes
0038 and claims there is no card path).

| | Starter | Pro |
|---|---|---|
| Local price (D17) | 50 DT | 90 DT |
| Card price (USD) | $15.00 | $30.00 |
| Token pool | 50M / month, **one shared pool** | 50M / month, **one shared pool** |
| Models unlocked | fast + smart | smart + frontier + fable |
| API keys | 3 | 15 |
| Cost at 100% burn (claimed) | 10.00 DT | 10.00 DT |
| Gross margin (claimed) | 80.0% | 88.9% |

The trial is **1M shared tokens over 3 days**, gated by the one launch code
`ZAINO-LAUNCH-3M`, redeemable from 20 October 2026 to 20 January 2027 (0045).
The campaign window is three months; each individual trial is still 3 days,
and a late redemption gets only the days the campaign has left. It was cut from 50M by 0039 for a good reason: a free
3-day trial was handing out a full paid month's volume — roughly 10 DT of
upstream cost per redemption — and could be farmed.

Two structural notes on the current shape. First, 0039 collapsed the per-alias
budgets into a single total, and enforcement sums the map, so the 50M is
genuinely shared: a Pro customer can spend the entire pool on `frontier`.
Second, that creates a real inversion the deck's own planning doc flags — Pro
gets the same 50M as Starter but across three models, so a customer paying
1.8× more hits a per-model wall sooner if they spread their spend. The
migration documents two fixes (Pro at 50M *per alias*, 150M total, with a 67%
floor) and deliberately ships neither, because it was specified as 50M total.

---

## 4. Payments

Two rails, and only one of them moves money.

**D17** is live. There is no merchant API — no intent, no redirect, no
webhook, no polling. The customer transfers inside the D17 app, screenshots
the authorisation number, and a staff member approves it in `/admin/d17`.
Approval routes through the same idempotent `applyCallback()` a webhook would
use, keyed on `d17:<paymentId>:approved`, which is what keeps "paid twice"
from happening. The provider's `verify()` deliberately throws, because there
is nothing to verify.

**Dodo** (the card rail) is implemented and typechecked but **in test mode**.
`DODO_PAYMENTS_ENVIRONMENT=test_mode` in both env examples, and migration 0040
maps the *test-mode* product IDs (`pdt_0NrQPphz…`, `pdt_0NrQQ1TI…`). A
checkout started today is a test payment — no money moves. Going live needs a
separate migration with live product IDs plus the environment flipped, and
0040 explicitly declines to do that inside a bug fix. Geography is therefore
capped at Tunisia until it happens.

~~One real billing gap sits between the rails~~ — **closed by removal, not by a
fix (0044).** Dodo used to charge `$30 × seats` while D17 charged
`plan.priceTndMillimes` with no seat multiplication, so a 25-seat team paying by
D17 paid 90 DT. The asymmetry was real, but the underlying feature was not:
`organization_members` had exactly one writer (signup provisioning), so there
was no invite flow, no member list, no member UI and no seat enforcement on any
request path. Seats were a billed entitlement with no delivery path on either
rail. 0044 drops `plans.max_seats` and `subscriptions.seats` and sends
`product_cart.quantity: 1`, which removes the asymmetry by removing the feature.
The revenue ceiling this used to imply is real and is now unfixable by billing
alone: raising ARPU needs a team product (invites + members + enforcement)
before it needs a per-seat price.

---

## 5. Unit economics — the problem

This is the section that matters, because everything else in the deck is
arithmetic layered on one asserted number.

The deck, the migrations and the planning docs all price from **0.20 DT per
1M blended tokens**, sourced as "100 DT buys a 500M-token block, November
2026" (`plans/deck/build.py`, `BASIS_M = 0.20`). From that: 50M costs 10 DT,
Starter keeps 80%, Pro keeps 88.9%, blended ARPU is 66 DT, fixed cost is
$74/month (VPS $44 + upstream minimum $30) = 229.40 DT at 3.10, and
break-even is 3.6 subscribers at 25% burn (4.1 at full burn). I re-ran all of
that arithmetic and it is internally consistent.

The problem is the input. The same repository carries a per-token rate table
in `config/litellm.yaml` and `prices/models.yaml` — fast $1/$5, smart $3/$15,
frontier $15/$75 per million input/output. At a normal 70/30 input:output mix
those imply:

| Spend the whole 50M pool on | Cost at list rates | vs the 50 DT / 90 DT price |
|---|---|---|
| `fast` | $110 = 341 DT | 6.8× a Starter month |
| `smart` | $330 = 1,023 DT | 20.5× Starter, 11.4× Pro |
| `frontier` | $1,650 = 5,115 DT | 56.8× a Pro month |

So 50M costs somewhere between $2.20 and $33 per million depending on the
model, against the 0.20 DT (~$0.065) per million the deck assumes — a gap of
30× to 500×.

Which number is real? Neither is evidenced in the repo. `CONTEXT.md` §4 says
the per-token rates are **placeholders** ("the provider publishes no pricing…
replace them before customer money depends on them"), and `prices/models.yaml`
repeats it ("placeholders until a real invoice arrives"). There is no invoice
anywhere in the tree. The 0.20 DT block price is asserted in a code comment
and a deck footer, not measured.

There is also a third model in production. The admin margin screen
(`portal/lib/admin/financials.ts`) does not use either figure: it computes
customer cost as `upstream_spend × rate_multiplier_bps` — 1.30 for Starter,
1.25 for Pro. That is a ~23% and ~20% gross margin respectively, and the
README says so directly: "At 1.30 you keep ~23% gross margin." So the product's
own ledger implies a margin an order of magnitude below the deck's 80%.

The honest reading: the 80% number is a *modelling assumption resting on an
unverified purchase price*, and the repo contains two other models that
disagree with it. Until someone produces the actual AiPilot invoice — or runs
one full month of production ledger and reads `grossMarginPct` off the admin
screen — the deck's central claim is unsupported. This is the single highest
priority item before any investor conversation, because it is the one number a
diligent investor will ask to see the receipt for.

---

## 6. Market and go-to-market

The market sizing is bottom-up and deliberately modest: ~30,000 developers in
Tunisia (GitHub 2021), ~100,000 across the Maghreb, ~220,000 with Egypt. At
15% payer conversion and 66 DT blended ARPU that is 11.88M DT/year, or about
**$3.83M ARR** — a ceiling, not a stepping stone.

That ceiling is why the raise is shaped the way it is. $10M ARR at single-seat
pricing needs 39,141 accounts — more than the entire addressable population.
Five-seat accounts at card pricing ($1,800/year) need 5,556. So the seat fix
and the card rail are not growth features; they are what makes the TAM story
arithmetically possible at all. A $3.8M-ceiling story fails a venture
diligence process at $1.5–3M, which is why the ask is an angel/seed extension
rather than a priced round.

GTM is Tunisia-first and content-led: LinkedIn publishing, a French/Arabic/
English trilingual product, and a desktop client (OpenCode) with a browser
device-code login so users never paste a key. The growth plan is explicit that
the card rail gates phase 2, and suggests a manual invoice path as the
zero-code bridge.

---

## 7. The deck and the ask

`plans/deck/` holds a 14-slide deck (PPTX + PDF) with speaker notes on all 14
slides and native editable charts. The arc is problem → workaround → product →
architecture → economics → cost basis → scale → positioning → proof → ask →
roadmap → risks → close.

The ask is **150,000 DT (~$48,400)** as an angel/seed extension, allocated
51k to a second payment rail, 45k to seat billing engineering, 33k to
Tunisia-first GTM and 21k buffer — which sums exactly.

The deck's strongest instinct is slide 13, which leads with the resale-terms
risk rather than burying it. That is the right call: the upstream provider's
terms permit powering your own product but forbid resale without written
approval, and Zaino's upstream is itself a reseller, so the exposure is
inherited. Two honest paths exist — get the approval in writing, or reposition
as private/team-internal use, which needs none.

Two deck figures are stale against the repo and should be rebuilt before it is
shown: slide 10 says **614 tests and 38 migrations**, where the actual numbers
are **641 and 40**; and its footnote still describes the pre-0039 per-alias
split rather than the single shared pool.

---

## 8. Verified engineering state

I ran the suite rather than trusting the claim:

- `npx tsc --noEmit` — clean, exit 0.
- `npx vitest run` — **641 tests passing across 41 files** in 9.6 seconds.
- **40 migrations**, forward-only and ledger-guarded, each with its reasoning
  in the file header and SQL guards that refuse to apply a broken invariant.
- ~57k lines of portal app/lib code, ~70k including tests, e2e and scripts.

Run tests from `portal/`, not the repo root — the `@/` alias only resolves
there, and running from root produces spurious failures.

The documentation discipline is genuinely unusual for a project this size:
every migration explains *why* it exists, several record the bug that
motivated them, and the README is candid about its own past mistakes (the
0025 daily-cap error that made a 50 DT plan worth 1,200 DT of tokens is
documented in detail rather than quietly fixed). That is an asset in diligence.

---

## 9. Open items, ranked

1. **Prove the cost basis.** Produce the AiPilot invoice or a month of
   `grossMarginPct` from the admin screen. Everything else waits on this.
2. **Get the resale approval in writing** — or commit publicly to the
   private/team-use positioning. This is the only genuinely existential risk.
3. ~~**Fix seat billing on the D17 rail.**~~ **Resolved by deletion (0044).**
   Seats are gone: the columns are dropped and both rails charge one flat price.
   What remains is the real opportunity — a *team product* (invites, member list,
   seat enforcement) is the prerequisite for any per-seat revenue, and it does
   not exist yet. Do not re-price before it does.
4. **Take the card rail live.** Separate migration with live product IDs,
   environment flipped, one real payment processed end to end.
5. **Rebuild slide 10** with 641 tests / 40 migrations and the 0039 pool shape.
6. **Resolve the Pro/Starter pool inversion** — either Pro at 50M per alias
   (150M total, 67% floor) or Starter down to 30M.
7. **Refresh the README** — it still says 0038 is the newest migration and
   that there is no card path, both of which are now false.

---

## 10. One-paragraph summary

Zaino AI is a well-engineered, honestly-documented Tunisian SaaS that resells
frontier AI models for dinars, with a real product around the models: hard
per-request quota enforcement, two payment rails, a trilingual dashboard, an
admin console and 641 passing tests. Its live rail is D17 manual transfer; its
card rail is built but in test mode, which caps it at Tunisia. Its pricing is
50 DT and 90 DT for a shared 50M tokens per month, and its entire margin story
rests on an asserted upstream cost of 0.20 DT per million tokens that the
repository's own rate table contradicts by one to two orders of magnitude and
that no invoice in the tree substantiates. The market ceiling is ~$3.8M ARR in
the current shape, which is why the raise is a 150,000 DT angel extension
aimed at unlocking a team product and cards rather than a venture round. The single
most valuable thing the founder can do next is not build anything — it is to
find the invoice that proves the cost basis, because every number in the deck
is downstream of it.
