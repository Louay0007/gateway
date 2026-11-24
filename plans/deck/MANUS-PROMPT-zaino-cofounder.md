# Manus prompt — "Zaino AI" co-founder briefing deck (12 slides)

Copy everything below the line into Manus as a single message. It is written to be
self-contained: Manus needs no access to the repo.

---

# TASK

Build a **12-slide presentation** (16:9, 13.333 × 7.5 in) that explains **Zaino AI**
end-to-end to a co-founder who has not seen the project yet.

Audience: one person, technically literate, joining the company. Goal is
**understanding**, not fundraising. By slide 12 they must be able to answer, unaided:
what Zaino sells, why anyone in Tunisia pays for it, what the product actually is,
how the money works, who the competitor is, what is built, what is not, and what
their own first job is.

Deliver **both** a `.pptx` and a `.pdf`, plus a Markdown file containing all speaker
notes. If a tool cannot produce `.pptx`, produce Google Slides and export.

---

# HARD RULES — read before designing anything

1. **Never invent a number.** Every figure you may use is in the "NUMBERS" section.
   If a slide needs a figure that is not there, write `[TBD]` and list it in a final
   "open items" note. Do not round, extrapolate, or estimate.
2. **Never claim traction.** Zaino has **zero paying customers**. Never write
   "customers", "users", "revenue", "growth", "traction", "partners", or a logo wall.
   The honest frame is "built, pre-revenue".
3. **Never say the card rail is live.** D17 is live. Dodo (cards) is built and in
   **test mode**. These are two different things and the deck must say so.
4. **Do not name the upstream supplier.** Call it "the upstream provider" or
   "the wholesale block". Zaino resells; naming the supplier creates legal exposure.
5. **No stock photography.** No robots, brains, circuits, glowing servers, handshakes,
   or people at laptops. Allowed visuals: typography, flat diagrams, tables, one
   product screenshot placeholder per slide at most, and abstract hairline geometry in
   the brand palette.
6. **One idea per slide.** Maximum ~40 words of visible text per slide (titles,
   labels and table cells count; footnotes do not). Everything else goes in speaker
   notes.
7. **Every slide carries a footer** with the source line (given per slide) and the
   slide number, bottom-right, in 8 pt muted grey.
8. **16:9 only.** No 4:3, no vertical, no animated transitions, no slide-master clip
   art, no gradients, no drop shadows, no rounded corners except where specified.

---

# BRAND — reproduce exactly

Zaino's identity is **near-monochrome Swiss editorial with one emerald accent**.
Restraint is the brand. Nothing should look like a SaaS template.

## Canvas and margins (inches, on a 13.333 × 7.5 canvas)

| Property | Value |
|---|---|
| Left margin | 0.75 |
| Right margin | 0.75 (content width = 11.833) |
| Eyebrow (kicker) baseline | y = 0.62, 10.5 pt, bold, letter-spacing 1.4 pt, ALL CAPS |
| Title top | y = 0.92, 37 pt, bold, line height 1.04 |
| Body text starts at or below | y = 2.16 |
| Footer hairline | y = 6.92, 0.5 pt |
| Footer text baseline | y = 7.03, 8 pt |

## Colour palette — use these hex values, nothing else

| Token | Hex | Where it is used |
|---|---|---|
| `INK` | `#0A0A0A` | All headline and body text on light slides |
| `GRAPHITE` | `#171717` | Dark full-bleed slide backgrounds; the logo tile; the one dark emphasis panel |
| `MUTED` | `#6F6F6F` | Secondary body copy, eyebrow labels, footers, table header row |
| `BORDER` | `#E5E5E5` | Hairlines, card outlines, table rules |
| `SURFACE` | `#F5F5F5` | Flat fill behind a light card or callout panel |
| `WHITE` | `#FFFFFF` | Slide background, and all text on dark slides |
| `EMERALD` | `#059669` | The **only** accent: eyebrows, section rules, data marks, one emphasis number, the "popular" tag |
| `EMERALD_DARK` | `#047857` | A second emerald only when two weights are needed in one figure |
| `CLAY` | `#B45309` | Risk, negative, "not yet proven" — and nothing else |
| `PAPER` | `#FAFAFA` | Optional warm off-white panel, used sparingly |

