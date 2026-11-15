# Zaino — LinkedIn Marketing Plan & Visual Prompt Pack

**Written:** 2026-11-07 · **Supersedes the content strategy in** `linkedin-growth.md` §2 and §5
**Scope:** marketing posts (product awareness), not engineering postmortems

---

## 0. What changes

`linkedin-growth.md` was built on a postmortem thesis: publish your own billing
bugs, earn authority. That works on developers who already care about meters.

It does **not** work for the job you are describing now: *let people know we
exist, and what the idea is.* A stranger scrolling their feed has no reason to
care that you double-counted cache reads. They do care that they are paying for
tokens they never use.

So this pack inverts the ratio:

| | Old plan | This plan |
|---|---|---|
| Lead pillar | Postmortem 40% | **The claim 50%** |
| Second | Economics 25% | **The demo 25%** |
| Third | Build-in-public 20% | **The offer 15%** |
| Fourth | Proof 15% | **Proof 10%** |
| Audience assumption | Already interested | **Never heard of you** |

Postmortems do not disappear — they move to weeks 4+, once there is an audience
that will read them. Their job changes from *acquisition* to *retention and
credibility*. Keep `linkedin-growth.md` §5 for that phase.

---

## 1. Logo and trademark rules — read before you design anything

You asked me to fetch the Claude logo and use it where needed. **I did not put
it in the marketing assets, and you should not either.** Here is the actual
rule, from Anthropic's own guidelines:

> "You may only use our trademarks as specifically permitted by us and only in
> materials we approve beforehand."
>
> "You may not use our trademarks in a manner that implies Anthropic's
> sponsorship or endorsement, or a relationship or affiliation with Anthropic,
> except as we expressly authorize."
>
> "If you have an existing business relationship with Anthropic and want to use
> our trademarks in a press release, **on your website, or in another context**,
> please email **marketing@anthropic.com**."
— <https://www.anthropic.com/legal/trademark-guidelines>

A marketing carousel or a pitch deck is "another context". A vendor logo next to
your product name is the textbook implication of affiliation. Anthropic's
Consumer ToS adds the same restriction for the brand generally, and reserves
permission to `marketing@anthropic.com`.

**What this means in practice:**

| Surface | Third-party logo | Why |
|---|---|---|
| `/docs` (already shipped) | Yes — currently in use | Nominative use: labelling wire-format compatibility. Describes the product, does not claim a relationship. Your `ATTRIBUTION.md` already states this correctly. |
| **LinkedIn marketing posts** | **No** | Marketing material. Implies endorsement. Not approved. |
| **Pitch deck** | **No** | Same. |
| Text mention ("compatible avec Claude Code") | Acceptable | Describing interoperability is not the same as using the mark as branding. Keep it plain text, no logo, no implied partnership. |

Two extra traps:

- **Do not design a lookalike.** A shape that *evokes* the Claude asterisk or
  the OpenAI blossom is worse than using the real file — it is a deliberate
  imitation, which the guidelines explicitly target ("no alterations… changes
  to colour, font, proportion").
- **The files are public domain as artwork, not as brands.** `ATTRIBUTION.md`
  is right that Wikimedia lists them `PD-textlogo`; it also says, correctly,
  "**trademark** of Anthropic". Public domain removes the copyright problem, not
  the trademark one.

**So the assets use the Zaino logo only**, and communicate "two native formats"
typographically and diagrammatically — which is also the cleaner design. A logo
wall reads as a reseller; a statement reads as a product.

If you want the logos anyway, that is the same email as `linkedin-growth.md`
Gate 1 (the resale permission). Ask for both in one message to
`marketing@anthropic.com`.

---

## 2. Messaging hierarchy

Every asset in this pack uses these three layers in this order. Do not invent
variants — repetition is what makes a startup memorable.

**Layer 1 — the claim (always the largest element on the slide)**

> 100M tokens par jour. Remis à zéro à minuit.

**Layer 2 — the three proofs (pick one per post, never two)**

| Proof | Line | Visual |
|---|---|---|
| The inversion | "Payez le jour, pas le mois." | two bars, one collapsing |
| The formats | "Une clé. Deux formats natifs." | two arrows from one node |
| The meter | "Compté une fois. Une seule." | a single column summing |

**Layer 3 — the offer (closing slide only)**

> 3 jours. Sans carte. → `zaino.soon.it/pricing`

### The one-line pitch, frozen

```
FR  Une clé. L'API Claude + OpenAI. 100M tokens par jour, remis à zéro à minuit.
EN  One key. The Claude + OpenAI APIs. 100M tokens a day, reset at midnight.
```

---

## 3. The visual system

Derived from `portal/app/globals.css` (`.dark`), converted to sRGB. The brand is
**monochrome by design** — there is no accent colour. Emphasis comes from scale
and weight, never hue. (An earlier draft of this plan specified violet. That was
invented. There is no violet in the codebase.)

```
--bg        #000000   ground
--fg        #FAFAFA   primary type
--muted-fg  #A1A1A1   secondary type, captions
--muted     #262626   rules, inactive bars
--card      #171717   panels, code blocks
--canvas    #0D0D0D   inset panels
--hair      #525252   footers, slide numbers
--bad       #FF6467   reserved for ONE meaning: the cost of the wrong model
```

**Canvas:** 1080 × 1350 (4:5, the tallest LinkedIn allows, maximum feed area).
**Safe zone:** 88 px left/right, 92 px top, 84 px bottom.

### The five templates

Reuse these instead of inventing layouts, so the feed learns your look.

| ID | Name | Used for | Structure |
|---|---|---|---|
| **T1** | Statement | The claim | one sentence, 104 px, 3 lines max |
| **T2** | Comparison | Inversion posts | two stacked panels, left = them, right = you |
| **T3** | Numbers | Proof | 3 rows, label left, mono figure right |
| **T4** | Terminal | Demo | code block, real input, real output |
| **T5** | Offer | Conversion | claim + one line + URL, centred |

### Persistent elements (every slide, no exceptions)

| Element | Position | Spec |
|---|---|---|
| Zaino logo | top-left, 66 × 66 px, 88 px from left, 92 from top | `portal/public/logo/zaino-curved-z-white.png` — white on transparent, reads at 32 px, so 66 is generous |
| Wordmark | 20 px right of logo, 31 px, weight 600, `-0.02em` | "Zaino" |
| Footer | bottom-left | `zaino.soon.it`, 27 px, `#525252` |
| Slide number | bottom-right | `01`…`08`, 27 px, `#525252`, current slide in `#FAFAFA` |

**Never:** stock photos, robots, brains, handshakes, gradients, drop shadows,
glows, violet, vendor logos, more than 20 words per slide.

---

## 4. The launch sequence — 21 days

Built for *being seen*, which means the first week is louder and more repetitive
than feels comfortable. Three phases:

```
Phase A  days 1–7    BE KNOWN      claim repeated 4 different ways
Phase B  days 8–14   BE UNDERSTOOD how it can be free, what the tiers are
Phase C  days 15–21  BE USED       onboarding, qualification, offer
```

Cadence: **5 posts/week on the profile** (Mon–Fri), page reposts 2–4 h later.
Saturday and Sunday are comments only. Batch all five on Sunday.

Why this order: a stranger needs to hear the claim ~4 times before it sticks.
Phase A is deliberately repetitive — different image, same sentence. Do not
"add variety" by changing the claim.

---

## 5. The twelve posts

Each post has: **copy** (paste into LinkedIn), **visual prompt** (for an image
generator), and **alt text** (accessibility, and LinkedIn indexes it).

Prompt usage: paste into your image tool, then composite the real Zaino logo
into the reserved 66 × 66 area — generators cannot reproduce your mark
reliably. Every prompt reserves that space explicitly.

---

### PHASE A — BE KNOWN

---

#### Post 1 · Day 1 · T1 Statement · The announcement

**Copy**

```
On facture l'IA à la journée. Pas au mois.

La plupart des passerelles vous vendent un plafond mensuel. Vous payez pour
des tokens que vous n'utilisez jamais — et le jour où vous en avez besoin, il
est déjà consommé.

Zaino inverse la fenêtre.

100 millions de tokens par jour et par modèle.
Remis à zéro chaque minuit, heure de Tunis.
Pas de limite par minute. Pas de plafond en dollars.
Une seule règle : le budget du jour. Le lendemain, il revient.

Une clé, deux formats natifs — l'API OpenAI et l'API Anthropic. Vos 40 lignes
existantes fonctionnent : seule la base URL et la clé changent.

3 jours d'essai. Sans carte.

zaino.soon.it — lien en commentaire.

#LLM #API #DevTools
```

**Visual prompt**

```
Editorial tech poster, 1080×1350, pure black background (#000000).
Top-left: reserve an empty 66×66 px square 88 px from the left edge and
92 px from the top for a logo to be composited later — leave it blank.

Main composition, left-aligned, occupying the middle 55% of the canvas:
A single statement in large white (#FAFAFA) grotesque type, weight 600,
104 px, letter-spacing -0.045em, line-height 0.98, exactly three lines:
line 1 "100 millions de tokens"
line 2 "par jour. Remis à"
line 3 "zéro à minuit."

Below it, a 120 px wide, 5 px tall white horizontal rule, 40 px of space
above and below.

Under the rule, two lines of muted grey (#A1A1A1) type, 34 px, line-height 1.4:
"Par modèle. Pas de plafond mensuel."
"Pas de limite par minute."

Bottom-left, 27 px, colour #525252: "zaino.soon.it"
Bottom-right, 27 px, colour #525252: "01"

Style: Swiss editorial, extreme restraint, generous negative space, no
imagery, no icons, no gradient, no shadow, no glow. Monochrome only.
Typography must be crisp and geometrically perfect, like a design-system
spec sheet.
```

**Alt text:** `100 millions de tokens par jour, remis à zéro à minuit — Zaino`

---

#### Post 2 · Day 2 · T2 Comparison · The fiction

**Copy**

```
Un quota mensuel est une fiction comptable.

Il suppose que vous consommez régulièrement. En réalité, un projet d'agent
brûle 90 % de son budget en trois jours, puis plus rien pendant deux semaines.

Le plafond mensuel punit exactement le comportement qu'il prétend financer.

Nous avons changé la fenêtre : 100 millions de tokens par jour et par modèle,
remis à zéro à minuit (heure de Tunis).

Un jour lourd coûte un jour. Pas un mois.

3 jours d'essai, sans carte. Lien en commentaire.

#LLM #SaaS #API
```

**Visual prompt**

```
Two-panel comparison graphic, 1080×1350, pure black background (#000000).
Top-left: reserve an empty 66×66 px square at 88 px left, 92 px top for a
logo to be composited later.

Heading above the panels, white (#FAFAFA), 64 px, weight 600,
letter-spacing -0.04em: "Le même budget. Deux fenêtres."

Panel A, y ≈ 380, full width minus 88 px margins, height 300 px,
background #171717, rounded 20 px:
  label top-left, 28 px, #A1A1A1: "PLAFOND MENSUEL"
  a wide horizontal bar, 24 px tall, spanning the panel, filled #262626,
  with only the left 15% filled in #FF6467
  caption under the bar, 26 px, #A1A1A1: "Facturé 30 jours. Utilisé 2."

Panel B, 40 px below, same size, background #171717, rounded 20 px:
  label top-left, 28 px, #A1A1A1: "JOUR ZAINO"
  a horizontal bar, 24 px tall, full width filled in #FAFAFA
  caption, 26 px, #A1A1A1: "Remis à zéro à minuit."

Below both, one line centred, white, 34 px:
"Un jour lourd ne détruit pas le mois."

Footer left 27 px #525252 "zaino.soon.it", right "02".

Style: data-visualisation minimalism, flat, no shadows, strictly
monochrome except the single #FF6467 fill. No 3D, no perspective.
```

**Alt text:** `Comparaison: plafond mensuel utilisé à 15% contre un quota journalier plein — Zaino`

---

#### Post 3 · Day 3 · T4 Terminal · The demo

**Copy**

```
Ce que vous changez pour passer à Zaino :

  base_url   →  https://api.zaino.soon.it
  api_key    →  zn-...

Ce que vous ne changez pas :

  vos 40 lignes de code
  votre SDK
  votre format de requête

Parce que la passerelle parle les deux formats nativement — l'API OpenAI et
l'API Anthropic. Claude Code, Codex, Cursor, le SDK Python, curl : tout ce qui
parle déjà ces API fonctionne tel quel.

Il n'y a pas de SDK Zaino. Ce n'est pas un oubli. Un SDK intermédiaire, c'est
une dépendance de plus à maintenir, et une raison de plus de ne pas vous
laisser partir.

3 jours d'essai, sans carte. Lien en commentaire.

#ClaudeCode #OpenAI #DevTools
```

**Visual prompt**

```
Developer terminal card on a black canvas, 1080×1350, background #000000.
Top-left: reserve an empty 66×66 px square at 88 px left, 92 px top for a
logo to be composited later.

Centrepiece: a rounded 20 px panel, background #0D0D0D, spanning
88 px margins, height 620 px, positioned y ≈ 420.

Inside the panel, monospace type 34 px, line-height 1.6, tabular figures:
a grey #525252 comment line:  "# avant"
two lines in #FAFAFA:
  "base_url: api.other.dev/v1"
  "api_key:  sk-..."
a blank line
another #525252 comment:  "# apres"
two lines in #FAFAFA with the value highlighted by a 2 px #FAFAFA
underline under the new text:
  "base_url: api.zaino.soon.it"
  "api_key:  zn-..."
a blank line
a final #525252 comment: "# le reste du code: inchange"

A thin 1 px #262626 divider separates the before and after blocks.

Above the panel, white 64 px weight 600: "Deux lignes. Pas un SDK."

Footer left #525252 27 px "zaino.soon.it", right "03".

Style: high-fidelity terminal aesthetic, monospace must be perfectly
legible and evenly spaced, no syntax rainbows, monochrome only,
no window chrome buttons, no reflection, no glow.
```

**Alt text:** `Terminal montrant deux lignes modifiées: base URL et clé — Zaino`

---

#### Post 4 · Day 4 · T3 Numbers · The inversion

**Copy**

```
Le vrai coût d'un token n'est pas le prix du token.

C'est le prix du token multiplié par votre taux d'utilisation du plafond.

Un plafond de 1M de tokens utilisé à 12 % coûte huit fois plus cher au token
utile qu'un plafond de 200 000 utilisé à 90 %.

Toutes les grilles tarifaires du marché comparent des prix au token. Aucune ne
compare des taux d'utilisation — parce que c'est là qu'elles perdent.

Sur 30 jours, un budget mensuel de 3M de tokens qui n'est consommé qu'à 15 %
vous laisse payer 2,55M de tokens qui n'existent pas.

Nous avons changé la fenêtre, pas le prix.

Lien en commentaire.

#SaaS #Pricing #LLM
```

**Visual prompt**

```
Minimal data panel, 1080×1350, pure black (#000000).
Top-left: reserve an empty 66×66 px square at 88 px left, 92 px top for a
logo to be composited later.

Title, white #FAFAFA, 64 px, weight 600, letter-spacing -0.04em, two lines,
y ≈ 300:
"Payé pour 100 %."
"Utilisé 15 %."

Below, three stacked rows, each 132 px tall, background #171717,
rounded 16 px, separated by 20 px, spanning 88 px margins:
row 1 — label left 28 px #A1A1A1 "Plafond mensuel",  right-aligned mono
        figure 64 px white "3 000 000"
row 2 — label left "Consommé",             figure #A1A1A1 "450 000"
row 3 — label left "Payé pour rien",       figure #FF6467 "2 550 000"

Under the rows, a single line 34 px #FAFAFA:
"Un quota journalier ne laisse pas de reste."

Footer left #525252 27 px "zaino.soon.it", right "04".

Style: annual-report minimalism, precise tabular numerals, flat panels,
no chart, no icons, no gradient. Monochrome plus one #FF6467 figure.
```

**Alt text:** `Trois chiffres: plafond mensuel 3 millions, consommé 450 000, payé pour rien 2 550 000 — Zaino`

---

#### Post 5 · Day 5 · T5 Offer · The trial

**Copy**

```
3 jours. Sans carte.

Il n'y a pas de carte du tout dans le produit — le paiement est un virement
D17, en Tunisie.

On aurait pu le cacher. On en a fait une contrainte de conception : si vous ne
pouvez pas payer en trente secondes, vous devez pouvoir essayer en trente
secondes.

Un essai ne doit jamais dépendre du système de paiement.

Ce que vous obtenez pendant 3 jours :
  · 100M de tokens par jour et par modèle
  · les quatre niveaux — Fast, Smart, Frontier, Fable
  · les deux formats natifs, sans SDK
  · 1M de contexte, 64k de sortie

zaino.soon.it/pricing — lien en commentaire.

#LLM #API
```

**Visual prompt**

```
Centred offer poster, 1080×1350, pure black (#000000).
Top-left: reserve an empty 66×66 px square at 88 px left, 92 px top for a
logo to be composited later.

Vertically centred block, everything centred horizontally:
Line 1, white #FAFAFA, 150 px, weight 600, letter-spacing -0.05em:
"3 jours."
Line 2, same treatment: "Sans carte."
A 120×5 px white rule centred, 40 px above and below.
Line 3, #A1A1A1, 34 px, line-height 1.5, two lines:
"100M de tokens par jour."
"Remis à zéro à minuit."
Line 4, white, 36 px, weight 500, 60 px below:
"zaino.soon.it/pricing"

Footer left #525252 27 px "zaino.soon.it", right "05".

Style: gallery poster, maximum whitespace, perfectly optically centred,
no border, no button shape, no gradient, monochrome only.
```

**Alt text:** `3 jours d'essai, sans carte — Zaino`

---

### PHASE B — BE UNDERSTOOD

---

#### Post 6 · Day 8 · T3 Numbers · How it can be free

**Copy**

```
On nous demande souvent comment on peut offrir 100M de tokens par jour.

La réponse est ennuyeuse : notre coût amont est fixe.

Pour un concurrent dont le coût suit les tokens, la générosité est une dépense.
Chaque token offert sort de sa marge. Pour nous, c'est un choix de
positionnement qui ne coûte rien de plus.

Ce n'est pas une promotion. Une promotion a une date de fin, et un concurrent
peut la copier lundi matin.

Une asymétrie de structure de coût ne se copie pas sans changer de structure.

C'est tout notre avantage, et il tient en une phrase : nous ne payons pas au
token, donc nous pouvons vous laisser en consommer.

Lien en commentaire.

#Business #LLM #SaaS
```

**Visual prompt**

```
Two-column cost diagram, 1080×1350, black (#000000).
Top-left: reserve an empty 66×66 px square at 88 px left, 92 px top.

Title white 64 px weight 600, two lines, y ≈ 300:
"Notre coût est fixe."
"Le vôtre devient prévisible."

Two vertical panels side by side, each 430 px wide, 560 px tall, 40 px gap,
background #171717, rounded 20 px:
LEFT panel label top 28 px #A1A1A1: "COÛT PAR TOKEN"
  inside: 12 thin horizontal bars stacked, each 10 px tall #262626, with
  the bar length increasing gradually downward — the last one extends
  beyond the panel edge and is clipped, drawn in #FF6467.
RIGHT panel label: "COÛT FIXE"
  inside: a single 10 px horizontal line in #FAFAFA, perfectly flat,
  spanning the full panel width, repeated only twice with a note
  "même coût" in 24 px #A1A1A1 beneath.

Under the panels, one centred line white 34 px:
"Une promotion se copie. Pas une structure."

Footer left #525252 27 px "zaino.soon.it", right "06".

Style: editorial infographic, strictly flat, no 3D, no shadows,
monochrome plus one #FF6467 bar.
```

**Alt text:** `Deux colonnes: coût par token qui grimpe, coût fixe qui reste plat — Zaino`

---

#### Post 7 · Day 9 · T2 Comparison · The four tiers

**Copy**

```
Quatre niveaux. Un nom par niveau.

Fast      réponses courtes, le moins cher
Smart     le défaut, pour la plupart du travail
Frontier  le raisonnement le plus profond
Fable     les longues trajectoires, les agents multi-étapes

Pas de nom de fournisseur. Pas de numéro de version. Pas de date de
déploiement.

Ce n'est pas de la pudeur. C'est une promesse : le moteur derrière un niveau
peut changer sans que vous ayez à changer quoi que ce soit, ni à relire une
documentation.

La plupart des passerelles exposent le nom du modèle et vous laissent deviner
lequel choisir. Nous avons préféré nommer l'usage.

1M de contexte. 64k de sortie.

Lien en commentaire.

#LLM #API #DevTools
```

**Visual prompt**

```
Four-row tier list, 1080×1350, black (#000000).
Top-left: reserve an empty 66×66 px square at 88 px left, 92 px top.

Title white 64 px weight 600, y ≈ 290: "Quatre niveaux d'usage."

Four rows starting y ≈ 430, each 150 px tall, 24 px gap, spanning 88 px
margins, background #171717, rounded 16 px:
Each row has a tier name on the left in white 56 px weight 600, and a
description on the right in #A1A1A1 28 px, right-aligned in one line.
Row 1: "Fast"      / "réponses courtes"
Row 2: "Smart"     / "le défaut"
Row 3: "Frontier"  / "raisonnement profond"
Row 4: "Fable"     / "longues trajectoires"
A 4 px white vertical rule sits immediately left of the tier name,
inside each row, 40 px tall, vertically centred.

Below the list, a note 26 px #525252:
"Aucun nom de fournisseur n'apparaît sur cette page."

Footer left #525252 27 px "zaino.soon.it", right "07".

Style: typographic table, strict baseline grid, flat, monochrome,
no icons, no logos, no badges.
```

**Alt text:** `Quatre niveaux: Fast, Smart, Frontier, Fable — Zaino`

---

#### Post 8 · Day 10 · T4 Terminal · How a request travels

**Copy**

```
Ce que fait votre requête quand elle traverse Zaino :

  votre client
    → Caddy (TLS, terminaison)
    → auth-edge (préfixe de clé)
    → LiteLLM (authentification, quota, routage)
    → amont
    → retour, en flux

Quatre sauts, dont trois en local sur la même machine. Le coût ajouté mesuré
reste sous le bruit de mesure du fournisseur lui-même.

Deux règles que nous nous sommes imposées, écrites en tête de fichier :

1. Si l'amont est injoignable, on renvoie 502. Jamais 200. Un proxy qui répond
   « succès » alors qu'il n'a pas répondu, c'est une requête qui n'est pas
   comptée — exactement la panne que ce produit existe pour empêcher.
2. On ne journalise jamais une clé. Ni sa valeur, ni sa longueur, ni un
   extrait. Un booléen « préfixe substitué », et rien d'autre.

Un service de 800 lignes sans aucune dépendance. Le dernier endroit où mettre
une dépendance npm, c'est un proxy de credentials.

Lien en commentaire.

#Architecture #Security #NodeJS
```

**Visual prompt**

```
Horizontal flow diagram, 1080×1350, black (#000000).
Top-left: reserve an empty 66×66 px square at 88 px left, 92 px top.

Title white 60 px weight 600, y ≈ 280: "Ce que fait une requête."

Four nodes arranged in a single vertical column, centred horizontally,
each 620 px wide, 110 px tall, background #171717, rounded 14 px,
separated by 40 px vertical connectors drawn as a 2 px #525252 line with
a small arrowhead:
node 1 label 30 px white: "Caddy"       subtitle 24 px #A1A1A1: "TLS"
node 2: "auth-edge"  / "préfixe de clé"
node 3: "LiteLLM"    / "auth · quota · routage"
node 4: "amont"      / "réponse en flux"
Above node 1 and below node 4, short 2 px #525252 lines ending in an arrow
pointing into and out of the stack, labelled 24 px #525252 "client" and
"retour".

At the bottom, a 1 px #262626 rule, then one line 26 px #A1A1A1:
"Trois sauts sur la même machine."

Footer left #525252 27 px "zaino.soon.it", right "08".

Style: system architecture diagram, geometric, perfectly aligned,
no icons, no colours, no gradients, no shadows, monochrome.
```

**Alt text:** `Schéma: client vers Caddy, auth-edge, LiteLLM, amont — Zaino`

---

#### Post 9 · Day 11 · T3 Numbers · The meter

**Copy**

```
Une passerelle qui compte mal est pire qu'aucune passerelle.

Parce qu'une panne se voit. Un compteur faux, non — il a l'air sûr de lui.

Donc le compteur est le produit, pas la fonctionnalité cachée derrière.

Un token qui traverse Zaino est compté une fois et une seule :
entrée, sortie, écriture de cache, lecture de cache. Quatre composantes, une
addition, une seule colonne stockée à l'ingestion — pour que tous les lecteurs
comptent pareil : le mur de quota, le tableau de bord, les finances, la
facturation.

Nous avons publié nos propres bugs de facturation, chiffres à l'appui, au lieu
de les corriger en silence. Un chiffre qu'on peut auditer vaut mieux qu'un
chiffre qu'on nous demande de croire.

591 tests. 35 migrations. 37 tables.

Lien en commentaire.

#Billing #Postgres
```

**Visual prompt**

```
Single-column ledger graphic, 1080×1350, black (#000000).
Top-left: reserve an empty 66×66 px square at 88 px left, 92 px top.

Title white 64 px weight 600, y ≈ 290, two lines:
"Un token."
"Compté une fois."

A small table, y ≈ 470, spanning 88 px margins, four rows 90 px each,
separated by 1 px #262626 hairlines, no outer border:
row 1 label 30 px #A1A1A1 "entrée"                right mono 34 px white "fresh_input"
row 2 label "sortie"                              right "output"
row 3 label "écriture de cache"                   right "cache_write"
row 4 label "lecture de cache"                    right "cache_read"
A 2 px white horizontal rule under the table, full width.

Below the rule, one line 30 px #FAFAFA:
"Une addition. Une colonne. Aucun lecteur divergent."

Footer left #525252 27 px "zaino.soon.it", right "09".

Style: accounting ledger, tabular numerals perfectly aligned to the
right edge, hairline rules only, no boxes, no fills, monochrome.
```

**Alt text:** `Tableau de quatre composantes comptées une seule fois — Zaino`

---

### PHASE C — BE USED

---

#### Post 10 · Day 15 · T4 Terminal · Ten minutes

**Copy**

```
De zéro à un 200, en dix minutes, sans parler à personne.

Le chemin, en entier :

1. zaino.soon.it/pricing → 3 jours, sans carte
2. vous copiez la clé zn-
3. vous changez la base URL dans votre éditeur
4. vous envoyez une requête
5. 200

Pas d'appel commercial. Pas de formulaire de qualification. Pas de « notre
équipe reviendra vers vous ».

Le piège que personne ne documente, et qui nous a coûté une heure :
si ANTHROPIC_API_KEY n'est pas vide dans votre environnement, votre client
l'envoie à la place du token, et vous obtenez un 401 qui n'a aucun rapport
avec le vrai problème. Mettez-la à vide.

Tous les fichiers de configuration vérifiés — Claude Code, Codex, Cursor, SDK
Python, curl — sont dans /docs, avec les pièges écrits à côté.

Lien en commentaire.

#ClaudeCode #OpenAI #DevTools
```

**Visual prompt**

```
Numbered checklist poster, 1080×1350, black (#000000).
Top-left: reserve an empty 66×66 px square at 88 px left, 92 px top.

Title white 64 px weight 600, two lines, y ≈ 280:
"Dix minutes."
"Aucun appel commercial."

List of five steps, y ≈ 460, spanning 88 px margins, each row 110 px:
a step number on the left in 30 px #525252 tabular ("01".."05"), a 1 px
#262626 vertical rule, then the step text in 32 px white on one line.
01  "Choisir un plan"
02  "Copier la clé zn-"
03  "Changer la base URL"
04  "Envoyer une requête"
05  "200"

Under the list, a panel background #0D0D0D, rounded 14 px, padding 32 px,
containing a monospace 28 px line in #FF6467:
"ANTHROPIC_API_KEY="""  followed by a #A1A1A1 comment "# laisser vide"

Footer left #525252 27 px "zaino.soon.it", right "10".

Style: instruction sheet, strict left alignment, tabular numerals,
flat, monochrome plus one #FF6467 line.
```

**Alt text:** `Liste de cinq étapes pour une première requête — Zaino`

---

#### Post 11 · Day 16 · T2 Comparison · Who it is for

**Copy**

```
Pour qui c'est :

· vous êtes développeur et vous payez l'IA de votre poche ou sur un budget
  technique
· vous utilisez déjà Claude Code, Codex, Cursor ou un SDK, et vous ne voulez
  pas réécrire
· vous voulez une base URL et une clé, pas un devis
· votre consommation est irrégulière — un pic de trois jours, puis rien

Pour qui ce n'est pas :

· vous cherchez un chatbot grand public pour rédiger des e-mails
· vous avez besoin d'un contrat sur mesure, d'une DPA et d'un support
  téléphonique — pas encore, et je préfère le dire
· vous ne pouvez pas payer par virement D17 (aujourd'hui, c'est le seul
  moyen : Tunisie et Maghreb)

Dire non tôt coûte moins cher que dire oui tard.

Lien en commentaire.

#LLM #DevTools #Tunisia
```

**Visual prompt**

```
Two-column yes/no panel, 1080×1350, black (#000000).
Top-left: reserve an empty 66×66 px square at 88 px left, 92 px top.

Title white 60 px weight 600, y ≈ 280: "Pour qui c'est. Pour qui non."

Two panels side by side, each 430 px wide, 720 px tall, 40 px gap,
background #171717, rounded 18 px.
LEFT panel: header 26 px letterspaced #A1A1A1 "POUR", then four lines
in 30 px white, each preceded by a small 8 px white square.
  "développeur"
  "déjà sur Claude Code"
  "une clé, pas un devis"
  "consommation irrégulière"
RIGHT panel: header "PAS POUR", then three lines in 30 px #A1A1A1,
each preceded by a small 8 px hollow square outlined in #525252.
  "chatbot grand public"
  "contrat sur mesure"
  "paiement par carte"

Under both, one centred line 32 px #FAFAFA:
"Dire non tôt coûte moins cher que dire oui tard."

Footer left #525252 27 px "zaino.soon.it", right "11".

Style: two-column editorial layout, strict grid, flat panels,
monochrome, no icons, no ticks, no crosses.
```

**Alt text:** `Deux colonnes: pour qui c'est, pour qui ce n'est pas — Zaino`

---

#### Post 12 · Day 17 · T5 Offer · Pricing

**Copy**

```
Starter 50 DT. Pro 90 DT.

Ce que vous obtenez, identique sur les deux :

100M de tokens par jour et par modèle, remis à zéro à minuit
les deux formats natifs, sans SDK
1M de contexte, 64k de sortie
le moteur d'extraction de documents et la recherche

Ce qui change :

Starter → Fast et Smart · 3 clés
Pro     → Smart, Frontier et Fable · 15 clés

Et 3 jours d'essai, sans carte, pour vérifier avant de payer.

Le paiement est un virement D17, en Tunisie. Ailleurs, écrivez-moi — je
préfère savoir combien vous êtes plutôt que de prétendre que c'est réglé.

zaino.soon.it/pricing — lien en commentaire.

#LLM #API #Tunisia
```

**Visual prompt**

```
Two-plan pricing card layout, 1080×1350, black (#000000).
Top-left: reserve an empty 66×66 px square at 88 px left, 92 px top.

Title white 60 px weight 600, y ≈ 270: "Deux plans. Un même plafond."

Two cards side by side, each 430 px wide, 660 px tall, 40 px gap,
background #171717, rounded 20 px, positioned y ≈ 400.
LEFT card: name 34 px #A1A1A1 "Starter", price 96 px white weight 600
"50 DT" with a smaller 26 px #525252 suffix "/mois", then three bullet
lines 26 px #A1A1A1: "Fast · Smart", "3 clés", "100M/jour".
RIGHT card: name "Pro", price "90 DT" same treatment, bullets:
"Smart · Frontier · Fable", "15 clés", "100M/jour".
A 2 px #FAFAFA horizontal rule spans the full width of the RIGHT card
only, 24 px below its name — the single mark of the recommended plan.

Below the cards, one centred line 30 px #FAFAFA:
"3 jours d'essai. Sans carte."
And beneath it 26 px #525252: "Virement D17 · facture sur demande ailleurs"

Footer left #525252 27 px "zaino.soon.it", right "12".

Style: pricing comparison, severe grid, no badge, no ribbon, no
gradient, no shadow, monochrome, prices in tabular numerals.
```

**Alt text:** `Deux plans: Starter 50 DT, Pro 90 DT, même quota de 100M par jour — Zaino`

---

## 6. How to run the prompts

1. **Generate** at 1080×1350. If the tool forces 2:3 or 1:1, generate and crop
   to 4:5 — never letterbox with grey bars.
2. **Composite the logo yourself.** Open
   `portal/public/logo/zaino-curved-z-white.png` and place it in the reserved
   66 × 66 area. The logo is 256 × 256 white-on-transparent, so it downscales
   cleanly. Never let a generator invent it.
3. **Check the text.** Image models misrender French accents. Crop the text
   back in from the rendered HTML instead of trusting the generator — the
   `carousel.html` in `plans/linkedin-assets/post-01/` is the reference build.
4. **Export** as PNG, then assemble as a PDF for carousels (LinkedIn wants PDF
   for multi-slide documents, one 1080 × 1350 page each).
5. **Alt text** goes in the post's image description field. Use the line
   supplied above each prompt.

---

## 7. Getting seen — the mechanics

The copy is half of it. This is the other half, and it matters more.

| Lever | What to do | Why |
|---|---|---|
| **First 60 minutes** | Reply to every comment, immediately | Distribution is decided early |
| **First 2 lines** | The hook, under 140 characters | Mobile truncates there |
| **No link in the body** | Put `zaino.soon.it` in the first comment | External links cut reach |
| **Comment before you post** | 10 real comments, then publish | Primes your own reach |
| **3 allies** | Two people comment within the hour | Manufacture the early signal |
| **5 posts/week** | Mon–Fri, batched Sunday | Rhythm beats bursts |
| **Repetition** | Same claim, four images | A stranger needs ~4 exposures |
| **4:5 only** | Never 1:1, never 16:9 | Tallest allowed = most feed area |
| **One idea per post** | If you have two, split it | Two ideas halve both |

**What to measure** — and nothing else:

| Metric | Meaning | 30-day target |
|---|---|---|
| Profile views per impression | The hook worked | > 12 % |
| Profile → site clicks | The profile did its job | 3–5 % of views |
| Site → trial | The offer is clear | 8–12 % |
| Trial → first 200 response | **The product works** | > 60 % |

Impressions are vanity. "Trial → first 200 response" is the only number that
predicts revenue.

---

## 8. Before posting — the three blockers

From `linkedin-growth.md` §10, still open, and they matter more now that the
posts are marketing rather than postmortems:

1. **No `/connect` page.** Every post sends traffic to `/pricing` or `/docs`.
   A developer who lands and cannot wire it in three minutes leaves, and a
   marketing post that produces that is worse than no post.
2. **No international payment.** Posts 5, 11 and 12 all say "virement D17,
   ailleurs sur demande". Keep that line in — it is honest, and it prevents the
   churn of a lead who signs up and then cannot pay.
3. **The paywall still shows 80M/32M** against a live 100M/day
   (`paywall-state.tsx:50`). Every asset in this pack repeats 100M. Fix it
   before post 1 or the product contradicts the campaign.

---

*Visual reference: `plans/linkedin-assets/post-01/` (carousel.html + rendered
slides). Content strategy: `linkedin-growth.md` §5 for the postmortem phase
after day 30.*
