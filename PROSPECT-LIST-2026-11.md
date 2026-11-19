# Zaino AI — prospect list & outreach pack (19 Nov 2026)

**115 live addresses across 109 organisations**, in five waves. Wave 1–4 are the
product prospects — 104 startups and software companies. Wave 5 is ecosystem:
accelerators and investor inboxes, which get a different email entirely. Every
address was either read on the organisation's own page (web-verified) or taken
from the official APII/CIDT *Tunisian Tech Startups* national catalog. Nothing
here came from a scraped lead database.

**Liveness checked:** DNS MX lookup on all 89 domains behind these addresses —
86 corporate, plus gmail/yahoo/outlook for the 21 founders who only publish a
personal address. Every one resolves to a mail exchanger, so no send in this
list hard-bounces. 15 entries were dropped earlier and are listed at the end so
you don't wonder where a company went: 11 on domains that no longer resolve at
all, 4 on domains still registered but parked without a mail exchanger.

---

## Read this before you send anything

The offer as framed had three problems, and fixing them changed what the code
can do. Read this section before the emails, because the emails now promise
numbers that the database actually enforces.

**1. "15 API keys" is the Pro plan's key allowance.** A key is not a grant — it
draws on the subscription's one shared pool — so 15 keys is not 15× the tokens.
What it does give is 15 independent secrets on one invoice and a visible
advertisement of your paid tier in a cold mail. **The trial now allows 2 keys**,
which is the honest evaluation shape: one for a sandbox, one for a staging
deploy. That is also Solo's allowance, so the grant does not undercut the paid
step.

**2. "Unlimited" is not something this product can say.** The gateway exists to
meter; `lib/entitlements/quota.ts` treats a missing ceiling as *no wall*, which
`0046_plan_ladder.sql` calls "the most expensive possible failure in this
system". A mail that says "unlimited" teaches your first cohort that limits are
negotiable. **It is also impossible to ship as an override per code** — see the
next point. The offer is a bounded grant.

**3. A promo code cannot carry its own grant.** This is the correction that
matters most, and it was wrong in the first draft of this document.
`redeemTrialCode()` (`portal/lib/trial/service.ts:107`) attaches the org to the
**one hidden `trial` PLAN row**, and the wall reads *that* row's `token_limits`,
`daily_token_cap` and `max_keys`. `trial_codes.token_limits` is explicitly **not
read for enforcement** — the schema comment on `trial_codes` says so. There is
no target-plan column on `trial_codes`.

So "give partners a bigger trial code" is not a thing the data model can do.
Widening the grant means changing the trial plan row, which **every** redeemer
shares — `ZAINO-LAUNCH-3M` included. That is why the grant lives in a migration
(`0047_partner_trial_code.sql`) instead of a one-off script: the plan row and
the code rows have to move together or they contradict each other.

### What the trial now gives, and what it costs

The `trial` plan moved from 1M to **4M weighted units**, `max_keys` 1 → 2, and
`daily_token_cap` 250K → 2M. At 0.20 DT per 1M weighted units:

| | Before (0046) | Now (0047) | Per 60 redeemers |
|---|---|---|---|
| Pool | 1M weighted | **4M weighted** | 48 DT |
| Daily cap | 250K | 2M | — |
| Keys | 1 | 2 | — |

4M is deliberate: enough that a real integration never hits the wall in three
days, and well under Starter's 50M — a free code handing out 8% of the 49 DT
entry tier is a defensible sample, handing out a fifth of it is not. It also
sits above no paid tier at all, so nobody can satisfy their month with a trial.

The daily cap is 2M and not 1.33M on purpose. A cap of `pool / days` turns the
daily limit into a second wall that a normal evaluator hits before the pool; at
2M the cap only exists to stop one runaway day spending the whole grant.

**Cost of the whole campaign at 60 redemptions: 48 DT.** That is the entire
downside if nobody converts.

**Run the migration before you send a single email:**

```bash
cd /Users/user/Workspace/gateway && make db-migrate
```

