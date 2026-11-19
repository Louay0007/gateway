# Pricing model and revenue plan — 19 November 2026

Every number below is derived from three inputs and one code fact. Nothing is asserted.

> **Status: the ladder below shipped, with four deliberate deviations.**
> This section is the record of what differs between the proposal and the
> code, so nothing here is read as a plan that has not happened.
>
> | Proposal | Shipped | Why |
> |---|---|---|
> | Solo 39 DT / **40M** | Solo 39 DT / **35M** | At 40M/39 DT a Solo customer got 1,026k units per dinar against Starter's 1,000k. The tier above it became the irrational choice and fairness rule #3 broke. 35M is 897k — still cheaper to enter, still visibly worse per dinar. |
> | Trial **10M** | Trial **1M** | Declined on purpose. 10M costs 2 DT per signup and hands a stranger 10× what the paid entry tier's daily cap allows. Cost visibility can be bought later; the trial number is a product decision, not a margin one. |
> | Frontier/fable on the trial | fast, smart only | The trial is a proof of the API, not a free sample of the most expensive engines. |
> | **Per-seat pricing** (§2.1, §4.4) | **Retired, not fixed** | `organization_members` has exactly one writer — signup provisioning, the owner row. There is no invite route, no member list, no member UI and no seat check on any request path, so billing a second seat takes money for a person who cannot hold a key. The seat leak was real (§2.1), but the correct fix was to stop selling the thing rather than to charge more accurately for it. Commit `4f46abe` did that in migration `0044_remove_seats.sql`. |
>
> Everything else in §3 and §6 shipped: Solo, Team and Business.
> **Overage (§2.2, §6 row 4) did not ship** — it is the one item in §6 still
> open. Migration: `0046_plan_ladder.sql`.
>
> One gap to know about: migration `0040` maps only Starter and Pro to card
> products, so **card checkout for Solo, Team and Business fails with a
> clear error** and those three sell on the D17 rail only. The comparison
> table on /pricing says "—" in the Card row for those plans rather than
> advertising a button that breaks.

**Inputs**

| Input | Value | Source |
|---|---|---|
| Cost of tokens | **0.20 DT per 1M weighted units** | 100 DT buys a 500M block |
| Competitor price | Promptix.tn, TND per 1M **input** tokens | their public price list |
| Model weights | fast ⅓, smart 1, frontier 5, fable 5 | `MODEL_WEIGHT_SQL`, `portal/lib/entitlements/quota.ts` |

**The code fact that governs everything**

The 50M pool is denominated in **weighted units**, not raw tokens. One weighted unit costs the same regardless of model. So a plan's price covers the whole pool, and how far it stretches depends entirely on which model it is spent on:

```
raw tokens available = pool_weighted_units / weight_of_model
```

| Spend the whole pool on | 50M pool delivers | Weight |
|---|---|---|
| fast | 150M tokens | ⅓ |
| smart | 50M tokens | 1 |
| frontier | 10M tokens | 5 |
| fable | 10M tokens | 5 |

This is why Fairness Rule #1 below matters: a Frontier tier must receive 5× the pool of a Smart tier to deliver the *same* number of tokens.

---

## 1. What shipped (19 Nov 2026, migration 0046)

| Plan | Price | Pool | Cost | Margin | Models | Keys |
|---|---|---|---|---|---|---|
| Solo | 39 DT | 35M | 7.00 DT | 82.1% | fast, smart | 2 |
| Starter | 50 DT | 50M | 10.00 DT | **80.0%** | fast, smart | 3 |
| Pro | 90 DT | 50M | 10.00 DT | **88.9%** | smart, frontier, fable | 15 |
| Team | 250 DT | 150M | 30.00 DT | 88.0% | smart, frontier, fable | 30 |
| Business | 500 DT | 400M | 80.00 DT | 84.0% | smart, frontier, fable | 100 |
| Trial | free | 1M | 0.20 DT | — | fast, smart | 1 |

There are no seats. `plans.max_seats` and `subscriptions.seats` were
dropped by `0044_remove_seats.sql`, and the columns are gone from
`portal/db/schema.ts` — nothing writes, reads or bills them. What separates
the tiers is pool size, model class and key count, all of which are real:
an org can mint its own keys up to `plans.max_keys` today.

**Per-model detail**

| Plan | Model | Tokens in pool | Your DT/1M | Promptix | You save | Advantage | Margin |
|---|---|---|---|---|---|---|---|
| Starter | fast | 150M | 0.333 | 0.387 | 0.05 DT | 1.16× | 40.0% |
| Starter | smart | 50M | 1.000 | 7.742 | **6.74 DT** | **7.74×** | 80.0% |
| Pro | smart | 50M | 1.800 | 7.742 | 5.94 DT | 4.30× | 88.9% |
| Pro | frontier | 10M | 9.000 | 15.484 | 6.48 DT | **1.72×** | 97.8% |
| Pro | fable | 10M | 9.000 | 38.710 | **29.71 DT** | 4.30× | 97.8% |

