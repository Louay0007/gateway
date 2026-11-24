# Zaino Drive — structure plan v2

> **Status:** Proposed · **Owner:** CEO · **Date:** 2026-11-23
> **Supersedes:** `Zaino-Drive/` v1 (built 2026-11-23, same day)
> **Nothing has been built yet. This is the plan to approve.**

---

## 1. What changes from v1

v1 was organised like a company: Company, Product, Market, GTM. That is how a
board member thinks. It is not how a colleague thinks.

They open the Drive because they have a job to do — **make a post**, **check
the burn**, **understand the architecture**. They should land in a folder named
after that job, with the files already inside it.

**v1:** `04-Go-To-Market/02-Brand/Brand-Foundation.md` — three clicks to
discover there is no wordmark.
**v2:** `01-Brand/` — logos in the root, guidelines one click in, the gap
stated on the front page.

Every folder in v2 answers the same four questions, in this order:

| # | Question | Answered by |
|---|---|---|
| 1 | What is in here? | `_START-HERE.md` |
| 2 | What do I read first? | `_START-HERE.md`, numbered reading order |
| 3 | What is current? | a date at the top of every file |
| 4 | What is missing or blocked? | a **Gaps** section in `_START-HERE.md` |

That last one is the discipline v1 lacked and the reason folders rot. A folder
that admits its gaps gets filled. A folder that looks complete gets trusted
when it should not be.

---

## 2. The tree

Eleven audience folders, one start folder, one archive.

```
Zaino-Drive/
│
├── 00-START-HERE/          Read this once. The map.
├── 01-BRAND/               ← the branding team
├── 02-FINANCE/             ← whoever checks the numbers
├── 03-TECH/                ← whoever touches the system
├── 04-PRODUCT/             What we sell, at what price, with what features
├── 05-MARKETING/           Campaigns, social, site, by channel
├── 06-SALES/               Prospects, scripts, proposals, pipeline
├── 07-MARKET-RESEARCH/     The evidence base behind every claim
├── 08-FUNDING/             Grants, Startup Act, applications
├── 09-INVESTORS/           Deck, data room, cap table
├── 10-LEGAL-ADMIN/         Company papers, contracts, policies
├── 11-OPERATIONS/          Vendors, runbooks, uptime
└── 99-ARCHIVE/             Superseded only. Never deleted.
```

Numbering is for sort order in any file browser. It is not a hierarchy to
memorise — `00-START-HERE/_START-HERE.md` carries the "if you are the branding
person, open this" table.

---

## 3. `01-BRAND/` — the branding team's entire world

This is the folder they asked for first, so it is designed in full.

```
01-BRAND/
├── _START-HERE.md              What exists, what is missing, read in this order
├── Brand-Guidelines — v1.0 — 2026-11-23.md      ← the one document to read
│
├── 01-LOGOS/
│   ├── zaino-curved-z-white.png         EXISTS — the deck's mark
│   ├── logo-full.png                    EXISTS — outreach signature
│   ├── zaino-curved-z-black.png         ❌ MISSING — no dark-on-light glyph
│   ├── wordmark.svg                     ❌ MISSING
│   ├── favicon.ico / app-icon-1024.png   ❌ MISSING
│   └── _README.md                       clear space, min size, download rules
│
├── 02-COLOUR/
│   ├── palette.md                       the hex table, read from globals.css
│   ├── palette.svg                      swatch sheet, for pasting into decks
│   ├── tokens.json                      the raw oklch values, for engineers
│   └── _README.md                       which accent means what, and when
│
├── 03-TYPOGRAPHY/
│   ├── specimen.svg                     Inter Display + Inter, at real sizes
│   ├── type-scale.md                    every size in the deck and the product
│   ├── fonts/                           ❌ MISSING — licence files for handoff
│   └── _README.md
│
├── 04-VOICE/
│   ├── tone.md                          how Zaino writes: numbers first
│   ├── do-and-dont.md                   3 good, 3 bad, annotated
│   └── _README.md
│
├── 05-USAGE-RULES/
│   ├── logo-do-dont.svg                 visual do/don't, one page
│   ├── spacing-and-layout.md
│   └── _README.md
│
└── 06-TEMPLATES/
    ├── linkedin/                        6 templates, EXISTS
    ├── deck/                            reference to the repo's build.py
    └── document/                        ❌ MISSING — letterhead, invoice
```

**What the branding team finds on day one:** two logos, a written colour system
read from the real product tokens, a written voice guide, six LinkedIn
templates and the deck. That is a real, usable starting kit.

