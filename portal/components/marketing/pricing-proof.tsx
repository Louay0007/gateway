import { Check } from "lucide-react";

import { PLAN_FACTS } from "@/lib/pricing/facts";

/**
 * PricingProof — the "is this real" strip.
 *
 * WHERE IT SITS AND WHY. Between the price cards and the comparison table. A
 * buyer who has just read five prices is at the exact moment of doubt, and
 * the comparison table does not answer that doubt — it answers "which one".
 * This band answers the earlier question with facts that can be checked
 * rather than with adjectives, which is the only kind of trust copy that
 * survives a technical reader.
 *
 * EVERY ITEM IS TRUE OF THIS CODEBASE, and each maps to something a customer
 * can verify:
 *
 *   - "only successful calls are metered"  → lib/jobs/collect-usage.ts writes
 *     a ledger row per success; enforce-prompt-limits reads that ledger.
 *   - "failures never consume quota"       → the same ledger is the only
 *     input to the wall, so a failed call has no row to count.
 *   - "the pool is shared, not per-model"  → tokenPoolFromLimits() SUMS the
 *     map; migration 0039 states the total once.
 *   - "D17 verified by a person"           → /admin/d17 is a staff queue.
 *   - "your prompt is not stored"          → store_prompts_in_spend_logs off.
 *
 * Deliberately NOT here: uptime percentages, customer counts, and any number
 * that would need a source we do not publish. An unverifiable claim on a
 * pricing page is the first thing a diligent buyer tests.
 */
const PROOF: { title: string; body: string }[] = [
  {
    title: "Only successful calls are metered",
    body: "A timeout, a 429 or a refusal writes no ledger row, so it cannot spend your pool.",
  },
  {
    title: "One pool, no per-model ceiling",
    body: "The allowance is a single total. Spend it all on one model without locking the others.",
  },
  {
    title: "D17 verified by a person",
    body: "Transfers settle against a staff-reviewed queue, usually within hours — not a webhook that guesses.",
  },
  {
    title: "Your prompts are not stored",
    body: "The spend ledger records token counts and cost. Prompt and response bodies are never written.",
  },
];

export function PricingProof() {
  // The cheapest and dearest entry points, derived rather than restated, so
  // this line cannot drift from the ladder the cards render.
  const byPrice = [...PLAN_FACTS].sort(
    (a, b) => a.priceTndMillimes - b.priceTndMillimes,
  );
  const entry = byPrice[0]!;

  return (
    <section
      aria-labelledby="proof-title"
      className="border-y border-border bg-muted/30"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-14">
          <div>
            <h2
              id="proof-title"
              className="text-balance text-lg font-semibold tracking-tight text-foreground"
            >
              What you are actually buying
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              The models are rented. The meter, the quota and the invoice are
              the product — and they are the parts you can check before you
              pay.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Entry is{" "}
              <span className="font-medium tabular-nums text-foreground">
                {entry.name} at {Math.round(entry.priceTndMillimes / 1000)} DT
              </span>{" "}
              a month, and the trial needs no card at all.
            </p>
          </div>

          <ul className="grid min-w-0 gap-x-8 gap-y-6 sm:grid-cols-2">
            {PROOF.map((item) => (
              <li key={item.title} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-card">
                  <Check className="size-3 text-foreground" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-foreground">
                    {item.title}
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
