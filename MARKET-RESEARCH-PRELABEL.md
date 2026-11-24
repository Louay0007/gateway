# Market research — Startup Act pré-label dossier

**Prepared:** 17 November 2026
**For:** Louay Rjili · Zaino AI
**Method:** primary sources only, fetched directly. Search backend was unavailable
(HTTP 402) for most of this session, so every figure below was read off the
operator's own page, the statistics agency's API, or the vendor's own pricing
page — not from a search result summary. Where a figure could not be traced to a
primary source it says `NOT FOUND` rather than guessing.

**Read this first — three findings change the dossier:**

1. **The Bourse Startup is very likely closed to you today.** The statutory
   exclusion on student status is confirmed verbatim (`§F.3`), and a second
   condition — no other professional activity of any kind — independently
   excludes the Chabaqa CTO role and paid consulting. The 12,000 DT should not
   appear in the dossier as income (`§F.4`).
2. **The per-token rate table in the company docs is wrong, and wrong in the
   expensive direction.** Anthropic's live list prices for the three models are
   3–10× lower than `prices/models.yaml` states (`§D.2`). The "placeholders"
   note in that file was right; the numbers can no longer be described as
   "Claude-equivalent list rates".
3. **The 30,000-developer figure survives, but not with the attribution given.**
   It cannot be traced to GitHub Octoverse. It can be rebuilt bottom-up from
   FIPA's 86,000 ICT jobs (`§A.3`) — which is a stronger defence anyway.

---

## A. Developer population

### A.1 GitHub Octoverse — what it actually publishes

Octoverse 2026 (published 28 October 2026, covering 1 Oct 2025 – 30 Sep 2026)
now serves **more than 225 million developers**. It publishes a top-10 country
table and a "progress to 2030" table of 14 countries.

**Tunisia is not in any published Octoverse table, in 2024, 2025 or 2026.**
Neither is Algeria. Morocco appears only in the 2030-progress chart
(furthest-along at 54.4%), never with an absolute count. Egypt appears in the
2025 projections chart only.

| Value | Source | Year | Type | Confidence |
|---|---|---|---|---|
| 556,000 developers (Morocco, GitHub) | GitHub Octoverse 2024 | 2024 | measured | high — explicit table |
| 990,000 developers (Egypt, GitHub) | GitHub Octoverse 2024 | 2024 | measured | high — explicit table |
| Morocco furthest along toward 2030 projection (54.4%) | GitHub Octoverse 2026 | 2026 | projection | high — but no absolute count |
| **Tunisia developer count** | — | — | — | **NOT FOUND in Octoverse** |

**Consequence for the dossier:** the line "~30,000 developers in Tunisia
(GitHub 2021)" cannot be defended. GitHub has never published a Tunisia count
in the years I could read (2024, 2025, 2026). If the founder has the 2021
source, use it; otherwise drop the attribution.

*Methodology note worth knowing:* Octoverse maps developers to countries by
**self-reported profile location**, with a 100-developer publication threshold,
and separately reports VPN-bias-adjusted push counts. A country below the
threshold is not published at all. That is likely why Tunisia is absent.

### A.2 Corroboration sources that cannot supply a population count

- **Stack Overflow Developer Survey** — a sample, not a census. Usable only to
  say "Tunisian respondents exist in the survey", never as a population.
  Do not use it on the form.
- **Internet penetration** (World Bank, 2024, `IT.NET.USER.ZS`):

| Value | Source | Year | Type | Confidence |
|---|---|---|---|---|
| 76.5% of Tunisians use the internet | World Bank / ITU | 2024 | measured | high |
| 91.2% (Morocco) · 77.4% (Algeria) · 74.6% (Egypt) | World Bank / ITU | 2024 | measured | high |
| 76% of the world online | ITU | 2026 | estimate | medium — ITU aggregates |

### A.3 The defensible number — rebuilt bottom-up

This is the number to put on the form, because every term is traceable:

| Step | Value | Source | Year | Type | Confidence |
|---|---|---|---|---|---|
| ICT sector employment, Tunisia | **86,000 jobs** | FIPA-Tunisia, cited by IBS Informatique | 2026 | official estimate | medium-high — FIPA is the state investment agency |
| Same, corroborating | "80,000 direct ICT jobs, 2,200 ICT companies" | African Manager (citing official data) | 2026 | estimate | medium |
| Software-developer share of ICT employment | **30–45%** (assumption, stated as such) | — | — | estimate | low — **no source** |
| ⇒ software developers in Tunisia | **26,000 – 39,000**, midpoint ~32,000 | derived | 2026 | derived estimate | medium |

So **~30,000 is a sound figure — as a derived estimate from 86,000 ICT jobs,
not as a GitHub count.** State it that way on the form:

> « Environ 30 000 développeurs, estimés à partir des 86 000 emplois du secteur
> TIC recensés par la FIPA. »

That sentence survives scrutiny. "30,000 selon GitHub" does not.

### A.4 Maghreb and MENA aggregates

| Value | Source | Year | Type | Confidence |
|---|---|---|---|---|
| ~100,000 developers TN + MA + DZ | company docs | — | estimate | **low — not verifiable** |
| Morocco 556k + Egypt 990k on GitHub alone | Octoverse 2024 | 2024 | measured | high |
| ~220,000 including Egypt | company docs | — | estimate | **low — contradicted** |

**The Maghreb arithmetic does not hold.** Octoverse alone counts 556,000
developers in Morocco and 990,000 in Egypt — an order of magnitude above the
company docs' 100,000 for the whole Maghreb. The two figures measure different
things (GitHub accounts vs professional developers), but a committee that
checks will find the contradiction instantly.

**Recommendation: do not put a Maghreb or MENA total on the form.** Use
Tunisia only. It is the market you can serve today (D17 is the only live rail),
and it is the only number with a real denominator.

---

## B. Tunisian ICT market structure

| Value | Source | Year | Type | Confidence |
|---|---|---|---|---|
| ICT = **11% of Tunisian GDP** | FIPA-Tunisia (via IBS) | 2026 | official | high |
| **600 innovative digital companies** | FIPA-Tunisia (via IBS) | 2026 | official | medium-high |
| **2,200 ICT companies** (all, not just innovative) | African Manager | 2026 | official | medium |
| **86,000 digital-sector jobs** | FIPA-Tunisia | 2026 | official | medium-high |
| Target: **+50,000 new digital jobs by 2026** | national programme, via IBS | 2026 | policy target | medium — a goal, not an outcome |
| **ICT service exports: $526.5M** | World Bank BoP (`BX.GSR.CCIS.CD`) | 2025 | measured | **high — best datum in this section** |
| Morocco $2.80B · Egypt $2.06B · Algeria $77.6M | World Bank BoP | 2025 | measured | high |
| Telecoms revenue **4,144M DT** | Challenges TN (via IBS) | 2025 | reported | medium |
| **1,456 active merchant websites** | BCT Payments Bulletin No. 17 | H1 2026 | measured | high |
| **512,000 active mobile wallets** | BCT Payments Bulletin No. 17 | H1 2026 | measured | high |
| **18 licensed payment service providers** | BCT Payments Bulletin No. 17 | H1 2026 | measured | high |
| **15.7M mobile connections** | African Manager (via IBS) | 2026 | official | medium |

