# SignPath Foundation — application answers

Every value below was checked against the repository, not recalled. Where a field
cannot be answered honestly yet, it says so instead of inventing a claim.

Target project: **`github.com/Louay0007/zaino-desktop`** — the Windows build that
SignPath can actually sign. Not the gateway (proprietary) and not the mobile app
(a GPL fork of someone else's project).

---

## Project Name

```
Zaino AI Agent
```

A Google search for "Zaino AI Agent" currently returns **nothing** — the project
is 3 weeks old with 0 stars. SignPath's own guidance says the name should be
identifiable on search. This is the weakest field on the form and no wording
fixes it; only time and a release fix it.

## Repository URL

```
https://github.com/Louay0007/zaino-desktop
```

Public, MIT, 7,449 files, single author (`louayrjilii-star`). Contains the Zaino
integration layer (~2,059 lines across `main/zaino/`, `renderer/zaino/`,
`shared/ipc-rpc/zaino.ts`) on top of upstream opencode.

## Homepage URL

```
https://zaino.soon.it
```

Live. Public pages: overview, pricing, docs, models, playground, connect,
changelog, status.

## Download URL

```
https://zaino.soon.it/download
```

⚠️ **This page does not yet mention SignPath Foundation.** SignPath requires it
to. Add one line before submitting — see "Before you submit" below.

## Privacy Policy URL

```
https://zaino.soon.it/privacy
```

Live, in the public footer. Covers the portal and the gateway; the desktop client
stores only a locally-encrypted credential and a provider config, no telemetry.

## Wikipedia URL

Leave empty. No article exists, and an empty optional field is better than a
fabricated one.

## Tagline

```
A desktop coding agent for the Zaino gateway — one key, the Claude and OpenAI APIs, a shared token pool you can audit.
```

Alternates, if it reads long:

```
A standalone desktop client for the Zaino gateway, with a token meter you can verify against your own usage.
```

## Category

```
Developer Tools
```

(If the form offers "Software Development" separately, that also fits. The app is
an AI coding agent, not a general productivity tool.)

## Description

```
Zaino AI Agent is a desktop application for developers working with large
language models. It connects to the Zaino gateway, a metered API service that
speaks both the OpenAI and Anthropic wire formats, so existing SDKs and coding
tools work against it unchanged.

The application provides a chat and coding interface, a sign-in flow bound to a
gateway account, local encrypted storage for the API credential, and a token
usage panel showing the remaining allowance and reset date for the current
billing period. Usage is enforced server-side; the client reports what the
server decides and never estimates or caches a quota.

It is a derivative of the open-source opencode project, extended with an
original integration layer for account sign-in, credential storage, quota
enforcement and release packaging. Both copyright notices are retained in the
LICENSE, which also records which paths are original work.
```

## Reputation

⚠️ **This is the field most likely to fail the application, and it cannot be
stretched honestly.** Verified 2026-11-14:

```
stars: 0        forks: 0
created: 2026-10-22        last push: 2026-11-07
```

The honest answer:

```
The project is three weeks old and has no stars or forks yet. What can be
evidenced today:

- A live production service at https://zaino.soon.it, running continuously since
  November 2026 with public status probes at /status and a documented changelog
  at /changelog.
- A public API gateway (api.zaino.soon.it) serving the OpenAI and Anthropic wire
  formats, with an open integration guide covering 14 tools.
- The desktop client has shipped two releases (v1.1.5, v1.1.6) to macOS, Windows
  and Linux from this repository's release pipeline.
- The upstream opencode project it builds on has substantial adoption; this fork
  inherits its architecture, not its user base.

No third-party coverage, download statistics or community discussion exists yet
to cite.
```

SignPath has a documented rejection of exactly this shape — a new
single-maintainer repository without external references
(`github.com/Arsarneq/docent/issues/72`). Expect the same. **Do not apply until
one of these is true:** the repo has real download numbers, a public post about
the app exists somewhere, or the app has actual users who can be pointed at.

## Maintainer Type

```
Individual
```

(One-person project; `git log` shows a single author. If the form requires a
company because the gateway is sold commercially, "Company" with
`Zaino AI` is also defensible — but Individual matches the repository.)

## Build System

```
GitHub Actions
```

The release pipeline is `.github/workflows/release-zaino.yml`, triggered by a
`v*` tag, producing NSIS `.exe` + `.zip` for Windows, dmg + zip for macOS, and
AppImage/deb/rpm for Linux via electron-builder.

⚠️ Two facts about that pipeline that matter to SignPath:

1. **It currently sets `ZAINO_UNSIGNED=1` for all platforms** (`:23,194`), which
   skips signing and notarization entirely. That is precisely what SignPath
   would replace on Windows.
2. **It has no `github.repository` guard**, so any `v*` tag publishes to the
   fork. Add one before you hand over a signing pipeline.

## First Name / Last Name

```
Louay
Rjili
```

## Email

```
ceo-louayrjili@sohabi.app
```

(Same mailbox as the gateway's transactional email — `MAIL_FROM` in production.)

## Company Name

```
Zaino AI
```

Optional. Leave empty if applying as an individual.

## Primary Discovery Channel

```
GitHub repository
```

Be accurate here; the free-signing research in this repo (`plans/free-signing-audit.md`)
came from reading SignPath's own terms and conditions page, not from a search.

## Exact source (optional)

```
https://signpath.org/terms.html — read while auditing code-signing options for a
Tunisian developer-tools project (the Apple Developer Program is the only route
for macOS; SignPath is the only free route for Windows).
```

---

## Before you submit — three things that must happen first

**1. Name SignPath on the download page — AFTER the first signed build.**
Required by their terms, but the claim must be true first. The tagline lives in
`components/marketing/download-content.tsx:111` and currently reads
"NSIS installer, WebView2 included". Change it to
"… · signed by SignPath Foundation" on the day you publish a SignPath-signed
release, not before. A visitor who checks the signature and finds none has been
lied to about the one thing that page exists to establish.

**2. Add the `github.repository` guard to `release-zaino.yml`.** Right now any
`v*` tag anywhere publishes to the fork. A signing pipeline without that guard
is a supply-chain hole, and it is the kind of thing a code-signing sponsor
checks.

**3. Note a contradiction in the workflow while you are there.**
`ZAINO_UNSIGNED=1` (line 23) skips macOS signing, and `ZAINO_REQUIRE_SIGNING=1`
(line 27) fails the release when Windows signing is missing. Windows signing
only activates when `AZURE_TRUSTED_SIGNING_*` secrets exist, and they do not.
So today **no Windows build can be produced by this workflow at all** — the
release job hard-fails at `afterPack`. Once SignPath signs for you, that
requirement is satisfied by a different signer, and the pipeline should be
rewired to use it rather than Azure.

**3. Decide about the reputation field.** If the honest answer is "3 weeks old,
0 stars," applying now is a likely rejection that costs nothing but also gains
nothing. The stronger application is the one made after the app has a download
count and one public mention.

---

## What is NOT being submitted, and why

| Candidate | Why not |
|---|---|
| `Louay0007/gateway` | `Cargo.toml` declares `license = "proprietary"`. SignPath requires an OSI-approved license. Relicensing the commercial gateway to satisfy a free-certificate program would give away the product. |
| `mobile-app/zaino` | A `git clone` of `github.com/cogwheel0/conduit` — 1,978 commits, `Copyright (C) 2026 Tunap Paul`, GPL-3.0. Not yours to submit, and renaming its copyright would be fraud. |
| An iOS build | SignPath issues Authenticode certificates. **No CA other than Apple can sign an iOS app.** That path is the $99 Apple Developer Program, already budgeted. |

---

## The honest summary

Two of the three things you asked me to "fix" are fixed: the LICENSE now names
your layer alongside opencode's, and this form is filled with verified values.

The third cannot be fixed by writing: **reputation**. A three-week-old repository
with no users is the exact profile SignPath has rejected before, in public. The
application is ready to send; the project is not yet the shape they accept.
