# Handoff — market research for the Startup Act pre-label dossier

**For:** an OpenCode session with web search
**From:** the Verdent session that prepared the dossier context
**Date:** 17 November 2026

You are researching market data for a real Tunisian government application.
The applicant is **Louay Rjili**, co-founder of **Zaino AI**. Output will go
directly onto a form that is evaluated by a labelling committee, so a wrong
number is worse than a missing one.

Read this entire file before your first search. Section 2 lists facts already
verified — **do not spend searches re-deriving them**, and do not contradict
them without saying so explicitly.

---

## 1. What the company is, in one paragraph

Zaino AI is a Tunisian metered API gateway that resells access to frontier
language models. Developers pay in Tunisian dinars (currently via D17, the La
Poste Tunisienne wallet) and get an OpenAI-compatible **and** Anthropic-compatible
endpoint, so existing tooling — Claude Code, Codex, Cursor, the OpenAI/Anthropic
SDKs, plain `curl` — works by changing only a base URL and a key. There is no
wrapper SDK. Four capability tiers are sold under **aliases only** (`fast`,
`smart`, `frontier`, `fable`); no upstream model vendor name is ever exposed to a
customer. The strategic claim is that **the payment rail and the meter are the
product**, not the models.

The core market problem: Tunisia has a large developer population with no usable
international payment card, no invoicing in dinars, and no licensed local
reseller — so the market filled with informal resellers and borrowed logins.

---

## 2. Ground truth — verified, do NOT re-research

Measured on 17 Nov 2026 by running the test suite and reading the migrations.

| Fact | Value |
|---|---|
| Automated tests | 1,130 passing, 73 files |
| Type-check | clean (`tsc --noEmit` exit 0) |
| Database migrations | 43, forward-only |
| Database tables | 36 |
| API routes | 71 |
| Pages | 41 |
| Live product | `https://zaino.soon.it` → HTTP 200 |
| API auth wall | `https://api.zaino.soon.it/v1/models` → HTTP 401 |

**Pricing (authoritative):**

| | Starter | Pro |
|---|---|---|
| D17 price | 50 DT/month | 90 DT/month |
| Card price (international) | $15 | $30 × seats |
| Token pool | 50M/month, one shared pool | 50M/month, one shared pool |
| Daily cap | 3M/day | 8M/day |
| Models | fast, smart | smart, frontier, fable |
| Keys / seats | 3 / 1 | 15 / 25 |
| Context / output | 1M / 64k | 1M / 64k |
| Trial | 3 days, 1M tokens, no card | same |

**Payment rails, three distinct states — never collapse them:**

1. **D17 (La Poste Tunisienne)** — live. Manual transfer, human-verified proof.
   Works with no matricule fiscale.
2. **Dodo** — international card processor, built, in `test_mode`. No money moves.
3. **Tunisian merchant gateways** — post-matricule. The billing layer is already
   a provider-agnostic registry, so each gateway is one new module.

**Team:** two co-founders. Louay Rjili (55%, gérant, prior CTO of Chabaqa.io
where he secured a Startup Act label) plus one co-founder (45%). Louay is a
final-year IT student at ISSAT Mateur.

**Market figures currently in the company docs (treat as *unverified estimates
needing confirmation*, not gospel):**
- ~30,000 developers in Tunisia (attributed to GitHub 2021)
- ~100,000 across the Maghreb (TN + MA + DZ)
- ~220,000 including Egypt
- Blended ARPU 66 DT/month; 15% payer conversion ⇒ 11.88M DT/yr ≈ $3.8M ARR ceiling

Your job includes **checking whether these hold up** and replacing them with
better-sourced numbers if they do not.

---

## 3. Facts only the founder can supply — DO NOT research or invent

Ask the user for these. Never guess, and never infer them from the codebase.

- Number of registered users today
- Number of **paying** users today
- Monthly revenue today (likely 0 — say so plainly if it is)
- Tokens served to date
- Whether the company has launched a startup before
- Exact legal form and incorporation status

If a question in §4 depends on these, write `[FOUNDER]` in the answer and move on.

---

## 4. The research brief

