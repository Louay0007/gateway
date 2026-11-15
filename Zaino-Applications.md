# Zaino AI — Application Pack

Ready-to-submit drafts for the three opportunities that are actually open to you
today. Written 13 November 2026.

**Read the correction on page 1 first — I gave you a bad deadline earlier.**

---

## Correction: the TotalEnergies deadline was wrong

I told you twice that TotalEnergies Startupper closes **30 November 2026**. That
was wrong, and I should have caught it sooner.

The date came from a third-party aggregator (allbusiness.africa), not from
TotalEnergies. When I checked their official Agorize platform directly, it shows
**0 live programmes and 62 closed**. The Tunisia "business creation project"
page still advertises Edition 4, which closed **18 June 2024**. There is no
open 2026 or 2027 cycle.

So: do not spend a day on it. I have corrected the tracker. Watch
startupper.totalenergies.com for the next edition — it is worth applying when it
opens, just not now.

The lesson generalises: aggregator sites invent or recycle deadlines. Every date
in this pack was checked against the operator's own site.

---

## What you can actually submit this week

Only three things are open to you today with no company and no incorporation.
Ranked by expected value:

| # | Opportunity | Amount | Effort | Realistic odds |
|---|---|---|---|---|
| 1 | **Emergent Ventures** | $1,000–$50,000 | ~3 hours | Moderate — best fit by far |
| 2 | **Awesome Foundation** | $1,000 | ~1 hour | Low–moderate (many applicants) |
| 3 | **Cloud credits** (AWS/Google/Microsoft/Cloudflare) | ~$18,000 in credits | ~2 hours total | High — mostly self-serve |

One $1,000 award covers your entire 1,885 DT. Emergent Ventures at even its
floor covers it several times over.

---

# 1. Emergent Ventures

**Apply at:** https://mercatus.tfaforms.net/5099527
**Rolling, no deadline.** Published decision window: about one week.
**Follow-up email only:** emergentventures@mercatus.gmu.edu

### Two rules that decide this

They now **decline AI-written applications**. This is stated on their own
listing. So use what follows as a *structure and a set of facts*, then write it
in your own voice. If it reads like a language model wrote it, it fails.

Submit **one** application per applicant and project.

### The five questions, and what to put in each

The form asks for a proposal of up to 1,500 words. The structure that works:

**1. Your personal story — and how it connects to this**

This is weighted heaviest. Do not open with the market. Open with you: a
developer in Tunis who could not buy the tools they needed. Be specific and
concrete. What did you try? What did it cost you? What did you have to do
instead? One real scene beats a paragraph of context.

Draft scaffolding (rewrite in your words):

> I am a developer in Tunis. For about a year I was building with whatever
> models I could reach for free, and the ceiling was obvious — the work I wanted
> to do needed models I simply could not pay for. Not because I lacked the
> money. Because I lacked a card that works internationally, an invoice in
> dinars, and any legal way to buy a subscription from here. I tried
> [what you actually tried]. In the end I did [what you actually did].
>
> The thing that made me angry was not my own inconvenience. It was realising
> that every developer in this country hits the same wall, and that the
> workaround most of them choose is either borrowing someone's account or
> buying from a grey-market reseller who takes their money and disappears.
>
> So I built the thing I needed.

**2. The problem**

State it plainly and locally, with the specific mechanics:

- No international payment card usable for USD subscriptions
- No local invoicing, so no way for a company to expense it
- No legal resale channel, so the market filled with informal resellers
- Result: developers in Tunisia work with a generation-old toolset while
  developers elsewhere work with the current one

**3. What you built**

Do not describe a plan. Describe a running system, because it is one:

- A gateway that enforces a hard monthly token quota per subscription, checked
  on every single request, failing closed
- Two payment rails: D17 (La Poste Tunisienne) for dinars, and a card rail built
  and in test mode
- A trilingual dashboard in French, Arabic and English
- A desktop client with browser-based device login, so users never handle an API key
- 641 automated tests passing, TypeScript clean, 40 database migrations

Say it in one breath and move on. The point is credibility, not detail.

**4. What is new or unusual**

Be honest — you are not inventing a model. Say what is actually novel:

> The models are not mine. The way in is. The hard part in this market is not
> inference, it is metering and compliance: charging in dinars, enforcing a
> quota precisely enough that a customer cannot burn more than they paid for,
> and doing it legally in a jurisdiction where the payment rails barely exist.
> That is what I built, and it is why nobody else here has done it.

**5. The ask — be specific and small**

This is where most applicants lose. Do not ask for a round. Ask for a number
tied to a list:

> I am asking for **$1,000**. It covers, exactly:
>
> - Incorporating the company (SUARL): 1,885 DT ≈ $608
> - Apple Developer Program, so the desktop client can ship on macOS/iOS: $99
> - The remainder as a buffer for the Startup Label fee and bank costs
>
> $1,000 is the difference between a project that exists on my laptop and a
> company that can take its first paying customer.

Their own guidance says they will "consider very small grants if they might
change the trajectory of your life." That sentence is describing exactly this.

### Budget table to paste in

| Item | DT | USD |
|---|---:|---:|
| SUARL incorporation (DIY: RNE, statuts, stamp duty, publication) | 1,885 | $608 |
| Apple Developer Program (includes signing certificates) | 307 | $99 |
| Startup Label application fee | 100 | $32 |
| Buffer (bank, courier, notary) | ~700 | ~$226 |
| **Total** | **~3,000** | **~$965** |

Ask for $1,000. It is round, it is honest, and it maps to the table.

### Before you hit submit

- Written by you, in your own words, not pasted from here
- One application, not three variants
- A working link to something they can look at
- No jargon they would have to decode
- Read it aloud once. If a sentence sounds like a pitch deck, cut it.

---

# 2. Awesome Foundation

**Apply at:** https://www.awesomefoundation.org/en/submissions/new
**Rolling, monthly decisions.** Choose **"Any"** chapter — there is no Tunisian
chapter, and "Any" is the documented route for international projects.

### The form, exactly

Their form has fixed character limits. Prepare offline:

| Field | Limit | What to write |
|---|---|---|
| Project title | short | Something concrete, not a slogan |
| About the project | **2,000 characters** | Draft below |
| How you'll use the money | **500 characters** | Draft below |
| About you | **500 characters** | Draft below |
| Images | up to 5 | Dashboard screenshot, the pricing page, a terminal showing a live request |
| Last date you could use the money | date | Give a real date ~3 months out |

### About the project (under 2,000 characters)

> Tunisia has roughly 30,000 developers, and almost none of them can legally buy
> a frontier AI subscription. There is no usable international card, no invoice
> in dinars, and no local reseller operating within the rules. So developers
> here either borrow someone else's account, buy from a grey-market seller who
> may vanish with their money, or work with a toolset several years behind their
> peers in Europe.
>
> Zaino AI fixes that. It is a subscription gateway that lets a developer in
> Tunis pay in dinars — through D17, the La Poste Tunisienne wallet everyone
> already has — and get the same models a developer in Paris gets, metered
> fairly and billed monthly.
>
> It is already built and running: a quota system that checks every request and
> fails closed, a trilingual dashboard in French, Arabic and English, a desktop
> client, and 641 automated tests. It is not a proposal. It is a working product
> waiting on the paperwork that lets it charge its first customer.
>
> The $1,000 would incorporate the company. That is the whole ask. Once it is a
> legal entity, it can take payments, apply for the national Startup Label, and
> — because of a Tunisian law most founders here do not know about — qualify for
> a state founder's grant worth 12,000 DT over a year.
>
> So $1,000 here is not a subsidy. It is the key that unlocks roughly twelve
> times its value in non-dilutive public funding, and turns a working product
> into a business that pays tax in Tunisia.

*(That is ~1,650 characters — inside the limit.)*

### How you'll use the money (under 500 characters)

> Entirely on incorporation, which is the single blocker. 1,885 DT covers the
> company registry, registration of the statutes, stamp duty and publication —
> about $608. The rest covers the Startup Label application fee (100 DT) and
> bank and notary costs. Nothing goes to salaries, marketing or my own expenses.
> Every dinar converts directly into a legal entity that can invoice customers.

*(~430 characters.)*

### About you (under 500 characters)

> I am a developer in Tunis. I built Zaino because I could not buy the tools I
> needed to do my own work — no card that works abroad, no invoice in dinars.
> Rather than keep working around it, I built the thing that removes the
> obstacle for everyone here. The product is finished and running. What is
> missing is the company.

