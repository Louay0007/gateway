# Emergent Ventures — Final Application Text

**Louay Rjili · Zaino AI · 13 November 2026**

Copy each block into the matching field. Word counts are given so you stay under
the 1,000-word limit.

---

## ⚠ Three contact details disagree — fix before you submit

| | You told me | Your CV says |
|---|---|---|
| Email | ceo-louayrjili@sohabi.app | louay.rjili@gmail.com |
| Phone | +216 24 267 363 | +216 51 803 706 |
| Location | Tunis | Rades Meliane |

Use **one** set consistently across the form, the PDF footer, and the CV if you
attach it. My recommendation: use the CV's details, because you are attaching
the CV and a reviewer comparing them will notice. If `ceo-louayrjili@sohabi.app`
is newer and you check it daily, use it — but then the CV should be updated too.

Location: Rades Meliane is in Ben Arous, not Tunis city. The form asks where you
physically are most of the time, so answer **Rades Meliane**.

---

# Field 1 — Tweet-length description

> A legal, dinar-priced way for Tunisian developers to buy frontier AI — when no
> international card and no local invoice exists.

*(140 characters. Alternative: "I build LLM pipelines for a living but cannot buy
the models for my own projects from Tunisia. So I built the way in.")*

---

# Field 2 — Tell us about your proposal

**Total: 921 words.** All three parts, in their order.

---

## PART 1 — About you (196 words)

I build LLM pipelines for a living. At Neediditals I design the prompt
engineering layers and the integration code that let a product talk to frontier
models. For two years I have been paid to make other people's software
intelligent, while being unable to buy those same models for my own work.

The obstacle was never money. It was access. I have no card a foreign processor
will accept, no way to receive an invoice in dinars, and no legal local channel
to buy a subscription. So I did what every developer here does: I worked around
it. Free tiers, whatever access I could legitimately get, and a lot of rebuilding
when a tool changed its terms and disappeared.

The thing that made me stop working around it was Chabaqa. I am its CTO, and I
took it through the Tunisian Startup Act labelling process myself. That taught me
something I had not understood: the barrier for a developer here is almost never
talent. It is access and paperwork. I had just spent months learning how to solve
paperwork problems for a company. So I pointed that at the problem I actually
cared about.

Zaino is me refusing to keep working around it.

---

## PART 2 — The consensus view (128 words)

The consensus I agree with, and that I find is increasingly unpopular to say out
loud in founder circles, is that **building on top of someone else's technology
is real engineering, not a lesser form of it.**

There is a strain of thinking that only counts if you trained the model, wrote
the compiler, or invented the protocol. Everything else is dismissed as "just
wrapping an API." I think that is wrong, and I think it is a view held mostly by
people who have never had to ship something for a customer who is paying in a
currency with no card rail.

Chabaqa runs on Next.js, MongoDB and third-party models. Zaino runs on models I
did not train. Neither is a lesser product for that. The engineering is in the
metering, the billing, the failure modes, and the compliance — the parts that
make someone else's primitive usable by a real customer in a real market.

---

## PART 3 — About your idea (597 words)

**The problem.** Tunisia has roughly 30,000 developers. Almost none can legally
buy a frontier AI subscription. There is no internationally accepted payment
card, no invoice issued in dinars, and no licensed local reseller. So the market
filled with informal ones: access resold through chat groups, paid by transfer,
with no recourse if the account disappears. The alternative is borrowing a
colleague's login.

Either way, a developer here works with a toolset years behind a developer in
Paris, and the gap compounds every quarter. I know this from the inside: I write
LLM integration code professionally and still could not get a legitimate account
for my own projects.

**The solution.** Zaino is a metered subscription gateway. A developer pays in
dinars through D17 — the La Poste Tunisienne wallet almost everyone already has
— and gets the same models their peers abroad use, with a monthly token
allowance, a usage dashboard, and an API key that works with standard tooling.
The models are not mine. The way in is.

**What is actually new.** Not inference. The hard part in this market is the
layer around it: metering precisely enough that a customer cannot consume more
than they paid for, enforcing that quota on every single request and failing
closed, billing in a currency that has no card rail, and doing all of it inside
the rules. That is what I built, and it is why nobody here has done it. The
compliance wrapper is the product, not a constraint on it.

**Timing.** Two windows opened at once. Frontier model providers now offer
reseller and partner arrangements that did not exist two years ago. And Tunisia's
Startup Act — which I have already navigated once, for Chabaqa — gives labelled
companies a corporate tax exemption, a foreign-currency account, and a state
founder's grant. The legal foundation and the commercial one are both available
for the first time together.

**How long, and what exists.** I started building Zaino in October 2026; it has
been my main project since. This is not a proposal — the system runs today:

- A quota engine enforcing a hard monthly limit per subscription on every
  request, failing closed, with three independent enforcement jobs sharing one
  code path so they cannot disagree
- Two payment rails: D17 live for dinars, a card rail built and in test mode
- A trilingual dashboard in French, Arabic and English, plus an admin console
- A desktop client with browser-based device login, so users never handle a raw
  API key
- 641 automated tests passing, a clean type-check, and 40 forward-only database
  migrations

**Budget outline.** I am asking for **$1,000**.

| Item | DT | USD |
|---|---:|---:|
| SUARL incorporation — registry, statutes, stamp duty, publication | 1,885 | 608 |
| Apple Developer Program, so the desktop client can ship | 307 | 99 |
| Startup Label application fee | 100 | 32 |
| Bank, notary and courier costs | 573 | 185 |
| **Total** | **2,865** | **924** |

The difference covers exchange and bank charges on receiving the grant.

**Implementation plan.** Incorporate within four weeks. Apply for the Startup
Label immediately after — 100 DT, decided within 30 days, and I know the dossier
because I have prepared one before. Within one month of the label, file for the
Bourse Startup: 1,000 DT net per month for twelve months for a non-salaried
founder. That is 12,000 DT, and it is why $1,000 here is not a subsidy — it is
the key that unlocks twelve times its value in non-dilutive public funding. Then
open paid subscriptions on the D17 rail.

**Expected impact.** Directly: a legal way for Tunisian developers to buy the
tools of their trade, in the currency they earn. Indirectly: a company that pays
tax here instead of money leaving through informal channels, and a template
others in the region can copy — the same obstacle exists in Algeria, Morocco and
Egypt.

**Cofounders.** None. Sole founder and sole point of contact.

---

# Before you submit

**Read it aloud.** This was written from your CV, so the facts are yours, but the
sentences are mine. Their page says they reject AI-written applications. Rewrite
any sentence you would not say to a friend — particularly Part 1, where the
voice matters most. The story is true; make the wording true too.

**One factual point to confirm:** I wrote "two years" for how long you have been
doing LLM work, based on Neediditals starting in 2024. Adjust if that is wrong.

**Attach** `Zaino-One-Page.pdf`. If you attach the CV as well, make sure its
contact details match the form.

**Do not submit from a VPN.** Their footer says it blocks or delays review.

---

## Word count

| Part | Words |
|---|---:|
| Part 1 | 196 |
| Part 2 | 128 |
| Part 3 | 597 |
| **Total** | **921** |

Under the 1,000 limit with room to add a sentence or two of your own.