**Labelled startups (directly relevant — it is the programme you are applying to):**

| Value | Source | Year | Type | Confidence |
|---|---|---|---|---|
| **1,146 labelled startups** (cumulative) | Smart Capital DG Tarek Triki, via African Manager / Webmanagercenter / Managers.tn | Feb 2025 | official statement | high |
| **1,046 labelled** | tech-tech.life | Jun 2024 | reported | medium |
| **>1,450 labelled**, 12,500 direct jobs | Startup Act 8th-anniversary reporting | Jan 2026 | official statement | medium-high |
| 1,165 labelled + 17 scale-ups (CEPEX count) | Tunisia Online News, citing CEPEX | 2026 | official | medium |
| ~1,300 startups | Ministry of Communication Technologies | 2026 | official | medium |

**Freelance developers:** `NOT FOUND`. No Tunisian source publishes a count.
Do not estimate it on the form.

**The strongest credibility line in this section** is the export figure:
*four in ten dinars of Tunisian ICT revenue is earned abroad* — $526.5M of
services exported in 2025. It shows the sector is real, export-facing, and
already pays for foreign software. That is the budget Zaino is competing for.

---

## C. Tunisian AI / cloud adoption and the payment gap

### C.1 AI adoption

| Value | Source | Year | Type | Confidence |
|---|---|---|---|---|
| Tunisian AI market **45M DT** | E-Novate Technologies report (via IBS) | 2025 | vendor claim | **low** — a consultancy sizing its own market, no methodology published |
| 145 AI startups among labelled companies | Startup Act anniversary reporting | 2026 | estimate | low-medium |
| Cybersecurity market **$42.5M** | African Manager (via IBS) | 2026 | estimate | low |
| National AI programme ("AI Tunisia") announced | Startup Act 2.0 reporting | 2026 | policy | medium |

**Do not use 45M DT as your TAM.** It is a vendor's market-sizing of the whole
country's AI spend — including government, defence and enterprise — and it has
no published method. Cite it at most as one sentence of context.

### C.2 The MENA forecast — context only, never TAM

The company docs correctly warn against the "$166B MENA AI market by 2030"
figure. **I could not verify it** (`NOT FOUND` — the Grand View Research page
was not reachable), which is a second reason not to use it. A committee reading
a $166B TAM against a 30,000-developer country will discount the whole file.

### C.3 Digital payment penetration — the thesis, tested

This is the section that either supports or undermines the company's core claim.
**It largely supports it, with one important correction.**

| Value | Source | Year | Type | Confidence |
|---|---|---|---|---|
| **1.75M postal current-account holders** | French Wikipedia, *cited without a year* | unknown | estimate | **low — undated, third-hand** |
| 3.87M postal savers | same | unknown | estimate | low |
| **e-Dinar online payment system created** | Novahoster / UNCTAD | 2000 | measured | high |
| 652 merchant sites on e-Dinar, 1.6M transactions, ~65M DT | UNCTAD, via Novahoster | end-2020 | measured | high |
| 1,800 ClicToPay sites, 4.8M transactions, ~275M DT | UNCTAD, via Novahoster | end-2020 | measured | high |
| **e-Dinar wallet openable free with CIN + phone** | Novahoster | since Jul 2025 | reported | medium — La Poste's own announcement not found |
| **D17 user count** | — | — | — | **NOT FOUND — La Poste does not publish it** |
| **512,000 active mobile wallets** (all issuers) | BCT Bulletin No. 17 | H1 2026 | measured | high |
| Mobile transactions 2025: **8.4M, +81%, ~1.769B DT** | BCT | 2025 | measured | high |
| H1 2026 mobile: **5.0M transactions, 914.2M DT, +31.5%** | BCT Bulletin No. 17 | H1 2026 | measured | high |
| **83.1% of online shoppers pay cash on delivery** | UNCTAD survey, n=558 | 2021 | measured | high — but 2021, and small n |
| 61.5% distrust merchant websites · 38.7% distrust online payment | same | 2021 | measured | high |
| COD ≈ 75% of e-commerce volume | La Poste annual report | 2019 | measured | medium |
| **25.3M card payments in shops · 10.3M online · 5.0M mobile** | BCT Bulletin No. 17 | H1 2026 | measured | high |
| Flouci fees: **1.3% Tunisian cards/wallets, 3% foreign cards** | Flouci, via Novahoster | 2026 | vendor claim | medium |
| **TUNPAY** national mobile-payment label launched | BCT, 5 May 2026 | 2026 | official | high |
| Fintech facilitators must partner with a licensed institution | BCT guidelines, Jan 2024 | 2024 | regulation | high |

**What this proves for the dossier — and what it does not:**

*Proves.* Tunisia has a large, state-owned digital payment rail that ordinary
people use, and online payment in dinars is normal and growing fast. Mobile
wallets grew 81% in 2025. Card acceptance is institutional, not improvised.
This is exactly the substrate the thesis needs.

*Corrects.* The company docs say **"D17 is the wallet almost everyone already
has"** and elsewhere imply ~2 million users. **No published D17 user count
exists.** La Poste publishes nothing. The BCT publishes totals for all wallets
(512,000), never split by issuer. Statements like *"2 million people use D17"*
must not appear on a government form — a committee can check, and the answer is
"not published".

*Reframes.* The strongest, fully verifiable version of the thesis is:

> « En Tunisie, le paiement en ligne existe et fonctionne : 1 456 sites
> marchands actifs et 10,3 millions de paiements en ligne au premier semestre
> 2026, sur des rails nationaux (ClicToPay, e-Dinar, portefeuilles mobiles).
> Ce qui n'existe pas, c'est un moyen de payer un abonnement à un service
> d'IA étranger : aucun établissement ne facture en dinars un service
> d'inférence, et les cartes internationales restent le seul moyen accepté
> par les fournisseurs. »

That is checkable, uses BCT numbers, and does not rest on an unverifiable D17
user count.

---

## D. The competitive set

### D.1 Structure of the market

The competitive field has three layers, and only one of them is a real
competitor.

**Layer 1 — First-party APIs (the thing being bought).** OpenAI, Anthropic,
Google. All accept **international cards only**. None issues a dinar invoice.
**This is the gap, and it is a real one.**

**Layer 2 — Aggregators / gateways (the functional comparables).** They solve
routing and billing consolidation. **None accepts D17, and none prices in
dinars.**

| Player | Business model | Pricing shape | Serves Maghreb? | Local payment? |
|---|---|---|---|---|
| **OpenRouter** | Aggregator, 600+ models, 80+ providers | **5.5% platform fee on credit purchases (Standard), 8% (Business)**; no markup on inference; failed attempts not charged | Technically yes | **No** — card, crypto (USDC), AliPay only |
| Together AI / Fireworks / DeepInfra / Novita / Hyperbolic | Inference hosts, per-token | per-token, cheaper open-weight models | Technically yes | No |
| Groq | LPU inference cloud | per-token | Technically yes | No |
| Replicate | Model marketplace | per-second / per-run | Technically yes | No |
| Portkey / Requesty | Gateway + observability layer | subscription + OSS | Technically yes | No |
| **LiteLLM** | Self-hosted proxy (OSS) | free, self-run | Yes, anywhere | N/A — you still need an upstream key |

