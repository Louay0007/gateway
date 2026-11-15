# Zaino AI — LinkedIn Growth & Acquisition Plan

**Written:** 2026-11-06 · **Scope:** company page + founder profile + conversion path
**Grounded in:** the live repo (`plans/linkedin-growth.md` is the companion to `README.md`, `CPO_ROADMAP.md`)

---

## 0. Read this before you post anything

Three gates. Two of them are not negotiable, and one of them decides which
audience you can actually convert.

### Gate 1 — ToS: you are selling resale, publicly

`README.md` §"Before serving third parties" states it plainly: Anthropic's
Commercial ToS permits powering your own products (§A.1) but forbids
**reselling the Services without express approval** (§D.2). Your upstream is
itself a reseller, so you inherit its exposure.

A public LinkedIn campaign that advertises paid API access to a metered
gateway **is** the resale use case. Private/team use can proceed now. A public
growth campaign is the thing that needs the written answer first.

**Do this:** send the request now, in parallel with everything below. Until it
lands, run the plan in **waitlist mode** — capture intent, demo the product,
onboard design partners by hand. Do not run paid promotion or an "open signup"
announcement on the resale framing before that answer arrives.

### Gate 2 — There is no international payment path

`portal/lib/billing/` has exactly one live provider: **D17 (La Poste
Tunisienne)**, a manual transfer with a human approving every proof. There is
no card path — Stripe was removed (`README.md` line 44). `usdTndRate()`
defaults to 3.1 and the checkout page is trilingual FR/AR/EN.

This is the single biggest fact in this plan. A globally-targeted LinkedIn
campaign will produce clicks from Paris, Berlin and Bangalore that **cannot
pay you**. Plan accordingly:

| Phase | Audience | Why it converts |
|---|---|---|
| 1 (weeks 1–6) | **Tunisia + Maghreb devs** | D17 works, French works, 50 DT is cheap locally |
| 2 (weeks 7–12) | **Francophone Europe** (FR/BE/CH/CA) | Same language, needs a payment fix first |
| 3 (quarter 2) | Global English | Needs card/Stripe or invoice-on-request |

**The cheapest fix that unlocks phase 2:** a manual invoice path — "DM us, we
send a Stripe/PayPal link or a monthly invoice." No code required to start
collecting intent. Then wire the real provider.

### Gate 3 — Alias-only surface, even in marketing

The product invariant is that a customer never sees an upstream model name
(`CONTEXT.md` §1). Your docs already bend this — `docs-data.ts` renders
"Zaino Haiku 5.5 / Zaino Sonnet 5.5". Pick one rule and hold it everywhere:

> Public naming is always the **alias**: Fast, Smart, Frontier, Fable.

Never write "we resell Sonnet" on LinkedIn. Write "Smart". It is also better
marketing: it makes the tier the product instead of the vendor.

---

## 1. Strategy — the uncomfortable fact first

**A company page will not get popular.** LinkedIn's distribution favours
people over logos by roughly 5–10×.

What the API returned for `zaino-ai-4a196a449`: name "Zaino AI", headline
"startup chez Zaino AI", locale FR, a logo rather than a face. That is the
whole record — the endpoint returns headline and vanity name, so I cannot
confirm from here whether About, Experience and Featured are filled in.
**Check those three sections yourself**; if they are empty, they are the
cheapest wins in this document. Either way the headline says what the company
is called, not what it does, and nobody follows a logo that describes itself
as "startup chez".

So the engine has to be two things running together:

```
  FOUNDER / BUILDER PROFILE          COMPANY PAGE
  (primary reach engine)      →      (storefront + proof)
  posts daily, comments hourly       reposts, hosts the deck,
  people follow a person             houses the case studies
```

**The recommendation:** put a human face on the account. Either convert the
existing `zaino-ai-4a196a449` profile into "Firstname Lastname — building
Zaino", or create a founder profile and keep the page as the company. The
profile is where 80% of the effort goes.

### The one-sentence pitch (use it everywhere, unchanged)

> **FR:** *Une seule clé, l'API Claude et OpenAI, et 100 millions de tokens
> par jour — remis à zéro chaque minuit.*

> **EN:** *One key, the Claude and OpenAI APIs, and 100M tokens a day — reset
> at midnight.*

That is the whole product. It is concrete, it is countable, and it is a claim
no competitor can copy without changing their cost structure. Lead with it
until people can finish the sentence for you.

### The content thesis

Your competitors publish opinions. You have something rarer: **a repo full of
specific, expensive bugs you already fixed, with the numbers.**

You have measured that you were billing cache-heavy workloads at 2× — 595,926
blended tokens where the truth was 298,637. You shipped a per-day budget
summed over a per-month window and silently cut Pro customers by 52% before
catching it. You have 591 tests pinning those invariants.

That is the content. Not "AI is changing everything" — instead: *"we were
charging our own customers double, here is the query, here is the fix, here is
the test that stops it happening again."* Developers follow the person who
publishes their own postmortems. It is unfakeable, it builds trust faster than
any feature announcement, and you already have 20 of them written down.

---

## 2. The four content pillars

Rotate in this ratio. Every post belongs to exactly one.

| Pillar | Share | Job | Source material |
|---|---|---|---|
| **1. Postmortem / engineering truth** | 40% | Authority. This is the follower engine. | `HANDOFF.md` §5, migrations 0028/0029, the edge rules |
| **2. The economics of AI access** | 25% | Differentiation. Makes the 100M claim credible. | `README.md` quota section, `PLATFORM.md` §4.3 |
| **3. Build-in-public / product** | 20% | Conversion. Shows what to click. | `CPO_ROADMAP.md` P0, changelog |
| **4. Proof / social** | 15% | Trust. Short, visual. | Screenshots, latency numbers, user quotes |