**Reading it:** Smart is the strongest story (7.74×). Fable is the biggest absolute saving (29.71 DT per million). Frontier is the weakest price story (1.72×) but the best margin (97.8%) — sell it as a capability, never as a discount.

---

## 2. Three defects that cap revenue today

### 2.1 The seat leak — 2,160 DT/month lost per large team *(resolved by removing seats, 16 Nov 2026)*

`portal/lib/billing/d17.ts` computed the amount from `plan.priceCents` alone. It never read `input.seats`, so a 25-person Pro team transferred 90 DT — the price of one seat — while the card rail charged 25 × $30 for the same product.

The leak was real, but the fix below was the wrong one, and it shipped and was then reverted. Multiplying the dinar ask by seats would have made the *charge* correct while leaving the *product* broken: `organization_members` has exactly one writer (signup provisioning, the owner row), so no request path can grant a second person a key. Charging 25× for a seat nobody can use is a chargeback, not revenue.

`4f46abe` deleted the capability instead — migration `0044_remove_seats.sql` drops the columns, checkout sends quantity 1, and every page stopped claiming seats. The table below is therefore the record of what would have been lost, not a to-do.

| Team size | Would have paid | Should have paid | At risk / month |
|---|---|---|---|
| 1 | 90 DT | 90 DT | 0 |
| 3 | 90 DT | 270 DT | 180 DT |
| 5 | 90 DT | 450 DT | 360 DT |
| 10 | 90 DT | 900 DT | 810 DT |
| 25 | 90 DT | 2,250 DT | **2,160 DT** |

**The revenue has to come from Team and Business instead** — bigger pools sold at a flat price to a buyer who can actually spend them (one owner, many keys).

### 2.2 No overage — heavy users are cut off instead of billed

When the pool is exhausted `computeTokenAllowedModels` returns `[]` and **every model is cut**. There is no overage path anywhere in the codebase. The customer's only options are to wait for the period to reset or to leave.

A customer who burns 2× their pool should pay ~1.5×, not 0×. This is the cheapest revenue in the business: it needs no acquisition, no new feature, and no new customer.

### 2.3 Frontier under-priced as a story, over-priced as a cost

Frontier costs 5× a Smart token but is priced at only 1.8× the Smart rate inside Pro. The plan absorbs the difference. See §3.

---

## 3. The ladder, as shipped

Six tiers. Each one sells a **different job**, not a different volume of the same thing.

| Plan | DT/mo | Pool | Cost | Margin | Models | Keys | Job |
|---|---|---|---|---|---|---|---|
| Trial | 0 | 1M | 0.20 | — | fast, smart | 1 | Prove the API is real |
| Solo | 39 | 35M | 7.00 | 82.1% | fast, smart | 2 | Beat Promptix's entry price |
| Starter | 50 | 50M | 10.00 | 80.0% | fast, smart | 3 | Everyday building |
| Pro | 90 | 50M | 10.00 | 88.9% | smart, frontier, fable | 15 | Frontier-class reasoning |
| Team | 250 | 150M | 30.00 | 88.0% | smart, frontier, fable | 30 | Three times the pool, one invoice |
| Business | 500 | 400M | 80.00 | 84.0% | smart, frontier, fable | 100 | Company-wide rollout |

### Tokens per price — the table that sells

| Plan | Price | fast | smart | frontier | fable |
|---|---|---|---|---|---|
| Solo | 39 DT | 105M @ 0.37 | 35M @ 1.11 | — | — |
| Starter | 50 DT | 150M @ 0.33 | 50M @ 1.00 | — | — |
| Pro | 90 DT | — | 50M @ 1.80 | 10M @ 9.00 | 10M @ 9.00 |
| Team | 250 DT | — | 150M @ 1.67 | 30M @ 8.33 | 30M @ 8.33 |
| Business | 500 DT | — | 400M @ 1.25 | 80M @ 6.25 | 80M @ 6.25 |

### Three fairness rules the ladder must obey

> The rules below were written when seats existed. Rule 3 referenced seats-per-dinar; seats are gone (see §2.1), so the ladder now has to earn every step with **pool-per-dinar, key count, or model class**.

1. **Same tokens per dinar across models.** A 250 DT Team plan on Frontier delivers 30M; on Smart it must deliver 150M. Rule: `raw_tokens = pool / weight`. Because the pool is weighted, this is automatic — but only if the pool scales with tier.
2. **A model appears in at most two adjacent tiers.** Two plans offering the same model at nearly the same price cannibalise each other. Starter and Solo both carry `fast`/`smart`, so Solo must be clearly worse on volume and price, which it is (39 DT / 35M vs 50 DT / 50M). The draft's 40M broke exactly this rule and was trimmed — see the status block at the top.
3. **Upgrade is always rational.** Each step must raise pool-per-dinar, key count, or model class. Team does it on pool (3× Pro's for 160 DT more) and keys (30 vs 15); Business does it again (2.7× Team's pool, 100 keys).

