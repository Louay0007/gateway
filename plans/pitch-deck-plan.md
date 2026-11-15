# Zaino AI — Investor Pitch Deck: structure & content plan

**Prepared:** 13 Nov 2026 · **Basis:** the live repo (`README.md`, `0038_monthly_50m.sql`,
`pricing`, `docs/dodo-payments.md`, `docs/d17-payments.md`, `plans/competitive-audit-*.md`)
and measured unit economics. Every number below is derived, not asserted.

---

## 0. The decision that comes before the deck

The financials produce one unavoidable conclusion, and the deck's entire shape depends on
answering it. **Do not skip this section.**

At current pricing the blended ARPU is **66 DT ($21.29) per month = $255/year**. The
home market (Maghreb developers, cited at ~100,000) yields:

| Assumption | Result |
|---|---|
| 15% ever pay for API access → 15,000 paying | **$3.8M ARR ceiling** in the entire home region |

That is a genuinely excellent bootstrapped business — 96% gross margin, profitable at
**3.6 subscribers**, no outside capital required to reach $10k MRR (470 subs). But it is
**not** a venture-scale outcome as priced: $10M ARR would need **39,141** single-seat
subscribers at $21/mo, against a 15,000-payer home market.

**Therefore this plan specifies two decks, and you must pick one before writing slides:**

| | **Deck A — Angel / bootstrap** | **Deck B — Seed / VC** |
|---|---|---|
| Ask | 150–400k DT ($50–130k) or none | $1.5–3M |
| Story | "Profitable infrastructure business, capital-efficient" | "Own the AI access layer for a 100M-dev region" |
| Uses current pricing | Yes, as-is | **No** — requires the seat fix (§3) |
| Honest ceiling | $3.8M ARR, stated openly | Must show a path past it |
| Diligence risk | Low | High (see §4) |

**Recommendation: build Deck A now.** It is defensible with today's numbers, needs no
product change, and the traction you have is real. Deck B becomes writable only after the
pricing fixes in §3 ship and produce 2–3 quarters of seat-priced revenue. Raising a seed
round on a $3.8M-ceiling story will fail diligence, and failing publicly costs you the
angel round too.

Both decks share slides 1–9. They diverge at slide 10 (ask + use of funds).

---

## 1. Narrative spine (the one argument)

> Developers across North Africa are locked out of frontier models — not by skill, but by
> **payment rails and dollar pricing**. A Tunisian engineer cannot put $20/month on a card
> that works. Zaino sells the same models in dinars, on the rail they already use, with a
> token allowance that is *predictable* instead of metered.

Three pillars, in this order of strength:

1. **Distribution is the moat, not the model.** You are not competing with Anthropic; you
   are the only practical way to *pay* for it locally. D17 + trilingual FR/AR/EN checkout
   is the actual asset.
2. **Unit economics that survive worst case.** 80% margin even if a customer burns the
   entire monthly allowance. Most API resellers die on this; the 0038 migration is the
   proof you have engineered it.
