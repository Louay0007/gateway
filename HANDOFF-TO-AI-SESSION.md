# HANDOFF — Zaino AI funding & outreach work

**Written:** 14 November 2026, ~20:20 UTC
**For:** an incoming AI session continuing this work
**User:** Louay Rjili, founder of Zaino AI, Tunis, Tunisia

Read this whole file before acting. Several things in it were expensive to
establish, and two facts are traps that will waste the user's time if ignored.

---

## 1. Who you are working for

Louay Rjili. Founder of **Zaino AI**. Final-year IT student at ISSAT Mateur
(Carthage University). Previously co-founder and CTO of **Chabaqa.io**
(2024–2026), where he **secured the Tunisian Startup Act Label** — he has been
through that process once already. Founder/CEO of SOHABI (2025–2026). AI
developer at Neceditals.com. Deep IEEE Tunisia involvement.

**Contact:** ceo-louayrjili@sohabi.app · +216 24 267 363
An older CV lists louay.rjilii@gmail.com and +216 51 803 706 — these disagree.
The form submissions used the sohabi.app pair. Confirm which is current before
submitting anything new.

He moves fast, wants paste-ready output, works in French for Tunisian
organisations and English for international ones. He has twice uploaded the
wrong document, so **verify any uploaded file is his before building on it**.
A file named `Resume.pdf` in the uploads folder belongs to a different person
(Idris Saddi) — do not use it.

---

## 2. The business, in one paragraph

Zaino AI is a Tunisian SaaS reselling frontier AI models for dinars. Developers
pay via **D17** (La Poste Tunisienne wallet) because there is no usable
international card and no local invoicing. The product is genuinely built and in
production: multi-tenant API gateway, hard per-request quota enforcement, two
payment rails, trilingual dashboard (FR/AR/EN), desktop/mobile clients, 641
automated tests passing, 40 forward-only migrations.

**Pricing (authoritative, migration 0039):** Starter 50 DT / Pro 90 DT local;
$15 / $30 card. Both a single shared 50M token pool per month. Trial 1M over
3 days.

**Repo:** `~/Workspace/gateway` (VM path `/sessions/*/mnt/gateway`).
GitHub: github.com/Louay0007/gateway

---

## 3. TWO TRAPS — read before doing any research

**Trap 1: aggregator sites invent deadlines.**
I twice told the user the TotalEnergies Startupper closed 30 November 2026. That
came from allbusiness.africa. The official Agorize platform shows **0 live
programmes, 62 closed** — the Tunisia page still advertises Edition 4, which
closed **June 2024**. There is no open cycle.

**Trap 2: most Tunisian programmes have no open call, and that is not the
barrier.** The ecosystem runs on the Startup Tunisia SSO network (~45 accredited
structures) and on email/relationships, not application forms. Every cohort
checked had closed: Founder Institute Tunis (10 Nov 2026, $599 + 2.5% equity),
216 Capital accelerator (31 Oct), Orange Fab season 8 (31 Oct 2025), Orange
Corners OCIF (30 Aug). Do not conclude "nothing is available" — conclude
"reach out by email".

**Rule: verify every deadline on the operator's own site. Never trust an
aggregator.**

---

## 4. THE MONEY PROBLEM — the single most important thing

He needs **1,885 DT (≈$608)** to incorporate, or 2,985 DT with an accountant.

| Item | DT |
|---|---:|
| SUARL registration, DIY | 400 |
| Startup Label application fee | 100 |
| Apple Developer Program | 307 |
| Google Play Console | 78 |
| Bank account + capital | 1,000 |

**Apple Developer Program includes iOS/macOS signing certificates.** He
originally budgeted separately for "signing certificates" — that was wrong.

### The Bourse Startup — and why it may not apply

Under the Startup Act, a founder working full-time in a labelled company
receives **1,000 DT net/month for 12 months** from ANETI (up to 5,000 for
ex-salaried founders). That is 12,000 DT.

**But the Bourse explicitly excludes anyone with student status**
("ne doit pas avoir le statut d'étudiant"). He is a final-year student. So the
12,000 DT is likely unavailable **until he graduates**. Every document written
says "subject to eligibility" for this reason. Do not promise him 12,000 DT.

A **pre-label** exists for people who have not incorporated (article 4, valid
6 months). It does not itself grant benefits, but it starts the clock.

---

## 5. THE COST-BASIS PROBLEM (unresolved, load-bearing)

The pitch deck and migrations price everything from **0.20 DT per 1M blended
tokens** ("100 DT buys a 500M block"). But `config/litellm.yaml` and
`prices/models.yaml` carry per-token list rates implying **$2.20–$33 per 1M** —
30× to 500× higher. `CONTEXT.md` §4 says those per-token rates are
*placeholders*. No invoice exists in the repo.

Meanwhile the admin margin screen prices revenue as `upstream × 1.25–1.30`
(~20–23% gross margin). Three models, all disagreeing.