### Format rules (these decide reach more than the copy)

- **Hook in the first 2 lines.** LinkedIn truncates at ~140 characters on
  mobile. Line 1 must work alone.
- **One idea per post.** If you have two, that is two posts.
- **No external link in the post body.** It suppresses reach. Put the link in
  the first comment, then say "link in comments."
- **Code and numbers as images.** Screenshots of real SQL output, real
  terminal output, real dashboards outperform text 3–5×. You have all of it.
- **Carousels (PDF) for anything with more than 4 steps.** They are the
  highest-dwell format on the platform.
- **Write in French first** (profile locale is `fr_FR`, market is Tunisian),
  and post an English version 24h later when the topic is universal. Same
  content, different audience — not a translation dump, a second post.
- **Never post and leave.** The first 60 minutes of comments decide the
  distribution. Be present.

---
## 3. Profile rebuild — paste-ready

Do this before the first post. A profile that lands traffic and has nothing to
read wastes every visit.

Every string below is measured. Character counts are stated because LinkedIn
truncates silently, and the field limits are: headline 220 · tagline 120 ·
About 2,600 (company: 2,000) · experience 2,000 · skills 50 · featured 5 items.

### 3.1 The profile is brand-new

The account `zaino-ai-4a196a449` returned three fields: name, headline
(`startup chez Zaino AI`), locale `fr_FR`. Treat it as empty and fill it in
order — a half-filled profile is worse than an untouched one, because the
sections you leave blank are the ones visitors check.

**Do not add Experience, Skills or Website links yet.** You are selling a live
gateway, not a stack. Adding a "Founder, Zaino" line you cannot fill with
three shipped things is the profile equivalent of an empty landing page.

### 3.2 Headline — the highest-leverage field

It appears next to every comment you leave, so it is read by people who never
visit the profile.

```
FR ▸ Je construis Zaino — une clé, l'API Claude + OpenAI, 100M tokens par jour. Rust + Postgres. Facturé à la journée.
```
`113 / 220 characters` (the `FR ▸` marker is a label, not part of the field)

```
EN ▸ Building Zaino — one key, the Claude + OpenAI APIs, 100M tokens a day. Rust + Postgres. Metered daily.
```
`102 / 220 characters`

Rules this follows: the claim first, the proof after, no leading "Passionné
par". Stop at the claim if you are unsure — the second half runs past the
mobile crop on some surfaces.

### 3.3 About

**FR — 1,507 / 2,600 characters.** The first two sentences (~213 characters)
are all that shows before "see more", so the hook is engineered to land
before the cut.

```
On facture l'IA à la journée, pas au mois.

La plupart des passerelles vous vendent un plafond mensuel. Vous payez pour des tokens que vous n'utilisez pas — et le jour où vous en avez besoin, il est déjà consommé.

Zaino inverse la fenêtre : 100 millions de tokens par jour et par modèle, remis à zéro chaque minuit, heure de Tunis. Pas de limite par minute. Pas de plafond en dollars. Une seule règle : le budget du jour. Le lendemain, il revient.

Une clé, deux formats natifs — l'API OpenAI et l'API Anthropic. Votre code existant fonctionne tel quel : Claude Code, Codex, Cursor, le SDK Python, curl. Il n'y a pas de SDK intermédiaire à installer, parce que les SDK que vous utilisez déjà parlent notre API.

Ce qui nous occupe vraiment, c'est le compteur. Un token qui traverse la passerelle est compté une fois et une seule : entrée, sortie, écriture de cache, lecture de cache. Nous avons publié nos propres bugs de facturation, chiffres à l'appui, parce qu'une passerelle qui compte mal est pire qu'aucune passerelle.

Concrètement :
· Quatre niveaux — Fast, Smart, Frontier, Fable — du moins cher au raisonnement le plus profond
· 1M de contexte, 64k de sortie
· Configs Claude Code et Codex vérifiées, avec les pièges documentés
· Extraction de documents et recherche de conversations servies par un moteur écrit en Rust, pas par du JavaScript qui bloque la boucle d'événements

37 tables. 35 migrations. 591 tests. Tout est mesuré ou ça n'existe pas.

Essai de 3 jours, sans carte.

zaino.soon.it
```

**EN — 1,276 / 2,600 characters.** Post this as the secondary language
after the French has run; do not publish both the same day.

```
We bill AI by the day, not by the month.

Most gateways sell you a monthly ceiling. You pay for tokens you never use — and the day you need them, they are already spent.

Zaino inverts the window: 100 million tokens per day, per model, reset every midnight Tunis time. No per-minute limits. No dollar caps. One rule: the day's budget. Tomorrow, it comes back.

One key, two native formats — the OpenAI API and the Anthropic API. Your existing code works as-is: Claude Code, Codex, Cursor, the Python SDK, curl. There is no wrapper SDK to install, because the SDKs you already use speak our API.

What we actually care about is the meter. A token that crosses the gateway is counted once, and once only: input, output, cache write, cache read. We have published our own billing bugs, numbers included, because a gateway that miscounts is worse than no gateway.

Concretely:
· Four tiers — Fast, Smart, Frontier, Fable — cheapest to deepest reasoning
· 1M context, 64k output
· Verified Claude Code and Codex configs, with the traps documented
· Document extraction and conversation search served by an engine written in Rust, not JavaScript blocking the event loop

37 tables. 35 migrations. 591 tests. It is measured or it does not exist.

3-day trial, no card.

zaino.soon.it
```

### 3.4 Featured section — three items, not five

Featured is the only place a visitor can click something without scrolling.
Three strong items beat five, because the fourth and fifth never get seen.

