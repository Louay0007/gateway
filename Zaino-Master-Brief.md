# Zaino AI — master brief after a full read

Compiled 13 November 2026. Sources read: `Zaino-Funding-Tracker.xlsx` (all five
sheets), `Zaino-Funding-Brief.md`, `Zaino-Applications.md`,
`Emergent-Ventures-Answers.md`, `Emergent-Ventures-FINAL.md`, `Zaino-One-Page.pdf`,
`ZAINO-SUMMARY.md`, `README.md`, `CONTEXT.md`, `CPO_ROADMAP.md`,
`plans/pitch-deck-plan.md`, `plans/0038-50m-monthly-implementation.md`,
`plans/HANDOVER-dodo-rail.md`, `plans/competitive-audit-chatgpt-codex.md`,
`docs/*.md`, `BLUEPRINT.md`, `PLATFORM.md`, `DESIGN.md`, `HANDOFF.md`,
`IMPLEMENTATION.md`, `LATENCY.md`, `PORTAL_PRODUCT_AUDIT.md`,
`PERFORMANCE-AUDIT.md`, and the migrations `0036`–`0040` plus
`prices/models.yaml` and `lib/billing/d17.ts`.

Where a document disagrees with the database or the price table, this brief
takes the database/price table as true and says so.

> **POSTSCRIPT (0044).** Per-seat pricing has been **removed**, so every seat
> figure below is history. 0044 drops `plans.max_seats` and
> `subscriptions.seats` and sends `product_cart.quantity: 1` on both plans. The
> reason is in this brief's own analysis: seats were sold but never delivered —
> `organization_members` has exactly one writer, so there was no invite flow,
> member UI or seat enforcement on any request path, and D17 never had a seat
> field. The "fix D17 seat billing" item is therefore closed by deletion; the
> real prerequisite for per-seat revenue is a team product that does not exist
> yet.

---

## 1. The business in one paragraph