Rules:
- Emerald appears **once or twice per slide**, never as a background block for a
  whole slide, never as a gradient.
- Clay is **never** used decoratively. If a slide has no risk, it has no clay.
- No other colour exists in this deck. No blues, no purples, no second accent.
- Charts use exactly two series colours: `EMERALD` and `GRAPHITE`, 1.75 pt lines,
  4 pt markers, no data labels, no gridlines, no value axis.

## Typography

| Role | Font | Weight | Size |
|---|---|---|---|
| Display (titles, hero numbers) | **Inter Display** | Bold | 37 pt titles; 44–74 pt hero figures |
| Body | **Inter** | Regular | 12.5–13.5 pt at 1.5 line height |
| Body emphasis | **Inter** | SemiBold | 11.5–12 pt |
| Labels / eyebrows | **Inter** | Bold, ALL CAPS, tracking 1.0–1.4 pt | 9–10.5 pt |
| Footers | **Inter** | Regular | 8 pt |
| Table cells | **Inter** | Regular, first column SemiBold | 11.5–13 pt, row height 0.48–0.60 in |

If Inter Display is unavailable, use Inter Bold with −1% tracking. **Never** substitute
a serif, never use a default PowerPoint/Google font, never mix a third family.

Two weights maximum per slide (Regular + Bold). Numbers are set large — a percentage
that carries the business case should be the largest object on its slide.

## Logo lockup

A **graphite rounded square tile** (radius ≈ 18% of the tile, `#171717`), with a
**white curved "Z" glyph** centred inside at 62% of the tile size, plus the wordmark
**"Zaino AI"** in Inter Display Bold immediately to the right (0.17 in gap), vertically
centred on the tile.

- On light slides: tile `#171717`, wordmark `#0A0A0A`.
- On the dark title/closing slides: tile `#2A2A2E` with a 1 pt `#55555C` outline and a
  0.012 in specular hairline `#4A4A4F` along its top edge, wordmark `#FFFFFF`.
- Tile sizes: 0.52 in on content slides, 0.62 in on title and close.

If you have no glyph file, render the curved "Z" yourself as a white mark with the
same optical weight — do not use a plain letter in a circle, and do not use an emoji.

## Layout vocabulary (reuse these, do not invent new ones)

- **Eyebrow → title → rule → content** on every content slide.
- **Hairline tables**: no fills, no vertical rules, 0.5 pt `#E5E5E5` horizontal rules
  only, header row in `MUTED` 9.5 pt caps, one highlighted row with a `#ECFDF5`
  (very pale emerald) fill.
- **Cards**: 1 pt `#E5E5E5` outline, no fill, radius 3.5% — or a `#F5F5F5` fill with no
  outline. Never both.
- **Stat blocks**: 34–74 pt figure in Inter Display Bold, 11 pt muted caption beneath
  at 1.35 line height.
- **Numbered step chain**: three equal panels left-to-right with a small grey right
  arrow between them; the last panel is `#171717` with white text.
- **Footer**: hairline at 6.92, source text left in 8 pt `#6F6F6F`, slide number
  right in 8 pt `#6F6F6F` formatted `01`…`12`.

---

# NUMBERS — the only figures you may use

**Product / plans (monthly, in Tunisian dinars):**

| Plan | Price | Shared pool (weighted units) | Models unlocked | API keys | Daily cap |
|---|---|---|---|---|---|
| Solo | 39 DT | 35M | Fast, Smart | 2 | 3.5M |
| Starter | 50 DT | 50M | Fast, Smart | 3 | 3M |
| Pro | 90 DT | 50M | Smart, Frontier, Fable | 15 | 8M |
| Team | 250 DT | 150M | Smart, Frontier, Fable | 30 | 15M |
| Business | 500 DT | 400M | Smart, Frontier, Fable | 100 | 40M |