**Do not restate "80% margin at full burn" as fact.** Getting the real AiPilot
invoice is the highest-priority open item before any investor conversation.

---

## 6. Applications — exact status

### Submitted
**Emergent Ventures** (Mercatus Center) — submitted, confirmation received
("Application Received" in inbox). Rolling grant, $1k–$50k, Africa track,
~1 week decisions. Proposal was **947 words** (limit 1,000).
Files: `Emergent-Ventures-PASTE-READY.txt` (the submitted text),
`Emergent-Ventures-Proposal-FINAL.md`, `Zaino-One-Page.pdf` (attached).

**SignPath Foundation** — the user says he submitted. **This is likely to be
rejected and he should be told.** Reasons: (a) the mobile client's LICENSE reads
"Copyright (C) 2026 Tunap Paul" — it is a GPL-3 fork of Conduit; (b)
`git ls-files mobile-app/zaino/` returns 0 files, so the app is untracked and
absent from the public repo; (c) `github.com/Louay0007/gateway` has no LICENSE
at root; (d) SignPath signs **Windows** binaries and his signing target is iOS.
Suggest withdrawing via support@signpath.io and doing Apple Developer instead.

### Open, no company required
- **Awesome Foundation** — $1,000, monthly, rolling. Apply at
  awesomefoundation.org/en/submissions/new, choose **"Any"** chapter. Form
  limits: 2,000 chars about project, 500 on use of money, 500 about you, up to
  5 images. Drafts exist in `Zaino-Applications.md`.
- **Cloud credits** (worth ~$18,000): AWS Activate Founders $1k (needs
  **Paid-plan** account, not free tier); Google Start $2k; Microsoft up to $5k;
  Cloudflare $10k.
- **SNEE** (Statut National Étudiant Entrepreneur) via PEE Carthage at ISSAT
  Mateur. Free. Recurring cohorts (El Manar closed 15 Nov 2026; Carthage cycles
  ~February). Gives schedule flexibility, coaching, FabLab, diploma mention.
  **This is his best student-specific lever and nobody uses it.**

### Blocked on incorporation
Flat6Labs Tunis ($65k–120k, equity), 216 Capital (€50k, closes 31 Oct annually),
Carthage Business Angels, **AIR** (30,000 TND from Smart Capital — but requires a
company **under 1 year old**, so incorporate then apply fast), Startup Label
(100 DT, 30-day decision), Orange Fab (15K€, 2 calls/year, season 8 was 100% AI).

### Later
Tony Elumelu Foundation — $5,000, opens **1 January 2027**, closes ~March. All 54
African countries, businesses 0–3 years. Best-fit large grant. Set a reminder.
Google for Startups Accelerator Africa — ~Feb–Mar 2027.
Africa's Business Heroes — needs 3 years revenue; 2029 target.

---

## 7. The outreach campaign — current state

**22 personalised French emails** were prepared and are being sent from
ceo-louayrjili@sohabi.app. Master list: `Tunisia-Master-Contacts.xlsx` (63
organisations, 6 tiers).

### Delivery reality
- **14 delivered, no bounce.**
- **2 bounced:** `contact@tunisian-startups.com` (relay denied — use web form);
  `hello@betacube.io` (domain has **no MX record** — web form only).
- **6 still queued in `queue.json`:** hello@startup.gov.tn,
  Fab.Tunisie@Orange.com, giz-tunesien@giz.de, tunisia@invest-for-jobs.com,
  contact@bigtech.africa, vivatech2026@tunisia.gov.tn

### The rate limit — critical
`mail.privateemail.com` (Namecheap Private Email) throttles hard:
**roughly 3 messages per hour**, rejecting with
`554 5.7.1 ... too many messages from sender in last 60 minutes`.

**Do not batch-send.** Use `drip_send.py`, which sends only the first pending
item per run and keeps it queued on rate-limit rather than failing. Run it no
more than once per 30–60 minutes.

```bash
cd ~/Workspace/gateway
export SMTP_PASS='<ask Louay — do not store in a file>'
python3 drip_send.py        # sends ONE, reports remaining
```

SMTP: mail.privateemail.com, port 465, SSL. IMAP: same host, port 993.
**SMTP submissions are not copied to the Sent folder** — the Sent folder will
show almost nothing even when mail went out. Bounces arrive in INBOX from
mailer-daemon and are the only reliable delivery evidence.

**Security note:** the mailbox password was pasted into a chat transcript on
14 Nov and is therefore compromised. **Tell Louay to rotate it** in the
Namecheap panel and enable 2FA. Do not print it in any new file.

### Files for sending
- `send_all.py` — builds all 22 messages (bodies + PDF attachment). `--dry` to
  preview. Uses START/END env vars to select a range.
- `drip_send.py` + `queue.json` — the safe drip sender.
- `send-email.py` — single ad-hoc email sender.
- `Email-RedStart.md` — the RedStart email with relance template.
- `Zaino-One-Page.pdf` — one-page supporting document, attached to most emails.

