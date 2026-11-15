# Handoff — Zaino AI Agent desktop (`/Users/user/Workspace/opencode`)

**Paste this whole file as the first message of a session opened on
`/Users/user/Workspace/opencode`.**

---

## What you are working on

`/Users/user/Workspace/opencode` is a **fork of opencode** (the open-source AI
coding agent) rebranded as the **Zaino AI Agent**. It is a paid desktop client
for the Zaino gateway — a commercial LLM gateway at `zaino.soon.it`, running at
**197.5.133.66** in production.

The fork adds a Zaino integration layer on top of upstream opencode:

```
packages/desktop/src/main/zaino/          auth, keys, usage, quota, models
packages/desktop/src/main/ipc-handlers/zaino.ts
packages/desktop/src/renderer/zaino/      sign-in gate, quota panel, gate.ts
packages/desktop/src/shared/ipc-rpc/zaino.ts
```

Everything else in `packages/` is upstream opencode and is **not your scope**
unless a change is strictly required to make the Zaino layer work.

---

## Read these first, in this order

1. **`GATEWAY_PORTAL_GAP_AUDIT.md`** (repo root). A prior audit that read the
   gateway portal source against this app's Zaino layer. §5 is a prioritised
   plan of 12 items; §7 claims all 12 are implemented. **Read §5 and §7
   together** — §7 exists because §5 was acted on.
2. **`V2_HTTP_API_AUDIT.md`** — the HTTP API surface between app and portal.
3. **`AGENTS.md`** — upstream opencode's own conventions. Respect them.
4. **`STATS.md`** — usage/telemetry accounting.

Then read the Zaino layer itself. Do not trust the audits' summaries: an audit
that marks its own work done is the least reliable section in it. **Verify every
§7 claim against the code** and report anything you cannot find.

---

## The invariants — do not break these

These come from the gateway side and are non-negotiable. They are the reason the
product exists; violating one is worse than shipping nothing.

1. **Alias-only surface.** A customer sees `fast`, `smart`, `frontier`, `fable`.
   Never `haiku-5.5`, `sonnet-5.5`, `opus-5.5`, `gpt-6-astra`, or any vendor
   name. The alias is what makes an engine swap a config change instead of a
   breaking release. This is enforced by tests on the gateway side.

2. **Never weaken metering.** Every inference must go through the gateway with
   the customer's own key. No bypass, no local cache of model output, no
   "offline mode". The meter is the product.

3. **One shared token pool per plan.** Starter 50M/month, Pro 50M/month, Trial
   1M. Spendable on any model the plan unlocks, in any proportion — 30M on one
   and 20M on another, or all 50M on one. There is **no per-model ceiling**.
   If the app displays an allowance, it must show the total, never a split.

4. **Failed requests are never billed**, and the app must not imply otherwise.

5. **The credential never crosses IPC.** See
   `packages/desktop/src/shared/ipc-rpc/zaino.ts` — the rule is documented
   there and must hold.

---

## What the upstream audits say is done

Summarised from §7 so you know what to verify, not what to trust:

| # | Claim | Where it should live |
|---|---|---|
| 1 | Gate guards all five spending endpoints (prompt, compact, command, skill, generate) | `renderer/zaino/gate.ts` — `SPENDING_PATHS`, `isSpendingPath` |
| 2 | `?model=` pre-flight guard is used; 429 maps to an `Exhausted` state | `renderer/zaino/quota.ts` — `fetchUsage(portal, key, model)` |
| 3 | Exhausted aliases filtered out of the model picker | `usableAliases(models, exhausted)` in `config.ts` `writeProvider` |
| 4 | A quota surface reachable while signed in | ⚠️ partial — panel exists, but the only entry point is a command-palette command |
| 5 | Plan name and reset date rendered | quota panel header |
| 6 | Key expiry surfaced end to end | client half confirmed; **portal half was missing and is now fixed in the gateway repo (`4254f83`)** |
| 7 | Single-device constraint stated in copy | sign-in Idle branch |
| 8 | `device_name` stored and exposed | migration `0032`, `KeyView.deviceName` |
| 9 | Sign-out revokes upstream | `POST /api/device/revoke` (gateway portal) |
| 10 | `ZainoDeviceCancel` emits `Cancelled` | `ipc-handlers/zaino.ts` |
| 11 | `FALLBACK_LIMITS` warns when used | `config.ts` `modelSpec` |
| 12 | Dead helpers used or removed | ⚠️ partial — `tightest`/`readState` gone, **`canUse` has no production caller** |

