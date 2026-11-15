# Zaino — LinkedIn Slide Research & Master Prompt

**Written:** 2026-11-07
**What this is:** the evidence on what actually works in LinkedIn startup
carousels, then one fully-specified prompt to build Zaino's deck.
**Supersedes:** the "5 posts × 8 slides" format assumption in
`linkedin-marketing-posts.md` §5.

---

## 1. What the research actually says

Four independent datasets, all 2025–2026, 1.3M–3M+ posts each. They agree on
the format and disagree, usefully, on the length.

### 1.1 Document posts are the best-performing format on LinkedIn

| Source | Corpus | Finding |
|---|---|---|
| Socialinsider, *2026 LinkedIn Benchmarks* | 1.3M posts, 16,645 pages | Native documents = **7.00 % engagement**, highest of any format, **+14 % YoY** |
| AuthoredUp | 3M+ posts, personal profiles | Documents = **1.39× reach**, **1.30× engagement** vs average; among top-5 % profiles **1.72× / 1.63×** |
| MagicPost | 67,765 carousels | Median 34 likes / 9 comments — ties for best of any format |
| Metricool, *2026 Study* | 673,658 posts | Carousels lead on impressions for company pages |

And the supply side, which is the actual opportunity: documents are only
**4.88 % of all LinkedIn posts** (AuthoredUp). Highest return, least used.

> Why it works mechanically: carousel swipes register as engagement, and
> dwell time is the signal the algorithm optimises for. A 12-slide deck
> generates up to 12 interaction events from one reader.

### 1.2 Length: the advice and the data disagree

The universally repeated advice is **8–12 slides**. The measured data says
something sharper:

| Slides | Carousels measured | Median likes |
|---|---|---|
| 2–5 | 11,829 | 22 |
| 6–8 | 22,373 | 26 |
| **9–12** | 21,978 | **49** |
| 13–20 | 8,270 | 58 |
| 21+ | 3,315 | 60 |

— MagicPost, 67,765 carousels

**Engagement nearly doubles at 9–12** and keeps climbing. The median carousel
is only 8 slides; the 90th percentile is 15. Most people stop exactly where
the payoff starts.

**The caveat, which the sources state but the headline numbers hide:** more
slides means more swipe events, and swipes are counted as engagement. So part
of the 13–20 uplift is a measurement artefact, not proof that readers loved a
longer deck. The honest reading is:

- **9–12 slides** is the real sweet spot — clear measured uplift, and every
  slide can still carry a real idea.
- **13–20** only wins if you genuinely have that many distinct points.
- **Beyond 15, completion drops** even as total engagement rises. You are
  trading depth of reading for count of swipes.

**Decision for Zaino: 12 slides.** It sits at the top of the measured sweet
spot, and the product genuinely has twelve distinct things to say.

### 1.3 Format and design specs

| Spec | Value | Source consensus |
|---|---|---|
| Canvas | **1080 × 1350** (4:5) | Best mobile real estate; 1080 × 1080 is the "safer cross-device" fallback |
| File | **PDF** (also PPT/PPTX/DOC/DOCX) | One document per post |
| Max size | 100 MB | Keep under 3–10 MB |
| Max pages | 300 | Do not approach |
| Safe margin | **~100 px** on a 1080 canvas (~10 %) | Keep key content in the centre 80 % |
| Body text | **≥ 24 px**, ideally 32 px | Some guides say 14–18 px — ignore those, they are written for other platforms |
| Headings | **36–48 px minimum**, up to 72 px | Headline must dominate or it will not pull the eye |
| Words per slide | **under 35–60** | "One idea per slide" is the single most repeated rule |
| Colour | RGB, 150–300 DPI | Contrast ≥ 4.5:1 |
| Links inside PDF | **not clickable** | Put the URL as visible text and in the first comment |

### 1.4 The hook slide is the whole ballgame

It is the only slide most people see, because it is the feed thumbnail.

