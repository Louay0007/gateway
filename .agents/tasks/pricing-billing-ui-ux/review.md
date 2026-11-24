# Review — pricing / billing UI-UX

Verdict: **CHANGES_REQUESTED** (2 blockers)

Scope reviewed: `git diff d6d02ab 9d7a2d6` (the task's full commit set; `main...HEAD` is empty because the branch already landed as `main`/`origin/main` at `9d7a2d6`). 8 files, +262/-126.

Unchanged in the diff: `portal/app/api/`, `portal/db/`, migrations, `portal/config/`, `edge/`, `.github/`, `portal/.env*`. No dependency added (`package.json` absent from the diff). Pricing numbers preserved: `$15` / `50 DT`, `$30` / `90 DT`, `50M` pool.

Defects 1–7, 9 verified as implementing the approved behavior, including `plan-card.tsx:60`'s three-language badge switch (FR `'Choisir ce plan'` / AR `'اختر هذه الخطة'` strings still match `lib/i18n/d17.ts:136`, `:260`) and the `PlanCard` `h-full` / `flex-1` footer baseline.

## Blocker 1 — D17 approval email now advertises Fast as included in Pro (false entitlement)

`portal/lib/i18n/d17.ts:96` (FR), `:220` (AR), `:339` (EN), introduced by `b820ce8`:

```
'• 50M jetons partagés entre Fast, Smart et Frontier, par mois\n' +   // :96
'• 50M tokens shared across Fast, Smart and Frontier, per month\n' +  // :339
```

Pro is not entitled to `fast`. `portal/lib/pricing/facts.ts:47-56`:

```ts
code: "pro",
models: ["smart", "frontier", "fable"],
```

Corroborated by `portal/tests/token-quota.test.ts:34` (`PRO_ENTITLED = ['smart', 'frontier', 'fable']`) and `portal/components/ui/interactive-pricing-component.tsx:71` ("Spendable on Smart, Frontier and Fable"). Both in-scope pricing surfaces exclude Fast from Pro; the email now includes it.

- **Consequence**: a Pro customer reads, in their D17 payment-confirmation email (the durable record of what they bought), that 50M tokens are spendable on Fast. `fast` is refused by `getAllowedModels` (`portal/lib/entitlements/allowed-models.ts:36`), so the first request they try fails — a paid-for entitlement claim contradicted by the wall, and a support-ticket generator.
- **Pre-existing?** No. Base `d6d02ab` read `• 210M tokens Smart (Sonnet 5.5) par mois` / `• 85M Frontier (Opus 5.5) par mois` — no Fast claim. `git log -S "50M jetons partagés entre Fast, Smart et Frontier" -- portal/lib/i18n/d17.ts` returns `b820ce8` only.
- **Correction**: drop `Fast` from all three bodies — `'• 50M jetons partagés entre Smart et Frontier, par mois'`, `'• 50M tokens shared across Smart and Frontier, per month'`, and the AR equivalent (`'• 50 مليون رمز مشترك بين Smart وFrontier شهرياً'`).

## Blocker 2 — Approved scope was `portal/components/**`; `portal/lib/` files were modified

The task restricts the change to `portal/components/dashboard/{billing-view,plan-card,payment-method-dialog,paywall-state}.tsx`, `portal/components/ui/interactive-pricing-component.tsx`, `portal/components/marketing/pricing-plans.tsx`, `portal/components/billing/dev-pay-form.tsx`, and states *lib/, app/api/, db/, migrations, config/, .github/, edge/, .env untouched*.

Diff touches:
- `portal/lib/i18n/d17.ts` (+3/-12) — `b820ce8`
- `portal/lib/changelog/entries.ts` (+6/-6) — `b820ce8`

The coder's report records this explicitly ("Out of scope... touches `lib/`, which the task forbids me to modify") but ships it anyway, and its defect table attributes the D17 email edit to the approved work.

- **Consequence**: the scope guard the task exists to enforce is not enforced. The `d17.ts` edit is also the carrier of Blocker 1, which no in-scope surface would have introduced.
- **Correction**: revert `b820ce8`'s `portal/lib/` hunks out of this change set and re-file them as a separate task with the Fast correction from Blocker 1 applied. If the alias-only rule is held to require the email fix (defect 8 named customer-facing *pricing/billing copy* only), get that scope expansion approved before landing it — do not assume it.

Note on interaction: reverting `b820ce8` alone would restore `Sonnet 5.5` / `Opus 5.5` in the email bodies, reintroducing an upstream-name leak into a customer-facing surface. The correction must therefore be *fix Fast and move the edit to its own approved change*, not a bare revert.

## Non-blocking, recorded (not blockers)

- `portal/lib/i18n/d17.ts:134-135`, `:255-256`, `:377-378`: `d17.feat_fast_model` / `d17.feat_smart_model` removed from all three dicts. `PLAN_FEATURES` (`portal/components/dashboard/paywall-state.tsx:31-45`) never listed them and no reference remains in `portal/**/*.{ts,tsx}`, so `t17`'s key-fallback (`d17.ts:397`) cannot surface a raw key. Deletion is safe — but it sits in the same forbidden `lib/` hunk as Blocker 2.
- Verification evidence is adequate and was not re-run: `npx tsc --noEmit` exit 0, `npx vitest run` 67 files / 1070 tests passed, `npx next build` exit 0, recorded in `report.md` and re-confirmed on `9d7a2d6`.
- No test mounts `PaymentMethodDialog`, so defect 5's keyboard path (arrows, `Home`/`End`, single tab stop) is verified by reading only. The implementation is correct on inspection: `tabIndex={selected ? 0 : -1}` (`:264`), arrow wrap at `:130`, `preventDefault` only after the key is consumed (`:132`), and focus index derived from `METHODS` order, matching the `[role="radio"]` DOM order. A component test is recommended but is not a blocker for a presentation-only task.
- Defects 1, 3, 4, 7 were not visually confirmed (no browser). Reasoned from classes; `plan-card.tsx:56` now puts the badge in a sibling grid row of the `overflow-hidden` `Card`, and `:65` gives `Card` `flex h-full flex-col` with `CardContent flex-1` — the stated mechanism is sound.
- `portal/components/marketing/pricing-preview.tsx:116` still renders `formatPlanPrice` as one composite `"$15 / 50 DT"` string. It is outside the seven named files, so out of scope; a consistency follow-up, not a finding.