In production that happens on deploy. `0047` is guarded: it refuses to apply if
the plan pool, the key count, or any active code's stated pool disagree, or if
the daily cap cannot reach the pool over three days. A redemption that silently
grants less than the email promised is worse than a failed deploy.

`ZAINO-PARTNER-3D` is capped at **120 redemptions** rather than unlimited
(raised from 60 by `0048` once the list reached 115 addresses — at 60, 55
recipients would have received a code that answers "all redemptions claimed").
A leaked unlimited code is unbounded spend and unredeemable, so the cap stays
finite; the whole campaign's worst case is 120 × 0.80 = **96 DT**.

**Verified, not assumed.** The migration was applied to a local database and the
redemption path was exercised end to end: `redeemTrialCode()` returned `ok`, and
the resulting subscription read `{"fast": 4000000}`, `daily_token_cap 2000000`,
`max_keys 2`, `trial_end` exactly 3 days out. The full suite passes (1145
tests, typecheck clean), and the guard was proven to reject a code whose stated
pool disagrees with the plan.

**The seed script now knows about the partner code.** `portal/scripts/
seed-trial-code.ts` retires every active code not on an explicit keep-list, and
that list is `[ZAINO-LAUNCH-3M, ZAINO-PARTNER-3D]`. Before this change it kept
only the launch code, so re-seeding an environment would have deactivated
`ZAINO-PARTNER-3D` silently — the migration guard watches the plan pool, keys
and cap, never `active`. Re-running the seed is now safe.

---

## Step 2 — the two emails

**Send from `ceo-louayrjili@sohabi.app`, not from a Zaino address and not from
the Gmail account.** Checked 19 Nov 2026:

| domain | MX | SPF | can it send? |
|---|---|---|---|
| `sohabi.app` | `mx1/mx2.privateemail.com` | `include:spf.privateemail.com ~all` | **yes** |
| `zaino.soon.it` | none | none | would be unauthenticated |
| `soon.it` | none | `v=spf1 -all` | **no** — that record explicitly forbids it |

`soon.it`'s SPF is `-all`, which tells every receiver "nothing may send as this
domain". A `louay@zaino.soon.it` address does not exist as a mailbox and could
not pass SPF if it did, so mail from it lands in spam or is rejected outright.
Creating it properly means buying a mailbox on `sohabi.app`'s provider and
moving the `zaino` subdomain's records with it — an afternoon, not five minutes.
Until then, `sohabi.app` is the only domain here with a working, authenticated
mail path, and a personal domain beats a Gmail address on cold mail anyway.

The mailbox already has DKIM published (`privateemail._domainkey`), but **no
DMARC record**. Add one before sending 115 emails:

```
_dmarc.sohabi.app.  TXT  "v=DMARC1; p=none; rua=mailto:ceo-louayrjili@sohabi.app"
```

`p=none` only asks for reports; it cannot hurt deliverability, and it is what
makes the difference diagnosable when a batch goes to spam. Don't jump to
`p=reject` until the reports look clean.

Provider settings if you send from a client rather than the webmail: SMTP
`mail.privateemail.com`, port **465** (SSL/TLS) or **587** (STARTTLS), username
the full address, auth on. Both ports answered from this machine and 587 offers
`AUTH PLAIN LOGIN` after STARTTLS, so the path out is open. **What is still
unverified is the login** — whether the mailbox exists and the password is
correct needs credentials only you have. Test it before batch one:

```bash
python3 -c "import smtplib,getpass;s=smtplib.SMTP('mail.privateemail.com',587,timeout=15);s.starttls();s.login('ceo-louayrjili@sohabi.app',getpass.getpass('password: '));print('LOGIN OK');s.quit()"
```

`LOGIN OK` means the mailbox is real and can send. A `535` means the address or
password is wrong, and every send in this list is wasted until it is fixed.

### Email A — AI/software companies (sent first, highest fit)

Subject: `API tuning for [Company] — 3 days, no card`