---

## 8. Deliverable files and what each is

| File | What it is |
|---|---|
| `ZAINO-SUMMARY.md` | Full business + technical summary of the company. Verified against repo. |
| `Zaino-Master-Brief.md` | Strategy brief for the funding search. |
| `Zaino-Funding-Brief.md` | Earlier brief on the 1,885 DT target. |
| `Zaino-Applications.md` | Drafts for Emergent Ventures, Awesome Foundation, cloud credits. |
| `Emergent-Ventures-PASTE-READY.txt` | **The text actually submitted.** 947 words. |
| `Emergent-Ventures-Answers.md` | Field-by-field guide for the EV form. |
| `Zaino-One-Page.pdf` | One-page supporting doc. LaTeX source in outputs/`zaino-onepage.tex`. |
| `Zaino-Funding-Tracker.xlsx` | Programmes tracker (24 programmes, 5 sheets). Superseded partly by the master contacts file. |
| `Tunisia-Master-Contacts.xlsx` | **The main contact list.** 63 orgs, 6 tiers, status column, email template. |
| `Tunisia-Contacts-Verified.md` | Earlier verified-contact note; superseded by the xlsx but has useful caveats. |
| `queue.json` | Pending email queue (6 addresses). |
| `send_all.py`, `drip_send.py`, `send-email.py` | Email tooling. |

Build scripts for the xlsx files live in the session outputs folder
(`build_tracker.py`, `build_contacts.py`) — regenerate rather than hand-edit.

---

## 9. Verified contacts (the ones that worked)

| Org | Email | Notes |
|---|---|---|
| RedStart Tunisie | hello@redstart.tn | +216 71 793 125 |
| The Dot | **dotting@thedottn.com** | hello@thedot.tn does NOT exist |
| Westerwelle Startup Haus | tunis@westerwelle.haus | +216 55 343 325, free 1-week pass |
| Lab'ess | contact@labess.tn | +216 71 287 688 |
| Factory 619 | contact@factory619.com | +216 24 49 29 76 |
| Impact Partner (Yunus) | contact@impactpartner.co | runs GEN I |
| Flat6Labs Tunis | Tunis@flat6labs.com | +216 58 529 161 |
| 216 Capital | hello@216capital.vc | |
| Carthage Business Angels | projectmanager@cba.tn | +216 56 05 66 99 |
| CoStart Sfax | co.start.now@gmail.com | |
| Novation City | contact@novationcity.com | +216 36 01 10 00 |
| Elgazala Technopark | contact@elgazala.tn | +216 71 856 600 |
| TAEF | info@taefund.org | +216 71 191 000 |
| Smart Capital / ANAVA | opportunites@startup.gov.tn | ask which funds are deploying |
| Startup Tunisia | hello@startup.gov.tn | pre-label questions |
| Orange Fab / Digital Center | Fab.Tunisie@Orange.com | one address for both |
| GIZ Tunisia | giz-tunesien@giz.de | +216 71 967 220 |
| GIZ Invest for Jobs | tunisia@invest-for-jobs.com | Soft Landing desk |
| BIGTECH Africa | contact@bigtech.africa | +216 94 410 423 |
| VivaTech delegation | vivatech2026@tunisia.gov.tn | ministry + GIZ |

Marked **"form only"** in the xlsx (no published email): Wiki Start Up, Open
Startup, CEED, Réseau Entreprendre, FOUNDUP, Level 1, Wasabi/Afkar, SMU,
MEDIANET, StartupGateX, Stecia, CAS Sfax, Atuge, Expertise France. Do not invent
addresses for these.

---

## 10. What to do next, in order

1. **Drain the queue** — 6 emails, one per 30–60 min via `drip_send.py`.
2. **Tell Louay to rotate the mailbox password.**
3. **Apply to Awesome Foundation** — rolling, no company needed, drafts ready.
4. **Apply for the four cloud credits** — an afternoon, ~$18,000 of value.
5. **Email PEE Carthage about SNEE** — his best student-specific lever.
6. **File the Startup Act pre-label** — hello@startup.gov.tn, email drafted.
7. **Advise withdrawing the SignPath application** (see §6).
8. **Chase the AiPilot invoice** — resolves the cost-basis problem in §5.
9. **Only after incorporation:** AIR grant (30,000 TND, must apply within the
   first year), Startup Label, then accelerators.
10. **Diary 1 January 2027** — Tony Elumelu opens.

---

## 11. Tone and judgement notes

He is technical and fast; do not over-explain fundamentals. But he is also
prone to optimism about deadlines and eligibility — verify before confirming.
He responds well to being told plainly when something will not work, and badly
to hedging.

Two things to keep saying, because they are true and he may not want to hear
them: **the Bourse probably excludes students**, and **the 80% margin rests on
an unverified cost basis**. Both would surface in any real diligence.

Do not mass-BCC the contact list. The Tunisian ecosystem is ~45 organisations
deep and they talk to each other daily.
