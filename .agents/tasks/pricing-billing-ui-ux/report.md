# Pricing / billing UI-UX — fix report (round 2: review findings)

Branch: `fix/pricing-billing-ui-ux` (still exists at `b820ce8`).
HEAD under verification: **`9d7a2d6`**, which is also `origin/main` and local `main`. The review fix below was implemented locally and then found already landed and pushed as `9d7a2d6`; the working tree is byte-identical to that commit (`git diff 9d7a2d6` empty).
Base: `origin/main` at task start = `fe0fd55`. Branch commits: `1205a8f`, `9b34bac`, `02552ab`, `38990c9`, `b820ce8`, `9d7a2d6`.

## Review findings addressed first (`.agents/tasks/pricing-billing-ui-ux/review.json`)

Verdict on arrival: `CHANGES_REQUESTED`, 2 findings, both in
`portal/components/dashboard/payment-method-dialog.tsx`.

| Finding | Status | Change |
|---|---|---|
| `radio-group-no-roving-tabindex` (blocking) | fixed | Dead `onTileKeyDown` + `tileRefs` deleted. New `onGroupKeyDown` on the group handles arrows **and** `Home`/`End`, and a `tilesRef` on the group container focuses the newly selected tile. `tabIndex={selected ? 0 : -1}` added to each tile, so the group is **one** tab stop. |
| `radio-group-preventdefault-on-container` (low) | fixed | The handler now computes `next` first and returns before `preventDefault()` for any key it does not consume, so unconsumed keys (and future focusable children) are not swallowed. |
| Non-blocking: unused `cn` import | fixed | Removed the dead `import { cn } from "@/lib/utils"`. |

Line references (`payment-method-dialog.tsx`):
- `:118-146` — `tilesRef` + `onGroupKeyDown` (arrows wrap, `Home`/`End` jump at `:138-139`, `preventDefault` only on consumed keys).
- `:249-253` — group wired: `ref={tilesRef}` + `onKeyDown={onGroupKeyDown}`; the inline handler that returned early for `Home`/`End` is gone.
- `:264` — `tabIndex={selected ? 0 : -1}` on each tile.
- dead `onTileKeyDown` / `tileRefs` and the unused `cn` import: absent from the file.

The prior commit messages `02552ab` and `38990c9` claimed "one tab stop for the group" before it was true. This round makes the claim match the code.

## Defect table (original task, verified in branch HEAD)

| # | Defect | Location | What the code does now |
|---|---|---|---|
| 1 | Recommended badge clipped | `plan-card.tsx:55-63` | Badge is a **sibling** of `Card` inside `grid-rows-[auto_1fr]`, so `Card`'s `overflow-hidden` (`ui/card.tsx:14`) no longer clips it; `translate-y-2` seats it across the top edge. |
| 2 | Duplicated Tailwind utilities | `plan-card.tsx:65-66`; `billing-view.tsx:303,321,484,524` | One value per element: `border-success/30` + `ring-success/30` (emerald `success` scale, not discarded `ring-emerald-200`), `bg-success/10`, `text-success`, `bg-warning/15 text-warning`. Grep for a doubled utility in the scope files returns no matches. |
| 3 | Unequal card heights / CTA misalign | `plan-card.tsx:55,65,102,105`; `paywall-state.tsx:122` | Wrapper `grid h-full`, `Card` `flex h-full flex-col`, `CardContent flex-1`, footer last → CTAs share one baseline. Paywall grid uses `items-stretch`. |
| 4 | Price reads as one composite number | `plan-card.tsx:71-83`; `billing-view.tsx:536-555,700-716`; `pricing-plans.tsx:63-74`; `interactive-pricing-component.tsx:265-281,338-346` | Primary amount `text-3xl font-bold`, TND `text-base text-muted-foreground`, interval its own `text-sm` `/{intervalLabel}` span, `gap-x-2` between them. |
| 5 | Payment tiles not keyboard-accessible | `payment-method-dialog.tsx:118-146,249-253,264` | `role="radiogroup"` + `role="radio"` + `aria-checked`, native `type="button"`, `tabIndex` roving (one tab stop), arrows/Home/End/Space/Enter, `focus-visible:ring-2 focus-visible:ring-success`, and a `<Check>` icon present on **both** tiles (opacity-only when unselected) so colour is not the sole signal. |
| 6 | Seats field unlabelled | `payment-method-dialog.tsx:217-234` | `<Label htmlFor="checkout-seats">` matches `Input id="checkout-seats"`, `type="number" inputMode="numeric" min={1} max={maxSeats} step={1}`; `clampSeats` (`:56-63`) treats `""` as 1; `aria-live="polite"` total recomputed from `billedSeats`. |
| 7 | Dialog copy cramped/truncated | `payment-method-dialog.tsx:186,189-197` | `sm:max-w-lg` widens it; description split into `${plan.name}, charged monthly.` plus its own line "A D17 transfer is fixed in dinars; a card is charged in USD." Meaning preserved. |
| 8 | Alias-only rule violation | `interactive-pricing-component.tsx:88`; `billing-view.tsx:61-62` | `{ name: 'Opus 5.5 access' }` removed; `MODEL_LABELS` deleted entirely (no reference in `components/` or `lib/`). `billing-view.tsx:61` now carries a comment recording the rule. |
| 9 | Duplicate/overlapping Enterprise bullets | `interactive-pricing-component.tsx:88-90` vs `:70-74` | Enterprise is "All four tiers — fast, smart, frontier, fable", "High-volume shared token pool", "Dedicated support & SLA". Pro keeps the single "Priority queue"; Enterprise no longer duplicates it with "Priority routing". One priority claim per card. |