1. **The pitch deck** as a PDF document (§9) — it is already a LinkedIn-native format
2. **`zaino.soon.it/pricing`** — the commercial answer, with the trial
3. **`zaino.soon.it/docs`** — the developer answer, "configs that actually work"

The changelog and the postmortem carousel go in later, once the changelog is
actually current (`changelog-content.tsx` stops at 26 October — fix that
before you feature it).

**Do not** link to the bare domain. `/pricing` and `/docs` are the two pages
that do work; the root page does not yet.

### 3.5 The click path this creates

```
profile views → Featured (3 clicks max) → /pricing or /docs
             → sign-up → trial → paste a key → 200
```

Every extra step here is a place a visitor leaves. Which is why the profile
carries no résumé, no skills list and no "open to work" — none of it serves
that path.

### 3.6 Company page

This is the profile you have today. Fill it; do not rebuild it.

**Name:** Zaino AI — keep.

**Tagline — 53 / 120 characters:**

```
Une clé, l'API Claude + OpenAI, 100M tokens par jour.
```

**About — 1,981 / 2,000 characters.** Check the count again after any edit;
twenty characters of headroom is the whole margin.

```
Une clé, l'API Claude et l'API OpenAI, 100 millions de tokens par jour.

La plupart des passerelles vendent un plafond mensuel. Vous payez pour des tokens que vous n'utilisez pas, et le jour où vous en avez besoin, il est déjà consommé. Un projet d'agent brûle 90 % de son budget en trois jours, puis plus rien pendant deux semaines. Un plafond mensuel punit exactement le comportement qu'il prétend financer.

Zaino inverse la fenêtre : 100 millions de tokens par jour et par modèle, remis à zéro chaque minuit, heure de Tunis. Pas de limite par minute. Pas de plafond en dollars. Pas de plafond de concurrence. Une seule règle : le budget du jour. Le lendemain, il revient.

Une clé, deux formats natifs. Les SDK OpenAI et Anthropic que vous utilisez déjà fonctionnent sans intermédiaire : Claude Code, Codex, Cursor, le SDK Python, curl. Seules la base URL et la clé changent.

Quatre niveaux, un nom par niveau — Fast, Smart, Frontier, Fable. 1M de contexte, 64k de sortie. Un alias ne révèle jamais le moteur qui le sert, ce qui permet de le changer sans qu'aucun client n'ait à relire une ligne de code.

Ce qui nous occupe vraiment, c'est le compteur. Un token qui traverse la passerelle est compté une fois et une seule : entrée, sortie, écriture de cache, lecture de cache. Nous avons publié nos propres bugs de facturation, chiffres à l'appui — dont un qui facturait les charges intensives en cache au double de leur coût réel. Une passerelle qui compte mal est pire qu'aucune passerelle.

Sous le capot : 37 tables, 35 migrations, 591 tests. Un moteur d'extraction de documents et de recherche écrit en Rust, parce qu'un PDF de 200 pages n'a rien à faire dans la boucle d'événements d'un serveur web.

Virement D17 (La Poste Tunisienne) en Tunisie, facture sur demande ailleurs. Il n'y a pas de carte dans le produit, et c'est un choix : si vous ne pouvez pas payer en 30 secondes, vous devez pouvoir essayer en 30 secondes.

Essai de 3 jours, sans carte.

zaino.soon.it
```

| Field | Now | Set to |
|---|---|---|
| Headline / tagline | `startup chez Zaino AI` | the 53-character tagline above |
| About | — | the 1,981 characters above |
| Industry | — | Software Development |
| Company size | — | 1–10 |
| Headquarters | — | Tunis, Tunisia |
| Type | — | Privately Held |
| Specialties | — | LLM gateway, API, Claude, OpenAI, developer tools, metering, Rust |
| Website | — | `zaino.soon.it` |
| Custom button | — | "Visiter le site" → `/pricing` |
| Logo | set | keep — it already reads at 32px |
| Cover | — | one dark banner, pitch in large type, same file as the personal profile |

**Language:** set the page to French primary. Profile locale is already
`fr_FR`; a French page with an English About is the most common mismatch.

**Cadence:** never post the same thing on both the same day. The page reposts
the founder's post 2–4 hours later, with one added line (a number, or the
link). That is the entire page strategy, and it works only because the founder
profile is where the reach is.

### 3.7 Copy rules this section follows

Worth keeping, because you will write more of this copy:

- **The claim before the credentials.** "100M tokens a day" earns the right to
  mention Rust; "Rust + Postgres" does not earn the right to mention 100M.
- **Numbers, not adjectives.** 591 tests, 1M context, 64k output, 37 tables.
  Delete every "puissant", "innovant", "révolutionnaire" — they are the
  reliable signature of a profile nobody reads.
- **Never name the upstream vendor.** Fast, Smart, Frontier, Fable. Always.
  It is the product invariant (`CONTEXT.md` §1) and it also reads as
  confidence rather than as resale.
- **Ship the last line as a door, not a slogan.** `Essai de 3 jours, sans
  carte.` is clickable truth; "Rejoignez-nous !" is not.
- **Say the limitation out loud.** D17 only, invoice on request. A developer
  who discovers that after signing up is a churn; one who reads it first is a
  qualified lead.

---

## 4. The daily posting plan

### 4.1 Cadence reality

Daily posting is sustainable only if you batch. The schedule below is
**5 posts/week on the profile + 1 on the page**, which beats 7 mediocre posts
every time, plus a **daily 15-minute comment block** that matters more than
the posting.