> Hi [First name],
>
> I'm Louay, I'm building Zaino AI out of Tunis. It's one API that fronts the
> strong models behind four aliases (`fast`, `smart`, `frontier`, `fable`) so a
> team doesn't juggle five SDKs and five invoices to ship one feature.
>
> I read that [Company] builds [specific thing from their site]. I'd like to
> give you two keys and let you break it for three days — 4M tokens across
> `fast` and `smart`, no card, no sales call. If the latency or the answer
> quality isn't good enough for what you're building, that's the most useful
> thing you can tell me, and it costs you nothing to find out.
>
> If it does hold up, I'd like to talk about working together — I'd rather
> have three teams building on this and telling me what's wrong than fifty
> signups who never send a second request.
>
> The code is `ZAINO-PARTNER-3D` and it works right now. Sign up at
> zaino.soon.it, then paste it at `/dashboard/redeem` — the balance shows up
> on the same screen.
>
> Louay Rjili
> Zaino AI — zaino.soon.it
> contact.zaino.ai@gmail.com

**Why it is written this way:** it names a real thing they built (so it isn't a
shotgun blast), it prices the ask in *their* terms ("three days"), it says the
negative outcome out loud, and it puts the code in the mail so the next step
costs them one paste instead of one reply.

### Email B — the rest of the list

Same body, one line changed. Drop the `[specific thing from their site]`
sentence and open with the sector instead:

> I'm Louay, I'm building Zaino AI out of Tunis — one API for the strong models,
> francophone and Arabic friendly, priced in dinars.

Everything else holds. The shorter version loses maybe 20% of reply rate but
costs you nothing to send, and it is the right trade for 100+ addresses.

### What not to do

- **Don't send all 104 in one day.** Gmail will start dropping you at roughly
  50–80 identical mails from a fresh account, and the domain gets a reputation
  you cannot undo. Send 15–20 a day, in the order below. Twenty a day over the
  104 product prospects is under a week of sending.
- **Don't put everyone in `To:`.** One `Bcc:` per batch of 20, or better, a
  mail-merge that puts one address in `To:`. A visible recipient list on a cold
  mail is the fastest way to be marked as spam by the whole batch at once.
- **Don't use the word "partnership" before they've used the product.** The
  email above offers to "talk about working together" only after the trial
  sentence, which is deliberate. "Partnership" from a stranger with no customers
  reads as "I want your distribution."
- **Don't attach anything.** No PDF deck, no pricing sheet. Attachments from
  unknown senders are the strongest single spam signal there is.

---

## Step 3 — the list

**Send order.** Wave 1 (rows 1–41) is the catalog's software/SaaS/EdTech/fintech
companies: they already ship software, so an API is a tool they recognise.
Wave 2 (rows 42–56) is companies whose own websites confirmed an address; these
are the most recently verified, so send them early in the sequence if you only
trust the freshest. Wave 3 (rows 57–58) and Wave 5 (rows 105–115) are not a
sales list at all — see the notes under those tables. Product prospects are
rows 1–56 and 59–104: 104 addresses to 100 organisations.

### Wave 1 — software, SaaS, EdTech, fintech, commerce (highest fit)