USD equivalents shown on the pricing page: $13 / $15 / $30 / $80 / $160.
Trial: free, 3 days, 1M tokens, 1 key, 250k/day.

**What a pool means (this is the single most misread thing — explain it twice):**
the pool is **weighted units**, one pool per plan, spendable on any model the plan
unlocks. Weights: Fast = 1/3, Smart = 1, Frontier = 5, Fable = 5. So a 50M pool is
**150M Fast tokens, or 50M Smart, or 10M Frontier**. It is **not** 50M per model.

**Model aliases (never use the vendor names in customer-facing copy):**
`fast` (Haiku-class) · `smart` (Sonnet-class) · `frontier` (Opus-class) · `fable`.
Four aliases, four capability tiers, one meter.

**Unit economics:**
- Cost basis: **100 DT buys a 500M-token wholesale block → 0.20 DT per 1M blended
  tokens.**
- Cost of a 50M pool: **10.00 DT**.
- Gross margin at 100% burn (every token used): Solo **82.1%**, Starter **80.0%**,
  Pro **88.9%**, Team **88.0%**, Business **84.0%**.
- Fixed cost: VPS $44 + upstream minimum $30 = **$74 ≈ 229 DT/month** at 3.10 DT/USD.
- Break-even: **≈ 3.6 subscribers** at 25% burn.
- 25% burn margins: Starter **95.0%**, Pro **97.2%**. (Label this a modelling
  assumption, not measured — add a small clay "ASSUMPTION" badge on the slide.)

**Market:**
- Tunisia: **≈ 30,000 developers**; **4,120 developers per million people** — the
  highest density in North Africa.
- Maghreb (TN + MA + DZ): **≈ 100,000** developers. With Egypt: **≈ 220,000**.
- Blended ARPU at current prices: **66 DT/month**. Bottom-up ceiling for the whole
  home region: **≈ $3.8M ARR**. Present this as the honest ceiling, not a TAM.

**Competitor — Promptix.tn (live, same product):**
- Pay-as-you-go credits, 1 credit = 1 TND, top-ups from **5 DT**, 450+ models,
  OpenAI- and Anthropic-compatible endpoints, Flouci top-up, TND invoices with VAT.
- Its price per 1M input tokens: Haiku-class **0.387 DT**, Sonnet-class **7.742 DT**,
  Opus-class **15.484 DT**, Fable-class **38.710 DT**.
- What **50 DT** buys versus Zaino's 50 DT Starter pool:

| Model class | Promptix | Zaino | Advantage |
|---|---|---|---|
| `fast` | 129M | 150M | 1.16× |
| `smart` | 6.46M | 50M | **7.7×** |
| `frontier` | 3.23M | 10M | **3.1×** |