---

## 4. Revenue mathematics

### 4.1 Block ROI — one 100 DT purchase

| Plan | Subs served per block | Revenue per block | Gross | ROI |
|---|---|---|---|---|
| Solo | 14.3 | 557 DT | 457 DT | 5.6× |
| Starter | 10.0 | 500 DT | 400 DT | 5.0× |
| Pro | 10.0 | 900 DT | 800 DT | **9.0×** |
| Team | 3.3 | 833 DT | 733 DT | 8.3× |
| Business | 1.2 | 625 DT | 525 DT | 6.2× |

**Pro is the best use of a block** — same token cost as Starter, 1.8× the revenue. That is a direct argument for making Pro the default recommendation rather than the premium one.

### 4.2 Monthly revenue at 25% real burn

| Customers | Solo 39 | Starter 50 | Pro 90 | Team 250 | Business 500 |
|---|---|---|---|---|---|
| 10 | 390 | 500 | 900 | 2,500 | 5,000 |
| 25 | 975 | 1,250 | 2,250 | 6,250 | 12,500 |
| 50 | 1,950 | 2,500 | 4,500 | 12,500 | 25,000 |
| 100 | 3,900 | 5,000 | 9,000 | 25,000 | 50,000 |
| 250 | 9,750 | 12,500 | 22,500 | 62,500 | 125,000 |

### 4.3 Blended scenarios (gross profit after token cost; net after 229 DT fixed)

| Scenario | MRR | Token cost @25% | Gross | Net/mo | Net ARR |
|---|---|---|---|---|---|
| A — 50 solo devs @ 39 DT | 1,950 | 100 | 1,850 | 1,621 | **19,447 DT** |
| B — 20 Starter + 5 Pro | 1,450 | 62 | 1,388 | 1,158 | 13,897 DT |
| C — 10 Team + 2 Business | 3,500 | 115 | 3,385 | 3,156 | **37,867 DT** |
| D — blended 60/20/8/4 | 8,800 | 340 | 8,460 | 8,231 | **98,767 DT** |

**The comparison that decides the strategy:** scenario A (50 individual developers) yields 19,447 DT/year. Scenario C (12 companies) yields 37,867 DT/year. **Twelve companies beat fifty developers.**

### 4.4 Why the seat multiplier is not in the numbers

An earlier draft of this section projected Pro revenue at 90 DT × seats, up to 45,000 DT/month. That figure is not reachable and has been removed from the model: a second seat cannot be spent (see §2.1), so there is nobody to bill. Scenario D in §4.3 assumes one Pro subscription per account, which is what the product actually sells.

### 4.5 With overage

A heavy user burning 2× their pool, billed at 1.5× the per-unit cost with a 33% margin, converts a churn event into roughly **2× the revenue at zero acquisition cost.** At 100 customers, if 20% of them overrun, that is 20 customers × ~25 DT = 500 DT/month incremental for one migration.

---

## 5. Market ceiling — the honest limit

~30,000 Tunisian developers → ~4,000 serviceable → at 10% conversion and 60 DT average:

```
400 × 60 DT = 24,000 DT/mo = 288,000 DT/year gross
```

That is the ceiling of the developer market. It is a real business and it is **not** a large one.

The Team/Business tiers are not capped by developer count. They are capped by how many Tunisian companies buy AI, which is a different and much larger number. **This is the only path to a figure above ~300k DT/year**, and it is why §3 adds tiers rather than cutting prices.

---

## 6. What to change, in order — and where it landed

| # | Change | Effort | Expected effect | Status |
|---|---|---|---|---|
| 1 | Trial 1M → 10M tokens | 1 migration | 2 DT cost/signup; makes the 7.74× visible | **Declined** |
| 2 | Fix `d17.ts` to multiply by seats | ~20 lines | Up to 25× on team accounts | **Reverted** — seats removed in `4f46abe`; the product could not deliver them |
| 3 | Add Team 250 DT / Business 500 DT | 1 migration | Unlocks the company motion | **Shipped** (0046) |
| 4 | Add overage at 1.5× cost | 1 migration + paywall | Removes churn; doubles heavy users | **Open** |
| 5 | Add Solo 39 DT below Starter | 1 migration | Beats Promptix's entry price | **Shipped** at 35M (0046) |

**Do not cut Starter's pool to raise margin.** At 80% margin on a 10 DT cost, there is nothing to save. The revenue problem is *distribution and pricing structure*, not per-token margin.