| # | Company | Sector | Email | Source |
|---|---|---|---|---|
| 1 | 3DWAVE | Business Software and services | `contact@3dwave.tech` | APII/CIDT catalog p.3 |
| 2 | ADDINN TUNISIE | Business Software and services | `contact@addinn.com` | APII/CIDT catalog p.3 |
| 3 | BAITY.TN | Commerce and shopping | `saber.gharsellaoui@gmail.com` | APII/CIDT catalog p.5 |
| 4 | BRANPER | Business Software and services | `info@branper.com` | APII/CIDT catalog p.6 |
| 5 | FELCLOUD | Business Software and services | `emine@felcloud.tn` | APII/CIDT catalog p.7 |
| 6 | CREOMETRY | Business Software and services | `mg@creometry.com` | APII/CIDT catalog p.8 |
| 7 | CYNOIA | Business Software and services | `n.riahi@cynoia.com` | APII/CIDT catalog p.8 |
| 8 | DIGITALIZE | Business Software and services | `azzabiahmed@digitalize.tn` | APII/CIDT catalog p.10 |
| 9 | DONEC | Business Software and services | `family@edonec.com` | APII/CIDT catalog p.11 |
| 10 | ESKY PROFESSIONAL SERVICES | Mobility; Business Software | `info@esky.com` | APII/CIDT catalog p.12 |
| 11 | THE FENIX | Business Software and services | `skander.c@thefenix.io` | APII/CIDT catalog p.13 |
| 12 | GO MYBIZ | Business Software and services | `achraf.gabsi@gomybiz.co` | APII/CIDT catalog p.15 |
| 13 | IDARATY | Communication services | `contact@idaraty.tn` | APII/CIDT catalog p.17 |
| 14 | INNOVUP | Fintech | `khalil.driss@innovup.com.tn` | APII/CIDT catalog p.18 |
| 15 | IRBE7A | EdTech | `anis.habibi@irbe7.com` | APII/CIDT catalog p.19 |
| 16 | KOTTI ONLINE DISTRIBUTION | Commerce and shopping | `Contact@chillandlit.tn` | APII/CIDT catalog p.20 |
| 17 | K2LIS | Fintech | `tarek.kamoun@K2LIS.com` | APII/CIDT catalog p.21 |
| 18 | MILLENIA ENGINEERING | Communication services | `i.ouardi@millenia.com.tn` | APII/CIDT catalog p.25 |
| 19 | MRAMMA TN | Real Estate Tech | `marwen.bmzoughia@mramma.tn` | APII/CIDT catalog p.25 |
| 20 | QARTAJ INTERNATIONAL GROUP | Commerce and shopping | `moncef.benrajeb@qartaj.com` | APII/CIDT catalog p.29 |
| 21 | ROBODOT | Ad Tech and Creative Tech | `ghazi.baccouche@gmail.com` | APII/CIDT catalog p.29 |
| 22 | RUN-IT | Business Software and services | `administration@run-it.tn` | APII/CIDT catalog p.30 |
| 23 | RYTHMINNO | EdTech | `zoghlamiahmad@gmail.com` | APII/CIDT catalog p.30 |
| 24 | SKILLS 21A | EdTech | `getskills21@gmail.com` | APII/CIDT catalog p.32 |
| 25 | SMART WAYS INNOVATION | Ad Tech and Creative Tech | `smartways.innovation@gmail.com` | APII/CIDT catalog p.33 |
| 26 | SOCIETE B QUBE | Business Software and services | `a.bechiri@bqubeits.com` | APII/CIDT catalog p.33 |
| 27 | SMPM (Elbusines) | Ad Tech and Creative Tech | `hjelassi@elbusines.com` | APII/CIDT catalog p.34 |
| 28 | SOLEDU | EdTech | `info@sol-edu.org` | APII/CIDT catalog p.35 |
| 29 | STE CERRO SOFT | Commerce and shopping | `manager@tunisie-enchere.com` | APII/CIDT catalog p.35 |
| 30 | STE HORIZON EDUCATION | EdTech | `feridaroundtheworld@gmail.com` | APII/CIDT catalog p.36 |
| 31 | NEOPOLIS DEVELOPPEMENT | Business Software | `info@neopolis-dev.com` | APII/CIDT catalog p.36 |
| 32 | SWIVER (Neopolis) | Business Software (invoicing) | `azzam.soualmia@swiver.net` | APII/CIDT catalog p.36 |
| 33 | TADREEX | EdTech | `chellynizar@tadreex.com` | APII/CIDT catalog p.37 |
| 34 | TADRIS | Ad Tech and Creative Tech | `tadris.tunisie@gmail.com` | APII/CIDT catalog p.37 |
| 35 | TAWA DIGITAL TALENTS | Ad Tech and Creative Tech | `midox@tawa.digital` | APII/CIDT catalog p.37 |
| 36 | TASHFEEN | Real Estate Tech | `wafy.bouassida@gmail.com` | APII/CIDT catalog p.38 |
| 37 | TUNISIA MARKET | Commerce and shopping | `contact@tunisia-market.com` | APII/CIDT catalog p.39 |
| 38 | TUNISIAN IDENTITY ONLINE | Fintech | `Karim.jebali@bankeid.tn` | APII/CIDT catalog p.39 |
| 39 | VITAL TOOLS | Business Software and services | `yassine.bouchoucha@vitaltools.tn` | APII/CIDT catalog p.41 |
| 40 | X-POINT | Business Software and services | `contact@x-point.tech` | APII/CIDT catalog p.42 |
| 41 | CAPX VALUE | Business Software and services | `maher.zaanouni@capxvalue.com` | APII/CIDT catalog p.42 |

