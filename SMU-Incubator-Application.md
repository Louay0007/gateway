# SMU Incubator — 6th cohort application

**Form:** `forms.cloud.microsoft/.../responsepage.aspx?id=0rdWlef...`
**Deadline: 6 December 2026** (form states it; SMU news post 11 Nov 2026)
**Prepared:** 19 November 2026

All **43 questions** were read from the form's own definition
(`runtimeForms` payload, v1.0, modified 16 Nov 2026) — not guessed from the
landing page, which shows only the first four. Answers below are in form order.

---

## 0. Three blockers that stop submission

The form is required-field heavy and three required answers **do not exist yet**.
Everything else is ready.

| # | Field | Status |
|---|---|---|
| Q20 | **Founder presentation video** (public link) | ❌ does not exist. Explicitly required to be an authentic human on camera. AI assistance allowed, but a real person must present. |
| Q37 | **Product / prototype video** (public link) | ❌ does not exist as a hosted link |
| Q32 | **Pitch deck PDF** (public link) | ⚠️ file exists at `plans/deck/Zaino-AI-Investor-Deck.pdf`, but it must be uploaded somewhere public and the link pasted |

Also missing, and only you have them: **date of birth** (Q19), **LinkedIn URL**
(Q25), and confirmation of the **diploma level** (Q16) and **professional status**
(Q22) answers marked ⚠️ below.

---

## 1. Identity block

| Field | Answer |
|---|---|
| Full name (Q13) | Louay Rjili |
| Email (Q23) | `ceo-louayrjili@sohabi.app` |
| Phone (Q29) | +216 24 267 363 |
| LinkedIn (Q25) | ⚠️ **you must supply** |
| Date of birth (Q19) | ⚠️ **you must supply** |
| Nationality (Q24) | Tunisian |
| Founders (Q21) | 1 |
| Female founders (Q15) | 0 |
| Last diploma (Q16) | ⚠️ **Master or Engineering Degree (or in progress)** — ISSAT Mateur is an engineering cycle. Confirm this is the right bracket rather than Licence. |
| Professional status (Q22) | ⚠️ **Entrepreneur** — see note below |
| SMU affiliation (Q10) | **External Student (Non-SMU Student)** |

**On Q22 vs Q10.** You are genuinely both a final-year student and the founder.
Q10 already records the student status accurately, so Q22 as *Entrepreneur*
describes what you actually spend your time doing. If you would rather keep one
honest signal instead of two, answer *Student* and rely on Q10 — but do not answer
*Student* in Q22 while claiming full-time founder elsewhere in the form.

---

## 2. Startup block

| Field | Answer |
|---|---|
| Startup name (Q18) | Zaino AI |
| Startup stage (Q17) | **Prototype Stage (have a minimum viable product)** |
| Startup type (Q30) | A Technology startup |
| Industry (Q26) | **DeepTech** |
| Nationality of market (Q5) | Tunisia now; Algeria, Morocco and francophone Africa planned |
| Transaction model (Q9, max 3) | **B2B**, **B2C** |
| Technologies (Q43, max 3) | **AI & ML**, **Cloud Technologies** |
| Participated in accelerators (Q8) | No |
| If yes, name them (Q12) | *(leave blank — optional)* |
| Won an award (Q38) | No |
| Patents applied (Q42) | No |
| Official label status (Q14) | **Intend to apply for the Startup Label** |
| Target market (Q27) | Software developers, engineering teams and digital agencies in Tunisia and the Maghreb |
| How did you hear (Q1) | **Other → « SMU website (smu.tn news) »** |

**Why Prototype Stage and not Idea Stage.** The form's Idea bracket says
"no product, no revenues so far", and the product demonstrably exists — live site
returns 200, the API returns 401 because the auth wall refuses anonymous calls.
Prototype is the honest bracket and the stronger one.

**Why DeepTech and not something else.** The industry list has no software or SaaS
option. DeepTech is the closest truthful bracket for an AI infrastructure layer;
do not pick Marketplace or Consulting, both of which misdescribe the product.