- Where Promptix wins: **entry price** (5 DT top-up vs Zaino's 39 DT floor).
- Where Promptix is weak: its business offering is "contact us" — no self-serve
  procurement, no per-department caps, no company onboarding.

**Engineering counts (state them as measured, with this footer):**
50 database migrations · ~66,000 lines of TypeScript/TSX in the portal · 71 test files.

---

# SLIDE-BY-SLIDE SPECIFICATION

Write these strings **verbatim** as the visible text. Speaker notes are separate —
put them in the notes pane and in the Markdown file.

---

## Slide 01 — Title (dark, full-bleed `#171717`)

Layout: logo lockup top-left at (0.75, 0.95), 0.62 in tile, dark treatment.
Emerald hairline 2.4 in wide at y = 5.72. No other graphics.

- Hero, 62 pt Inter Display Bold, white, line height 1.02, at y = 2.42:
  **"Frontier AI,\nin dinars."**
- Subline, 15.5 pt `#B4B4B8`, 1.45 line height, max width 7.4 in, at y = 4.62:
  **"Zaino AI sells the same frontier models every developer wants — on the payment rail North African engineers already use."**
- Eyebrow, 10.5 pt bold caps, tracking 1.3, `#8A8A90`, y = 5.94:
  **"CO-FOUNDER BRIEFING"**
- Bottom line, 12 pt `#C8C8CC`, y = 6.28: **"November 2026  ·  zaino.soon.it"**
- Right-aligned, same baseline, 12 pt `#8A8A90`: **"Tunis, Tunisia"**

Notes: "This is a payments story that happens to sell AI. Everything else follows from that one sentence. Do not open with market size or 'AI is changing everything' — open with the payment gap."

---

## Slide 02 — The gap (light)

Eyebrow: **"THE PROBLEM"**
Title (37 pt): **"A developer here cannot buy what a developer there can."**

Left, a hairline table at (0.75, 2.16), width 6.55, 4 columns → 3 columns
(`""`, "United States", "Tunisia"), column widths 2.05 / 2.25 / 2.25, row height 0.56,
first column SemiBold, last row highlighted:

| | United States | Tunisia |
|---|---|---|
| Monthly price | $20 | $20 |
| Card that works | Yes | Rarely |
| Local billing | Credits | None |
| Time to first call | 2 minutes | Days, or never |

Under the table, 13.5 pt `MUTED`, 1.5 line, y = 5.32, width 6.55:
**"The model is not the barrier. The checkout is. A Tunisian engineer can read the same docs, write the same code, and still be unable to pay."**

Right, a `#F5F5F5` panel at (7.62, 2.16), 4.96 × 2.34, no outline. Inside:
- label 10 pt bold caps `MUTED`, tracking 0.9: **"THE TALENT IS ALREADY LEAVING"**
- hero figure **"67%"** at 54 pt Inter Display Bold, `INK`
- caption 12.5 pt `GRAPHITE`, 1.4 line: **"of Tunisians under 30 have considered emigrating"**

Below the panel, 12.5 pt `MUTED`, y = 4.78: **"Every engineer who leaves is a customer who never existed — and the reason they leave is opportunity, not talent."**

Footer: "Sources: Arab Barometer 2025 (emigration intent, under-30, Tunisia); published list prices of OpenAI and Anthropic, Nov 2026. 'Card that works' reflects local issuer / 3-D Secure acceptance for USD SaaS."

Notes: "The 67% is emigration intent across the whole under-30 population — context, not a market-size input. Say that aloud so it is never misused later."

---

## Slide 03 — What people do instead (light)

Eyebrow: **"THE WORKAROUND"**
Title: **"Three workarounds. All of them break."**

Three equal cards at y = 2.16, height 3.62, width 3.72, gap 0.335, 1 pt `#E5E5E5`
outline, radius 3.5%, no fill. Each card: a 10.5 pt emerald number `01`/`02`/`03` at
0.3 in inset, a 16 pt Inter Display Bold heading, an 11.5 pt `MUTED` description, then
three clay 0.055 in squares with 11 pt bullets.

1. **"Shared API key"** — "A team pools one foreign card and passes the key around." · No cost attribution · No per-user quota · No audit trail
2. **"VPN + foreign card"** — "A card issued abroad, or a friendly reseller account." · Fails on renewal · Issuer blocks · Unreliable uptime
3. **"Resold access"** — "Buying from an informal reseller at a markup." · No SLA · Keys revoked · Terms-of-service risk

Closing line, 13.5 pt `MUTED`, y = 6.02, full width:
**"None of these is a business. They are all one revoked key away from stopping — which means the customer has no reason to trust you, and you have no way to bill them."**

Footer: "Observed behaviour of pooled-key and resold-access workflows, Nov 2026."

Notes: "All three fail on a schedule the customer does not control. That is why someone will pay for a product that simply keeps working."

---

## Slide 04 — The product (light)

Eyebrow: **"THE PRODUCT"**
Title: **"One subscription. One shared pool. Paid in dinars."**

Layout: five plan cards in one row is too tight. Use **two grouped blocks**:

**Block A (left, width 7.2): "FOR ONE DEVELOPER"** — three stacked rows in a hairline
table, columns: plan / 39–90 DT / pool / models / keys:

| Plan | Price | Shared pool | Models | Keys |
|---|---|---|---|---|
| Solo | 39 DT | 35M | Fast, Smart | 2 |
| Starter | 50 DT | 50M | Fast, Smart | 3 |
| Pro | 90 DT | 50M | Smart, Frontier, Fable | 15 |

**Block B (right, width 4.4): "FOR A COMPANY"** — same table style:

| Plan | Price | Shared pool | Models | Keys |
|---|---|---|---|---|
| Team | 250 DT | 150M | Smart, Frontier, Fable | 30 |
| Business | 500 DT | 400M | Smart, Frontier, Fable | 100 |

Above the right block, a small emerald tag 1.22 × 0.3 with white 7.5 pt caps
**"ONE INVOICE"**.

Below both, a `#F5F5F5` strip full content width, height 0.9, containing 12 pt text:
**"A pool is weighted units, not raw tokens: 50M = 150M Fast, or 50M Smart, or 10M Frontier. One pool per plan, spendable on any model the plan unlocks."**

Footer: "Source: plans table (migration 0046), November 2026 catalog. USD: $13 / $15 / $30 / $80 / $160."

Notes: "Say the weighting out loud twice. A 50M pool is not 50M per model — it is 150M of the cheap model or 10M of the expensive one. Every later question about 'how much do I get' is answered by that sentence. Solo exists because our competitor's 5 DT top-up was winning the casual buyer on entry price alone."

---

## Slide 05 — How it works (light)

Eyebrow: **"ARCHITECTURE"**
Title: **"Quota is enforced per request, and fails closed."**

A four-hop chain at y = 2.18, each panel 3.6 × 1.62, radius 5%, gap 0.5 in with a
small grey right-arrow between panels. Panels 1–3 are `#F5F5F5`, panel 4 is `#171717`
with white text. Each panel: 26 pt Inter Display Bold label at 0.3 inset, an 11 pt
muted sub-label, 10.5 pt bold small tag.

1. **"Customer key"** — `zn-…` — "Issued in the portal"
2. **"Auth edge"** — "Rust" — "Swaps to sk-, checks quota"
3. **"Gateway"** — "LiteLLM router" — "Alias → upstream model"
4. **"Upstream"** — "Wholesale block" — "Streams the completion back" (emerald sub-tag `#6EE7B7`)

Below, two columns at y = 4.14:
- Left, label 9.5 pt bold caps `MUTED`: **"WHAT THE EDGE GUARANTEES"** + 12.5 pt `MUTED` body, 1.55 line, width 6.1:
  **"The customer's key never reaches the upstream. The upstream credential never leaves the box. Unknown model names are rejected with a 400. Denials are rewritten into a per-alias message a customer can act on."**
- Right, a hairline card (7.0, 4.14, 5.58 × 2.44) with label **"THE TWO PLANES"** and three rows:
  "Control plane — Next.js portal: auth, keys, usage, billing, admin" /
  "Data plane — Caddy → edge → gateway → Postgres + Redis" /
  "Deployment — one VPS, Docker Compose, push to main"

Footer: "Source: DESIGN.md §2–§4; edge/server.mjs; config/litellm.yaml."

Notes: "The edge is the security boundary. That is the whole reason it exists as a separate service rather than a middleware file. It also carries a Responses→Chat shim, because the upstream is OpenAI-compatible only and Codex speaks Responses exclusively."

---

## Slide 06 — The meter (light, this is the engineering slide)

Eyebrow: **"THE ACTUAL ENGINEERING"**
Title: **"One meter. One rule. Three jobs that cannot drift."**

Left, three stacked statements with emerald 0.055 in marks, 13 pt `GRAPHITE`,
0.42 in apart, starting y = 2.3:
- **"One meter"** — blended tokens, summed across five ledger columns.
- **"One rule"** — `allowed = entitled WHERE tokens_used < token_limit`
- **"One window"** — the dashboard bundle and the enforcement path import the **same** function.

Right, a `#171717` panel (7.1, 2.16, 5.48 × 2.9), radius 4%, white text:
label 9 pt bold caps `#6EE7B7`: **"WHY THIS MATTERS"**, then 12 pt `#A8A8AE`,
1.5 line: **"If the dashboard and the gateway ever compute the window differently, the dashboard lies while the gateway cuts. That is the most expensive bug this product can have — so it is impossible by construction."**

Below, full width, a 3-column stat strip at y = 5.35, each 3.9 wide:
- **"5/3"** caption "Fast / Smart weight ratio"
- **"15"** caption "Frontier weight in the same meter"
- **"3"** caption "independent jobs, one shared helper"

Footer: "Source: portal/lib/entitlements/quota.ts (MODEL_WEIGHT_SQL, BILLABLE_TOKEN_COLUMNS); migration 0038."

Notes: "Rate limits, concurrency caps and dollar budgets are stored but deliberately never pushed to the gateway, so nothing except the token wall can block a request. Weighted units are what make one pool safe: a frontier token is 15× a fast token in the same meter."

---

## Slide 07 — Payments (light, one clay element)

Eyebrow: **"PAYMENTS"**
Title: **"Two rails, three states. Never blur them."**

Three cards, y = 2.2, height 3.3, width 3.72, gap 0.335. Each has a status pill at the
top (0.3 × 1.2 in, 7.5 pt white caps) and a heading.

1. Pill `EMERALD` **"LIVE"** — heading 16 pt: **"D17"** — body 11.5 pt `MUTED`:
   **"La Poste Tunisienne. Customer transfers, uploads the proof, staff approve. Approval is idempotent on the payment id."**
   bullets: "Manual, human-verified" · "No merchant API" · "Works today"
2. Pill `CLAY` **"TEST MODE"** — heading: **"Card (Dodo)"** — body:
   **"Implemented, typechecked, checkout wired — but the environment is test_mode and three of the five plans have no card product yet."**
   bullets: "Moves no money yet" · "Starter + Pro mapped" · "Solo/Team/Business: D17 only"
3. Pill `MUTED` **"POST-INCORPORATION"** — heading: **"Local gateways"** — body:
   **"Tunisian merchant gateways, additive behind a provider-agnostic registry. Requires the company to exist first."**
   bullets: "Registry: dev, d17, dodo" · "Additive, never a rewrite"

Closing line, 12 pt `MUTED`, y = 5.85, full width:
**"D17 is the moat and the bottleneck: it is why a customer here can pay at all, and it is manual, so it does not scale past a few dozen payments a month."**

Footer: "Source: docs/d17-payments.md; docs/dodo-payments.md; migration 0040 (Dodo product ids); migration 0050 (D17 auto-verification ledger)."

Notes: "Three states, and collapsing any two of them is how we end up telling an investor something false. The card rail is code, not revenue. The auto-verification ledger records what the model read and what it decided, so an automatic approval is still defensible in a chargeback."

---

## Slide 08 — Unit economics (light, the money slide)

Eyebrow: **"UNIT ECONOMICS"**
Title: **"Even a customer who burns the whole pool leaves us 80%."**

Left: label 9.5 pt caps `MUTED`: **"STARTER, WORST CASE"**, then **"80%"** at 74 pt
Inter Display Bold `INK`, then 12.5 pt `MUTED`: **"gross margin at 100% burn"**, then
11.5 pt `MUTED`, 1.5 line, width 3.28:
**"Worst case is the case that matters. At 25% — the realistic pattern — Starter is 95% and Pro is 97%."**

Right: a hairline table (4.62, 2.66, width 7.96) with the arithmetic fully visible:

| | Starter | Pro |
|---|---|---|
| Monthly price | 50.00 DT | 90.00 DT |
| Token allowance | 50M | 50M |
| Cost at 100% burn | 10.00 DT | 10.00 DT |
| Gross profit | 40.00 DT | 80.00 DT |
| Gross margin | 80.0% | 88.9% |

Under the table, a small line chart (5.84, width 8.2, height 1.02) titled 9.5 pt caps
`MUTED`: **"MARGIN AS USAGE RISES (%)"**, x categories 0/25/50/75/100, two series
Starter (emerald) and Pro (graphite), y-axis 70–100, axis hidden, legend right, 8.5 pt.

Add a clay 9 pt caps badge at the kicker line, right-aligned: **"25% BURN IS AN ASSUMPTION"**.

Footer: "Basis: 0.20 DT per 1M blended tokens (100 DT buys a 500M-token block). Burn = share of the monthly pool consumed. The 25% figure is modelled, not measured — no full production month has been averaged."

Notes: "Lead with the cost basis: one number, 0.20 DT per million. Every price in the ladder is arithmetic on top of it, held at a deliberate floor. No plan can lose money at full burn — that is a constraint, not a hope. Fixed cost is $74 ≈ 229 DT, so break-even is about four customers."

---

## Slide 09 — Market and the one competitor (light)

Eyebrow: **"MARKET"**
Title: **"The competitor exists. It is not cheaper where it counts."**

Left, a hairline table (0.75, 2.2, width 8.1) comparing what 50 DT buys:

| | Promptix | Zaino | Advantage |
|---|---|---|---|
| fast | 129M | 150M | 1.16× |
| smart | 6.46M | 50M | **7.7×** |
| frontier | 3.23M | 10M | **3.1×** |

Highlight the `smart` row. Under it, 12.5 pt `MUTED` 1.5 line, width 8.1:
**"Promptix.tn sells the identical product: pay-as-you-go credits, 1 credit = 1 TND, top-ups from 5 DT, 450+ models, TND invoices with VAT. It is live and it is public."**

Right, a `#171717` panel (9.15, 2.2, 3.43 × 4.1) radius 4%, white text:
label 9 pt bold caps `#6EE7B7`: **"WHERE WE WIN, WHERE WE LOSE"**
two stacked entries, 11.5 pt bold white heading + 9.5 pt `#A8A8AE` body:
- **"Win — company procurement"** — "Self-serve per-org plans, caps, one invoice, admin console. Their business offering is 'contact us'."
- **"Lose — entry price"** — "5 DT top-up versus our 39 DT floor. We do not win the casual buyer, and we should stop pretending we do."

Add a third small line below the two, 9.5 pt `MUTED`: **"Honest ceiling: ≈ 100,000 developers in the Maghreb, 66 DT blended ARPU → ≈ $3.8M ARR for the whole home region."**

Footer: "Sources: Promptix.tn public pricing, Nov 2026; GitHub 2021 developer counts; Qhala/Qubit 2025 developer density. ARPU is our own 60/40 blend."

Notes: "Do not compete on catalog breadth or on being cheapest at the low end. Compete on price-per-token for strong models and on the company procurement surface. The $3.8M ceiling is not a weakness to hide — it is the reason the company tiers exist and the reason we do not need venture capital to be profitable."

---

## Slide 10 — What is built, what is not proven (light, honest split)

Eyebrow: **"STATE OF THE COMPANY"**
Title: **"This is not a deck with a product to follow."**

A four-stat strip across the top at y = 2.14, each 3.0 wide:
**"50"** "database migrations" · **"~66k"** "lines of portal code" · **"71"** "test files" · **"4"** "model aliases wired"

Hairline at y = 3.62. Then two columns at y = 3.86, headers 9.5 pt bold caps:

**"IN PRODUCTION TODAY"** (emerald header, emerald square bullets, 11.5 pt `GRAPHITE`):
- D17 transfer billing with manual approval
- Hard per-request quota enforcement
- Five plans, priced in dinars
- Trilingual dashboard (FR / AR / EN)
- Admin console and entitlement sync
- Chat UI and playground on the same key

**"BUILT, NOT YET PROVEN"** (clay header, clay square bullets):
- Card rail — implemented, test mode
- Zero paying customers
- Cost basis — asserted, no invoice on paper
- Written resale approval from upstream
- No measured burn rate over a full month

Closing line, 12 pt `MUTED`, y = 6.14:
**"Two columns, deliberately. Everything on the right is a known gap with a path — not a surprise waiting in diligence."**

Footer: "Measured against the repository, November 2026: migration count, line count over portal/app + components + lib + hooks, test-file count, aliases in config."

Notes: "If asked for customer numbers, say plainly that there is not yet a cohort worth quoting and offer the internal dashboard in diligence. Never invent a number here — it is the fastest way to lose the room. The cost basis is the load-bearing number and it has no invoice behind it yet; that is the first thing to fix."

---

## Slide 11 — Next four quarters (light)

Eyebrow: **"ROADMAP"**
Title: **"Four things we cannot do today, and when each unlocks."**

A four-row table (0.75, 2.2, width 8.35), columns: What / Why it matters / When,
column widths 2.4 / 3.6 / 1.4, row height 0.62, first column SemiBold:

| What | Why it matters | When |
|---|---|---|
| Card rail live | International customers cannot pay us at all today | Q1 |
| Written resale approval | The whole business model depends on it | Q1 |
| Team product (members, roles) | Team and Business tiers sell pools, not people | Q2 |
| Self-serve card products for all five tiers | Three tiers currently sell on D17 only | Q2 |

Right, a `#F5F5F5` panel (9.4, 2.2, 3.18 × 3.6) with label **"THE ORDER IS NOT NEGOTIABLE"**
and 10.5 pt `GRAPHITE` 1.5 line:
**"Resale approval first, because everything else is spending against a model that might not be allowed. Card rail second, because D17 does not scale past a few dozen payments a month. Then the team product, then the card catalog."**

Footer: "Sequence from the repo's own risk ranking; quarters are targets, not commitments."

Notes: "The ordering is the argument. Building the team product before approval means building against a business model that might not survive a letter from the upstream."

---

## Slide 12 — Close and the ask of the co-founder (dark, full-bleed `#171717`)

Layout mirrors slide 01. Logo lockup top-left, 0.62 in, dark treatment. Emerald
hairline 2.4 in at y = 4.55.

- Hero, 44 pt Inter Display Bold white, 1.12 line, y = 2.5, width 10.4:
  **"The infrastructure is built.\nThe customers are not here yet."**
- Body 16 pt `#B4B4B8` 1.45 line, y = 4.85, width 7.4:
  **"What I need from you is not capital. It is the three things I cannot do alone: written approval from the upstream, a card rail that clears without a human, and the first twenty paying companies."**
- Right-aligned at the same baseline, 13 pt emerald bold: **"zaino.soon.it"**; under it
  12 pt `#8A8A90`: **"Tunis, Tunisia"**
- Footer line `#2E2E33` at 6.86; left 8 pt `#6A6A70`: **"Zaino AI · Co-founder briefing · November 2026"**; right `12`.

Notes: "Stop talking after the ask. Do not fill the silence with a feature recap. The two honest paths on resale are: written approval, or repositioning as private team-internal tooling, which needs no approval at all — and that decision is ours to make, not the upstream's."

---

# SPEAKER NOTES

Write 90–140 words of notes per slide, in this voice: plain, first person, no marketing
adjectives, no exclamation marks. Each note must contain (a) the one sentence to say
aloud, (b) the number that carries the slide, and (c) one honest caveat. Deliver them in
the `.pptx` notes pane **and** as a separate `speaker-notes.md`.

---

# CONSISTENCY CHECKS BEFORE YOU DELIVER

Run these and report the result in your final message:

1. Every slide is 13.333 × 7.5 in, white or `#171717` background only.
2. Only the ten palette hexes appear anywhere in the file. No other colour.
3. No blue, purple, teal, orange outside `#B45309`, no gradients, no shadows.
4. Inter / Inter Display only; exactly two weights per slide.
5. Every slide has the eyebrow, a 37 pt (or 44/62 pt) title, the footer hairline,
   the source line, and the number `01`–`12`.
6. No slide has more than ~40 words of visible body text.
7. Every number on every slide appears in the NUMBERS section, unchanged.
8. The words "customer", "users", "revenue", "growth", "traction", "MRR" do **not**
   appear anywhere except in explicit negatives ("zero paying customers").
9. The card rail is described as test mode everywhere it appears.
10. No vendor name of the upstream provider appears anywhere.

Report: slide count, file names, the consistency results, and any `[TBD]` you had to
leave.