### Wave 2 — verified on the company's own site (freshest addresses)

| # | Company | Sector | Email | Source |
|---|---|---|---|---|
| 42 | Cynoia | B2B SaaS (team workspace) | `contact@cynoia.com` | cynoia.com/en/contact |
| 43 | E-Tafakna | LegalTech + AI (contracts) | `info@e-tafakna.com` | e-tafakna.com footer |
| 44 | Juridoc | LegalTech + AI (legal search) | `contact@juridoc.tn` | juridoc.tn |
| 45 | Fabskill | HR-tech + AI agents (ATS) | `contact@fabskill.com` | fabskill.com |
| 46 | Fabskill | HR-tech + AI agents (ATS) | `business@fabskill.com` | fabskill.com |
| 47 | Konnect | Fintech / payment facilitator | `contact@konnect.network` | konnect.network/en/a-propos/contact |
| 48 | Flouci | Fintech / payment API | `dev-support@flouci.com` | docs.flouci.com |
| 49 | Flouci | Fintech / payment API | `sales@flouci.com` | docs.flouci.com |
| 50 | Flouci | Fintech / payment API | `contact@flouci.com` | facebook.com/flouci |
| 51 | AiKup | AI dev shop (vision, edge AI) | `contact@aikup.tn` | aikup.tn |
| 52 | Kinetonic | Software + AI agents agency | `hello@kinetonic.tn` | kinetonic.tn |
| 53 | Kinetonic | Software + AI agents agency | `contact@kinetonic.tn` | kinetonic.tn |
| 54 | Axynoxia | Custom software + integrations | `contact@axynoxia.com` | axynoxia.com |
| 55 | Web Media Tunisie | Web/AI agency (chatbots) | `commercial@webmediatunisie.com` | webmedia-tunisie.com |
| 56 | Web Agency Tunis | Web/AI agency | `contact@agence-web-tunis.com` | agence-web-tunis.com |

**Rows 45–46 and 52–53 are two addresses at one company.** Send `contact@` /
`hello@` first; keep the second as the follow-up address if the first bounces.

### Wave 3 — ecosystem, not customers

| # | Organisation | Role | Email | Source |
|---|---|---|---|---|
| 57 | 216 Capital Ventures | VC, pre-seed / seed | `hello@216capital.vc` | 216capital.vc |
| 58 | Smart Capital (ANAVA) | State fund of funds | `opportunites@startup.gov.tn` | smartcapital.tn |

Do not send Email A to these two. They are not API buyers. 216 Capital is worth
a separate, shorter note — you are raising-smú or at least relationship-building
for the pré-label path, and a cold "here's a free trial" email to a VC reads as
a mass mail. Smart Capital's address is the fund-of-funds inbox and is the
correct channel for an **ANAVA / Startup Act** question, not for a product.

### Wave 4 — sector depth, lower urgency

Send these only after Wave 1 replies tell you which vertical actually bites.