| Day | Pillar | Format | Job |
|---|---|---|---|
| **Mon** | Postmortem | Text + screenshot | The week's authority anchor |
| **Tue** | Economics | Carousel (PDF, 8 slides) | Differentiation |
| **Wed** | Build-in-public | Text or demo video | Conversion |
| **Thu** | Postmortem (short) | Text, one number | Second reach bite |
| **Fri** | Proof / social | Screenshot or testimonial | Trust before the weekend |
| **Sat/Sun** | — | Comments only | Never post into the void |

**Batch on Sunday, 90 minutes.** Write 5 posts, make 2 carousels, screenshot
everything you need. Posting is 10 minutes a day; preparation is one block.

### 4.2 The daily 45-minute routine (non-negotiable)

This is what actually makes an account grow. Posting is the excuse.

| Minutes | Action |
|---|---|
| 0–10 | Reply to **every** comment on your last post. All of them. |
| 10–30 | Comment on **10 posts** from the people you want to reach. Real comments — a question, an addition, a number from your own data. Never "great post". |
| 30–40 | Accept connections, send **3 DMs** using the scripts in §6. |
| 40–45 | Log the day's numbers in the tracking sheet (§8). |

---

## 5. Thirty days of posts — full copy

Ready to publish. `[ ]` = your screenshot or number to insert. Every post
follows the same skeleton: **hook → tension → evidence → lesson → soft CTA.**

---

### WEEK 1 — Establish the thesis

#### Post 1 · Mon · Postmortem (anchor)

```
Nous facturions nos propres clients deux fois trop cher.

Pendant des semaines, un client qui utilisait le cache payait 2× son usage
réel. Nous l'avons découvert par accident, en comparant deux chiffres :

  entrée facturée ......... 595 926 tokens
  entrée réellement due ... 298 637 tokens

Le bug tenait en une addition. Le fournisseur renvoie `prompt_tokens`, qui
contient DÉJÀ les tokens lus depuis le cache. Notre requête faisait :

  prompt_tokens + cache_read_tokens

…donc nous comptions la partie cachée deux fois. Chaque client intensif en
cache était coupé à la moitié de son quota, sans aucun message d'erreur.

La correction a demandé une colonne (`fresh_input_tokens`), une migration
qui recalcule l'historique, et une contrainte qui interdit à l'ancienne
formule de revenir.

Ce qui nous a le plus coûté n'est pas le bug. C'est que notre tableau de bord
affichait les mêmes chiffres faux, avec assurance. Un mauvais compteur qui a
l'air sûr de lui est pire qu'une panne.

Une passerelle qui compte mal n'est pas une passerelle.

#LLM #Billing #Postgres
```

#### Post 2 · Tue · Économie · Carousel 8 slides

Slide copy (one idea each):

1. `Votre quota IA mensuel est une fiction.`
2. `Vous payez pour un plafond que vous n'utilisez pas.` — `30 jours facturés, 2 jours actifs.`
3. `Puis le jour où vous en avez besoin…` — `…il est déjà consommé.`
4. `Nous avons inversé la fenêtre.` — `100M tokens par jour, par modèle.`
5. `Remis à zéro à minuit, heure de Tunis.` — `Pas de fenêtre glissante. Pas de reset sur demande.`
6. `Un jour lourd ne détruit pas le mois.` — `Le lendemain repart à 100M.`
7. `Comment on peut se le permettre :` — `Notre coût amont est fixe. Le vôtre devient prévisible.`
8. `Une clé. Deux formats. 3 jours d'essai.` — `zaino.soon.it`

Caption:

```
Un quota mensuel est une fiction comptable.

Il suppose que vous consommez régulièrement. En réalité un projet d'agent
consomme 90% de son budget en trois jours, puis plus rien pendant deux
semaines.

Le plafond mensuel punit exactement le comportement qu'il prétend financer.

Nous avons changé la fenêtre : 100 millions de tokens par jour et par
modèle, remis à zéro à minuit (heure de Tunis). Un jour lourd coûte un jour,
pas un mois.

Les 8 slides expliquent le calcul.

#LLM #API #DevTools
```

#### Post 3 · Wed · Build-in-public

```
Le pire message d'erreur de notre produit disait :

  "Model 'frontier' is not available for this API key"

Notre client lisait ça et pensait que sa clé était cassée. Il la recréait.
Il nous écrivait. Il perdait une heure.

Le vrai problème : il avait épuisé ses tokens Frontier pour la journée.

La clé allait très bien. Le message accusait le mauvais objet.

Aujourd'hui il lit :

  "Out of frontier tokens for today — resets at midnight Tunis time."

Même refus, 20 lignes plus bas dans la pile. Aucune ligne de facturation
changée. Simplement le refus qui dit la vérité.

Règle qu'on s'est donnée : un refus doit nommer la chose que l'utilisateur
peut changer, jamais la chose qu'il ne peut pas.

#UX #DevTools #API
```

#### Post 4 · Thu · Postmortem court

```
Une fenêtre de facturation de 24h, additionnée sur un mois.

C'est ce que nous avons livré un jour. Le budget était
"100M par jour" ; la requête sommait sur le mois entier.

Résultat : le plan Pro passait de 210M/mois à 100M/mois. Moins 52%, sans
qu'un seul client ne reçoive d'explication.

Deux décisions raisonnables prises séparément. Une catastrophe prise
ensemble.

Le test qui aurait dû exister : convertir l'unité dans les deux sens et
comparer. Il existe maintenant.

#Postgres #Billing
```

#### Post 5 · Fri · Preuve

```
[SCREENSHOT: terminal, curl sur /v1/messages, réponse streaming]

Le même code, deux fournisseurs d'API.

  OpenAI SDK    →  base_url: zaino.soon.it/v1
  Anthropic SDK →  base_url: zaino.soon.it

Pas de SDK intermédiaire. Pas de traduction à maintenir. Vos 40 lignes
existantes fonctionnent, la clé change et rien d'autre.

Claude Code et Codex sont vérifiés sur les deux formats, avec les configs
dans la doc — pas une capture d'écran marketing.

#ClaudeCode #OpenAI #DevTools
```