3. **Built, not pitched.** ~70k lines of TS/TSX in the portal alone, 614 tests, 38
   migrations, a gateway with hard quota enforcement, an admin console, and a shipped
   desktop app (**v1.1.5**, ARM64 + x64 DMG, released from the separate
   `Louay0007/zaino-desktop` repo — note it is *not* in this tree, so say "shipped
   desktop client", not "in this repo"). Show this — it is the difference between a deck
   and a deck with a company behind it.

**Do not lead with "we're an AI company."** Lead with the payment gap. It is specific,
verifiable, and nobody else is solving it.

---

## 2. Slide-by-slide structure (14 slides)

Deck A. Each entry: what the slide proves, and the number that carries it.

| # | Slide | Claim it makes | The number that carries it |
|---|---|---|---|
| 1 | **Title** | — | Name, one line, contact. No logo soup. |
| 2 | **The gap** | Tunisian/Maghreb devs cannot buy frontier AI | 67% of under-30s consider emigrating (Arab Barometer 2025); no card path exists for local devs |
| 3 | **The workaround today** | They use VPN + foreign cards + shared keys | Shared keys = no cost attribution, no quota, no audit. Fragile and often ToS-violating. |
| 4 | **Product** | One subscription, three model tiers, dinars | `fast`/`smart`/`frontier` aliases; 50M blended tokens/mo; 3 keys Starter, 15 Pro |
| 5 | **How it works** | Real infra, hard enforcement | Caddy → auth-edge (`zn-`→`sk-`) → LiteLLM; quota enforced per request, fail-closed |
| 6 | **The economics** | Margin survives a hostile customer | **At 100% burn: 10 DT cost on a 50 DT price = 80% margin.** Pro: 89%. |
| 7 | **Why the pricing is defensible** | Priced against a real cost basis | 0.20 DT per 1M tokens (100 DT / 500M). Every plan priced from that, not guessed. |
| 8 | **Traction / proof** | It ships | 614 tests passing, 38 migrations, desktop client v1.1.5 shipped, admin console. Say what is *live* vs *in progress*. |
| 9 | **Competition** | Nobody occupies this position | Table: OpenAI/Anthropic direct (no dinar rail), local resellers (no product), VPN workarounds (no compliance) |
| 10 | **The ask** | What you want | Deck A: 150–400k DT or none. Deck B: $1.5–3M. |
| 11 | **Use of funds** | Specific, not "hiring" | Deck A: runway + payment rail expansion. Deck B: sales + seat pricing + EU expansion |
| 12 | **Roadmap** | Next 4 quarters, dated | File/vision input, tool calling, web search (from the competitive audit — these are the real gaps) |
| 13 | **Risks, stated plainly** | You have done diligence on yourself | ToS resale (§4), payment concentration, single-VPS, founder concentration |
| 14 | **Close** | One sentence, one action | "The infrastructure is built. We need X to reach Y." |

**Slide 13 is not optional and not a weakness.** Investors find the ToS question in
diligence regardless. Pre-empting it with a mitigation plan reads as competence; being
surprised by it reads as naivety.

---

## 3. What must be true before Deck B is honest

These are product/pricing changes, not slide edits. Each is already identified in the repo.

### 3a. D17 ignores `seats` — the ARPU ceiling is a billing bug

`0037_dodo_and_seat_prices.sql` sets Pro `max_seats 25`, and Dodo bills
**$30 × seats**. But the D17 path charges **90 DT flat regardless of seats**. A 25-seat
Pro team pays 90 DT on the local rail and $750 on the card rail. That is the ARPU ceiling,
and it is a bug, not a strategy.

Fix it and the picture changes:

| Seats | Card rail ($30/seat) | ARR per account |
|---|---|---|
| 1 | $30/mo | $360 |
| 5 | $150/mo | **$1,800** |
| 25 | $750/mo | **$9,000** |

A 5-seat account is **7× a Starter account**. $10M ARR then needs 5,556 five-seat accounts
instead of 39,141 singles. **This single fix is the difference between Deck A and Deck B.**

### 3b. Add a real tier ladder above Pro

Priced from the 0.20 DT/1M basis, margins hold:

| Tier | Tokens/mo | Cost | Price | Margin |
|---|---|---|---|---|
| Starter | 50M | 10.0 DT | 50 DT | 80.0% |
| Pro | 50M | 10.0 DT | 90 DT | 88.9% |
| **Team (5 seats)** | 250M | 50.0 DT | 300 DT | 83.3% |
| **Business (15 seats)** | 750M | 150.0 DT | 850 DT | 82.4% |

### 3c. Resolve the Pro inversion before quoting any per-model number

Pro currently gives **16.7M per model vs Starter's 25M** — a customer paying 1.8× more
hits a per-model wall sooner. Never put a per-model figure on a slide until this is fixed
(option: Pro = 50M *per alias*, 150M total, 67% floor). An investor who reads carefully
will find this in ten minutes.

---

## 4. Risks to state on slide 13 (and how to answer them)

| Risk | Severity | Mitigation to present |
|---|---|---|
| **Upstream ToS — resale** | **Critical** | `README.md:451` states Anthropic permits powering your own product (§A.1) but forbids resale without approval (§D.2), and your upstream is itself a reseller so you inherit it. **Get the written answer before fundraising.** Present it as "approval requested, here is the thread" — or as a private/team-use business, which needs no approval. |
| **Payment concentration** | High | D17 is the *only live* rail: one provider, manual human approval per payment, no webhooks, no merchant API. The Dodo (card) integration **is implemented and typechecks**, but `DODO_PAYMENTS_API_KEY` is unset in both `.env.example` files, so it is not confirmed live. Say "card rail implemented, pending production keys" — do not say "card billing is live" until you have processed a real payment. |
| **Single VPS** | Medium | One box, Docker Compose. Honest answer: deliberate, cost-driven, documented recovery via `make restore`. |
| **No card revenue** | Medium | D17 only. Means international customers **cannot pay you** — this is why the growth plan runs Tunisia-first. State it as sequencing, not a gap. |
| **Founder concentration** | Medium | Standard for pre-seed. Address with what is documented (this repo is unusually well-documented). |
| **Model dependency** | Medium | Multi-alias (Haiku/Sonnet/Opus/GPT-6) routes around any single vendor. |

---

## 5. Numbers appendix (use exactly these; they are computed)

**Unit economics — 0.20 DT per 1M tokens**

| Plan | Price | Cost at 100% burn | Margin @100% | Margin @25% |
|---|---|---|---|---|
| Starter | 50 DT | 10.0 DT | 80.0% | 95.0% |
| Pro | 90 DT | 10.0 DT | 88.9% | 97.2% |

**Fixed cost:** VPS $44 + upstream $30 = **$74 = 229.40 DT** at 3.10.
**Break-even:** 3.6 subscribers (blended, 25% use) — 4.1 if every customer maxes out.

**Scale (60/40 Starter/Pro, 25% burn)**

| Subscribers | Revenue | Token cost | Profit | Margin |
|---|---|---|---|---|
| 5 | 330 DT | 12 DT | 88 DT | 26.7% |
| 10 | 660 DT | 25 DT | 406 DT | 61.5% |
| 25 | 1,650 DT | 63 DT | 1,358 DT | 82.3% |
| 50 | 3,300 DT | 125 DT | 2,946 DT | 89.3% |
| 100 | 6,600 DT | 250 DT | 6,121 DT | 92.7% |

**LTV / CAC (at 25% burn, 63.50 DT contribution)**

| Monthly churn | LTV | Max CAC @3:1 | Payback @100 DT CAC |
|---|---|---|---|
| 5% | 1,270 DT ($410) | 423 DT ($137) | 1.6 mo |
| 8% | 794 DT ($256) | 265 DT ($85) | 1.6 mo |
| 12% | 529 DT ($171) | 176 DT ($57) | 1.6 mo |

**Supply:** 100 DT buys 500M tokens → serves 10 subscribers at **full** burn, or ~40 at
realistic use, for a month. This is the working-capital advantage: you are prepaid.

**Market (cited, bottom-up — do not invent a top-down TAM)**
- Tunisia ~30,000 developers (GitHub 2021); 4,120 devs/million, highest in North Africa (Qhala/Qubit 2025)
- Maghreb (TN+MA+DZ) ~100,000; +Egypt ~220,000
- MENA AI market $166B by 2030 at 44.8% CAGR (Grand View Research) — cite as context, **never** as your TAM

---

## 6. Production rules (so it looks professional)

- **16:9, 1920×1080.** One idea per slide. If a slide needs two points, it is two slides.
- **Max 40 words visible per slide.** The detail goes in speaker notes, not on the wall.
- **One typeface**, two weights. Numbers set large — the 80% margin should be the biggest
  object on slide 6.
- **No stock photography of robots, brains, or circuits.** Use real product screenshots
  (dashboard, quota meter, model picker) and one clean architecture diagram from the README.
- **Every number footnoted** with its source: repo file, or the citation above. Investors
  test one number; if it does not trace, the rest are discounted.
- **Build the appendix** (8–12 slides, skipped in the pitch): full scale table, the 0038
  migration rationale, cost-basis derivation, competitive audit detail. Send it after.
- **Rehearse to 10 minutes** for a 20-minute slot, leaving 10 for questions.

## 7. What NOT to put in the deck

- No "AI will change everything" market preamble. Your investor has read it.
- No fabricated TAM ("$166B addressable"). You address $3.8M today; say so.
- No claiming card billing is live. Dodo is implemented and typechecks, but no production
  key is configured — you have not processed a real card payment.
- No claiming the desktop app is GA without checking what actually ships. v1.1.5 is
  published from the separate `Louay0007/zaino-desktop` repo — verify the release and
  signing status before putting a download number on a slide.
- No per-model token figures until the Pro inversion is fixed.
- No revenue projection that ignores the payment-rail constraint: **customers outside
  Tunisia literally cannot pay you yet.** Every forecast must respect that.

## 8. Immediate next actions

1. **Pick Deck A or B** (§0). Everything downstream depends on it.
2. **Send the ToS resale request today.** It has the longest lead time and gates fundraising.
3. **Fix D17 seat billing** (§3a) — 1–2 days of work, and it is what makes Deck B possible at all.
4. **Fix the Pro inversion** (§3c) before any per-model number appears anywhere public.
5. Collect the 3 real metrics the deck is missing: paying customers, monthly churn, average
   tokens/user. Without these, slide 8 is a feature list, not traction.
6. Then build the 14 slides against this structure.