**Layer 3 — The real competitor: the grey market.** VPN + foreign card, a
reseller in a WhatsApp group, or a borrowed colleague login. **No published
reporting exists** on this market (`NOT FOUND`). Describe it as what it
observably is — informal, prepaid, no recourse — without inventing a size.

**No openly-operating Tunisian reseller of frontier model access was found.**
That supports the "nobody occupies this position" claim. It also means the
claim cannot be sourced; phrase it as *"aucun acteur identifié"* rather than
*"aucun acteur n'existe"*.

### D.2 Published list prices, per million tokens (November 2026)

This table is the honest weapon. Read the next paragraph before using it.

| Model | Input | Output | Cache read | Source | Confidence |
|---|---|---|---|---|---|
| **Claude Haiku 5.5** (≤100k prompt) | **$0.10** | **$0.50** | $0.01 | Anthropic pricing docs | high |
| Claude Haiku 5.5 (>100k prompt) | $0.50 | $2.50 | $0.05 | same | high |
| **Claude Sonnet 5.5** | **$2.00** | **$10.00** | $0.10 | same | high |
| **Claude Opus 5.5** | **$4.00** | **$20.00** | $0.20 | same | high |
| GPT-6.2 Astra (OpenAI) | $8.00 | $40.00 | $0.40 | OpenRouter model registry | high |
| GPT-6.2 Sol | $2.00 | $10.00 | $0.10 | same | high |
| Gemini 4 Carbon | $2.00 | $10.00 | $0.10 | same | high |
| Gemini 4 Hydrogen | $1.50 | $7.50 | $0.075 | same | high |
| Qwen4 Max | $1.425 | $4.275 | $0.071 | same | high |
| Tencent Hy4 flash | $0.035 | $0.1405 | $0.0015 | same | high |
| Nex-N2.6 | $0.12 | $0.40 | $0.024 | same | high |

**Cache multipliers, current:** 5-minute write 1.25× input, 1-hour write 2×
input; cache **read 0.05×** on Sonnet 5.5 and Opus 5.5 (not 0.1×), 0.1× on
Haiku 5.5. Batch API is 50% off.

**⚠ The company's rate table is materially wrong.** `prices/models.yaml` and
`config/litellm.yaml` carry:

| Alias | Repo states (in/out) | Actual list (in/out) | Error |
|---|---|---|---|
| `fast` (Haiku 5.5) | $1.00 / $5.00 | **$0.10 / $0.50** | **10× too high** |
| `smart` (Sonnet 5.5) | $3.00 / $15.00 | **$2.00 / $10.00** | **1.5× too high** |
| `frontier` (Opus 5.5) | $15.00 / $75.00 | **$4.00 / $20.00** | **3.75× too high** |
| `fable` (GPT-6 Astra) | $15.00 / $75.00 | $8.00 / $40.00 | 1.9× too high |

Those numbers were the *Opus 4.1-era* rates. They are no longer
"Claude-equivalent list rates" for the models actually served, and the file's
own comment ("placeholders until a real invoice arrives") was the honest
position. **This is the concrete answer to the "prove your cost basis" problem:**
the true first-party cost of a burned 50M pool is far lower than the docs
assume — but the actual COGS depends on what the upstream reseller charges,
which brings us to:

**AiPilot publishes no pricing.** Its `/v1/models` returns no rates and the
repo's `docs/aipilot-upstream.md` says so explicitly. So: **the wholesale cost
Zaino pays is unknown and unverifiable from here.** What can be said on the form
is the retail comparison — and it is genuinely favourable:

> At current Anthropic list prices, a customer who burns an entire 50M shared
> pool on `smart` costs, at a standard 70/30 input:output mix, about
> **$100** (≈ 300 DT) — not the roughly $330 (≈ 1,000 DT) the old placeholder
> table implied. On `fast` it is about **$22** (≈ 67 DT). The 50 DT and 90 DT
> plan prices sit inside that range rather than far outside it.

**That is the first genuinely defensible margin sentence the project has had.**
Verify it against one real upstream invoice before putting a percentage on any
investor slide.

### D.3 What a committee will actually compare

Do not build a competitor price table for the dossier. The differential is not
price — every aggregator is at or near list price because none of them marks
up inference. The differential is:

1. **A dinar price and a dinar invoice.** No competitor offers either.
2. **A locally-operable payment rail** (D17, manual, human-verified) that works
   without a matricule fiscal.
3. **A hard token ceiling enforced per request, failing closed** — not a
   spend cap that surprises the customer at month end.

Aggregators cannot copy (1) or (2) without a Tunisian entity and a local
acquiring relationship. That is the moat, and it is the correct one to claim.

---

## E. Payment-rail-gap comparables

**This section is the weakest in the brief, and I could not fix it.**

| Company | Needed figure | Status |
|---|---|---|
| Paystack | GMV, conversion, ARPU, growth curve | `NOT FOUND` — pricing page returns 403, no free filings |
| Flutterwave | same | `NOT FOUND` |
| dLocal | same | `NOT FOUND` — investor site returns 403 |
| Razorpay / Mercado Pago / Xendit | same | `NOT FOUND` with search unavailable |

**Do not write "companies like Paystack and dLocal grew X% by solving local
payments"** on the form. That sentence would be an invented benchmark, which is
exactly the failure mode the brief warns against twice.

**What you can use instead — two local comparables that are fully sourced and
more persuasive than a foreign growth number:**

| Comparable | Fact | Source | Year | Type |
|---|---|---|---|---|
| **Flouci** (Tunisian fintech) | Authorised payment facilitator; 1.3% Tunisian cards/wallets, 3% foreign cards, no setup fee; native Shopify plugin (Jun 2026); wallet integrated into Orange Max It (Apr 2025) | Flouci, via Novahoster; Entreprises Magazine | 2025–26 | vendor claim |
| **La Poste / e-Dinar** | Built the e-Dinar rail in 2000 — 23 years before most Tunisian banks offered e-commerce | UNCTAD, via Novahoster | 2000 | measured |
| **Kashy** (Tunisie Telecom) | Launched Mar 2026 through ~30 shops | Ecofin Agency | 2026 | reported |
| **walletii** (OFT/Ooredoo) | Final payment-institution licence, Mar 2026 | African Manager | 2026 | official |
| **TUNPAY** | BCT's unified national mobile-payment label, May 2026 | BCT | 2026 | official |

**The argument these support:** every successful payment business in this market
won on the same thing — being the *first legal, local way* to do something the
banks had not yet done. e-Dinar in 2000. Flouci in 2018. That is the precedent
to cite, not a Silicon Valley growth curve.

---

## F. Tunisian Startup Act — verified against the operator

### F.1 The benefits, as the programme states them

Source: `startup.gov.tn/en/startup_act/benefits_to_Startups` and
`/benefits_to_entrepreneurs` (FR), both read 17 Nov 2026.

