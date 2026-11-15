# Can Zaino sign for free? — audit, 2026-11-07

Verdict: **Windows yes (Microsoft Store MSIX). macOS no. Infinity no.**

## The subject under audit

| Fact | Value |
|---|---|
| Repo | `Louay0007/zaino-desktop`, public, MIT |
| Created | 2026-10-22 (16 days old) |
| Releases | 2 (v1.1.5, v1.1.6) |
| Stars / forks | 0 / 0 |
| Contributors | 2 |
| Product | Paid subscription client for the Zaino Gateway |
| Governing law | Tunisia (portal `terms/page.tsx:115`) |
| Channels | NSIS `.exe`, DMG/zip, AppImage/deb/rpm |

The last two rows decide most of what follows. The desktop tree is MIT, but the
thing it is a client for is sold by subscription, and the vendor is Tunisian.

## Every free route, assessed

### 1. Microsoft Store MSIX — FREE, and it works

Microsoft re-signs MSIX packages with its own certificate after certification.
No CA certificate, no .pfx, no HSM, no fee. You never see a SmartScreen warning,
and neither does the user.

Requirements, checked against Zaino:

| Requirement | Status |
|---|---|
| Partner Center account | Free. Individual free since 2025-09-10, company free since 2026-05-07 |
| Account type | **Company** required — policy 10.14, commercial activity; 10.8.3 if financial info is primary |
| MSIX package | Must build one; `electron-builder@26.15.7` ships `AppxTarget` only, no `msix` target |
| `runFullTrust` capability | Auto-added by electron-builder for Electron |
| Payment | Non-game PC apps may use a third-party purchase API (policy 10.8) — the existing Dodo/D17 checkout is allowed, must not be required *at install* |
| Privacy policy, testable build | Both exist / doable |
| Certification | Mutable; a few days, can be rejected |

Costs, in order of pain:

1. **Auto-update moves to the Store.** `electron-updater` does not support
   MSIX/AppX — Store or `.appinstaller` only. Windows users currently on NSIS
   get updates from the GitHub feed; after an MSIX listing they'd be on a
   different update channel and the old installs do not migrate themselves.
   Need a one-time "you're moving" path — a final NSIS release that points at
   the Store listing.
2. **Electron builder target.** Use `appx` (deprecated but accepted) or
   `electron-windows-msix` / Electron Forge MSIX maker to produce `.msixupload`.
3. **Certification risk.** An app that is useless without an account, from a
   vendor with 16 days of history and no public presence, is a weak submission.

Verdict: **viable**. It is a distribution change wearing a signing hat, not a
checkbox.

### 2. SignPath Foundation — free, but the publisher becomes them

Free OV-level cert, HSM-held key, GitHub Actions integration. Conditions
(`signpath.org/terms.html`):

- OSI-approved license, **no commercial dual-licensing** — Zaino qualifies (MIT)
- **No proprietary components** — the gateway is a separate repo; the desktop
  tree qualifies
- Actively maintained, already released — qualifies
- Publisher shown to users is **"SignPath Foundation"**, not Zaino
- They vet traction, and reject single-maintainer repos without external
  references — documented rejection at `Arsarneq/docent#72`, same shape as
  Zaino (new repo, few releases, no stars)
- Revocable at any time, at their discretion, with no arbitration

Verdict: **apply, expect rejection on traction.** Even on approval the
installer says "SignPath Foundation", which is wrong for a paid product.

### 3. Microsoft Store with an EXE/MSI installer — not free

The 2021 EXE/MSI submission path does **not** get re-signed. The Store requires
the installer itself to chain to a Microsoft Trusted Root CA. No help.

### 4. Azure Artifact Signing (ex-Trusted Signing) — not free, and not available

Two independent blockers:

- $9.99/month, and **free/trial/credit-based Azure subscriptions are refused**.
  The $200 signup credit and the $100 Student Pack credit do not work. Needs
  pay-as-you-go or EA.
- Country. Organization validation: US, CA, EU, UK, AU, NZ, JP, KR, SG, CH, NO,
  IL. Individual developer: **US and Canada only**. **Tunisia is not on either
  list**, so this is closed even if paid.

Verdict: **dead for this vendor.** Any earlier advice to use it does not apply.

### 5. Certum Open Source — €49/yr, and revoked if you sell

The certificate carries the fixed prefix "Open Source Developer" and Certum
revokes it if used to sign commercially distributed software. Zaino is sold by
subscription. Also, the project must be publicly identifiable with the
developer's name attached — a client for a closed gateway is a poor fit.

Verdict: **ineligible.** €49 isn't free anyway.

### 6. Sigstore / cosign — free, does nothing on Windows

Records a signature in a public transparency log. Windows SmartScreen and UAC
ignore it completely. Useful as a supplementary artifact-attestation habit; not
a signing route.

### 7. Self-signed certificate — free, useless in public

Triggers a hard SmartScreen block for anyone who hasn't imported the root.
Only defensible for enterprise distribution where IT pushes the root via
Intune/GPO — not a consumer product.

### 8. macOS — no free route, none

| Route | Free? | Gatekeeper clean? |
|---|---|---|
| Ad-hoc signing (current) | Yes | No — "unidentified developer", right-click → Open |
| Free Apple ID / Xcode personal team | Yes | No — local development only, no notarization |
| Apple Developer Program | No, $99/yr | Yes, Developer ID + `notarytool` + staple |
| Fee waiver | Yes | **Not for individuals or sole proprietors** — nonprofits, accredited schools, government entities only, distributing only free apps |

Apple's waiver explicitly excludes individuals. Zaino is a commercial product
from a one-person shop, so the waiver is closed on two counts.

Verdict: **the $99 stands.** The one mitigating fact: `electron-updater` does
not verify the macOS signature, so **updates keep installing** on
ad-hoc-signed builds. The cost is one warning per fresh install, not a broken
update path.

### 9. Linux — nothing to do

deb/rpm carry no trust requirement at install; AppImage is unsigned by
convention. A GPG-signed apt repo is a nicety, not a gate.

## Free things that are not signing

- **EV certificates no longer skip SmartScreen.** Microsoft removed the
  instant-reputation grant; OV and EV build reputation identically, by clean
  download volume. Paying for EV is now money for nothing.
- **Reputation is per publisher, and accrues.** Every release signed by the
  same identity builds it; a different identity restarts it. Which is the
  argument for picking one route and staying on it.
- **No manual SmartScreen submission** exists any more. There is no queue to
  join.

## Answer

| Platform | Free signing exists? | What it costs instead |
|---|---|---|
| Windows | **Yes — Microsoft Store, MSIX** | A migration off NSIS + electron-updater, a Store submission, and Store-managed updates forever after |
| macOS | **No** | $99/yr Apple Developer Program, or keep the warning |
| Linux | N/A | — |

Two things to decide, and they are independent:

1. **Windows:** submit to the Microsoft Store as a company account and get
   Microsoft signing for free, accepting that Windows updates become the Store's
   job and existing NSIS users need a migration release. Or keep shipping NSIS
   unsigned and accept SmartScreen.
2. **macOS:** pay $99, or accept the one-time warning per install.

Do not spend on an OV/EV certificate for Windows until both of those are
settled — if the Store route is taken it is wasted money, and if it isn't, the
cheapest OV route (Certum cloud, ~€209 direct) requires a registered company
in a jurisdiction Certum will validate.