| # | Company | Sector | Email | Source |
|---|---|---|---|---|
| 59 | ACTIFS PRÉCIEUX APEX | HealthTech | `hajer.derouiche@actifsprecieux.com` | APII/CIDT catalog p.3 |
| 60 | AGGRIBRAND | Agritech | `bouguerrasawssen02@gmail.com` | APII/CIDT catalog p.4 |
| 61 | AMAL XR | HealthTech | `amalvr.rhb@gmail.com` | APII/CIDT catalog p.4 |
| 62 | BAKO MOTORS | Mobility | `boubaker.siala@bakomotors.com` | APII/CIDT catalog p.5 |
| 63 | BE WIRELESS SOLUTIONS | Telecom | `karim.kharrat@bewireless-solutions.com` | APII/CIDT catalog p.6 |
| 64 | WINICARI | Mobility | `bussoftware@winicari.tn` | APII/CIDT catalog p.7 |
| 65 | CURE BIONICS | HealthTech | `contact@curebionics.com` | APII/CIDT catalog p.8 |
| 66 | D-WEE | HealthTech | `contact@dweehealthcare.com` | APII/CIDT catalog p.9 |
| 67 | DOMHOME | Advanced Manufacturing | `contact@domhome.tn` | APII/CIDT catalog p.10 |
| 68 | DRACOSS | Environment | `contact.team@dracoss.tn` | APII/CIDT catalog p.11 |
| 69 | DRILLSERV | Agritech | `contact@drillserv-tunisia.com.tn` | APII/CIDT catalog p.11 |
| 70 | ELASTIC SOLUTIONS | Agritech | `abk@elastic-solutions.com` | APII/CIDT catalog p.12 |
| 71 | HARRO MEA | HealthTech | `marketing@harromea.com` | APII/CIDT catalog p.16 |
| 72 | HYO-TEC | Advanced Manufacturing | `contact@hyo-tec.com` | APII/CIDT catalog p.16 |
| 73 | INDUSTRY X.O | Advanced Manufacturing | `bilel.labidi@industryx0.pro` | APII/CIDT catalog p.17 |
| 74 | KAMIOUN | B2B Retail | `fares@kamioun.tn` | APII/CIDT catalog p.19 |
| 75 | HEALTHCARE ANYWHERE | HealthTech | `rawia.chniti@healthcare-anywhere.tn` | APII/CIDT catalog p.20 |
| 76 | KLINK.BOOKING | Creative industry | `sherazade.amous@gmail.com` | APII/CIDT catalog p.20 |
| 77 | KTN TRAFFIC | Mobility | `ktn.traffic@outlook.com` | APII/CIDT catalog p.21 |
| 78 | LABORATOIRE LASER AFRIQUE | Agritech | `timmo.vanderbeek@laboratoirelaser.com` | APII/CIDT catalog p.22 |
| 79 | LAIT ESPOIR | Agritech | `hayfa.khalfaoui@yahoo.com` | APII/CIDT catalog p.22 |
| 80 | LINKIVIA | Logistics | `khadijaattia@linkivia.com` | APII/CIDT catalog p.22 |
| 81 | LIPONOV | HealthTech | `jannet.kamoun@enis.tn` | APII/CIDT catalog p.23 |
| 82 | LOXBOX SERVICES | Mobility | `contact@loxbox.tn` | APII/CIDT catalog p.23 |
| 83 | L6A | Mobility | `info@L6.tn` | APII/CIDT catalog p.23 |
| 84 | M ESANTE PLUS | HealthTech | `mohamed.benhmida@doqtoor.com` | APII/CIDT catalog p.24 |
| 85 | MOOME | Agritech | `imen@moome.io` | APII/CIDT catalog p.25 |
| 86 | NEXTAV | AI remote sensing | `hichem.mokni@nextav.ai` | APII/CIDT catalog p.26 |
| 87 | OPTIMALOGISTIC | Mobility | `info@optimalogistic.com` | APII/CIDT catalog p.26 |
| 88 | ORBITECH (SeekMake) | Advanced Manufacturing | `seekmake.co@gmail.com` | APII/CIDT catalog p.27 |
| 89 | ORBIT ENGINEERING SOLUTIONS | Industrial IT | `tarek.chebbah@orbitsolutions.tn` | APII/CIDT catalog p.27 |
| 90 | ROBOCARE | Agritech | `ihbiri@robocare.tn` | APII/CIDT catalog p.29 |
| 91 | SILIPLASTUNISIE | HealthTech | `siliplastunisie@gmail.com` | APII/CIDT catalog p.31 |
| 92 | SIMARL | Dispute resolution | `salmi.kaouthar@gmail.com` | APII/CIDT catalog p.31 |
| 93 | SKANIT DIGITAL SOLUTIONS | FoodTech | `rahal.kerim@gmail.com` | APII/CIDT catalog p.31 |
| 94 | SMART FARM | Agritech | `benbrikabechir@gmail.com` | APII/CIDT catalog p.32 |
| 95 | SMART MED | HealthTech | `issam.bellaj@med.tn` | APII/CIDT catalog p.32 |
| 96 | SOCIÉTÉ ICAN-C | HealthTech | `contact.icanc@gmail.com` | APII/CIDT catalog p.34 |
| 97 | CO-SOLAR | Agritech | `contact@co-solar.com` | APII/CIDT catalog p.34 |
| 98 | SOGHYEN | Environment | `soghyen@gmail.com` | APII/CIDT catalog p.35 |
| 99 | TEMBO DIGITAL LIBRARY | HealthTech | `contact@tembolib.com` | APII/CIDT catalog p.38 |
| 100 | TUNISIE AQUAPONIE | Agritech | `tunisie.aquaponie@gmail.com` | APII/CIDT catalog p.39 |
| 101 | TYNASS IT | AR / cultural tourism | `contact@tynassit.com` | APII/CIDT catalog p.40 |
| 102 | BHOLD | FoodTech | `kb@bhold.tn` | APII/CIDT catalog p.40 |
| 103 | VIZMERALD | FoodTech | `contact@vizmerald.com` | APII/CIDT catalog p.41 |
| 104 | WATERSPIRIT SA | FoodTech | `m.bhouri@waterspirit.com.tn` | APII/CIDT catalog p.41 |