The reliable formula, from the sources that measured it:

```
[who it's for] + [the gap or tension] + [the payoff]
```

- **Under ~60 characters** so it survives thumbnail scale.
- 5–8 words for the headline.
- Never open with the product or feature name. Open with the problem.

Two concrete examples of the difference:

| Weak | Strong |
|---|---|
| "Introducing Zaino AI, our new LLM gateway" | "You're paying for tokens you never use" |
| "5 lessons from building a startup" | "We bill AI by the day. Here's why that matters." |

### 1.5 Structure that works for explaining an idea

The convergent structure across the product-marketing and founder sources:

```
Hook → Context (the stakes) → Value (3–5 slides, one idea each)
     → Summary → single CTA
```

And specifically for a **launch**, the sequence is:

```
Problem → what changed → who it helps → next step
```

The strongest finding across 3,000 viral SaaS launch posts: **show, don't
tell.** Posts that visually demonstrated the product beating a real problem
outperformed text-heavy announcements every time. And the weakest launches
all shared one signature — a single "we're live!" post, then silence. The
strongest were a story arc across one to two weeks.

### 1.6 One correction to the pitch-deck instinct

You asked about *startups presenting their idea*. Worth separating two
artefacts that get conflated:

| | Investor pitch deck | LinkedIn explainer carousel |
|---|---|---|
| Audience | VC, 3–4 minutes, has context | Developer scrolling, 8 seconds, has none |
| Slides | 11–13 funded average (15–20+ unfunded) | 9–12 |
| Opens with | Problem or traction | **Hook that earns the swipe** |
| Market size | Required | Skip it |
| Team | Required | Skip it |
| Ask | Required | Only the trial |

The deck research (Sequoia/YC 10-slide canon; traction in 92 % of funded decks
vs 57 % unfunded) is useful for *what to prove*. It is misleading for *how to
open*. A VC reads slide 1 knowing why they are there; a LinkedIn reader does
not. Do not put your team slide in a carousel.

---

## 2. What this means for Zaino specifically

Three conclusions follow from the data, and they are not the ones I gave you
earlier:

1. **Build one flagship 12-slide deck, not twelve 8-slide carousels.** The
   measured uplift at 9–12 assumes a deck that earns the length. Zaino's core
   idea needs about twelve beats to land: the problem, the inversion, the
   proof, the moat, the tiers, the qualification, the offer.

2. **Lead with the reader's waste, not the product.** "You pay for tokens you
   never use" is the hook. "Une clé, deux formats" is slide 6, not slide 1.
   The product is the answer; it cannot be the question.

3. **The moat slide is the differentiator, and most startups cannot write it.**
   Everyone can claim a feature. Almost nobody can say "our cost structure is
   fixed, therefore generosity is free for us and expensive for a competitor."
   That belongs at slide 8, immediately before the pricing, because it is what
   makes the price believable.

---

## 3. The deck — 12 slides

| # | Slide | Job | The one idea |
|---|---|---|---|
| 01 | Hook | Earn the swipe | You pay for tokens you never use |
| 02 | The fiction | Context | A monthly ceiling assumes you consume evenly. You don't. |
| 03 | The waste | Quantify it | 3M budget, 15 % used, 2.55M paid for nothing |
| 04 | The inversion | The turn | 100M a day, reset at midnight |
| 05 | What one day looks like | Make it concrete | A heavy day costs a day, not a month |
| 06 | What you get | Product | One key, two native formats, four tiers |
| 07 | How you wire it | Proof it's real | Two lines change. Not an SDK. |
| 08 | Why we can afford it | The moat | Fixed upstream cost = structural, not a promo |
| 09 | The meter | Trust | Counted once. Published our own bugs. |
| 10 | Who it's for | Qualification | Developer, irregular usage, no sales call |
| 11 | The price | Offer | Starter 50 DT, Pro 90 DT, 3 days free |
| 12 | CTA | Act | zaino.soon.it/pricing |

