# Startup Act — dossier context pack

**Prepared:** 17 November 2026
**For:** Louay Rjili · Zaino AI · hello@startup.gov.tn
**Status:** context only. Every number below was re-verified against the running
repo on 17 Nov 2026, not copied from an earlier brief.

Read §1 and §2 before writing a single line of the dossier. Two of the facts in
the existing documents are wrong in ways a committee will notice.

---

## 1. Which application you are actually filing

There are three separate things, and the words get used interchangeably in the
earlier notes. They are not interchangeable.

| | What it is | Do you qualify today? |
|---|---|---|
| **Pré-label** (art. 4, loi 2018-20) | A status for a founder **before** incorporation. Valid 6 months. Proves the innovation early. | **Yes — this is your route.** |
| **Label Startup** | The real label. Requires an incorporated company. 100 DT, decision ≤30 days, silence 60 days = approval. | **No — blocked on incorporation.** |
| **Bourse Startup** | 1,000 DT/month × 12 for a founder in a *labelled* company. | **Probably not, even after the Label.** See §2. |

The pré-label does **not** grant the tax exemption, the FX account, or the
Bourse. It starts the clock and puts you in front of the committee early. The
funding brief is correct on this point and it is worth repeating in the email so
nobody assumes you think otherwise.

**Sequence:** pré-label now → incorporate → Label → (Bourse if eligible).

---

## 2. Two traps that will cost you the application

### Trap 1 — the Bourse excludes students