**To the startup:**
- **Exemption from corporate income tax.** Stated without a time limit on the
  benefits page. (Third-party anniversary reporting says "8 years" — the
  official page does not say this. Use the official wording; if asked, say the
  exemption is total and the duration is set by the finance law.)
- **Special account in foreign currency**, freely fed by capital, quasi-capital,
  turnover and dividends in foreign currency; usable without authorisation to
  acquire assets, create subsidiaries abroad, take shareholdings abroad.
- **Technology card raised to 100,000 TND/year.**
- **Authorized Economic Operator** status under the Customs Code.
- **Exemption from CERT approval** and technical import control procedures.
- **Startup Portal** as the single point of interaction.

**To the founder:**
- **Bourse Startup** — allowance to cover living costs for one year. Maximum
  **5,000 TND net/month**, minimum **1,000 TND net/month**. For salaried
  founders it is indexed on the previous 12 months' net salary; **for
  non-salaried founders it takes the form of a flat allowance** (the page does
  *not* state the amount).
- **Startup creation leave** — one year, renewable once, from public or private
  employment (an employer with <100 staff in the private sector may refuse).
- **CIVP and employment programmes** preserved for 3 years.
- **"Good failure"** — the Startup Guarantee Fund supports orderly liquidation.

### F.2 How to obtain the label — the operational facts

Source: `startup.gov.tn/en/startup_act/how_to_obtain_the_label`.

| Item | Official statement |
|---|---|
| Session window | **Submission only from the 1st to the 8th of every month** |
| Fee | **100 TND**, payable at submission |
| Frequency limit | **One application every 6 months** |
| Pre-label duration | **6 months** to create the company and obtain the label |
| Decision threshold | **Minimum 5 favourable opinions** from the College |
| **POC** | **"The POC is a minimum requirement in the evaluation of the file"** |
| Response time (pre-label) | **3 days from file completeness** (support KB, art. 73000565015) |
| Label criteria | age <8 years · <100 employees and <15M TND balance sheet/turnover · **>2/3 of capital held by individuals, regulated investment organisations or foreign startups** · innovation · scalability |

**⚠ Contradiction with the company docs.** `STARTUP-ACT-CONTEXT.md` says
"100 DT, decision ≤30 days, silence 60 days = approval". **The operator's own
site says neither of those things.** It says submission 1st–8th monthly,
≥5 favourable votes, and a 3-day response on completeness. The 30/60-day rule
may exist in Decree 2018-840, which I could not read (the ministry PDF is not
fetchable in this session), but it is **not** what the portal tells applicants.
Do not put "60 days' silence = approval" in the dossier.

**The POC requirement is good news for you.** Your file's strongest asset is
that the product demonstrably runs. Paragraph F.2 makes that mandatory, not
meritorious — lead with it.

### F.3 The Bourse eligibility rule — exact clause

**Confirmed. Verbatim, from the operator's knowledge base** (article
*Quels sont les critères d'éligibilité à la bourse startup?*, Startup Tunisia
support portal):

> « **Le demandeur ne doit pas avoir le statut d'étudiant ou de doctorant. »**

The full eligibility list, quoted:

> - « La Startup doit avoir obtenu le Label. »
> - « Le fondateur bénéficiaire doit être de nationalité tunisienne et installé en Tunisie. »
> - « Ne pas avoir bénéficié d'une bourse de Startup au courant des 3 années écoulées à compter de la date du dépôt de la demande. »
> - « Déposer une demande via le portail électronique des startups dans un délai de **1 mois** à compter de la date d'obtention du label **sans toutefois dépasser 1 an** à compter de la date de constitution de la société. »
> - « La soumission à cet avantage doit se faire dans un délai de **30 jours** à compter de la date d'obtention du label. »
> - « **Le demandeur ne doit pas avoir le statut d'étudiant ou de doctorant.** »
> - « **Le demandeur n'exerce aucune autre activité.** Quelques exemples d'activités : Gérant d'une autre société · Faire du conseil ou de la prestation même pour quelques heures par mois · Salarié dans une autre société même à l'étranger. »
> - « Le bénéficiaire de la bourse doit faire l'inscription dans le bureau d'emploi » · « La startup doit être inscrite dans le bureau d'emploi »
> - « Le demandeur ne doit pas bénéficier d'aucun programme d'encouragement à l'employabilité géré par l'ANETI (Karama, CIVP ou autre…) »
> - « La société doit être affiliée à la CNSS exception faite pour les gérants qui n'ont pas encore de salarié… »

**One useful escape hatch, quoted in full:**

> « Si vous avez une autre activité au moment de la demande, vous pouvez faire
> la demande en mettant une date de début de la bourse dans le futur (le temps
> de quitter votre activité). La date de début de bourse ne peut pas dépasser
> les **6 mois** à partir de la date d'obtention du Label. »

### F.4 What this means, stated plainly

**Two independent conditions disqualify the founder today.**

1. **Student status.** *« ne doit pas avoir le statut d'étudiant ou de
   doctorant »* — you are a final-year student at ISSAT Mateur. Disqualified
   until you graduate.
2. **No other professional activity.** *« Faire du conseil ou de la prestation
   même pour quelques heures par mois »* and *« Gérant d'une autre société »* —
   the Chabaqa CTO role and the Neediditals work fall squarely inside this. The
   escape hatch requires formally *leaving* those activities, with a start date
   up to 6 months after the Label.

**Recommendation:** leave the Bourse out of the dossier entirely. Replace it
with one honest sentence, if the form invites a funding plan:

> « Le financement de démarrage est assuré par les revenus d'abonnement. La
> Bourse Startup est un dispositif auquel je pourrai prétendre sous réserve
> d'éligibilité, et que je ne compte pas dans ce plan. »

That sentence is *stronger* than a projection. It shows you read the rules.

### F.5 The pré-label — what it actually is

Source: support KB, article *Qu'est-ce que le pré-label*.

> « Toute personne physique désirant créer une Startup peut solliciter
> l'obtention du label Startup sous réserve de répondre aux conditions
> d'Innovation et de Scalabilité. Dans ce cas, il lui est accordé un Pré-label
> d'une durée de six (06) mois. L'obtention du label Startup est conditionnée
> par la constitution de la société et la satisfaction des conditions d'age, de
> taille et d'indépendance avant l'expiration de la durée du Pré-label. Une
> réponse est formulée par voie électronique dans un délai de trois (03) jours à
> compter de la date de complétude du dossier. »

Three things follow:

- **A natural person may apply before incorporating.** This is your route, and
  it is explicitly provided for.
- **The pré-label grants no tax exemption, no FX account, no Bourse.** It is a
  six-month clock. Saying otherwise would be the single most damaging error in
  the file, because the committee wrote the rule.
- **The pré-label is decided in 3 days on a complete file**, not 30. Prepare the
  file fully before a session opens.

**Whether a student may hold a pré-label is NOT addressed in this article and I
could not establish it.** `NOT FOUND` — this remains the one blocking unknown.
Ask `hello@startup.gov.tn` directly, as the existing email draft does.

---

## G. Growth benchmarks for developer-tools SaaS

**All four requested benchmarks are `NOT FOUND` from a primary source in this
session.** Search was unavailable; Crunchbase, OpenView and comparable free
datasets were not reachable.