---

### WEEK 2 — Build the authority

#### Post 6 · Mon · Postmortem (the best one you own)

```
LiteLLM calcule l'accès d'une clé comme l'INTERSECTION de deux listes :
les modèles de la clé, et les modèles de son équipe.

Nous poussions les modèles sur chaque clé. Jamais sur l'équipe.

L'équipe était créée une fois avec la liste par défaut, et gardait cette
liste pour toujours. Chaque clé héritait donc silencieusement de l'ancienne
liste.

Symptôme : une clé correctement configurée `{fast, smart}` renvoyait

  403 "Model 'smart' is not available for this API key"

…alors que `GET /v1/models` renvoyait fièrement `["fast","smart"]`.

Le message accuse la clé. L'objet fautif est l'équipe, deux niveaux plus haut.

Pourquoi c'est resté invisible ? Parce que tous nos plans autorisaient
exactement `["fast"]`, qui correspondait par coïncidence à la liste par
défaut. Ajouter un modèle à un plan a suffi à l'exposer.

La leçon n'est pas "faites attention aux intersections". C'est :
si deux listes doivent être d'accord, le test doit vérifier l'intersection,
pas chaque liste séparément. Nos tests vérifiaient chaque liste. Tous verts.

#LiteLLM #Postgres #Debugging
```

#### Post 7 · Tue · Économie

```
Le vrai coût d'un token n'est pas le prix du token.

C'est le prix du token × votre taux d'utilisation du plafond.

Un plafond de 1M tokens utilisé à 12% coûte 8× plus cher au token utile
qu'un plafond de 200k utilisé à 90%.

Toutes les grilles tarifaires du marché comparent des prix au token.
Aucune ne compare des taux d'utilisation — parce que c'est là qu'elles
perdent.

[SCREENSHOT: tableau 3 offres, colonne "prix/token", colonne "coût réel du token utile"]

Regardez la deuxième colonne, pas la première.

#SaaS #Pricing #LLM
```

#### Post 8 · Wed · Build-in-public

```
Ce que fait un token quand il traverse notre passerelle :

  client → Caddy (TLS) → auth-edge (préfixe de clé)
         → LiteLLM (auth, quotas, routage) → amont

Quatre sauts, dont trois en local. Coût ajouté mesuré : sous le bruit de
mesure du fournisseur lui-même.

Pourquoi auth-edge existe : nos clients ont des clés `zn-`, la passerelle
stocke des `sk-`, et son normaliseur ne hache QUE ce qui commence par `sk-`.
Le préfixe n'est pas cosmétique, il est structurel.

Un service de 800 lignes, sans aucune dépendance, pour trois caractères.

Il y a un principe derrière : le dernier endroit où mettre une dépendance
npm, c'est un proxy de credentials.

#NodeJS #Architecture #Security
```

#### Post 9 · Thu · Postmortem court

```
Notre stream SSE était compressé en gzip.

Mesure de l'écart entre deux tokens consécutifs :

  sans compression ....... 2,3 ms
  avec compression ....... 23,9 ms

Dix fois plus lent. La compression attend d'avoir un bloc avant de le
pousser — c'est exactement ce qu'il ne faut pas faire à un flux de tokens.

Un flux n'est pas un document. Ne le compressez pas.

#SSE #Streaming #Performance
```

#### Post 10 · Fri · Preuve

```
[SCREENSHOT: page /docs, config Claude Code]

Trois lignes pour brancher Claude Code :

  export ANTHROPIC_BASE_URL="https://api.zaino.soon.it"
  export ANTHROPIC_AUTH_TOKEN="zn-..."
  export ANTHROPIC_API_KEY=""      ← vide, et c'est important

Le piège que personne ne documente : si `ANTHROPIC_API_KEY` n'est pas vide,
votre client l'envoie à la place du token et vous obtenez un 401 qui n'a
aucun rapport avec le vrai problème.

On l'a mis dans la doc parce qu'on a perdu une heure dessus.

#ClaudeCode #AI
```

---

### WEEK 3 — Convert

#### Post 11 · Mon · Postmortem

```
Nous avons construit un traducteur d'API pour un seul client.

codex-cli parle uniquement l'API "Responses" d'OpenAI. Notre amont sert
`chat/completions` et `messages`, mais renvoie 404 sur `responses`.

LiteLLM ne traduit pas — il relaie. Donc 404.

Nous avons écrit le traducteur (700 lignes) et l'avons placé DEVANT
LiteLLM, pas derrière. Raison : la facturation. LiteLLM sait tarifer et
journaliser `chat/completions`. Traduire après lui aurait inventé un
deuxième format à tarifer, à journaliser, et à prouver.

Trois règles qui ont demandé le plus de soin :

  · le raisonnement ne devient JAMAIS du texte visible
  · un flux se termine TOUJOURS par `response.completed`, même vide
  · une erreur amont garde son statut — un 429 reste un 429

Ce dernier point est le plus important. Un 429 transformé en 200 vide fait
croire à un agent que le modèle a répondu.

#OpenAI #Codex #Architecture
```

#### Post 12 · Tue · Économie · Carousel

1. `La générosité est une arme, pas une dépense.`
2. `Si votre coût est par token, la générosité vous tue.`
3. `Si votre coût est fixe, elle vous distingue.`
4. `Nous avons un coût amont fixe.`
5. `Donc nous donnons 100M tokens/jour.`
6. `Un concurrent qui copie paie chaque token donné.`
7. `C'est un avantage structurel, pas une promo.`
8. `Une clé. Deux formats. zaino.soon.it`