*(~340 characters.)*

### Two cautions

Their FAQ says chapters prefer projects that **benefit their own community**.
That is why the draft leads with Tunisian developers and the local economy, not
with your product's features. Keep it that way.

They also generally do not fund "personal expenses, marketing, salaries,
operational expenses." Incorporation is a grey area — it is a legal cost, not a
personal one, and the framing above makes that clear. If rejected, the same text
works on the next month's cycle; most chapters carry applications forward.

---

# 3. Cloud credits — do all four in one sitting

These are not cash, but you run a VPS and a gateway, so they remove real monthly
cost. Approximately $18,000 of value for about two hours of forms.

**Order matters only in that none of them blocks another.** Apply to all four.

| Programme | Amount | Where | What you need |
|---|---|---|---|
| AWS Activate — Founders | $1,000, up to $5,000 | aws.amazon.com/startups/credits | Paid-plan AWS account, working website |
| Google for Startups Cloud — Start | $2,000 | cloud.google.com/startup | Google account |
| Microsoft for Startups | up to $5,000 Azure | microsoft.com/en-us/startups | Microsoft account |
| Cloudflare for Startups | $10,000 | cloudflare.com/forstartups | Cloudflare account |

### The one thing that will trip you up

**Your AWS account must be on the Paid plan, not the six-month free tier.**
Free-tier accounts are not eligible for promotional credits. Upgrade first, then
apply.

### What to say when they ask what you're building

Keep it to three sentences, and lead with the technical fact that you already
operate infrastructure:

> Zaino AI is a metered API gateway serving frontier language models to
> developers in Tunisia, where international card payments are not available. We
> run a containerised stack (reverse proxy, auth edge, LiteLLM, Postgres, Redis)
> and bill customers in local currency. We are pre-revenue and self-funded,
> currently incorporating.

That last clause matters — it is what qualifies you for the Founders/Start tier
rather than the VC-backed tier.

---

# What comes after these

If any one of the three lands, you incorporate, and then the sequence from the
brief applies: Startup Label → Bourse Startup (12,000 DT) → accelerators.

If none lands within a month, the fallback is not another grant application. It
is to find 2,000 DT another way — family, a first paying customer on the D17
rail (you can sell before incorporating, as a sole trader), or a small paid pilot
with one Tunisian dev shop. The Bourse is worth 12,000 DT and it only requires
that you get over a 2,000 DT wall once.

---

## Submission checklist

- [ ] Rewrite the Emergent Ventures proposal in your own words — no AI phrasing
- [ ] Gather 3–5 screenshots: dashboard, pricing page, live API call, test run
- [ ] Confirm your age is within any programme limits before applying
- [ ] Upgrade the AWS account to Paid plan
- [ ] Submit Emergent Ventures
- [ ] Submit Awesome Foundation ("Any" chapter)
- [ ] Submit the four cloud credit applications
- [ ] Send the pre-label email to hello@startup.gov.tn
- [ ] Diarise: check startupper.totalenergies.com monthly for the next edition
- [ ] Diarise: Tony Elumelu opens 1 January 2027

---

### Sources

- [Emergent Ventures — official application form](https://mercatus.tfaforms.net/5099527)
- [Emergent Ventures — eligibility, Africa track, decision timing](https://www.for9a.com/en/opportunity/emergent-ventures-grant-support-innovative-projects-ideas-africa)
- [Emergent Ventures — no AI-written applications, rolling](https://questd.ai/fellowships/emergent-ventures)
- [Awesome Foundation — application form and character limits](https://grantsights.com/blog/awesome-foundation-grants)
- [Awesome Foundation — FAQ, eligibility, "Any" chapter](https://stemgrants.com/awesome-foundation-grants-due-open)
- [TotalEnergies Startupper — official platform, 0 live programmes](https://startupper.totalenergies.com/en/challenges)
- [AWS Activate — eligibility requires a Paid-plan account](https://aws.amazon.com/aws-startups/learn/everything-you-need-to-know-about-aws-activate-credits)
- [Startup Act — Label and Bourse conditions](https://www.mtc.gov.tn/fileadmin/StartupAct/Startup_Act_-_procedures_conditions_obtention_du_label.pdf)