Note the shape: the first four slides are all about *the reader's problem*.
Zaino does not appear as a product until slide 6. That is deliberate and it is
what the launch data says works.

---

## 4. THE MASTER PROMPT

Paste the block below into a design-capable model, or use it as the build
brief. Replace nothing except `[TODAY'S DATE]`.

It is written to be self-contained: colours, sizes, positions, copy, and the
trademark rule are all inside it.

```
You are building a 12-slide LinkedIn document post (carousel) for a startup
called Zaino. Produce one 1080×1350 PNG per slide, plus a single combined PDF.

════════════════════════════════════════════════════════════════
A. HARD CONSTRAINTS — do not deviate
════════════════════════════════════════════════════════════════

Canvas:      1080 × 1350 px per slide (4:5 portrait). All 12 identical.
Output:      12 PNGs, RGB, then one PDF, one page per slide, under 10 MB.
Safe zone:   keep all text within 88 px of the left and right edges,
             92 px of the top, 84 px of the bottom.
Density:     maximum 35 words per slide. One idea per slide. No exceptions.
Contrast:    ≥ 4.5:1 everywhere.

TRADEMARK RULE — non-negotiable:
Do NOT include any third-party logo (Anthropic, Claude, OpenAI, ChatGPT,
Cursor, GCP, or any other vendor mark). Do NOT draw an abstract shape that
evokes the Claude asterisk, the OpenAI blossom, or any similar mark.
Compatibility with those services is expressed in plain text only.
The only logo anywhere in this deck is Zaino's own.

════════════════════════════════════════════════════════════════
B. VISUAL SYSTEM
════════════════════════════════════════════════════════════════

The brand is MONOCHROME BY DESIGN. There is no accent colour. Emphasis
comes from scale and weight, never hue.

Palette (use these exact hex values, nothing else):
  #000000  ground, every slide background
  #FAFAFA  primary type
  #A1A1A1  secondary type, captions, muted labels
  #262626  hairline rules, inactive bars
  #171717  panels and cards
  #0D0D0D  inset panels (code blocks)
  #525252  footer text, slide numbers, tertiary notes
  #FF6467  RESERVED. Use only to mark loss or waste. Maximum one
           element per slide, and only on slides 03 and 11.

Typography:
  One family only: Helvetica Neue / Helvetica / Arial (or Inter).
  Two weights only: 600 for headings, 400 for body.
  Slide headline:  64–104 px, weight 600, letter-spacing -0.04em,
                   line-height 0.98–1.06.
  Hero number:     up to 150 px, weight 600, tabular figures.
  Body:            32–34 px, line-height 1.42, colour #A1A1A1.
  Footer:          27 px, colour #525252.
  All figures use tabular (monospaced) numerals.

Persistent elements — identical on all 12 slides:
  Logo        top-left. A white-on-transparent "Z" mark, 66 × 66 px,
              placed 88 px from the left edge and 92 px from the top.
              Reserve this space in your layout; the real asset is
              composited afterwards, so leave it blank.
  Wordmark    "Zaino" immediately right of the logo, 20 px gap,
              31 px, weight 600, letter-spacing -0.02em, colour #FAFAFA.
  Footer      bottom-left: the text "zaino.soon.it", 27 px, #525252.
  Slide no.   bottom-right: two digits "01"–"12", 27 px. The current
              slide's number is #FAFAFA; on all others it would be
              #525252 — since each slide shows only its own number,
              render it in #FAFAFA.

Style: Swiss editorial. Generous negative space. Perfect optical
alignment. Flat: no gradients, no shadows, no glows, no 3D, no texture,
no icons, no illustrations, no stock photography, no robots, no brains,
no handshakes. Every slide must look like it came from a design-system
specification sheet.

════════════════════════════════════════════════════════════════
C. THE 12 SLIDES — exact copy
════════════════════════════════════════════════════════════════

Write the text EXACTLY as given. French must carry correct accents.
Do not add, shorten, or rephrase. Do not add emoji.

────────────────────────────────────────
01 — HOOK
Layout: T1 Statement
Headline (96 px, 3 lines, left-aligned, upper-middle):
    Vous payez
    des tokens
    que vous n'utilisez pas.
Rule: 120 × 5 px, #FAFAFA, 44 px below the headline.
Sub (34 px, #A1A1A1):
    Un quota mensuel suppose une consommation régulière.
    Un projet d'agent n'en a pas.

────────────────────────────────────────
02 — THE FICTION
Layout: T1 Statement
Eyebrow (26 px, #A1A1A1, letter-spacing .14em, uppercase): LE PROBLÈME
Headline (72 px, 3 lines):
    Un plafond mensuel
    punit le comportement
    qu'il prétend financer.
Rule.
Sub (34 px, #A1A1A1):
    Un projet d'agent brûle 90 % de son budget en trois jours,
    puis plus rien pendant deux semaines.

────────────────────────────────────────
03 — THE WASTE
Layout: T3 Numbers
Headline (64 px, 2 lines):
    Payé pour 100 %.
    Utilisé 15 %.
Three rows, each #171717 panel, radius 16 px, 34 px padding,
label left 28 px #A1A1A1, figure right 60 px mono weight 600:
    Plafond mensuel        3 000 000
    Consommé                 450 000     (figure colour #A1A1A1)
    Payé pour rien         2 550 000     (figure colour #FF6467;
                                         1 px border rgba(255,100,103,.3))
Sub (32 px, #FAFAFA, 44 px below):
    Un quota journalier ne laisse pas de reste.

────────────────────────────────────────
04 — THE INVERSION
Layout: T1 Statement
Eyebrow: L'INVERSION
Headline (104 px, 2 lines):
    100 millions de tokens
    par jour.
Rule.
Line (42 px, #FAFAFA, weight 500):
    Remis à zéro à minuit.
Sub (32 px, #A1A1A1, 14 px below):
    Par modèle. Pas de plafond mensuel.
    Pas de limite par minute.

────────────────────────────────────────
05 — ONE DAY
Layout: T2 Comparison
Headline (64 px, 2 lines):
    Le même budget.
    Deux fenêtres.
Panel A (#171717, radius 20 px, 36 px padding):
    Label 26 px uppercase #A1A1A1:  PLAFOND MENSUEL
    Bar: 24 px tall, radius 4 px, track #262626, filled 15 % in #FF6467
    Caption 26 px #A1A1A1:  Facturé 30 jours. Utilisé 2.
Panel B (same, 40 px below):
    Label:  JOUR ZAINO
    Bar: full width, filled in #FAFAFA
    Caption:  Remis à zéro à minuit.
Centred line (34 px, #FAFAFA, 44 px below):
    Un jour lourd ne détruit pas un jour.

────────────────────────────────────────
06 — WHAT YOU GET
Layout: T7 Tier rows
Eyebrow: LE PRODUIT
Headline (64 px):
    Une clé. Deux formats natifs.
Four tier rows, each #171717 radius 16 px, 132 px tall, 22 px apart:
    a 4 × 44 px #FAFAFA vertical rule, then the tier name 52 px
    weight 600, then the description right-aligned 27 px #A1A1A1:
    Fast      réponses courtes
    Smart     le défaut
    Frontier  raisonnement profond
    Fable     longues trajectoires
Note (26 px, #525252, 36 px below):
    Aucun nom de fournisseur n'apparaît sur cette page.

────────────────────────────────────────
07 — HOW YOU WIRE IT
Layout: T4 Terminal
Headline (64 px, 2 lines, 48 px above the panel):
    Deux lignes.
    Pas un SDK.
Panel (#0D0D0D, radius 20 px, 40 px padding), mono 31 px, line-height 1.65:
    # avant                                    (colour #525252)
    base_url: api.autre.dev/v1                 (colour #FAFAFA)
    api_key:  sk-...                           (colour #FAFAFA)
    1 px #262626 divider, 22 px above and below
    # après                                    (colour #525252)
    base_url: api.zaino.soon.it                (underline the URL with a
                                                2 px #FAFAFA border-bottom)
    api_key:  zn-...                           (underline the key likewise)
    26 px blank
    # le reste du code : inchangé              (colour #525252)

────────────────────────────────────────
08 — WHY WE CAN AFFORD IT
Layout: T2 Comparison (two side-by-side panels)
Headline (64 px, 2 lines):
    Notre coût est fixe.
    Le vôtre devient prévisible.
LEFT panel (#171717, 430 px wide, 560 px tall, radius 20 px):
    Label 26 px #A1A1A1:  COÛT PAR TOKEN
    12 stacked horizontal bars, each 10 px tall, #262626, increasing in
    length downward; the last one extends past the panel edge and is
    clipped, drawn in #FF6467.
RIGHT panel (same size):
    Label:  COÛT FIXE
    A single perfectly flat 10 px #FAFAFA line spanning the panel,
    repeated twice, with 24 px #A1A1A1 text beneath: "même coût"
Centred line (34 px, #FAFAFA):
    Une promotion se copie. Pas une structure.

────────────────────────────────────────
09 — THE METER
Layout: T3 Table (hairlines, no boxes)
Eyebrow: LA CONFIANCE
Headline (64 px, 2 lines):
    Un token.
    Compté une fois.
Four rows, 90 px each, separated by 1 px #262626 hairlines, no
outer border, label left 30 px #A1A1A1, value right 34 px mono #FAFAFA:
    entrée              fresh_input
    sortie              output
    écriture de cache   cache_write
    lecture de cache    cache_read
2 px #FAFAFA rule, full width, under the table.
Line (30 px, #FAFAFA):
    Une addition. Une colonne. Aucun lecteur divergent.
Note (26 px, #525252):
    591 tests · 35 migrations · 37 tables

────────────────────────────────────────
10 — WHO IT'S FOR
Layout: two panels, side by side
Headline (60 px):
    Pour qui c'est.
LEFT panel (#171717, 430 px wide, 720 tall, radius 18 px):
    Header 26 px uppercase #A1A1A1:  POUR
    Four lines, 30 px #FAFAFA, each preceded by an 8 px #FAFAFA square:
      développeur
      Claude Code
      une clé, pas un devis
      usage irrégulier
RIGHT panel (same size):
    Header:  PAS POUR
    Three lines, 30 px #A1A1A1, each preceded by an 8 px hollow square
    outlined 1.5 px in #525252:
      chatbot
      contrat sur mesure
      carte bancaire
Centred line (32 px, #FAFAFA):
    Dire non tôt coûte moins cher que dire oui tard.

────────────────────────────────────────
11 — THE PRICE
Layout: two pricing cards
Headline (60 px):
    Deux plans. Un plafond.
LEFT card (#171717, 430 × 660, radius 20 px):
    Name 34 px #A1A1A1:      Starter
    Price 96 px #FAFAFA weight 600:  50 DT   with 26 px #525252 suffix "/mois"
    Two bullets, 26 px #A1A1A1:   Fast · Smart / 3 clés
RIGHT card (same):
    Name:      Pro
    Price:     90 DT /mois
    Bullets:   Smart · Frontier · Fable / 15 clés
    A 2 px #FAFAFA horizontal rule spans the full card width, 24 px below
    the plan name — the only mark of the recommended plan.
Centred lines below (30 px #FAFAFA, then 26 px #525252):
    3 jours d'essai. Sans carte.
    Virement D17 · facture sur demande

────────────────────────────────────────
12 — CTA
Layout: T5 Offer, fully centred
Hero (132 px, weight 600, 2 lines):
    3 jours.
    Sans carte.
Rule (120 × 5 px, #FAFAFA, 44 px above and below).
Sub (34 px, #A1A1A1, centred):
    100M de tokens par jour.
    Remis à zéro à minuit.
URL (36 px, #FAFAFA, weight 500, 56 px below):
    zaino.soon.it/pricing

════════════════════════════════════════════════════════════════
D. SELF-CHECK BEFORE YOU RETURN ANYTHING
════════════════════════════════════════════════════════════════

For each of the 12 slides, verify and state:
  1. All text sits inside 88 px left/right, 92 px top, 84 px bottom.
  2. No word is clipped, no line overflows its container.
  3. Word count ≤ 35.
  4. Only palette colours are used; #FF6467 appears on slides 03 and
     11 only, at most once each.
  5. The logo area (66 × 66 at 88, 92) is empty.
  6. No third-party logo or lookalike anywhere.
  7. French accents are correct.
  8. Slide number matches the slide.

Then return: 12 PNGs, the combined PDF, and the eight checks per slide
as text.
```