Each item names the form field it feeds. Answer **all** of them. Where a number
cannot be found from a credible source, say `NOT FOUND` and explain what you
searched — an honest gap is usable, a plausible invention is not.

### A. Developer population — feeds « Taille du marché », « Marché cible »

Find defensible counts for **Tunisia**, **Morocco**, **Algeria**, **Egypt**, and
the **MENA** aggregate. Cross-check at least two independent sources per country
where possible.

Preferred sources, in order:
1. GitHub Octoverse (developer counts by country, if published)
2. Stack Overflow Developer Survey (country participation is a sample — use only
   as corroboration, never as a population count)
3. World Bank / ITU / UNESCO ICT statistics
4. Tunisian national sources: **APII**, **Smart Capital**, **INS** (Institut
   National de la Statistique), Ministry of Communication Technologies
5. Industry bodies: TunisianStartups, GIZ Tunisia, World Bank Digital Economy
   diagnostics for Tunisia

Explicitly report **the year of each figure** and whether it counts *all* ICT
professionals or *software developers specifically*. These differ by a factor of
two or more and the committee will notice.

### B. Tunisian ICT market structure — feeds « Taille du marché », « Part de marché »

- Number of registered ICT/software companies in Tunisia (APII registry is the
  usual source)
- Number of **software development / IT services** companies specifically
- Estimate of freelance developers
- Number of startups (Smart Capital reports this; there is a Startup Act
  labelling count too)
- Tunisia's ICT sector share of GDP and export figures — Tunisia's offshore IT
  services export number is a strong credibility datum

### C. Tunisian & Maghreb AI/cloud adoption — feeds « Potentiel de croissance »