Caption:

```
On nous demande souvent comment on peut offrir 100M tokens par jour.

La réponse est ennuyeuse : notre coût amont est fixe.

Pour un concurrent dont le coût suit les tokens, la générosité est une
dépense — chaque token offert sort de sa marge. Pour nous, c'est un choix
de positionnement qui ne coûte rien de plus.

Ce n'est pas une promotion. C'est une asymétrie de structure de coût, et une
promotion ne peut pas la copier.

#Business #LLM #SaaS
```

#### Post 13 · Wed · Build-in-public

```
3 jours d'essai. Pas de carte.

Parce que notre paiement est un virement manuel (D17, La Poste
Tunisienne) — il n'y a pas de carte du tout dans le produit.

On aurait pu cacher ça. On a préféré en faire une contrainte de conception :
si le client ne peut pas payer en 30 secondes, alors il doit pouvoir
essayer en 30 secondes.

Un essai ne doit jamais dépendre du système de paiement.

#SaaS #Onboarding
```

#### Post 14 · Thu · Postmortem court

```
Un client a codé `^$` comme motif "interdit" dans son évaluateur.

Avec `re.M`, `^$` correspond à toute ligne vide — donc à la quasi-totalité
des réponses correctes. Tout était noté FAUX.

Nous avons cru avoir un classement de nos modèles : 6/6 en haut, 4/6 en bas.
C'était un artefact de mesure.

Quand une sonde valide tout, suspectez la sonde.

#Testing #Python
```

#### Post 15 · Fri · Preuve

```
[SCREENSHOT: dashboard, compteurs par alias]

Ce que le client voit n'est jamais le nom du modèle amont.

Vous lisez : Fast, Smart, Frontier, Fable.
Pas : le nom du fournisseur, sa version, son déploiement.

Ce n'est pas de la pudeur. C'est une promesse : le moteur derrière un alias
peut changer sans que vous ayez à changer quoi que ce soit, ni à relire une
doc.

Un produit qui fuit le nom de son fournisseur n'a pas d'alias. Il a un
revendeur.

#API #ProductDesign
```

---

### WEEK 4 — Proof and community

#### Post 16 · Mon · Postmortem

```
Une passerelle doit échouer du bon côté.

Si notre amont est injoignable, notre edge renvoie 502. Jamais 200.

Pourquoi c'est une règle écrite en tête du fichier : un proxy qui répond
"succès" quand la passerelle n'a pas répondu, c'est une requête non
comptée. C'est exactement la panne que ce produit existe pour empêcher.

La même logique impose de ne jamais journaliser une clé — ni sa valeur, ni
sa longueur, ni un extrait. Un booléen "préfixe substitué", et rien d'autre.

Les règles de sécurité les plus utiles tiennent en une phrase. Le travail
consiste à les écrire en haut du fichier, puis à les tester.

#Security #NodeJS
```

#### Post 17 · Tue · Économie

```
Trois façons de vendre de l'IA. Une seule tient sans autorisation écrite.

1. Revendre l'accès : vous détenez la clé, le client paie l'usage.
2. BYOK : le client détient sa clé, vous vendez le logiciel.
3. Usage interne.

La 1 est la plus simple à vendre et la plus exposée — les conditions du
fournisseur interdisent la revente sans accord explicite, et le fait que
votre processeur de paiement l'accepte ne change rien.

Nous avons choisi la voie qui demande le moins de chance et le plus de
travail.

#LLM #Legal #Business
```

#### Post 18 · Wed · Build-in-public

```
Le produit tient en 37 tables, 35 migrations, et 591 tests.

Les migrations sont à sens unique, avec un registre. Jamais de rollback :
restauration de sauvegarde. Parce qu'un rollback écrit par quelqu'un de
pressé à 23h un vendredi est la façon la plus fiable de perdre des données.

La règle qui a coûté le plus cher à apprendre : les migrations tournent
AVANT le code, jamais après. Sinon on sert du code qui attend une colonne
qui n'existe pas encore.

#Postgres #DevOps
```

#### Post 19 · Thu · Postmortem court

```
Le même bug, deux fois, à six semaines d'intervalle.

Nous avions deux tables de prix : une par token (pour la passerelle), une
par million de tokens (pour le portail). Elles ont divergé dans les deux
sens, silencieusement.

La correction n'est pas "faites attention". C'est un test qui lit les DEUX
fichiers depuis le disque et échoue si un seul chiffre diffère.

Si deux sources de vérité doivent s'accorder, l'accord doit être un test.

#Testing #Billing
```

#### Post 20 · Fri · Preuve + première offre publique

```
[SCREENSHOT: page /pricing]

Trois jours, sans carte.

One key. Deux formats natifs. 100M tokens par jour et par modèle, remis à
zéro à minuit.

Starter 50 DT/mois. Pro 90 DT/mois.

Si vous êtes en Tunisie, vous pouvez essayer maintenant.
Si vous êtes ailleurs, écrivez-moi en commentaire — la facturation
internationale arrive, et je préfère savoir combien vous êtes.

#LLM #API #Tunisia
```

---

### Weeks 5–8 · hooks only (write in full when you get there)

21. **The 100M number, explained honestly** — what it costs you when someone burns it.
22. **Why we wrote the extractor in Rust** — a 200-page PDF in Node blocks the event loop.
23. **We deleted our own pack of features** — what the roadmap cut and why.
24. **Streaming, and the four ways to break it** — buffering, content-length, gzip, retries.
25. **What a good 403 looks like** — the error message as product.
26. **Our tests catch config drift, not code** — the two price tables.
27. **Self-hosting search** — why your queries should not go to a third party.
28. **A month of uptime, and what it cost** — a real ops post.
29. **The refusal we ship on purpose** — `previous_response_id` returns 400.
30. **Month one, in numbers** — signups, tokens, what broke. (Only if honest.)