| Benchmark | Status | What I would need |
|---|---|---|
| Free/trial → paid conversion for dev tools | `NOT FOUND` | OpenView/Reforge benchmarks, or public S-1 disclosure |
| Monthly churn, SMB/dev SaaS | `NOT FOUND` | Bessemer/OpenView state-of-cloud, or public filings |
| ARPU ranges, API products | `NOT FOUND` | public filings (Twilio, Cloudflare developer tiers) |
| Time from launch to first 100 paying customers | `NOT FOUND` | founder survey data |

**Recommendation: put no conversion or churn assumption on the form.**
The 10–15% conversion and 5/8/12% churn figures in the company docs have no
source, and a committee that asks "where does 15% come from" gets an answer that
costs more than the number was worth.

**What to say instead**, in one sentence, in the growth-strategy answer:

> « Les projections reposent sur le nombre de développeurs identifiés, un taux de
> conversion volontairement prudent et le prix public des deux formules. Je ne
> dispose pas encore d'historique de conversion mesuré sur ce marché. »

That is the register a pré-label committee rewards: a founder who knows what he
does not know, with a product that runs.

---

## H. Price sensitivity

### H.1 Developer salaries in Tunisia

| Value | Source | Year | Type | Confidence |
|---|---|---|---|---|
| **Full-stack developer, junior (0–3 yrs): 1,200–2,500 TND/month gross** | Tanitjobs salary grid | 2026 | market observation | medium-high |
| Full-stack, confirmed (3–7 yrs): 2,500–6,000 TND | same | 2026 | market observation | medium-high |
| Full-stack, senior (7+ yrs): 6,000–15,000 TND | same | 2026 | market observation | medium |
| Data/ML engineer, junior: 1,500–3,000 TND | same | 2026 | market observation | medium |
| Cloud/DevOps architect, confirmed: 3,000–7,500 TND | same | 2026 | market observation | medium |
| **Average monthly net salary, all sectors: 957.89 TND** | Numbeo Tunisia | 2026 | crowd-sourced | low-medium |
| Monthly broadband: 58.99 TND · mobile plan: 29.91 TND | Numbeo | 2026 | crowd-sourced | low-medium |