- Any published figure on AI adoption by Tunisian companies
- Cloud spend in Tunisia / North Africa
- Africa or MENA AI market size forecasts (cite as **context only**, never as
  the company's TAM — the repo is explicit about this)
- Digital-payment penetration in Tunisia: D17 user count, card penetration,
  e-commerce payment mix. **This is the single most valuable datum** because the
  company's whole thesis is a payment-rail gap.

### D. The global comparable market — feeds « Concurrents », « Facteurs différenciants »

Map the actual competitive set. For each, note: business model, pricing shape,
whether they serve the Maghreb, and whether they accept local payment.

- **Direct aggregators/gateways:** OpenRouter, Together AI, Fireworks AI, Groq,
  DeepInfra, Novita AI, Hyperbolic, Replicate, Requesty, Portkey, LiteLLM (as a
  self-hosted alternative)
- **First-party APIs:** OpenAI, Anthropic, Google (cannot be bought locally —
  that *is* the competitive gap)
- **Regional / MENA:** any Arabic-first or North-Africa-focused AI API provider
  (search in Arabic and French too: *واجهة برمجة الذكاء الاصطناعي*, *passerelle
  API IA Tunisie*)
- **Local Tunisian:** any existing reseller operating openly — check Tunisian
  startup directories, LinkedIn, and local tech press
- **The real competitor:** VPN + foreign card, and grey-market resellers in
  chat groups. Describe how that market actually works, if any reporting exists.

For each competitor capture **pricing per million tokens**, so a comparison table
can be built honestly.

### E. Payment-rail-gap comparables — feeds « Potentiel de croissance », credibility

Find companies that won by solving a *local payments* problem rather than a
technology problem, and get their growth numbers: Paystack, Flutterwave, dLocal,
Razorpay, Mercado Pago, Xendit, Paddle-adjacent models. What conversion rates,
ARPU and growth curves did they post? This gives defensible benchmarks instead of
invented projections.

### F. Tunisian Startup Act — feeds « Pourquoi postulez-vous au Label »

- The full list of Startup Act benefits: tax exemptions (corporate tax, and for
  how long), FX account, the Bourse Startup amount and conditions, patent-cost
  support, and anything else
- **Number of startups labelled to date** and the current programme statistics
- **The Bourse eligibility rule on students.** The company docs assert the law
  requires the founder not to have student status (« ne doit pas avoir le statut
  d'étudiant »). **Verify this against startup.gov.tn or the official ANETI /
  Ministry documentation, and quote the exact clause.** This single fact changes
  the applicant's whole financial plan, so do not rely on secondhand summaries.
- Pré-label under article 4 of Law 2018-20: what it grants, its validity, and
  **whether a student may hold one**
- Whether the Bourse is available per-founder (the docs claim up to three
  founders may each claim it)

### G. Growth benchmarks for a developer-tools SaaS — feeds all numeric projections

Find industry benchmarks, with sources:
- Free/trial → paid conversion for developer tools (the docs assume 10–15%)
- Monthly churn for SMB/developer SaaS (the deck models 5% / 8% / 12%)
- ARPU ranges for API/developer products
- Typical time from launch to first 100 paying customers

### H. Price sensitivity context — feeds « Business Model »

- Average net salary for a Tunisian software developer (a 2026 figure is cited as
  ~$328/month nationally; find the **developer-specific** number)
- What 50 DT/month and 90 DT/month represent as a share of that salary — this is
  the argument that the price is affordable, and it needs a real denominator

---

## 5. Source discipline — non-negotiable

This project has already been burned twice by aggregator sites that invent or
recycle deadlines and figures. Apply these rules:

- **Never cite an aggregator** (allbusiness.africa, opportunitydesk, for9a,
  grantsights, and similar) as the source of a number. They are discovery tools
  only. Trace every figure back to the operator, the statistics agency, or the
  original research.
- **Date every figure.** "30,000 developers" without a year is unusable.
- **Distinguish estimate from measurement.** If a number is a vendor's marketing
  claim, say so.
- **Never present a top-down TAM as the company's addressable market.** The
  company's own docs are explicit: addressable market is bottom-up, and the
  $166B MENA AI forecast is context, never TAM.
- If two credible sources disagree, **report both and the discrepancy** rather
  than picking the flattering one.

---

## 6. Output format

Produce a single Markdown document with one section per item A–H. For every
figure:

```
| Value | Source | Year | Type | Confidence |
|---|---|---|---|---|
| 30,000 developers (TN) | GitHub Octoverse | 2021 | estimate | medium |
```

Where `Type` is one of `measured` / `estimate` / `vendor claim` / `forecast`, and
`Confidence` is `high` / `medium` / `low` with a one-line reason.

Then, at the end, a section titled **« Réponses proposées »** that turns your
findings into drafts in **French**, under 300 words each, for these form fields:

1. Quel est votre marché cible ?
2. Quelle est la taille de votre marché ?
3. Quel est votre part de marché cible ? et comment comptez-vous l'atteindre ?
4. Quelle est votre stratégie de croissance pour les 3 prochaines années ? en chiffres
5. Quel est le nombre d'utilisateurs que vous avez aujourd'hui ? projection 3 ans
6. Qui sont vos concurrents et qui pourrait devenir votre concurrent ? Qui craignez-vous le plus ?
7. Quels sont les facteurs différenciants de votre solution ?
8. Décrivez le potentiel de croissance de votre projet, les indicateurs clés et les facteurs clés de succès
9. Pourquoi postulez-vous au Label Startup ? A quels avantages êtes-vous le plus sensible ?

French must be in the register of a Tunisian public dossier — plain, factual, no
marketing adjectives. Avoid « révolutionnaire », « disruptif », « puissant ».

---

## 7. Two things to get right above all else

**The market-size question is where dossiers die.** A committee read hundreds of
these. "The AI market will be $166B by 2030" is the sentence that loses the file.
A bottom-up number — *N developers × payer conversion × ARPU* — with each term
sourced, is what wins it. Build the bottom-up model and show the arithmetic.

**Do not overstate traction.** The form asks for today's user count and revenue.
If those are near zero, the honest answer plus a credible plan beats an inflated
number the committee can check against the live product. The product being
demonstrably real (1,130 tests, live endpoints) is stronger evidence than any
projection.

---

## 8. What to hand back

1. The findings document with the source table per item
2. The nine French drafts under « Réponses proposées »
3. A short list titled **« Ce que je n'ai pas pu vérifier »** — what you searched
   for and could not establish, so the founder knows which numbers are still
   guesses
4. A note on any place where your findings **contradict** the company docs in §2,
   so the dossier can be corrected before submission