---

## 5. Per-slide prompts (if you generate individually)

If your tool handles one image per call, use the master prompt as the
system/context, then this per slide:

```
Using the Zaino visual system above (monochrome, #000000 ground,
#FAFAFA type, Swiss editorial, 1080×1350), produce ONLY slide [N].
Copy exactly as specified in section C. Leave the 66×66 logo area at
(88, 92) empty. No third-party logos.
```

Why one prompt rather than twelve: the persistent elements (logo position,
wordmark, footer, slide number, type scale) must be **identical** across all
twelve. Generating them separately from a shared spec invites drift. If you
must split, generate slide 01 first, then feed it back as a style reference
for the rest.

---

## 6. Production checklist

- [ ] **12 slides, all exactly 1080 × 1350.** One wrong ratio crops badly in feed.
- [ ] **Export a single PDF**, one page per slide, under 10 MB.
- [ ] **Composite the real logo** — `portal/public/logo/zaino-curved-z-white.png`
      (256 × 256, white on transparent) into the reserved 66 × 66 area. Never
      let a generator draw your mark.
- [ ] **Re-set body text by hand if the generator mis-accented French.** It
      will.
- [ ] **Links are not clickable inside a PDF.** Put `zaino.soon.it/pricing` as
      visible text on slide 12, and in the first comment.