**What is honestly missing:** no wordmark, no dark glyph, no app icon, no font
licence files, no letterhead. `_START-HERE.md` says so on line one rather than
letting them discover it after an hour.

The brand folder's logo README carries the download rules — minimum size,
clear space, never recolour, never on a mid-tone — because the most likely
mistake is a colleague stretching the PNG.

---

## 4. `02-FINANCE/` — sheets, pictures, and a summary

They asked for **fully detailed sheets, fully pictured, with MD summaries**.
That is three outputs from one source, and the plan is built around not letting
the three drift.

```
02-FINANCE/
├── _START-HERE.md                    What is proven, what is assumed, read order
├── Finance-Report.html               ← the pictured report, open this first
│
├── 01-REVENUE/
│   ├── Pricing-Ladder.md             five tiers, from migration 0046
│   ├── Unit-Economics.md             per-plan cost and margin
│   └── Tier-Economics.xlsx           one row per plan, formulas live
│
├── 02-COSTS/
│   ├── Cost-Basis.md                 ⚠️ UNPROVEN — read the warning first
│   ├── Cost-Basis-Scenarios.xlsx     the four competing models, side by side
│   ├── Vendors.xlsx                  VPS, upstream, D17, Dodo, domains
│   └── Burn.md                       monthly fixed cost
│
├── 03-MODEL/
│   ├── Financial-Model.xlsx          8 quarters × 3 scenarios
│   └── Assumptions.md                every input, with its source
│
├── 04-FUNDING-NEED/
│   ├── Incorporation-Budget.md       the 1,885 DT lean figure
│   └── Runway.md                     months of runway at each cost level
│
└── charts/                           generated, never hand-made
    ├── 01-price-ladder.svg
    ├── 02-margin-by-plan.svg
    ├── 03-cost-basis-scenarios.svg
    ├── 04-incorporation-budget.svg
    ├── 05-break-even.svg
    ├── 06-market-ceiling.svg
    └── 07-burn.svg
```

### How the pictures get made — the one real decision

The repo already solved this for the deck. `plans/deck/build.py` holds geometry
and colour in one file so, in its own words, *"the PPTX and the preview
screenshots cannot drift."* The same pattern applies here.

**Recommended:** `02-FINANCE/build.py` + `data.yaml` → `charts/*.svg` +
`Finance-Report.html`.

- One file of numbers. Change a price, re-run, every chart and the report update.
- Reuses the brand palette already defined in `build.py`.
- SVG scales, so the same chart works in the report, a LinkedIn post and a deck.
- The alternative — charts drawn by hand in Excel — is what produced *four
  different margins* circulating in the repo today.

**Fallback:** charts inside the xlsx, exported. Simpler to start, drifts within
a month.

### The honesty rule for this folder

⚠️ **A picture makes a number look proven.** That is exactly the risk here.

The margin chart rests on a cost basis (0.20 DT / 1M) that **no invoice
supports**, and the repo holds four mutually exclusive margins (~90%,
unbounded, deeply negative, ~21%).

So the plan requires:

1. `03-cost-basis-scenarios.svg` exists **and shows all four models**, with the
   divergent results visible. It is the honesty chart, not a marketing one.
2. `02-margin-by-plan.svg` carries a visible banner: **"assumed cost basis — no
   invoice."** Same on the HTML report.
3. No margin figure leaves this folder for a deck or an application until
   `Cost-Basis.md` loses its warning.

Without those, a beautiful finance folder makes the company's biggest open risk
*worse*, because it becomes harder to see that it is a risk.

---

## 5. `03-TECH/` — where we are, obstacles, goals

They asked for exactly three things, so those three are the top of the folder.

```
03-TECH/
├── _START-HERE.md                60-second orientation, read order
├── 01-Where-We-Are.md            ← asked for
├── 02-Obstacles.md               ← asked for
├── 03-Goals.md                   ← asked for
│
├── 04-Architecture.md            the system in 4 pages, plain language
├── 05-Quality.md                 tests, migrations, audits, deploy
├── 06-Runbooks/
│   ├── Deploy.md
│   ├── Restore.md                ⚠️ untested — a backup you have not restored is a hope
│   └── Incident.md
└── 07-Decisions.md               why it is built this way (ADR-lite)
```

**`01-Where-We-Are.md`** — one page: what ships today, on what, in what state.
The five plans, the two rails (D17 live, Dodo test-mode), one VPS, 50
migrations, deploy = push to `main`. Written for a reader who is technical but
new.

**`02-Obstacles.md`** — the honest list, each with impact and owner:

| Obstacle | Why it matters |
|---|---|
| Cost basis unproven | Every price and margin is a guess |
| Resale approval not in writing | The whole business model is unconfirmed with the upstream |
| Card rail in test mode | Solo, Team and Business sell on D17 only |
| Up to 20 min unmetered spend | Unbounded cost exposure on a burst |
| No tested restore | One disk failure is the company |
| `CHAT_KEY_SECRET` absent from `.env.example` | A fresh deploy fails obscurely |
| No daily rollup | Reporting drift, slow to notice |

**`03-Goals.md`** — three horizons (30 / 90 / 365 days), each goal written so
you can tell whether it happened. Not "improve reliability" — "a restore
rehearsed from backup, timed, documented."

The 1,400-line `PLATFORM.md` / `BLUEPRINT.md` / `DESIGN.md` **stay in the
repo**. `04-Architecture.md` explains them in four pages and links out. Nobody
reads a blueprint in a Drive.

---

## 6. The remaining folders

| Folder | Root contents | Summary doc |
|---|---|---|
| `04-PRODUCT` | Plans, features, roadmap, design system pointer | `Product-Overview.md` |
| `05-MARKETING` | Strategy, LinkedIn, website copy, exported assets | `Marketing-Summary.md` |
| `06-SALES` | Pipeline.xlsx, prospects, outreach, scripts | `Sales-Summary.md` |
| `07-MARKET-RESEARCH` | Pré-label research, competitive table, customer notes | `Market-Summary.md` |
| `08-FUNDING` | Startup Act path, applications, tracker.xlsx | `Funding-Summary.md` |
| `09-INVESTORS` | Deck A, data room, cap table | `Investor-Summary.md` |
| `10-LEGAL-ADMIN` | Incorporation, contracts, terms, privacy | `Legal-Status.md` |
| `11-OPERATIONS` | Vendors, metrics, uptime | `Operations-Summary.md` |

Same pattern everywhere: `_START-HERE.md` + numbered subfolders + one summary
md + a Gaps section.

`05-MARKETING` and `01-BRAND` stay separate on purpose. Brand is the system
(colour, type, logo); marketing is the use (this week's post). Mixing them is
how a brand guide becomes a folder of old PNGs.

---

## 7. What happens to v1

v1 is uncommitted, so this is cheap. Rebuild in place:

| v1 artifact | Fate |
|---|---|
| `README.md` (structure, naming, access tiers, 7 contradictions) | **Keep** — becomes `00-START-HERE/_START-HERE.md` |
| `00-Start-Here/Glossary.md` | **Keep** — moves to `00-START-HERE/` |
| `00-Start-Here/Document-Inventory.md` | **Keep** — update paths for v2 |
| `04-Go-To-Market/02-Brand/Brand-Foundation.md` | **Keep** — becomes `01-BRAND/Brand-Guidelines` |
| All copied repo docs | Re-sorted into the new folders |
| `.gitignore` | **Keep** |

Nothing is lost. v1's three written documents were the good part; they move and
get better.

---

## 8. What cannot be filled today

A structure is only honest if it names its empty rooms. These stay visibly
empty, with a `_README.md` saying why:

| Missing | Blocks |
|---|---|
| Cost-basis invoice | Every margin figure, every deck |
| Wordmark + dark logo + app icon | Every light-background asset |
| Financial model | Every diligence call |
| Cap table | Any equity conversation |
| Architecture explainer (4 pages) | Non-technical readers |
| Founder + product video | SMU submission, 6 Dec deadline |
| Any customer evidence | All of sales and marketing |

---

## 9. Build order

1. **Skeleton + `00-START-HERE`** — the map that makes the rest navigable.
2. **`01-BRAND`** — the folder they asked for first; most material exists.
3. **`03-TECH`** — three written docs, no new assets needed.
4. **`02-FINANCE`** — needs the build script and the honesty banners.
5. **`04`–`11`** — mechanical sorting of what exists.
6. **`99-ARCHIVE`** — stale docs with archive notes.

Brand and Tech are a day. Finance is a day because of the charts. The rest is
sorting.

---

## 10. Decisions to make

| # | Decision | Recommendation |
|---|---|---|
| 1 | Finance pictures: build script or Excel charts? | **Build script** — one source of numbers, cannot drift |
| 2 | Margin charts before the cost basis is proven? | **Yes, but banner-labelled "assumed"** — hiding the number is worse than qualifying it |
| 3 | Delete v1 or rebuild in place? | **Rebuild in place** — three documents carry over |
| 4 | Folders for people we have not hired yet? | **Yes** — `05-MARKETING` and `06-SALES` exist empty, so a new hire lands in a home |