Zaino AI sells access to frontier AI models to developers in Tunisia and the
Maghreb, priced in dinars and paid through D17 (La Poste Tunisienne's wallet),
with a card rail (Dodo) built but still in test mode. The product is not the
models — it is the metering, quota enforcement, two payment rails, trilingual
dashboard and admin console wrapped around them. Two plans: Starter 50 DT ($15)
unlocking fast + smart, Pro 90 DT ($30) unlocking smart + frontier + fable.
Both get **one shared 50M-token pool per month** (migration 0039). Trial is 1M
shared over 3 days. Live state: 641 tests passing, tsc clean, 40 migrations,
single VPS, deploy is a push to `main`.

---

## 2. Pricing — authoritative (migration 0039, not the README)

| | Starter | Pro |
|---|---|---|
| D17 | 50 DT | 90 DT |
| Dodo | $15 | $30 |
| Pool | 50M/month, one pool | 50M/month, one pool |
| Models | fast + smart | smart + frontier + fable |
| API keys | 3 | 15 |
| Cost at 100% burn (claimed) | 10 DT | 10 DT |
| Margin at 100% burn (claimed) | 80.0% | 88.9% |

~~The D17 rail ignored seats.~~ The two rails used to disagree — Dodo charged
`$30 × seats`, D17 charged `plan.priceTndMillimes` flat — so a 25-seat team paid
90 DT on D17 and $750 on Dodo. 0044 removed the asymmetry by removing seats: both
rails now charge one flat price per plan, which is also all the product can
deliver.

---

## 3. The cost basis — now three models, not two

This is the load-bearing number and the documents hold three mutually
exclusive versions of it.

**Model A — 0.20 DT per 1M blended tokens** ("100 DT buys a 500M-token block").
Source: a code comment in `plans/deck/build.py` (`BASIS_M = 0.20`) and the deck
footer. Every figure in the deck, every margin claim, break-even (3.6 subs) and
the whole 150,000 DT ask are arithmetic layered on this. No invoice exists.

**Model B — $30/month flat, unlimited.** Source: `CPO_ROADMAP.md` line 9,
"Upstream is **$30 flat, unlimited**. Every competitor's COGS is per token."
This is a *third* model, not a variant of A: under B, volume is free and the
margin is whatever the price is. It is also the only model under which the
roadmap's central strategy ("generosity is not a cost, it is a weapon") is
rational. Note that `ZAINO-SUMMARY.md` describes the same $30 as an "upstream
minimum" in fixed cost — a floor on a metered bill, which is not flat and not
unlimited. The two documents disagree about what the same $30 is.

**Model C — per-token list rates.** `config/litellm.yaml` and `prices/models.yaml`:
fast $1/$5, smart $3/$15, frontier $15/$75 per million in/out. Both files label
these **placeholders** ("until a real invoice arrives"). At a 70/30 mix, burning
the whole 50M pool costs $110 (fast), $330 (smart), $1,650 (frontier) — i.e.
341 DT, 1,023 DT, 5,115 DT against a 50 DT / 90 DT price.

**Model D — the product's own ledger.** `lib/admin/financials.ts` computes
customer cost as `upstream × rate_multiplier_bps` (1.30 Starter, 1.25 Pro), which
is a ~23% / ~20% gross margin. The README says this outright.

So the repo contains four different margins for the same business: ~90% (A),
unbounded (B), deeply negative (C), and ~21% (D). Until the AiPilot invoice or
one month of production `grossMarginPct` exists, the deck's 80–89% is an
assumption, not a measurement. This remains the single highest-priority item
before any investor conversation.

---

## 4. Funding: the workbook and the four documents

The workbook's thesis is right and is the most valuable thing in the folder:
the money needed is ~1,900 DT to incorporate, and incorporation unlocks the
**Bourse Startup** — 1,000 DT/month net for 12 months for a non-salaried
founder, i.e. 12,000 DT, non-dilutive. That is 6× the ask.

The sequence: Tier 1 grants that need no company (Emergent Ventures, Awesome
Foundation, four cloud-credit programmes) → pre-label under article 4 of Law
2018-20 (6-month validity, no company needed) → incorporate SUARL → Startup
Label (100 DT, 30-day decision, 60 days' silence = approval) → Bourse within
1 month of the label → accelerators (Flat6Labs, 216 Capital, CBA), all of which
require a legal entity.

Corrections already made and worth keeping: Apple's $99 includes the signing
certificates (a line item the founder had budgeted separately); TotalEnergies
Startupper has **no open cycle** — the "30 Nov 2026" deadline came from an
aggregator and the official platform shows 0 live programmes.

---

## 5. Where the documents still contradict each other

These are live errors in deliverables, not history. Ordered by what they cost.

**5.1 The grant budget double-counts ~1,485 DT.** The workbook defines 1,885 DT
as the *whole* lean budget (400 registration + 100 label + 307 Apple + 78 Play +
1,000 bank = 1,885) and says "this is the number to put on every application."
`Zaino-Applications.md` and `Emergent-Ventures-FINAL.md` then list
"SUARL incorporation … 1,885 DT / $608" as the *incorporation line*, and add
Apple (307), the label (100) and a 573 DT buffer on top — every one of which is
already inside the 1,885. The result is a $924 table against a $607 need, with
$1,000 requested. The honest lean figure is 1,885 DT ≈ $607.

**5.2 TotalEnergies is still recommended in three places.** The tracker's
Tracker sheet says "NO OPEN CYCLE — corrected 13 Nov 2026" and
`Zaino-Applications.md` opens with the correction. But `Zaino-Funding-Brief.md`
still says "closes 30 November 2026 — 17 days from now. … the largest open
window right now", and the workbook's own **START HERE** (B29) and **Calendar**
(B5) sheets still list it as this week's top action. Anyone working from the
brief or the calendar will spend a day on a dead programme.

**5.3 The Emergent Ventures word limit is still 1,500 in two places.**
`Emergent-Ventures-Answers.md` corrects it to 1,000 ("My earlier pack said
1,500. Use 1,000"), but `Zaino-Funding-Brief.md` and the tracker's Emails sheet
still say 1,500.

**5.4 Contact details disagree, including across the two documents written the
same day.** `Emergent-Ventures-Answers.md` instructs
`ceo-louayrjili@sohabi.app` / `+21624267363` / City "Tunis", and suggests
creating `louay@zaino.soon.it`. `Emergent-Ventures-FINAL.md` lists the CV's
`louay.rjili@gmail.com` / `+216 51 803 706` / Rades Meliane, and says to use
those. Both are dated 13 November. The PDF footer and CV must match whichever
is chosen.

**5.5 Bourse eligibility may not hold.** The 12,000 DT assumes the
"non-salaried founder" rate. The same application narrative says the founder is
paid to build LLM pipelines at Neediditals and is CTO of Chabaqa. A salaried
founder falls under a different rate (up to 5,000 DT), and the conditions also
require full-time commitment and no other ANETI programme. This needs confirming
before 12,000 DT appears in any plan as income.

**5.6 Stale technical documents.** `README.md` still says "there is no card
path", lists 0038 as the newest migration, describes the pool as a per-alias
split (25M + 25M) rather than 0039's single pool, and its "things that will bite
you" bullet 3 says the wall is "per-day now, not per-period" and then tells you
to say "resets <period end>" in the same sentence. `CONTEXT.md` (Oct 15) says
$19/$99, 217 tests, 11 migrations, a `howtofix.id` upstream and three aliases.
`HANDOFF.md` describes a single served model on a dead tunnel. `LATENCY.md`
carries a completely different model/price table ($2/$10 sonnet, $4/$20 opus).
`plans/pitch-deck-plan.md` and `plans/deck/build.py` still say 614 tests / 38
migrations where the truth is 641 / 40.

**5.7 Two market ceilings circulate.** `ZAINO-SUMMARY.md` and the deck say
$3.83M ARR ceiling (100k Maghreb devs × 15% payers × 66 DT ARPU). The
`ZAINO-SUMMARY` also notes $10M ARR needs 39,141 single-seat accounts against a
15,000-payer population, which is why the ask is an angel extension and why the
seat fix is framed as existential rather than cosmetic. That reasoning is
sound and internally consistent; it just is not the number on the deck's later
slides.

---

## 6. Product and engineering state, verified

Architecture: Caddy → auth-edge (`zn-` → `sk-`, fail-closed, no credential
logging) → LiteLLM → Postgres/Redis, one VPS under Compose. The edge is the
security boundary and also carries the Responses→Chat shim, because the upstream
is OpenAI-compatible only and `codex-cli` speaks Responses exclusively.

Quota design, which is the genuinely strong part: one meter (blended tokens, five
ledger columns summed), one rule
(`allowed = entitled WHERE tokens_used < token_limit`), one window helper shared
by the dashboard bundle and the enforcement path. Rate limits, concurrency and
dollar budgets are stored but never pushed. Three jobs call the same helper so
they cannot drift.

Two rails: D17 manual (no merchant API — the customer transfers, screenshots the
authorisation number, staff approve; approval idempotent on
`d17:<paymentId>:approved`), and Dodo built but `DODO_PAYMENTS_ENVIRONMENT=test_mode`
with test-mode product IDs in migration 0040 — a checkout today moves no money.

Genuine open items, in the order the documents themselves rank them: prove the
cost basis; get the resale approval in writing (or commit to private/team-use
positioning); build a team product before re-pricing for seats; take the card rail live; resolve the
Pro/Starter pool inversion if it still exists; refresh the README.

The known engineering risks are documented rather than hidden: up to 20 minutes
of unmetered spend between collection runs, no daily rollup, `unknown` aliases
now charged to every alias, and a `CHAT_KEY_SECRET` that was required by
`docker-compose.yml` but absent from `.env.example`.

---

## 7. What I would do next, in order

1. Fix the grant budget table's double count (5.1) before the Emergent Ventures
   form is submitted. It is the one place where a reviewer can check the
   arithmetic and find it wrong.
2. Purge TotalEnergies from the brief, START HERE and Calendar (5.2).
3. Pick one set of contact details and make the form, PDF and CV agree (5.4).
4. Confirm the Bourse rate against actual employment status (5.5) — 12,000 DT of
   the plan rests on it.
5. Produce the AiPilot invoice. Nothing in the deck is safe to show until then.