Pricing numbers, plan codes and token amounts unchanged: `$15` / `50 DT`, `$30` / `90 DT`, `50M shared tokens/month`. No i18n key added, removed or renamed; FR/AR literals (`'Choisir ce plan'`, `'اختر هذه الخطة'`) still match `lib/i18n/d17.ts:136` and `:260`, so the three-language badge/CTA switch in `plan-card.tsx:60` resolved correctly.

## Item 8 — upstream-name occurrences in pricing/billing copy

Searched for `Haiku|Sonnet|Opus|Zaino ` across the seven in-scope files. Result:

- **Customer-facing upstream names in pricing/billing copy: none remaining.** The two hits in `billing-view.tsx` are source comments (`:61-62`, describing the label strings that were removed — not rendered).
- `billing-view.tsx:948` renders "Token prices shown are **Zaino** official USD rates" — `Zaino` is our own brand, not the upstream vendor. Left alone.
- **Out of scope, already cleaned on this branch by `b820ce8`** (touches `lib/`, which the task forbids me to modify, so recorded rather than re-edited): `lib/i18n/d17.ts` — the D17 payment-confirmation email named `Sonnet 5.5` / `Opus 5.5` and the dead keys `d17.feat_fast_model` / `d17.feat_smart_model` named `Claude Sonnet` / `Claude Opus`; `lib/changelog/entries.ts` headings. All alias-only now.
- **Remaining, for a follow-up outside this task's scope:** `lib/` was not swept for any other upstream-name occurrence by this branch beyond the above; a dedicated `lib/` copy audit is the recommended follow-up.

## Visually unverified (no browser available)

Reasoned from classes only — **not** confirmed on screen:

- **#1** badge unclipped, **#3** equal card heights and shared CTA baseline, **#4** price composite spacing. All four depend on real layout/font metrics.
- **#5** focus ring visibility and the reserved check-icon slot not shifting tile width.
- **#7** dialog width and reflow at `sm:` breakpoints.

Verified without a browser: `tsc`, the full test suite, and `next build`. No test mounts `PaymentMethodDialog`, so the new keyboard path is **covered by reading only** — a component test for arrows/Home/End/tab-stop is the recommended next addition.

## Verification output

```
$ cd portal && npx tsc --noEmit
exit 0 (no output)

$ cd portal && npx vitest run
 Test Files  67 passed (67)
      Tests  1070 passed (1070)
   Duration  3.00s

$ cd portal && npx next build
 ✓ compiled; 19/19 static pages; ƒ Proxy (Middleware)
exit 0 (re-run on 9d7a2d6: same)
```

Baseline 1070 passing preserved — no test skipped, deselected or added.