---

## VERIFIED FINDINGS — read this before anything else

A second audit checked §7's twelve claims against the code. Ten hold. Two do not,
and one of them is a security issue. Each was independently confirmed.

### F1. A signed-in user cannot sign out (CRITICAL, blocking)

`ZainoKeyClear` is only reachable from `ZainoSignIn`
(`renderer/zaino/sign-in.tsx:87` → `renderer/api.ts:100`), and that component is
mounted **only when `hasKey === false`** (`renderer/desktop-app.tsx:196-200`).
Once a key is stored, nothing — no menu, no settings row, no command — can call
it. There is no sign-out path in the shipped app.

The storage layer and IPC are correct; only a call site is missing. Fix: add a
"Sign out" entry to the command palette and/or the settings screen that invokes
`ZainoKeyClear`.

### F2. Clearing a key does not stop the running sidecar (SECURITY, blocking)

On `Unauthorized`, `ipc-handlers/zaino.ts:131-151` clears the key and the
provider config but **never calls `restart()`** — unlike `ZainoKeySet:67` and
`ZainoKeyClear:97`, which both do. The old sidecar process keeps `ZAINO_API_KEY`
in its environment, so a **revoked key stays usable locally** until the app is
restarted. `provider.ts:8-13` states that a restart is required after the key
changes.

Fix: call `restart()` in the `Unauthorized` branch, matching the other two.

### F3. `HEAD` does not compile (blocking for a fresh clone)

`git show HEAD:packages/desktop/src/renderer/platform/index.ts:11,78` imports and
uses `PROMPT_PATH`, which `HEAD:.../zaino/gate.ts` no longer exports (it exports
`isSpendingPath`). The working tree fixes it; the committed tip does not.

Fix: commit the working tree, or fix the import on the tip. Any new session that
starts from `HEAD` and runs `bun typecheck` will see a red build that is not its
own fault.

### F4. "401 on expired device key" was claimed and not implemented — NOW FIXED IN THE PORTAL

The audit's §7 item 6 asked the portal to reject expired keys. It did not:
`portal/lib/device/auth.ts` selected `expires_at` and returned it, but never
predicated on it, so a 30-day key kept answering `/api/device/usage` with 200 on
day 31. The desktop looked signed in and failed later with an opaque upstream
401/403.

**Fixed in the gateway repo** (`4254f83`): the query now has
`AND (expires_at IS NULL OR expires_at > now())`, with a test pinning it. Do not
re-fix this in the desktop repo; it is done.

### Everything else

Ten of twelve claims confirmed in code. Deviations that are minor:

- **P1.4** — the quota panel exists and mounts, but the ONLY entry point is a
  command-palette command. No settings row, no menu item.
- **P3.12** — `tightest`/`readState` are gone; `canUse` is exported, tested and
  has **no production caller**.
- **§7's claim** that a test pins the five spending paths *against*
  `packages/protocol/.../session.ts` is **false** — `gate.test.ts:268-292`
  hardcodes literals. The paths are correct; the test does not fail if upstream
  renames an endpoint.

### Also open, from the second audit

- **"Upgrade" copy with no link.** `messages.ts:48` tells a user to upgrade;
  nothing opens the portal. Sign in, out of tokens, told to upgrade, no door.
- **`device.ts` has no test file.** The only code path that mints a key has zero
  coverage.
- **i18n violation.** Zaino copy lives in a local catalog
  (`renderer/zaino/messages.ts`), against `packages/desktop/AGENTS.md`
  ("NEVER hardcode user-visible English strings"). `command.zaino.quota` exists
  in **1 of 66** locale files.
- **Settings providers row lies.** `settings/providers/providers.tsx:380` shows
  "Connected from your environment variables" for an in-app sign-in.
- **Credential is `safeStorage` + a file, not the OS keychain**, despite the
  comment in `credential.ts:6` saying keychain. `safeStorage` is defensible;
  the comment is wrong.
- **Version drift.** `packages/desktop/package.json` 1.1.6 vs repo root 2.1.2;
  `release-zaino.yml` hardcodes `1.1.6` in three places, ignoring package.json.
- **`release-zaino.yml` has no `github.repository` guard**, so any `v*` tag
  publishes to the fork.