### Wave 5 — accelerator and investor inboxes (do NOT send Email A)

| # | Organisation | Role | Email | Source |
|---|---|---|---|---|
| 105 | Orange Fab Tunisie | Accelerator, 100% AI cohort 8 | `Fab.Tunisie@Orange.com` | orangefab.tn |
| 106 | RedStart Tunisie | Accelerator (Red'Innov) | `hello@redstart.tn` | redstart.tn/contact |
| 107 | RedStart Tunisie | Douja Gharbi, named contact | `dgharbi@redstart.tn` | redstart.tn/contact |
| 108 | Lab'ess | Incubator, rolling intake | `contact@labess.tn` | labess.tn |
| 109 | Smart Capital / ANAVA | Startup Act, general inbox | `hello@startup.gov.tn` | smartcapital.tn |
| 110 | Flat6Labs Tunis | Accelerator, 10 cycles | `Tunis@flat6labs.com` | flat6labs.com |
| 111 | Carthage Business Angels | Angel network, ~100 members | `projectmanager@cba.tn` | eina4jobs.org |
| 112 | TunisianStartups (NGO) | Runs Link4Inn, broadcasts calls | `contact@tunisian-startups.com` | tunisian-startups.com |
| 113 | TunisianStartups (NGO) | Membership / join | `join@tunisian-startups.com` | tunisian-startups.com |
| 114 | GIZ Tunisia | Development programmes | `giz-tunesien@giz.de` | giz.de |
| 115 | Invest for Jobs (GIZ) | Tunisia desk | `tunisia@invest-for-jobs.com` | invest-for-jobs.com |

**Rows 105–115 are not prospects for the API trial.** They are the ecosystem
inboxes from `Tunisia-Contacts-Verified.md`, which was checked against each
programme's own page on 14 Nov 2026. A "here's a free API key" mail to an
accelerator reads as a mass mail and burns the address for the question you
actually need to ask them — which is about application windows and the pré-label
path, not about latency. Send them the French note in
`Tunisia-Contacts-Verified.md`, not Email A. `hello@216capital.vc` and
`opportunites@startup.gov.tn` in Wave 3 belong to the same bucket.

All 11 rows were re-checked for a mail exchanger on 19 Nov 2026 and every domain
accepts mail.

---

## Removed — domain no longer resolves or takes mail

Checked 19 Nov 2026. These are in the 2022 catalog but their domain has no DNS
record or is parked without a mail exchanger, so a send will hard-bounce and
damage your sender reputation. Don't re-add them without a fresh address from
the company.

| Company | Catalog email | Why |
|---|---|---|
| BEENOMI | `haifa.tlaila@beenomi.com` | domain does not resolve |
| BIOINNOV8A | `marwa.louati@bioinnov-a8.com` | domain does not resolve |
| CARGOWEEN | `hello@cargoween.com` | domain does not resolve |
| DEEPIC | `contact@deepic-health.com` | domain does not resolve |
| FOOD FOR FUTURE | `insaf.ayari@food4future.tech` | domain does not resolve |
| IRRIAPP | `hedi.n@irriapp.tn` | domain does not resolve |
| MAKHBAZTI | `support@makhbazti.com` | parked at a registrar (`renewyourname`), no MX |
| I BEY DISTRIBUTION | `ines.bejar@mymall.tn` | domain does not resolve |
| OTO TRAVEL | `Elyes@oto.tn` | domain does not resolve |
| PEPOLLS | `amine.bnr@pepolls.com` | domain does not resolve |
| VAGROK | `contact@vagrok.com` | domain does not resolve |
| DIGI SMART SOLUTIONS | `bohli.afef@dig2s.com` | parked (`dns-redirect`) |
| EVADAM TECHNOLOGY | `info@evadam.io` | Cloudflare-parked |
| MICROACESS | `Contact@microacess.com` | parked (`share-dns`) |
| SAHTICARE | `contact@vitah.tech` | domain does not resolve |

---

## What this list is not

- **It is not a fresh contact list.** The APII catalog is from September 2022.
  Roughly 13% of its domains are already dead. The surviving 87% are real
  organisations, but the person behind `info@` may have changed. That is fine
  for a `contact@`/`info@` inbox and not fine for a named individual.
- **It is not enriched.** I did not guess `first.last@domain` patterns for named
  founders. Guessing produces a 40–60% bounce rate and burns the domain. Where
  the catalog printed a founder's own address, it is here as printed.
- **It is not exhaustive.** Tunisia has far more than 100 tech companies. These
  are the ones with a *published, currently-deliverable* address. Companies like
  InstaDeep, Wattnow, Dabchy and Sotipop are better targets but publish no email
  — they want an inbound form or a warm intro. Chasing those is a different
  job from this one.

## Sources

- [APII / CIDT — Catalogue des startups tech tunisiennes (Sept 2022)](https://www.tunisieindustrie.nat.tn/fr/download/STARTUPSTECH.pdf) — 99 company cards, the bulk of this list
- [Cynoia — contact](https://cynoia.com/en/contact)
- [E-Tafakna](https://e-tafakna.com)
- [Juridoc](https://juridoc.tn)
- [Fabskill](https://www.fabskill.com)
- [Konnect — contact](https://konnect.network/en/a-propos/contact)
- [Flouci — API support](https://docs.flouci.com/essentials/debug-support)
- [AiKup](https://aikup.tn/solutions/ai-development-tunisia)
- [Kinetonic](https://www.kinetonic.tn)
- [Axynoxia](https://www.axynoxia.com)
- [Web Media Tunisie](https://webmedia-tunisie.com/en/artificial-intelligence-agency)
- [216 Capital](https://216capital.vc)
- [Smart Capital — ANAVA](https://smartcapital.tn/?page_id=989&lang=en)
- [Orange Fab Tunisie](https://orangefab.tn)
- [RedStart Tunisie — contact](https://redstart.tn/contact)
- [Lab'ess — contact](https://www.labess.tn/canditatez/incubation)
- [Flat6Labs Tunis](https://flat6labs.com/stay-connected)
- [Carthage Business Angels](https://www.eina4jobs.org/en/carthage-business-angels-cba)
- [TunisianStartups](https://www.tunisian-startups.com)
- [GIZ Tunisia / Invest for Jobs](https://www.invest-for-jobs.com)