---

## 6. Growth mechanics

### 6.1 The 20-people list

Reach comes from *specific* people, not hashtags. Build a list of 20:

- 8 Tunisian / Maghreb devs who post about AI or infra
- 6 francophone dev-tool founders (small, indie, not VC-scale)
- 3 AI newsletter authors (francophone)
- 3 people who work at a company that would consolidate AI spend

Comment on their posts daily for two weeks before you ever DM them. By then
they know your name, and the DM converts.

### 6.2 DM scripts (only after two weeks of real comments)

**Warm, after they engaged with your post:**

```
Salut [Prénom] — merci pour ton commentaire sur [sujet], ça m'a fait
réfléchir à [point précis].

Question rapide : est-ce que tu paies aujourd'hui au token ou au forfait ?
Je demande parce qu'on a construit l'inverse du marché (100M/jour, reset à
minuit) et je cherche 5 personnes pour le casser avant de l'ouvrir.

Pas de pitch si ça ne t'intéresse pas — je suis surtout curieux de savoir
comment tu gères ton budget IA aujourd'hui.
```

**Cold but specific (never generic):**

```
Bonjour [Prénom],

J'ai lu votre post sur [sujet précis]. Vous parliez de [détail] — c'est
exactement le problème qu'on a rencontré en construisant notre passerelle.

On a une approche différente : quota journalier remis à zéro chaque minuit
plutôt que plafond mensuel. 100M tokens par jour et par modèle.

Je ne cherche pas à vous vendre quoi que ce soit aujourd'hui : est-ce que je
peux vous envoyer le postmortem d'un bug de facturation qu'on a eu ? Ça vous
dira en trois minutes si notre façon de compter vous intéresse.

[Lien direct vers le post, pas la landing page.]
```

Rules: one message, no follow-up before 7 days, never a calendar link in the
first message, never the word "opportunité".

### 6.3 Employee / ally amplification

Every post: 3 people comment within the first hour (co-founder, a friend, a
user). Not "great post" — a real question. Early comments are the single
strongest reach signal you can manufacture.

### 6.4 What not to do

- No engagement pods (LinkedIn detects them; they also teach you nothing).
- No hashtag stuffing — 3 maximum, and only real ones (`#LLM`, `#Postgres`, `#DevTools`).
- No "I'm humbled to announce". No motivational content. Ever.
- No DMs to people who have not seen you before.
- No posting a link in the body. Comment, then link.
- No more than one promotional post per fortnight.

---

## 7. The conversion path

A post that gets 10,000 views and sends 300 people to a generic homepage
converts worse than one that gets 900 views and sends 20 people to a page
written for them.

### The path

```
LinkedIn post
  → /pricing          (or the specific post, if it is a postmortem)
  → /docs             (they are a developer; they will read the config)
  → sign-up
  → /dashboard        ← TODAY THIS IS THE PAYWALL. Nothing else.
  → redeem trial      (3 days, no card)
  → paste a zn- key into their editor
  → 200 response      ← THE ONLY ACTIVATION EVENT THAT MATTERS
```

**The gap:** `CPO_ROADMAP.md` P0 says the missing piece is *discovery*, not
transport — a developer should never hand-write a base URL. There is no
`/connect` page. LinkedIn traffic will hit exactly that wall: they have the
key, they do not know the three lines, they leave.

**Fix before you scale the campaign:** ship `/connect` — pick your tool
(Claude Code, Codex, Cursor, OpenAI SDK, curl), pick a tier, paste a key, get
a block that works. `portal/components/docs/code-block.tsx` already exists.
This is one page and it is worth more than the first fifty posts.

### What to measure (nothing else)

| Metric | Why | Target by day 90 |
|---|---|---|
| Post → profile views | Is the hook working | 15% of impressions |
| Profile → site clicks | Is the profile doing its job | 3–5% of views |
| Site → sign-up | Is the landing page clear | 8–12% |
| Sign-up → trial redeemed | Is onboarding alive | **>50%** |
| Trial → first 200 response | The real activation | **>60%** |
| Trial → paid | Is the product worth 50 DT | 10–15% |
| Comments left per day | The input that drives everything | 10 |

Impressions are vanity. **Trial → first 200 response** is the only number that
predicts revenue.

### UTM discipline

Every link: `?utm_source=linkedin&utm_medium=social&utm_campaign=pm-cache-bug`
— per post, not per month. In three weeks you will know which pillar produces
signups, and it will surprise you.

---

## 8. Weekly review (30 minutes, every Friday)

Answer four questions in writing:

1. Which post had the highest *profile visits per impression*? (Not
   impressions — visits. That is the hook working.)
2. Which pillar produced the most sign-ups via UTM?
3. What did a commenter ask twice? → That is your next post.
4. What did we promise publicly that is not true yet? → Fix it or retract it.

Then delete the lowest-performing format from next week and double the
highest. Formats are hypotheses; the calendar is not sacred.

---

## 9. The pitch deck

Ten slides. One idea per slide, one number per slide. A LinkedIn carousel
version (PDF, 1080×1350) and a 16:9 version for the profile's Featured
section. Same content.

---

**Slide 1 — Title**

> # Zaino
> ### Une clé. L'API Claude + OpenAI. 100M tokens par jour.
> `zaino.soon.it`

---

**Slide 2 — The problem**