- **macOS signing is off in practice.** `release-zaino.yml:23,194` sets
  `ZAINO_UNSIGNED=1` for all platforms, so the app ships ad-hoc signed and never
  notarized. Windows signing is wired but hard-fails without
  `AZURE_TRUSTED_SIGNING_*` secrets.
- **Dead copy after the pool rewrite:** `usageRemaining`, `modelLabel`.
- **Orphan asset:** `renderer/assets/zaino-halloween-bg.jpg` tracked while its
  component is deleted.

### Known-open issues the original audit admits

- **Single-device is a server constraint, not a product decision.** The portal
  revokes every previous device key on approval. A second machine silently kills
  the first. Stating it was chosen over fixing it; multi-device is a real feature
  (stop the blanket revoke, key on a device id, add a device list).
- **No device list anywhere** — not in app, not in the portal dashboard.
- **`FALLBACK_LIMITS` (256K / 32K)** is used silently when `/v1/models` omits
  `max_input_tokens`, so compaction runs too late.

---

## Things to check that the audits do NOT cover

These are gaps I noticed reading the repo; verify each before acting.

1. **Rebrand completeness.** There are **21 `README.*.md` translations**
   (verified) for a product still called "OpenCode". Check what the app actually shows a user
   (`productName`, `appId`, window title, about panel, installers) versus what
   still says opencode. Same class of bug as a dead link.
2. **Dead routes / dead IPC channels.** Walk every IPC channel registered in
   `ipc-handlers/` and confirm a renderer call site exists. The audit already
   found two of these (a dropped `readUsage` alias, a sign-out that never
   refetched key state). Look for more.
3. **Signing and release.** `fix(packaging): refuse to ship an unsigned Windows
   installer, and close the update hole` is the latest packaging commit. Confirm
   what macOS notarization and Windows signing actually do today, and whether the
   update channel matches where builds are published.
4. **Version skew.** Compare the app's bundled protocol/client version against
   the gateway's current API. A mismatched schema surfaces as a runtime error at
   send time, not at build time.
5. **Error copy quality.** The quota states should read like a product ("Out of
   tokens for this period — resets 15 December"), not a tag
   (`Error("quota_exhausted")`). The audit fixed one instance; check the rest.

---

## Do these first, in this order

1. **Run `bun typecheck` before touching anything.** If it is red at `HEAD` with a
   `PROMPT_PATH` import error, that is pre-existing (F3) — commit or fix the tip
   before building on it.
2. **Fix F2 — restart the sidecar on `Unauthorized`.** Three-line change, matches
   `ZainoKeySet` and `ZainoKeyClear`, and it closes the hole where a revoked key
   keeps working locally.
3. **Fix F1 — give a signed-in user a way to sign out.** The IPC and storage are
   already correct; only a call site is missing.
4. Then work down the "Also open" list.

Do NOT re-fix F4. It is done in the gateway repo and covered by a test there.

## How to verify

```bash
cd /Users/user/Workspace/opencode/packages/desktop
bun typecheck
bun test
```

```bash
cd /Users/user/Workspace/opencode
bunx oxlint .
```

The audit's last verified numbers: `bun typecheck` clean, `bun test` 227 pass /
1 skip / 0 fail, `oxlint` 0 errors. If your numbers differ, something moved —
find out what before adding to it.

**Runtime check.** The app talks to a live gateway. To exercise it:

- Gateway API: `https://api.zaino.soon.it` — alias-only, `zn-` keys
- Portal: `https://zaino.soon.it` — a device key is minted by the device-code
  flow (`POST /api/auth/device` → approve in a browser → poll for the token)
- A spent pool returns a real 403 with the copy in `outOfTokensMessage`

Do not test against a mock for the final check. The whole point of the Zaino
layer is that it reports the *real* meter.

---

## Working agreement

- **Verify, do not assume.** The previous audits are good but were written by the
  same session that did the work. Read the code.
- **Report what you could not confirm** rather than marking it done. An honest gap
  list is worth more than a green summary.
- **One change at a time, with the test that pins it.** Every fix in §7 shipped
  with a test; keep that bar.
- **Do not touch the gateway/portal** from that repo. If a portal change is
  genuinely required (e.g. a new endpoint), write it down as a separate item —
  the portal lives at `/Users/user/Workspace/gateway` and has its own invariants
  and test suite (716 tests).