The conditions require the founder **not to have student status**
(*« ne doit pas avoir le statut d'étudiant »*). You are a final-year student at
ISSAT Mateur. The 12,000 DT is therefore likely unavailable until you graduate.

Do not put "12,000 DT unlocks" in the dossier. If you state it as near-certain
income and the committee knows the eligibility rule — they wrote it — you look
either uninformed or like you are overstating. Say **"sous réserve d'éligibilité"**
or leave it out of the dossier entirely and keep it as your own private plan.

This also interacts with a second condition: the Bourse requires full-time
commitment to the startup and no other ANETI programme. Your other engagements
(Neediditals, Chabaqa) are relevant here and must be described accurately.

### Trap 2 — the resale question is not answered

Your upstream is itself a reseller, and its terms forbid resale without written
approval. The dossier will describe a metered gateway selling model access.
Decide **before** writing which story you are telling:

- **Reseller** — you hold the key, the customer pays you for usage. Needs the
  written approval to be safe.
- **Private / team-internal tooling** — no approval needed, and still fundable.

The funding brief says this surfaces the moment you talk to a real investor. A
label committee is less likely to ask, but « revente de services tiers sans
autorisation » is exactly the kind of phrase that stalls a file. Do not volunteer
the upstream vendor's name anywhere in the dossier — this aligns with the
existing alias-only rule anyway.

### Also check before submitting

- **Nationality / residence / age** conditions on the pré-label.
- Whether a pré-label applicant must eventually incorporate **in Tunisia** —
  yes for the Label; confirm the pré-label has no earlier deadline attached.
- Whether a **student** may hold a pré-label at all. This is the one thing I
  could not verify from the repo and it gates the whole filing. Ask
  hello@startup.gov.tn directly, in the same email, as a plain question.

---

## 3. Verified facts — use these, not the old ones

Every earlier draft (`Emergent-Ventures-FINAL.md`, `Zaino-Applications.md`,
`Tunisia-Contacts-Verified.md`, `plans/pitch-deck-plan.md`) cites **641 tests /
40 migrations / 591 tests**. Those were true at the time and are now stale.

Measured on 17 Nov 2026 by running the suite and reading the migration folder:

| Claim | Say this | Old value in the docs |
|---|---|---|
| Automated tests | **1,130 tests, 73 files, all passing** | 641 / 591 / 614 |
| Migrations | **43, forward-only** | 40 / 38 / 35 |
| Database tables | **36** | 37 |
| Type-check | **clean (`tsc --noEmit`, exit 0)** | — |
| API routes | **71** | — |
| Pages | **41** | 36 |

Command run, if asked to prove it:

```bash
cd portal && npx vitest run     # 73 files, 1130 tests, ~3.6s
cd portal && npx tsc --noEmit   # exit 0
```

### Product facts, from migration 0039 + 0043

| | Starter | Pro |
|---|---|---|
| Price, D17 | 50 DT | 90 DT |
| Price, card (international) | $15 | $30 × seats |
| Pool | 50M/month, **one shared pool** | 50M/month, one shared pool |
| Daily cap | 3M/day | 8M/day |
| Models | fast, smart | smart, frontier, fable |
| Keys / seats | 3 / 1 | 15 / 25 |
| Context / output | 1M / 64k | 1M / 64k |
| Trial | 3 days, 1M tokens, no card | same |

**Payments: three rails, three states — do not collapse them into one.**

| Rail | State | What it is |
|---|---|---|
| **D17** (La Poste) | **Live** | Manual transfer, human-verified proof. Works with no matricule fiscale. |
| **Dodo** | Built, `test_mode` | International card processor. Test products only; no money moves. |
| **Tunisian merchant gateways** | **Post-matricule** | The local plug-in layer is already built; each gateway is an added module. |

The dossier must not say "card payments are live" and must not say "we only do
D17". Both are wrong. The correct claim is that payments are local by design with
D17 as the first brick, and that the merchant gateways attach to an existing
provider-abstraction layer once the matricule fiscal exists.


**Do not write "100M tokens per day".** That was the retired model (migration
0025). The live product is a 50M monthly pool with a daily sub-cap. The LinkedIn
pack is built on the old number — irrelevant for the dossier, but do not carry it
across.

**Do not put a margin figure in the dossier.** The repo holds four mutually
exclusive cost bases (0.20 DT/1M, $30 flat unlimited, per-token placeholders,
and a 1.25–1.30× multiplier giving ~20–23%). The 80–89% figure is an assumption
with no invoice behind it. A committee that asks "what is your cost per token"
should get the honest answer: *priced from a bulk arrangement; the per-token
figure is still being finalised.* Nothing in a pré-label dossier depends on it.

---

## 4. The narrative — the blocks you will reuse

Written in French, because the dossier and the email are French. An English
mirror follows the French in §5, for the international programmes.

### 4.1 The problem, in one paragraph

> En Tunisie, environ 30 000 développeurs n'ont aucun moyen légal d'acheter un
> abonnement aux modèles d'IA de pointe. Il n'existe pas de carte bancaire
> acceptée à l'international, pas de facture émise en dinars, et pas de
> revendeur local agréé. Le marché s'est donc rempli d'intermédiaires informels :
> accès revendu via des groupes de messagerie, payé par virement, sans recours si
> le compte disparaît. L'alternative est d'emprunter l'identifiant d'un collègue.
> Dans les deux cas, un développeur ici travaille avec des outils qui ont
> plusieurs années de retard sur ceux d'un développeur à Paris — et l'écart se
> creuse chaque trimestre.

### 4.2 The solution

> Zaino AI est une passerelle d'abonnement avec compteur. Un développeur paie en
> dinars, par un moyen de paiement tunisien, et obtient les mêmes modèles que ses
> pairs à l'étranger : une enveloppe mensuelle de tokens, un tableau de bord
> d'usage et une clé API compatible avec ses outils existants. Les modèles ne
> sont pas les miens. Le chemin d'accès, si.

### 4.2bis Paiement local — say the strategy, not the first rail

The earlier drafts over-identified the product with D17. D17 is the **first**
local rail, chosen because it is the only one that works before matricule
fiscale — not the only rail the product will ever have. A committee reading
"paid via D17" reads a postal wallet; a committee reading "paiement local
tunisien, première brique D17, puis intégration des passerelles marchandes dès
obtention du matricule fiscal" reads a payments roadmap. Same facts, very
different dossier.

**The claim to make:**

> Le paiement est local par conception, pas par contournement. La première brique
> est D17, parce qu'un porteur de projet non immatriculé ne peut pas ouvrir de
> compte marchand. Dès l'obtention du matricule fiscal, les passerelles
> marchandes tunisiennes s'y ajoutent : le rail est déjà isolé derrière une
> interface fournisseur, donc chaque nouveau moyen de paiement est un module
> supplémentaire, sans modification du produit.

**Why that sentence is verifiable rather than a promise** — and this is the part
worth knowing if they ask:

- `portal/lib/billing/types.ts` defines a provider-agnostic contract. Every
  provider-specific fact (payment intents, redirect URLs, callback signatures,
  cancellation) lives behind that interface.
- `portal/lib/billing/index.ts` is a registry: `PROVIDERS = { dev, d17, dodo }`,
  resolved by name at checkout. Adding a rail is one new file plus one entry.
- The subscription state machine, entitlement enforcement and webhook
  idempotency (`billing_events` dedupe) are all provider-neutral and shared.
- Two rails already run on this boundary — a manual one (D17) and a hosted one
  (Dodo) — which proves the abstraction empirically, not just by design.

So the honest statement is: *the local payment layer is a plug-in boundary that
already carries two rails; the remaining Tunisian gateways are additive.*

**Do not name specific gateways in the dossier unless you have confirmed their
onboarding terms.** Paymee, Flouci, Konnect and Clictopay are the usual
candidates for a Tunisian merchant account, but I could not verify their current
requirements or API terms today — the research tool was unavailable. What the
dossier needs is the *architecture* claim above, which is true independent of
which gateway signs first. Confirm each one's prerequisites before you commit to
a named integration in writing.

**One correction to the Dodo framing.** The card rail in the repo is Dodo, an
international processor, and it is in `test_mode`. It is not the "local card
rail" and it will not become one. Local card acquiring in Tunisia runs through
the SMT/Monétique settlement and is a different integration. Keep the two
separate in your head and in the dossier: **D17 (live), Dodo (international, in
test), passerelles locales (post-matricule).**

### 4.3 What is actually innovative — the answer that matters most

This is the section the committee reads hardest, because « innovation » is the
criterion. Do not claim the models. Claim the layer.

> L'innovation n'est pas l'inférence. La difficulté, sur ce marché, est la couche
> autour : compter avec assez de précision qu'un client ne puisse jamais
> consommer plus qu'il n'a payé, appliquer ce quota à chaque requête et échouer
> en refusant plutôt qu'en laissant passer, facturer dans une devise qui n'a pas
> de rail carte, et faire tout cela dans le cadre légal. C'est ce que j'ai
> construit, et c'est pourquoi personne ici ne l'a fait. Le conformité n'est pas
> une contrainte posée sur le produit : c'est le produit.

Back it with the mechanism, because a committee can check a mechanism:

> Un seul compteur (tokens mélangés, cinq colonnes du grand livre additionnées),
> une seule règle (`autorisé = dû ET tokens_utilisés < plafond`), et une seule
> fonction de fenêtre temporelle partagée par le tableau de bord et par le chemin
> d'application. Trois tâches indépendantes appellent la même fonction, donc le
> chiffre que le client voit et le chiffre qui le bloque ne peuvent pas diverger.
> La fenêtre est mensuelle, avec un plafond journalier qui borne le pire cas à
> une journée au lieu d'un mois.

### 4.4 The Chabaqa credential — your strongest single line

You have already taken a company through this exact process. Say it once, plainly,
near the top, and never again:

> J'ai déjà mené ce dossier à son terme : en tant que CTO de Chabaqa.io, j'ai
> obtenu le Label Startup Act pour cette société. Je connais le dossier, le
> comité et les délais.

That single sentence moves you from "primo-entrepreneur with an idea" to
"founder who has completed a Tunisian public process". It is the highest-value
line in the whole application and it costs one sentence.

### 4.5 What exists today

> Ce n'est pas une proposition. Le système tourne :
>
> - une passerelle multi-tenant avec application stricte du quota à chaque requête, en échec fermé
> - deux rails de paiement : D17 (virement vérifié par un humain) actif pour les dinars, un rail carte construit et en mode test
> - un tableau de bord trilingue français / arabe / anglais, et une console d'administration
> - un client de bureau avec connexion par navigateur, pour que l'utilisateur ne manipule jamais une clé brute
> - 1 130 tests automatisés au vert, typage propre, 43 migrations à sens unique

---

## 5. English mirror (for international programmes only)

> Tunisia has roughly 30,000 developers and almost none of them can legally buy a
> frontier AI subscription: no internationally accepted card, no invoice in
> dinars, no licensed local reseller. The gap filled with informal ones — access
> resold through chat groups, paid by transfer, no recourse if the account
> vanishes. A developer here therefore works with a toolset years behind a
> developer in Paris, and the gap compounds every quarter.
>
> Zaino AI is a metered subscription gateway. A developer pays in dinars through a
> Tunisian payment method — starting with D17, the La Poste wallet almost everyone
> already has — and gets the same models their peers abroad use: a monthly token
> allowance, a usage dashboard, an API key that works with existing tooling. The
> models are not mine. The way in is.
>
> The innovation is not inference. It is the layer around it: metering precisely
> enough that a customer cannot consume more than they paid for, enforcing that
> quota on every request and failing closed, billing in a currency with no card
> rail, and doing all of it inside the rules. Compliance is not a constraint on
> the product; it is the product.
>
> This is already running: 1,130 automated tests passing, a clean type-check, 43
> forward-only migrations, two payment rails, a trilingual dashboard, a desktop
> client with browser device login. I have done this once before — as CTO of
> Chabaqa.io I secured the Tunisian Startup Act label for that company.

---

## 6. Budget — one table, no double count

The workbook defines **1,885 DT as the whole lean budget**. Two other documents
then list "SUARL incorporation 1,885 DT" *and* add Apple (307), the Label (100)
and a 573 buffer on top — every one of which is already inside the 1,885. That
is a ~1,485 DT double count, and the resulting table asks for $1,000 against a
$607 need. If a reviewer checks the arithmetic, it is the one thing in the file
they can catch you on.

**The honest table:**

| Poste | DT | USD ≈ |
|---|---:|---:|
| Immatriculation SUARL (RNE, statuts, timbre, publication) | 400 | 129 |
| Frais bancaires + capital versé | 1 000 | 323 |
| Apple Developer Program (certificats inclus) | 307 | 99 |
| Google Play Console | 78 | 25 |
| Frais de dossier Label Startup | 100 | 32 |
| **Total** | **1 885** | **608** |

Two things this table gets right that the drafts got wrong:

- **Apple's $99 already includes the signing certificates.** A separate
  "code signing" line is a phantom cost for iOS/macOS. Only a *signed Windows
  build* would need a separate certificate, and that is not now.
- **The 573 DT "buffer" is not a cost**, it is the remainder. Do not add it.

Round the ask to **1 900 DT** if a single figure is required, and say why:
« arrondi pour les frais de virement ». Honest, checkable, no invented line.

---

## 7. Contact details — pick one set, then never mix

Three sources disagree, including two documents written the same day:

| | Form submissions used | CV / other doc |
|---|---|---|
| Email | ceo-louayrjili@sohabi.app | louay.rjili@gmail.com |
| Phone | +216 24 267 363 | +216 51 803 706 |
| City | Tunis | Rades Meliane |

**Recommendation:** use `ceo-louayrjili@sohabi.app` / `+216 24 267 363` —
that is what every previous submission used, and consistency with the record
matters more than which mailbox is nicer. But the two problems with it are real:

1. The domain is `sohabi.app`, not `zaino`. On a *government* form about Zaino,
   a mismatched domain invites the question of whether Zaino is a real entity.
   **But `zaino.soon.it` cannot send mail as it stands** (checked 19 Nov 2026):
   the subdomain has no MX record, and `soon.it` publishes `v=spf1 -all`, which
   authorizes *no* sender at all. Creating the mailbox is not a DNS-only change —
   it needs a real mailbox on a provider plus SPF/DKIM/DMARC for the subdomain.
   For this filing, use `ceo-louayrjili@sohabi.app`, which has MX, SPF and DKIM
   live, and state the website as `zaino.soon.it` separately.
2. **Location must be Rades Meliane**, not Tunis. Rades Meliane is in Ben Arous.
   The form asks where you physically are; answer accurately.

The CV's address is only correct if you actually use it. Whichever you pick, the
email, the dossier PDF and the CV must agree. A reviewer comparing two documents
is the cheapest diligence in the world, and it is the one that finds a mismatch.

---

## 8. The email, ready to send

Short, two questions, and it asks the eligibility question honestly rather than
hiding it. Send from the address you will use on the form.

```
À : hello@startup.gov.tn
Objet : Pré-label Startup Act — Zaino AI (pré-immatriculation)
```

> Bonjour,
>
> Je suis Louay Rjili, fondateur de Zaino AI. Nous permettons aux développeurs
> tunisiens d'accéder aux modèles d'IA de pointe en payant en dinars via D17,
> faute de carte internationale et de facturation locale.
>
> Le produit est construit et en production : passerelle API multi-tenant,
> application stricte des quotas à chaque requête, rail D17 actif, tableau de
> bord trilingue FR/AR/EN, 1 130 tests automatisés au vert, 43 migrations. J'ai
> par ailleurs obtenu le Label Startup Act pour Chabaqa.io en tant que CTO, donc
> le dossier ne m'est pas inconnu.
>
> Zaino n'est pas encore fiscalement ouverte en Tunisie ; j'engage la
> constitution de la société et je souhaite déposer un pré-label au titre de
> l'article 4 avant l'immatriculation.
>
> Trois questions :
>
> 1. Un porteur de projet encore étudiant est-il éligible au pré-label ?
> 2. Quelles pièces accompagner le dépôt à ce stade (business plan, preuve de
>    concept, statuts à venir) ?
> 3. Quand ouvre la prochaine session de labellisation ?
>
> Je peux vous présenter le produit en démonstration en quinze minutes si c'est
> utile.
>
> Bien cordialement,
>
> Louay Rjili
> Fondateur, Zaino AI
> ceo-louayrjili@sohabi.app · +216 24 267 363
> zaino.soon.it

Three questions is the maximum for a reply. Question 1 is the one that decides
whether you file now or wait — it is worth leading with inside the body.

---

## 9. What still has to be decided before you submit

- [ ] **Student eligibility** for the pré-label (§2) — the one blocking unknown
- [ ] **Which story**: reseller (needs written approval) or private/team tooling
- [ ] **Contact set** finalised, and matching on form + PDF + CV (§7)
- [ ] **Business plan document** — the pré-label dossier needs one; nothing in
      the repo is written for a *Tunisian government* reader. The investor deck
      is the wrong document (it leads with a $3.8M ARR ceiling and an ask).
- [ ] **Company name reservation** — the SUARL name must be reserved before
      filing, and "Zaino AI" as written may not be the registrable form
- [ ] Confirm the **pré-label fee** — the 100 DT figure in the notes is the
      *Label* fee, not necessarily the pré-label's

---

## 9bis. Formulaire pré-label — réponses finales

Paste-ready. Verified against live infrastructure on 17 Nov 2026.

| Champ | Valeur |
|---|---|
| **Nom du projet** | `Zaino AI` |
| **Description (< 25 mots)** | `Zaino AI est une passerelle API par abonnement donnant aux développeurs tunisiens accès aux modèles d'IA de pointe, avec un paiement local en dinars.` (24 mots) |
| **Lien site web** | `https://zaino.soon.it` |
| **Industrie** | Technologies de l'information / Logiciel |
| **Secteur d'activité** | TIC — services numériques / SaaS |
| **Type de Technologie** | SaaS / Cloud / API |
| **Région** | Tunisie |
| **Région en Tunisie** | Ben Arous (Rades Meliane) |

**Structure du capital** — one row:

| Nom de l'actionnaire | Type | N° CIN | Pourcentage | Actions |
|---|---|---|---|---|
| Louay Rjili | Personne physique (Fondateur) | *[CIN]* | 100 % | 100 |

100 actions à 10 DT = 1 000 DT de capital, cohérent avec la ligne budget.
A SUARL is by definition unipersonnelle, so a single 100 % shareholder is the
legally correct shape — not merely a preference.

**The warning on this field is a commitment, not a formality.** The form states
the administration may refuse the passage from Pré-Label to Label if the declared
structure is not respected. Declaring 100 % now means: do not bring an
accelerator onto the cap table (Flat6Labs, 216 Capital) between the pré-label and
the Label. Both are blocked on incorporation anyway, so the current sequence is
consistent — but know that this field is the one place where a later equity
decision can cost you the Label.

Website check: `https://zaino.soon.it` → **200**, title *« Zaino AI — One API for
Every Model »*. `https://api.zaino.soon.it/v1/models` → **401**, i.e. the auth
wall is live and refusing anonymous calls. Both are demonstrable if asked.

---

## 10. The three sentences to keep unchanged

If you compress this whole file into what you actually say:

1. **The problem is payment rails, not talent.** Thirty thousand developers, no
   card, no dinar invoice — that is the market, and it is why nobody else serves
   it.
2. **The product is the meter, not the model.** Alias-only access, one shared
   pool, one rule enforced identically by three jobs, failing closed.
3. **I have done this before.** Chabaqa.io, Label obtained, dossier and committee
   known.

Everything else is evidence for those three.