- [ ] **Caption opens with the hook**, not "Voici notre nouveau carrousel".
      Add an explicit swipe instruction: *"Les 12 slides expliquent le calcul."*
- [ ] **First comment** carries the link.
- [ ] **Alt text on the document** — write one paragraph describing the whole
      deck, since a PDF gets a single description.

### Before you post, two blockers remain open

1. **The paywall shows 80M/32M** against a live 100M/day
   (`paywall-state.tsx:50`). Slide 04 and slide 11 both say 100M. Fix it first,
   or the product contradicts the deck on the one number the deck is about.
2. **No `/connect` page.** Slide 07 tells readers it is "two lines", and then
   there is nowhere to land that proves it. This is the highest-leverage page
   in the repo for this campaign.

---

## 7. Sources

- Socialinsider, *2026 LinkedIn Benchmarks* — 1.3M posts, 16,645 pages
- AuthoredUp, *Best Performing Content on LinkedIn in 2026* — 3M+ posts
- MagicPost, slide-count study — 67,765 carousels
- Metricool, *LinkedIn Study 2026* — 673,658 posts
- Socialinsider, *LinkedIn Carousels: Specs & Best Practices*
- Buffer, *LinkedIn carousels experiment* — 1M+ posts
- Sequoia / YC seed-deck canon; DocSend–Harvard, *The science behind developing
  a successful pitch deck* (pre-seed vs seed, slide order by frequency)
- Stripe Atlas, *Starting your fundraising pitch deck* — acts, not slides
- J.P. Morgan, *Creating an Investor Pitch Deck*