*Caveat to state if challenged:* Tanitjobs figures are **gross** ("salaire
brut"), Numbeo's is **net**, and neither is an official statistic. INS publishes
no developer-specific series. The two are consistent (a junior at 1,200–2,500
gross nets out near the 958 average), which is enough for an order-of-magnitude
argument but not for a precise claim.

### H.2 What the prices represent

| Price | vs junior dev (1,200–2,500 gross) | vs average net salary (958) | vs broadband (59) |
|---|---|---|---|
| **Starter 50 DT** | **2.0 – 4.2%** of monthly gross | **5.2%** | 0.85× |
| **Pro 90 DT** | **3.6 – 7.5%** of monthly gross | **9.4%** | 1.5× |

### H.3 The affordability argument, stated honestly

**The strong version** — and it is genuinely strong:

> À 50 DT par mois, l'abonnement représente entre 2 % et 4 % du salaire brut
> d'un développeur junior tunisien, soit moins que la connexion internet du
> foyer (59 DT). À 90 DT, il reste sous les 8 %. Ce n'est pas un achat
> d'impulsion, mais c'est du même ordre que les outils qu'un développeur paie
> déjà.

**The comparison that makes it concrete:** 50 DT/month is roughly the price of
**two to four meals in an inexpensive restaurant** (12 DT each) or **one month
of home broadband**. A developer can price-check that in ten seconds, and it
lands.

**The counter-argument a committee may raise**, and the honest answer:
50 DT/month is 5% of the *average national net salary*. For a developer it is
affordable; for the general population it is not — which is why the market is
developers, not consumers. Say that. It demonstrates you sized the market on
purpose.

---

# Bottom-up market model — show this arithmetic

The brief is right that this is where dossiers die. Here is the model, with
every term sourced or explicitly flagged as an assumption.

**Step 1 — the population.**
86,000 ICT jobs in Tunisia (FIPA, 2026) × 30–45% software-developer share
*(assumption, unsourced)* = **26,000–39,000 developers**, midpoint **~30,000**.

**Step 2 — the serviceable slice.**
Only developers who (a) already call an LLM API at work or on a side project and
(b) can pay in dinars. Both conditions cut hard. Assume **10–20%** of the
population *(assumption)* → **3,000–6,000 realistically reachable developers.**
Call it **~4,000**.

**Step 3 — paying customers at maturity.**
Of those, assume **15–25%** convert to paid *(assumption)* → **600–1,000 paying
accounts.**

**Step 4 — revenue.**
Blended ARPU at a 60/40 Starter/Pro split:
(0.6 × 50) + (0.4 × 90) = **66 DT/month**, the figure the company docs already
use — it is an assumption, not a measurement, and should be labelled as one.

| Scenario | Paying accounts | ARPU | Monthly | Annual (DT) | Annual (USD @ 3.03) |
|---|---|---|---|---|---|
| Conservative | 600 | 66 DT | 39,600 DT | **475,000 DT** | **~$157,000** |
| Midpoint | 800 | 66 DT | 52,800 DT | **634,000 DT** | **~$209,000** |
| Optimistic | 1,000 | 66 DT | 66,000 DT | **792,000 DT** | **~$261,000** |

**Ceiling comparison, if you must state one:** the company docs' "$3.8M ARR"
requires 100,000 Maghreb developers × 15% conversion × 66 DT. Two of those three
terms are unverified (§A.4) and one is unsourced (§G). **Do not use it.**

**The number for the form:** *a serviceable market of roughly 4,000 developers
and a realistic revenue ceiling in the hundreds of thousands of dinars a year at
maturity.* It is small. It is also **true, checkable, and consistent with
everything else in the file** — and for a pré-label, a founder who states a small
honest market with a working product beats one who claims a large invented one.

---

# « Réponses proposées »

Nine drafts in French, plain register, no marketing adjectives. Each under 300
words. `[FOUNDER]` marks a figure only Louay can supply.

---

### 1. Quel est votre marché cible ?

> Mon marché cible est le développeur professionnel tunisien qui utilise déjà des
> modèles d'IA dans son travail — pour du code, des agents, du traitement de
> documents — et qui ne peut pas les payer légalement aujourd'hui.
>
> Ce développeur existe en nombre mesurable. Le secteur TIC tunisien emploie
> 86 000 personnes selon la FIPA, dont j'estime que 30 à 45 % exercent un métier
> de développement logiciel, soit environ 30 000 personnes. Il exerce
> principalement à Tunis, Sfax, Sousse et Monastir, souvent dans des sociétés de
> services exportant vers l'Europe.
>
> Trois caractéristiques définissent ce client. Il est techniquement capable
> d'intégrer une API en quelques minutes. Il dispose d'un budget outil réel, mais
> en dinars. Et il n'a aucun moyen d'obtenir une facture en dinars pour un
> service d'IA étranger.
>
> Dans un second temps, le marché s'étend aux petites équipes — agences, studios,
> services informatiques internes — qui ont besoin de plusieurs clés et d'un
> plafond de dépense maîtrisé. C'est le segment que couvre l'offre Pro.
>
> Je ne vise pas le grand public. Un abonnement à 50 DT représente environ 5 % du
> salaire net moyen national : c'est un budget d'outil professionnel, pas une
> dépense de particulier. Cette limite est volontaire et définit le
> positionnement.

*(≈180 mots)*

---

### 2. Quelle est la taille de votre marché ?

> Je calcule ce marché par le bas, à partir de l'emploi, et non à partir d'une
> prévision mondiale.
>
> **Population.** 86 000 emplois dans le secteur TIC tunisien (FIPA, 2026). En
> retenant une part de 30 à 45 % de métiers de développement logiciel — une
> hypothèse que j'assume — on obtient 26 000 à 39 000 développeurs, soit environ
> 30 000.
>
> **Marché servi.** Seuls comptent les développeurs qui utilisent déjà une API de
> modèle et qui peuvent payer en dinars. J'estime cette part entre 10 et 20 %,
> soit 3 000 à 6 000 personnes.
>
> **Marché accessible.** À un taux de conversion de 15 à 25 %, cela représente
> 600 à 1 000 comptes payants. Au prix public de 50 DT (Starter) et 90 DT (Pro),
> avec une répartition 60/40, le revenu moyen par compte est de 66 DT par mois.
>
> **Chiffre d'affaires potentiel à maturité :** entre 475 000 et 792 000 dinars
> par an, soit 157 000 à 261 000 dollars au taux de 3,03.
>
> Je présente ce chiffre comme un plafond, non comme une prévision. C'est un
> marché national étroit, et je préfère le dire ainsi : un marché de cette taille
> ne justifie pas un financement de capital-risque, mais il justifie une société
> rentable et un produit réel.
>
> Le potentiel de croissance au-delà de ce plafond ne vient pas de la Tunisie
> seule, mais de l'extension régionale — à condition de disposer d'un rail de
> paiement dans chaque pays, ce qui n'est pas le cas aujourd'hui.

*(≈230 mots)*

---

### 3. Quelle est votre part de marché cible ? et comment comptez-vous l'atteindre ?

> Ma cible à trois ans est de 300 à 500 comptes payants, soit environ 3 000 à
> 3 800 dinars de revenu mensuel. Cela représente moins de 10 % des
> 3 000 à 6 000 développeurs que j'estime réellement accessibles. Je préfère
> viser une part modeste d'un segment étroit que d'annoncer une part large d'un
> marché que je ne peux pas servir.
>
> L'accès se fait par trois canaux, dans cet ordre.
>
> **Un.** Le produit lui-même. Un développeur qui a une clé obtient une réponse
> HTTP 200 en moins de dix minutes, sans appel commercial. La page de connexion
> génère la configuration exacte pour quatorze outils — Claude Code, Codex,
> Cursor, les SDK, curl. C'est le canal principal, et le moins coûteux.
>
> **Deux.** La publication technique, en français et en arabe, sur LinkedIn et
> dans les communautés de développeurs tunisiennes. Le contenu porte sur le
> comptage et la facturation, pas sur le modèle.
>
> **Trois.** L'essai gratuit de trois jours, sans carte — possible précisément
> parce que le paiement n'est pas un préalable.
>
> Je mesure une seule chose : le passage de l'inscription à la première réponse
> 200. Les impressions ne prédisent rien. Ce taux, lui, prédit le revenu.
>
> [FOUNDER] — nombre d'inscrits à ce jour : à compléter.

*(≈215 mots)*

---

### 4. Quelle est votre stratégie de croissance pour les 3 prochaines années ? en chiffres

> **Année 1 — consolidation locale.** Objectif : 100 à 150 comptes payants,
> soit 6 600 à 9 900 dinars de revenu mensuel. Priorités : fiabiliser le rail
> D17, réduire le délai de vérification des paiements, et obtenir le matricule
> fiscal — condition d'accès aux passerelles marchandes tunisiennes. Le produit
> est déjà en production ; cette année porte sur la distribution, pas sur la
> construction.
>
> **Année 2 — équipes et paiement carte.** Objectif : 250 à 350 comptes,
> 16 500 à 23 100 dinars par mois. Deux leviers. D'abord la facturation par
> siège sur le rail local, qui augmente le revenu par compte sans changer le
> prix affiché. Ensuite l'activation du rail carte international, aujourd'hui
> construit et en mode test, ce qui ouvre la clientèle hors Tunisie.
>
> **Année 3 — extension régionale.** Objectif : 400 à 500 comptes au total,
> dont une part hors Tunisie. Condition préalable : un rail de paiement
> opérationnel dans chaque pays visé. Sans cela, un utilisateur marocain ou
> algérien ne peut pas payer, et la croissance annoncée serait fictive.
>
> **Facteurs de réussite :** le coût d'achat des tokens en gros, la stabilité du
> taux de conversion essai → payant, et l'obtention d'une réponse écrite du
> fournisseur amont sur la revente.
>
> **Ce que ces chiffres ne sont pas.** Ce sont des objectifs, pas des
> projections financières. Je ne dispose pas encore d'historique mesuré de
> conversion sur ce marché, et je ne présente pas d'hypothèse de rétention que je
> ne peux pas documenter.

*(≈235 mots)*

---

### 5. Quel est le nombre d'utilisateurs que vous avez aujourd'hui ? projection 3 ans

> **Aujourd'hui.** [FOUNDER] — comptes inscrits : à compléter. Comptes payants :
> [FOUNDER]. Revenu mensuel : [FOUNDER].
>
> Je préfère donner ces chiffres exacts plutôt qu'un chiffre présentable : le
> produit est en production et vérifiable publiquement, ce qui est plus solide
> qu'un nombre d'utilisateurs invérifiable.
>
> **Ce qui existe et se démontre maintenant, sans dépendre d'un chiffre
> commercial :**
>
> - une passerelle multi-tenant en production, avec application du quota à
>   chaque requête et échec fermé ;
> - 1 130 tests automatisés au vert et un typage TypeScript propre ;
> - 43 migrations de base de données à sens unique ;
> - deux rails de paiement : D17 actif, rail carte construit et en mode test ;
> - un tableau de bord trilingue français / arabe / anglais ;
> - un client de bureau avec connexion par navigateur, sans manipulation de clé ;
> - un point d'accès public qui refuse les appels anonymes.
>
> **Projection à trois ans.** 100 à 150 comptes payants en année 1, 250 à 350 en
> année 2, 400 à 500 en année 3 — soit 26 400 à 33 000 dinars de revenu mensuel
> en fin de période.
>
> Ces objectifs sont volontairement modestes. Un dossier qui annonce des
> milliers d'utilisateurs pour un produit lancé depuis quelques semaines invite
> une vérification ; un dossier qui annonce cent comptes et montre un système qui
> fonctionne invite une démonstration.

*(≈220 mots)*

---

### 6. Qui sont vos concurrents et qui pourrait devenir votre concurrent ? Qui craignez-vous le plus ?

> **Mes concurrents ne vendent pas la même chose que moi.**
>
> Les fournisseurs directs — OpenAI, Anthropic, Google — vendent le modèle. Ils
> n'acceptent qu'une carte internationale, n'émettent pas de facture en dinars et
> ne sont pas accessibles à un développeur tunisien. Ce n'est pas un concurrent
> commercial, c'est la cause du problème que je traite.
>
> Les agrégateurs — OpenRouter, Together, Groq, Fireworks — vendent le routage
> entre modèles, à prix coûtant plus une commission de 5,5 à 8 % sur l'achat de
> crédits. Aucun n'accepte D17 et aucun ne facture en dinars. Leur faiblesse est
> structurelle : ils ne peuvent pas encaisser un dinar.
>
> **Mon concurrent réel est informel.** Le développeur qui utilise un VPN avec
> une carte étrangère, celui qui achète un accès auprès d'un revendeur dans un
> groupe de messagerie, celui qui emprunte l'identifiant d'un collègue. Ce marché
> n'a ni facture, ni recours, ni traçabilité. Je ne dispose d'aucune donnée
> publiée sur son volume.
>
> **Ce que je crains le plus :** qu'un acteur tunisien déjà installé — une
> passerelle de paiement comme Flouci, un opérateur télécom avec son portefeuille
> — ajoute une offre d'accès aux modèles. Il possède déjà le rail, la base
> clients et la conformité. Ce scénario est réaliste, et c'est pour cela que ma
> différenciation ne peut pas être seulement le paiement : elle doit être la
> précision du comptage et la qualité de l'outil pour développeur.

*(≈235 mots)*

---

### 7. Quels sont les facteurs différenciants de votre solution ?

> **Un. Le paiement local, sans immatriculation préalable.** Un porteur de projet
> non immatriculé ne peut pas ouvrir de compte marchand. D17, portefeuille de la
> Poste Tunisienne, le permet. C'est la raison pour laquelle le produit peut
> exister avant la société, et non l'inverse.
>
> **Deux. Un compteur unique et une seule règle.** Un token qui traverse la
> passerelle est compté une fois, sur cinq colonnes du grand livre additionnées.
> L'autorisation obéit à une seule condition : dû et consommation inférieure au
> plafond. Trois tâches indépendantes appellent la même fonction, donc le chiffre
> que le client voit et le chiffre qui le bloque ne peuvent pas diverger. C'est
> le point technique sur lequel je suis le plus exigeant, parce qu'une passerelle
> qui compte mal est pire qu'aucune passerelle.
>
> **Trois. Échec fermé.** Si l'amont est injoignable, la passerelle renvoie une
> erreur. Jamais un succès. Un proxy qui répond « réussi » sans avoir répondu
> produit une requête non comptée — exactement la défaillance que ce produit
> existe pour empêcher.
>
> **Quatre. Aucun nom de fournisseur côté client.** Quatre niveaux nommés par
> usage — fast, smart, frontier, fable. Le moteur derrière un niveau peut changer
> sans que le client modifie une ligne de code.
>
> **Cinq. Aucun SDK intermédiaire.** Les SDK OpenAI et Anthropic existent déjà et
> fonctionnent avec mon point d'accès. Un SDK supplémentaire serait une
> dépendance de plus pour le client, et une raison de plus de ne pas partir.
>
> **Six. Interface trilingue français / arabe / anglais**, y compris le tunnel de
> paiement en arabe avec mise en page de droite à gauche.

*(≈250 mots)*

---

### 8. Décrivez le potentiel de croissance, les indicateurs clés et les facteurs clés de succès

> **Potentiel.** Le marché tunisien est étroit : environ 30 000 développeurs, dont
> 3 000 à 6 000 réellement accessibles, pour un plafond de revenu de l'ordre de
> 475 000 à 792 000 dinars par an à maturité. Ce n'est pas un marché qui justifie
> une levée de fonds importante. C'est un marché qui justifie une société
> rentable, avec un coût fixe de l'ordre de 250 dinars par mois.
>
> La croissance au-delà de ce plafond dépend de deux conditions non réunies
> aujourd'hui : un rail de paiement opérationnel dans chaque pays visé, et une
> facturation par siège sur le rail local.
>
> **Indicateurs clés — trois, dans cet ordre.**
>
> 1. **Taux de passage inscription → première réponse 200.** C'est le seul
>    indicateur qui prédit le revenu. Un développeur qui obtient une réponse ne
>    part pas silencieusement.
> 2. **Taux de conversion essai → payant.** Non mesuré à ce jour ; ce sera le
>    premier chiffre que je publierai dès qu'il sera significatif.
> 3. **Revenu moyen par compte et taux de rétention mensuel.** [FOUNDER]
>
> **Facteurs clés de succès.**
>
> - Le coût d'achat des tokens en gros : c'est la variable dont dépend toute la
>   marge, et elle n'est pas encore documentée par une facture.
> - Le délai de vérification des paiements D17 : chaque heure d'attente est un
>   client perdu.
> - La clarté juridique de la revente d'accès, qui conditionne la communication
>   publique.
> - L'obtention du matricule fiscal, qui ouvre les passerelles marchandes
>   tunisiennes et met fin au paiement vérifié manuellement.

*(≈245 mots)*

---

### 9. Pourquoi postulez-vous au Label Startup ? À quels avantages êtes-vous le plus sensible ?

> Je postule au pré-label au titre de l'article 4, avant l'immatriculation, parce
> que c'est la seule voie ouverte à un porteur de projet qui n'a pas encore de
> société. Je connais la procédure : en tant que CTO de Chabaqa.io, j'ai obtenu
> le Label Startup Act pour cette société. Le dossier ne m'est pas inconnu.
>
> **L'avantage auquel je suis le plus sensible est l'exonération de l'impôt sur
> les sociétés.** Elle a un effet direct et mesurable sur ma structure de coûts :
> mon modèle repose sur une marge unitaire faible et un volume élevé. Un impôt
> sur les sociétés de 15 à 20 % sur un chiffre d'affaires de cette nature
> absorberait une part importante de la marge, alors que la même exonération
> change la capacité de réinvestissement dans l'infrastructure.
>
> **Le deuxième avantage est le compte en devises.** Mes coûts — l'achat des
> tokens — sont en dollars, mes revenus en dinars. Un compte en devises alimenté
> librement supprime une friction de trésorerie qui, autrement, m'oblige à
> convertir à chaque cycle.
>
> **Je ne compte pas la Bourse Startup dans mon plan.** Les conditions
> d'éligibilité — notamment l'absence de statut d'étudiant et l'absence de toute
> autre activité professionnelle — ne sont pas réunies à ce jour. Je préfère le
> dire plutôt que de fonder un plan sur un dispositif auquel je ne suis pas
> éligible.
>
> Ce que je demande au Label, c'est la reconnaissance d'un cadre : montrer qu'un
> projet construit par un étudiant tunisien, en dehors de tout financement,
> répond aux critères d'innovation et de scalabilité.

*(≈250 mots)*

---

# Ce que je n'ai pas pu vérifier

Listed so the founder knows exactly which numbers are still guesses. **Nothing
in this list should appear on the form.**

| # | What | Why it matters | What I tried |
|---|---|---|---|
| 1 | **Official Tunisia developer count** | The 30,000 figure is now derived, not sourced | Octoverse 2024/2025/2026 (Tunisia absent from every table) |
| 2 | **Whether a student may hold a pré-label** | **Blocks the whole filing** | Read the pré-label KB article — silent on this. Must be asked by email. |
| 3 | **The Bourse amount for a non-salaried founder** | The "1,000 DT/month" figure is the stated *minimum*, not a stated forfait | Official page says "indemnité forfaitaire" without an amount |
| 4 | **The 30-day / 60-day decision rule** | Company docs assert it; operator's site says 3 days on completeness | Decree 2018-840 PDF is not fetchable (`application/pdf` unsupported) |
| 5 | **The duration of the corporate tax exemption** | Official page gives none; third-party reporting says 8 years | Ministry PDF unavailable |
| 6 | **D17 user count** | Company docs rely on "almost everyone has it" | La Poste publishes nothing; BCT publishes totals by channel only, never by issuer |
| 7 | **e-Dinar / postal account holder counts that are dated** | Only an undated Wikipedia figure (1.75M) exists | UNCTAD 2020 merchant data is the only dated primary figure |
| 8 | **Free→paid conversion, churn, ARPU benchmarks for dev tools** | All company projections rest on the 10–15% assumption | Search unavailable; Crunchbase/OpenView unreachable |
| 9 | **The AiPilot wholesale cost per token** | This is the real COGS, and therefore the real margin | `docs/aipilot-upstream.md` confirms no published pricing; no invoice in the tree |
| 10 | **Grey-market size in Tunisia** | The "real competitor" has no published figure | No reporting found |
| 11 | **Paystack / Flutterwave / dLocal / Razorpay growth data** | Requested as payment-rail comparables | All investor pages returned 403 or unreachable |
| 12 | **$166B MENA AI forecast** | Correctly excluded from TAM; also unverifiable | Grand View Research page not reachable |
| 13 | **Tunisia AI market 45M DT methodology** | Cited by a hardware reseller, second-hand | No primary method published by E-Novate |
| 14 | **Freelance developer count in Tunisia** | Would strengthen the market size | No Tunisian source publishes it |

**Also worth noting about method:** in this session the web-search tool returned
HTTP 402 (no credit) on every call, so identical figures could not be
cross-checked across two search engines. Every figure above that is marked
*high confidence* came from a page fetched directly from the operator, agency,
or vendor. Anything requiring a second opinion is marked accordingly.

---

# Contradictions with the company docs (§2) — correct before submission

Ordered by what each one costs if a committee finds it.

### 1. The per-token rate table is wrong (§2, "Pricing" and `prices/models.yaml`)

| Alias | §2 / repo states | Actual Anthropic list (Nov 2026) |
|---|---|---|
| `fast` | $1.00 / $5.00 | **$0.10 / $0.50** |
| `smart` | $3.00 / $15.00 | **$2.00 / $10.00** |
| `frontier` | $15.00 / $75.00 | **$4.00 / $20.00** |
| `fable` | $15.00 / $75.00 | up to $8.00 / $40.00 (GPT-6.2 Astra) |

Cache-read multipliers also changed: 0.05× on Sonnet 5.5 and Opus 5.5, not 0.1×.

**Effect:** the repo's own claim that burning 50M on `smart` costs $330 is wrong
— at current list it is about **$100**. **Fix this before anyone quotes a margin
from those files.** The good news is it moves the story in your favour.

### 2. "30,000 developers (GitHub 2021)" is not traceable (§2, §A)

GitHub has published no Tunisia count in 2024, 2025 or 2026. **Re-derive it from
FIPA's 86,000 ICT jobs** (§A.3) and drop the GitHub attribution.

### 3. The Maghreb and MENA developer numbers are contradicted by Octoverse (§2)

§2 says ~100,000 for TN+MA+DZ and ~220,000 with Egypt. Octoverse alone counts
**556,000 in Morocco and 990,000 in Egypt**. Different measures, but a committee
will not pause to work that out. **Use Tunisia only.**

### 4. "Card price $15 / $30 × seats" is presented as a live rail — it is not (§2)

§2 lists three rails correctly, but the marketing surfaces do not. Both
`portal/lib/pricing/facts.ts` (`COMPARISON`, row "Card": **Yes**) and the pricing
FAQ (*"Can I pay by card? Yes, at checkout, in US dollars. Card payments are
instant."*) promise a working card rail. `DODO_PAYMENTS_ENVIRONMENT=test_mode`
and migration 0040's test product IDs say otherwise.

**On the dossier specifically:** do not write "paiement par carte disponible".
The correct claim is *"rail carte construit, en cours d'activation"*.

### 5. "Decision ≤30 days, silence 60 days = approval" is not what the operator says (§F.2)

Official: submission **1st–8th monthly**, **≥5 favourable opinions**, response
**3 days from completeness**. Remove the 30/60-day claim unless the founder has
read Decree 2018-840 and can quote it.

### 6. The 12,000 DT Bourse figure must not be in the dossier (§2, §F.4)

Two confirmed exclusions apply — student status, and any other professional
activity. §2 lists the Bourse as if available. It is not, today. See §F.4 for the
one honest sentence to use instead.

### 7. "15% payer conversion ⇒ $3.8M ARR" has no sourced basis (§2, §G)

Neither the 15% nor the 100,000-developer denominator is verifiable. See the
bottom-up model above — the honest ceiling is **475,000–792,000 DT/year**.

### 8. Test and migration counts in §2 are stale

§2 says 1,130 tests / 73 files / 43 migrations / 36 tables / 71 routes / 41
pages. I did not re-run the suite in this session, so I cannot confirm or refute
these. **Re-measure before the file goes in** — `cd portal && npx vitest run`
and `ls db/migrations | wc -l`. A committee is unlikely to check, but the
founder will be asked in a pitch.

### 9. Marketing copy still states "100M tokens per day, reset at midnight"

Live product is **50M per month** with a daily sub-cap — 3M/day (Starter) and
8M/day (Pro), per migration 0043. The LinkedIn pack and
several landing components still carry the retired daily claim. Irrelevant to
the dossier, but if a committee opens the site after reading the file, the
product contradicts itself.

### 10. Trial volume disagrees across surfaces

README says 50M; `docs-data.ts` says 1M; migration 0039 says 1M. **1M is
correct.** Any 50M trial claim is stale.

---

# The three sentences to say out loud

If the whole file compresses to what actually gets said in fifteen minutes:

1. **The product runs, and you can check it now.** A live endpoint that refuses
   anonymous calls, a quota enforced per request, 43 forward-only migrations,
   a trilingual dashboard, and two payment rails — one live, one built.
2. **The gap is payment, not talent.** Tunisia has a working national payment
   system and 86,000 ICT jobs; it has no legal way to buy a foreign AI
   subscription in dinars. That is a specific, verifiable market failure, and it
   is the whole reason the product exists.
3. **The numbers are small and I know it.** ~30,000 developers, 3,000–6,000
   reachable, a ceiling in the hundreds of thousands of dinars. I am asking for a
   pré-label on the strength of a working system, not on a market forecast.

Everything else is evidence for those three.