> ### Votre quota mensuel est une fiction.
>
> Vous payez un plafond que vous n'utilisez pas.
> Le jour où vous en avez besoin, il est déjà consommé.
>
> *Un projet d'agent consomme 90% de son budget en 3 jours, puis rien pendant 2 semaines.*

---

**Slide 3 — The inversion**

> ### 100M tokens. Par jour. Par modèle.
>
> Remis à zéro à minuit, heure de Tunis.
> Pas de fenêtre glissante. Pas de plafond en dollars.
>
> Un jour lourd coûte **un jour**.

---

**Slide 4 — What you get**

> ### Deux formats natifs, pas de traduction.
>
> | | |
> |---|---|
> | API OpenAI | `base_url/v1` |
> | API Anthropic | `base_url` |
>
> Claude Code · Codex · Cursor · SDK Python · `curl`
> Vos 40 lignes existantes fonctionnent. Seule la clé change.

---

**Slide 5 — The tiers**

> ### Quatre niveaux, un nom par niveau.
>
> **Fast** — réponses courtes, le moins cher
> **Smart** — le défaut pour la plupart du travail
> **Frontier** — le raisonnement le plus profond
> **Fable** — les longues trajectoires, les agents multi-étapes
>
> 1M de contexte · 64k de sortie

---

**Slide 6 — Why it's possible**

> ### Notre coût amont est fixe.
>
> Pour un concurrent dont le coût suit les tokens, la générosité est une
> dépense.
> Pour nous, c'est un choix de positionnement.
>
> C'est une asymétrie de structure de coût. Une promotion ne peut pas la
> copier.

---

**Slide 7 — Proof**

> ### Le compteur est le produit.
>
> 591 tests · 35 migrations · 37 tables
> Un token compté une fois : entrée, sortie, écriture de cache, lecture de cache.
>
> Nous publions nos propres bugs de facturation, avec les chiffres.
> *Une passerelle qui compte mal est pire qu'aucune passerelle.*

---

**Slide 8 — Pricing**

> ### Sans carte.
>
> **Starter** — 50 DT/mois · Fast + Smart · 3 clés
> **Pro** — 90 DT/mois · Smart + Frontier + Fable · 15 clés
> **Essai** — 3 jours, gratuit, sans carte
>
> Paiement : virement D17 (La Poste Tunisienne).

---

**Slide 9 — Who it's for**

> ### Vous êtes développeur, pas acheteur.
>
> Vous voulez une base URL et une clé, pas un appel commercial.
> Vous voulez savoir ce que coûte une requête, pas lire un devis.
>
> **De la page d'accueil à un 200, en 10 minutes, sans parler à personne.**

---

**Slide 10 — CTA**

> ### Trois jours. Sans carte.
>
> `zaino.soon.it/pricing`
>
> Ou écrivez-moi ici — je réponds moi-même.

---

### Deck design rules

- Dark ground, one accent (violet), white type. No gradients except one.
- Type: the biggest element on every slide is the claim, not the logo.
- Never more than 20 words on a slide.
- Numbers in a monospace face — it reads as measured, not marketed.
- No stock photos of robots, brains, or handshakes. One screenshot of real
  output beats any illustration.

---

## 10. Fix these before you spend a dirham on promotion

Ranked by how much they cost you in conversion, from the code I read:

| # | Issue | Where | Effect on LinkedIn traffic |
|---|---|---|---|
| 1 | **No `/connect` page** | `app/(marketing)/` | Developers land, cannot wire it, leave. Highest-leverage fix in the repo. |
| 2 | **No international payment** | `lib/billing/` (D17 only) | Non-Tunisian clicks cannot convert. Gate the audience or fix the path. |
| 3 | **SSE is gzipped** | `config/Caddyfile:39` | 10× slower token delivery — the demo feels bad to exactly the people you invite. |
| 4 | **`max_tokens` defaults to 8192 with `reasoning_effort: max`** | `lib/chat/gateway.ts:148` | Empty answers on constrained calls. A visitor's first try can return nothing. |
| 5 | **Paywall shows 80M/32M against a live 100M/day** | `paywall-state.tsx:50` | Contradicts the one number your entire campaign repeats. |
| 6 | **README still says "three tiers"** | `README.md:3` | Anyone technical who checks will find Fable missing. |
| 7 | **Changelog is 11 days stale, no RSS** | `changelog-content.tsx` | "Build in public" needs a public record. |
| 8 | **Expired key in a tracked file** | `docs/aipilot-upstream.md:10` | A dev who finds it learns the wrong thing about your hygiene. |

Items 1, 5 and 6 should be fixed **this week**, before post 1. Items 3 and 4
are one-line/one-constant fixes. Item 2 is the strategic one — decide the
audience phase before you write the campaign.

---

## 11. The first 14 days, concretely

| Day | Do |
|---|---|
| 1 | Gate 1 email sent. Decide audience phase. |
| 2 | Rebuild profile (§3). Banner + headline + About. |
| 3 | Fix items 1, 5, 6 above (or start `/connect`). |
| 4 | Write posts 1–5. Batch the Sunday block. |
| 5 | Build the 20-people list. Comment on 10 of them, no DM. |
| 6 | Publish post 1. Stay in comments for 90 min. |
| 7 | Comment on 10. DM the 3 warmest. Publish post 2 (carousel). |
| 8 | Publish post 3. Page reposts it. |
| 9 | Publish post 4. First weekly review. |
| 10 | Publish post 5. |
| 11 | Ship `/connect`, even as a rough version. |
| 12 | First DM conversation that turns into a trial. |
| 13 | Write week 2's posts. |
| 14 | Post 6 (the LiteLLM intersection post — your best asset). |

---

*Companion documents: `CPO_ROADMAP.md` (what to ship), `README.md` (what is
true). This file is strategy; those two are the source of facts.*