**On Q14.** You do not hold a label and the pré-label window has not opened yet
(1–8 December). "Intend to apply" is accurate today. Do not select
"Currently applying" until you have actually filed.

---

## 3. Narrative answers

Written in English — the form, its questions and its options are all English.
**Do not paste French here.** Keep the numbers exactly as given; they were
re-verified on 19 Nov 2026.

### Q6 — The problem

> In Tunisia roughly 30,000 developers have no legal way to buy a frontier AI
> subscription. There is no internationally accepted payment card, no invoice
> issued in dinars, and no licensed local reseller. The gap filled itself with
> informal intermediaries: access resold through messaging groups, paid by
> transfer, with no recourse if the account disappears. The only other option is
> borrowing a colleague's credentials — which means sharing an identity and
> breaking a vendor's terms.
>
> The result is that a developer in Tunis works with a toolset two years behind a
> developer in Paris, and the gap compounds every quarter. This is not a talent
> problem. It is a payment-rails problem, and it is why the local market is served
> almost entirely by grey channels.

### Q31 — The solution

> Zaino AI is a metered subscription gateway. A developer pays in dinars through a
> Tunisian payment method and receives the same models their peers abroad use: a
> monthly token allowance, a usage dashboard, and an API key that works with the
> tooling they already have.
>
> The models are not mine. The way in is. Around them I built the layer that makes
> local resale viable: per-request quota enforcement that fails closed, one shared
> token pool with a daily sub-cap, a trilingual dashboard (FR/AR/EN), an admin
> console, and a desktop client with browser device login so a user never handles a
> raw key.
>
> Payments are local by design, not by workaround. D17 (La Poste's wallet) is the
> first rail because an unincorporated founder cannot open a merchant account. The
> payment layer is isolated behind a provider-agnostic interface that already
> carries two rails, so each additional Tunisian gateway is an added module rather
> than a product change.

### Q41 — How is it innovative

> The innovation is not inference. On this market the hard part is the layer
> around it: metering precisely enough that a customer can never consume more than
> they paid for, enforcing that quota on every single request and failing closed
> rather than open, billing in a currency that has no card rail, and doing all of
> it inside the rules.
>
> The mechanism is deliberately simple, because it has to hold under load. There is
> exactly one meter — blended tokens, summed across five ledger columns — and
> exactly one rule: allowed = entitled AND tokens_used < token_limit. Three
> independent jobs call the same shared window function, so they cannot drift.
> Critically, the dashboard and the enforcement path import that same window
> function: the number the customer sees and the number that blocks them are
> computed by one piece of code, so the dashboard cannot lie while the gateway
> cuts. The window is monthly with a daily sub-cap, which bounds the worst case to
> one day instead of one month.
>
> That invariant is the product. Compliance is not a constraint placed on top of
> it — it is the architecture.

### Q3 — Current progress (product, market, partners)

> **Product — built and running.** A multi-tenant API gateway enforcing quota on
> every request, failing closed. Architecture is two planes: a Next.js control
> plane (auth, organisations, API keys, usage dashboards, billing, staff admin
> console, built-in chat) and a data plane of Caddy → a custom auth-edge service →
> LiteLLM Proxy → Postgres/Redis on one VPS under Docker Compose.
>
> The edge is the security boundary: it swaps the customer's `zn-` key for the
> upstream credential, so the upstream secret never leaves the box. It rejects
> unknown model names, and rewrites upstream denials into a customer-readable,
> per-alias message. Four aliases are sold, never the upstream names.
>
> **Engineering evidence.** 1,130 automated tests passing across 73 files; clean
> type-check (`tsc --noEmit`, exit 0); 43 forward-only migrations, each carrying
> its reasoning and SQL guards that refuse to apply a broken invariant; 71 API
> routes and 41 pages. Verified by running the suite on 19 November 2026.
>
> **Payments — one live rail.** D17 is live: manual transfer, human-verified
> proof, which is the only rail available before a matricule fiscale. A card rail
> is implemented and type-checked but is in test mode, so no real money moves on it
> yet. The provider-agnostic billing interface already carries both, which proves
> the abstraction empirically rather than by design.
>
> **Market — no paying customers yet.** Pre-revenue and self-funded. The product is
> live and the trial is open; revenue is gated on incorporation and a merchant
> account, which is exactly what this incubation period and the concurrent
> incorporation are for. I would rather state that plainly than present a
> projection as traction.
>
> **Partners — none signed.** No reseller or integration agreements yet. I hold no
> upstream resale approval in writing, which is a known item on my own risk list,
> not something I would discover in diligence.

### Q4 — Growth potential, key indicators, success factors

> **Why it can grow.** The addressable population is bottom-up and modest:
> ~30,000 developers in Tunisia, ~100,000 across the Maghreb, ~220,000 including
> Egypt. At 15% payer conversion and ~66 DT blended ARPU that is a ceiling near
> 11.9M DT/year (~USD 3.8M ARR). I state it as a ceiling, not a stepping stone —
> it is precisely why per-seat pricing matters, and why the card rail is a growth
> feature rather than a convenience.
>
> **Indicators I will report against.** (1) paying accounts; (2) net revenue
> retention, which is the real test of whether the pool shape is right;
> (3) gross margin read from the admin ledger rather than modelled — the product
> already computes `grossMarginPct` from actual upstream spend and returns null
> when there is no revenue, so this cannot be flattered; (4) trial-to-paid
> conversion; (5) burn per paying account.
>
> **Key success factors, in order.** (1) Incorporation and a merchant account —
> without them the revenue path is a single manual rail. (2) Proving the true
> upstream cost basis from an actual invoice; every margin figure currently rests
> on an assumption, and I will not present one until it is receipted.
> (3) Fixing seat billing on the D17 rail — today a 25-seat team pays the same as
> one person, the single highest-leverage revenue fix available. (4) Written
> approval for resale, or a deliberate repositioning to private/team-internal
> tooling, which needs none.

### Q34 — Business model

> Two subscription tiers, billed monthly in dinars or in USD by card once that rail
> goes live.
>
> - **Starter — 50 DT/month:** 50M pooled tokens, a 3M daily cap, 3 keys,
>   `fast` and `smart` model classes.
> - **Pro — 90 DT/month:** the same 50M pool, an 8M daily cap, 15 keys, 25 seats,
>   `smart`, `frontier` and `fable`.
>
> A 3-day, 1M-token trial with no card required sits in front of both. Revenue is
> subscription, not usage-based — the pool is the product, and the meter exists to
> make an unmetered commitment safe to sell.
>
> The cost side is bulk upstream capacity resold at a margin, plus ~$74/month of
> fixed infrastructure (one VPS and an upstream minimum), which puts break-even in
> the low single digits of subscribers at modest burn. The honest caveat: the
> per-token cost basis is still an assumption awaiting a real invoice, so I treat
> the margin figure as unproven rather than bankable.

> **Two things never to say in this form:** do not quote an 80–89% gross margin
> (unsupported — the repo holds four mutually exclusive cost bases), and do not say
> card payments are live (they are in `test_mode`).

### Q33 — Growth strategy, next 3 years, in numbers

> Targets, all contingent on incorporation and the card rail:
>
> - **2027 — 150 paying accounts.** Tunisia only. Seat billing fixed on the D17
>   rail, then the card rail live with one real end-to-end payment. This is the
>   year the product stops being a single-rail business.
> - **2028 — 600 paying accounts**, with roughly a third of revenue from multi-seat
>   team accounts rather than single seats. Algeria and Morocco entered through
>   francophone channels; the dashboard is already trilingual.
> - **2029 — 1,800 paying accounts**, with enterprise/agency contracts as the
>   margin driver and a share of revenue outside the Maghreb.
>
> The arithmetic that governs this: at single-seat pricing, USD 10M ARR would need
> ~39,000 accounts against a ~15,000-payer population, which is not achievable. At
> five-seat card pricing it needs ~5,500 accounts, which is. So the plan is
> deliberately seat-weighted, not seat-agnostic.

### Q11 — Competitors, and who I fear most

> **Direct benchmarks.** (1) The upstream providers themselves, wherever a
> developer can reach them directly — they are the default, and the entire product
> exists because most local developers cannot. (2) Informal resellers operating
> through Facebook and Telegram groups: cheap, instant, no invoice, no recourse,
> and they will undercut any legal price because they carry none of the cost of
> being legal. (3) Regional MENA resellers accepting local payment methods, who
> already serve the wider Arabic-speaking market and could move into the Maghreb.
> (4) Adjacent developer platforms and cloud providers that bundle model access
> into a broader subscription.
>
> **Who I fear most.** Not the grey resellers — they compete on price and lose on
> recourse the moment a customer needs an invoice. The real threat is the upstream
> provider localising: a direct dinar billing arrangement with a local partner, or
> a telco or payment aggregator bundling model access. That would remove the reason
> the product exists in a single move.
>
> The defensible answer is not the models, it is the local operating layer —
> metering, enforcement, invoicing and support in the customer's language and
> currency — plus the switching cost once a team's keys, dashboards and usage
> history live here.

### Q35 — Founding team

> **Louay Rjili — founder.** Final-year engineering student at ISSAT Mateur, and a
> working developer rather than a first-time builder with an idea. I have been paid
> to build LLM pipelines professionally at Neediditals, and I am CTO of Chabaqa.io,
> where I took the company through the Tunisian Startup Act process and secured its
> label — so the regulatory path this business depends on is one I have already
> completed once.
>
> I built Zaino alone and end to end: architecture, the auth edge and key exchange,
> the quota meter and its enforcement path, two payment rails, the trilingual
> dashboard, the admin console, the desktop client, and the 1,130-test suite that
> guards them. There is one founder and no co-founder — that is the honest
> structure, and it is the main reason a mentor network and a hiring pipeline are
> the two things I most want from this programme.

### Q36 — Users today, and the 3-year projection

> **Today: no paying users.** Pre-revenue, with the product live and a free trial
> open. I am stating zero rather than counting trial signups as users, because the
> two are not the same thing.
>
> Projection: **150 paying accounts in 2027, 600 in 2028, 1,800 in 2029.** These
> assume incorporation completes, a merchant account is opened, seat billing is
> fixed on the D17 rail and the card rail goes live — each of which is a
> prerequisite, not a hope.

> Replace the first line only with real numbers if you have trial signups, and only
> if you separate "trial accounts" from "paying accounts" in the same sentence.

---

## 4. Rankings

### Q28 — Services, most needed → least needed

SMU's list has no funding line, so rank by what actually unblocks revenue:

1. Introduction to Clients B2B
2. Networking
3. Support in Product Development
4. Access to Talents for recruitment, R&D & Freelancing
5. Visibility on Social Media & Mass Media
6. Work Space for you & your team
7. Finding a Co-Founder

Work space ranks low deliberately: you already operate from Rades Meliane and the
product runs on a VPS, so co-working is a nice-to-have rather than an unblocker.
Saying so is more credible than ranking everything as critical.

### Q39 — Workshops, most critical → least

The funding option carries its own warning — *"choose this only if you at least
have a running product and few paying clients"*. You have the running product but
zero paying clients, so rank it third rather than first:

1. Marketing & Sales (Growth Hacking, Sales Automation…)
2. Legal Framework & Compliance (Startup Label, Intellectual Property…)
3. Funding & Investment Readiness
4. Product & Technology (Design Thinking & Agile, AI…)
5. Operations & Management
6. Leadership & Self-Development

Legal ranks second because it is where your real risk sits: resale terms and the
pré-label structure declaration.

---

## 5. Q7 — Why Zaino is a fit for SMU

Choose: **Industry Alignment — our industry focus directly aligns with one of SMU's
publicly recognized centers of excellence (e.g., Finance, Data Analytics, AI,
HealthTech).**

This is the only option that is true without overclaiming. You are an AI
infrastructure company, which matches a stated SMU centre of excellence; you are
not hiring SMU interns at scale yet (Talent Pipeline), you do not need lab access
(Resource Leverage, Physical Resources), and framing a paid gateway as social
mission would be a stretch.

If you would rather lead with people than positioning, *Talent Pipeline & Research*
is defensible — but only say it if you would genuinely take an intern in the coming
cohort.

---

## 6. The three videos and the deck — what is still missing

### Q20 — Founder presentation video (required, human on camera)

Does not exist. Record it; do not generate it. The form explicitly requires an
authentic human presentation and permits AI assistance only in editing.

**60–90 seconds, one take, phone camera, no music:**

1. **Who you are (10s).** Name, ISSAT Mateur, what you build.
2. **The problem (20s).** One concrete scene: you could not buy the tools you
   needed, not for lack of money — for lack of a card and an invoice.
3. **What you built (25s).** The meter, the fail-closed enforcement, the local
   payment rail. Say the one invariant out loud: the dashboard and the gateway read
   the same function, so the number cannot disagree with the cut.
4. **Where it stands (15s).** Live, 1,130 tests, pre-revenue, incorporating.
5. **What you want from SMU (10s).** Named, specific: mentor network and a first
   B2B introduction.

Speak English. Do not read a script visibly — the form is screening for authenticity,
and a read script reads as one.

### Q37 — Product demo video (required)

Screen recording, 2–3 minutes, no voice-over needed if the flow is clear:
sign up → start the trial → create a key → make a call from a terminal → open the
dashboard and show usage incrementing → hit the daily cap and show the
customer-readable refusal. That last step is the whole pitch: it proves the wall
enforces rather than displays.

### Q32 — Pitch deck link (required)

`plans/deck/Zaino-AI-Investor-Deck.pdf` exists locally. Two things before linking
it:

- It was built on **13 Nov 2026** and its slide 10 still says **614 tests / 38
  migrations**. The real figures are **1,130 / 43**. Rebuild before an SMU reviewer
  compares the deck to the form.
- The deck leads with a **150,000 DT ask and a $3.8M ARR ceiling**. For an
  incubator, that framing is wrong — they are selecting for coachability and fit,
  not for an investment round you are not raising here. A three-page PDF (problem,
  product, traction) would serve better than the investor deck.

### Public hosting

All three links must resolve without a login. A Google Drive folder with
"anyone with the link" is fine. `zaino.soon.it` is live (200) and
`api.zaino.soon.it/v1/models` correctly returns 401 — that is a feature, and worth
saying if asked.

---

## 7. Before you press submit

- [ ] Record the founder video (Q20) — the only hard blocker
- [ ] Record the product demo (Q37)
- [ ] Rebuild or replace the deck, then upload (Q32)
- [ ] Supply date of birth (Q19) and LinkedIn (Q25)
- [ ] Confirm the diploma bracket (Q16) and professional status (Q22)
- [ ] Decide whether to quote any user numbers at all in Q36 — zero is the honest
      and defensible answer
- [ ] Keep the numbers identical everywhere: **1,130 tests, 73 files, 43
      migrations, 71 API routes, 41 pages, tsc clean** (re-verified 19 Nov 2026)

**One consistency rule.** `Tunisia-Contacts-Verified.md` and older drafts still
quote 641 tests. If anything you send to SMU says 641 while the form says 1,130,
that is the cheapest diligence in the world and it finds the mismatch. One number,
one source.

---

## 8. Calendar

| When | What |
|---|---|
| By 26 Nov | Record both videos; fix and upload the deck |
| By 30 Nov | Submit the SMU form — do not leave it to 6 Dec |
| 1–8 Dec | Startup Act pré-label window (separate filing, `STARTUP-ACT-CONTEXT.md`) |

Submitting SMU early matters: reviewers typically read in arrival order, and the
6 December deadline is also the day the pré-label week begins.
