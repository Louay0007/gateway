import { Section } from "@/components/docs/docs-section";
import { TIERS } from "@/components/docs/docs-data";

/**
 * Models — the four aliases, as a comparison matrix.
 *
 * WHAT THIS REPLACED. Four `<article>` cards, each holding three `<div>` tiles:
 * sixteen rounded, bordered, tinted containers to present twelve numbers that
 * only mean anything when read ACROSS. The price of `fast` is not interesting
 * on its own — it is interesting next to `smart`. Cards force the reader to
 * hold three values in memory and scroll to compare them, which is exactly the
 * job a table exists to remove.
 *
 * This is the craft floor's rule, applied literally: "Dense data = rows
 * (Table, List/Item), not Card-wrapped lists." A docs table of tiers and rates
 * is dense data by any definition, so it is a table — with a real `<caption>`,
 * `<thead>`, and `<th scope>` so a screen reader announces "Output, frontier".
 *
 * ALIAS-ONLY by invariant: no upstream deployment name appears here. The plan
 * column is the same `TIERS[].plans` value /pricing and the database agree on;
 * a card claiming an alias is Pro-only while Starter can call it is the exact
 * contradiction that makes a developer stop trusting the meter.
 *
 * THE WIDTH IS THE POINT. On a wide screen this matrix gets the full content
 * column and every rate is legible in one sweep. On a phone it scrolls inside
 * its own box (the same pattern /pricing uses) rather than collapsing back
 * into the cards this replaced — a stacked table is still a table, and the row
 * label travels with the row.
 */
export function ModelsSection() {
  return (
    <Section
      id="models"
      kicker="Models"
      title="Four names. That's the whole catalog."
      body={
        <>
          You never pick a deployment — you pick a tier and the gateway routes
          it. Swapping the models behind an alias is a deploy, not a migration,
          which is why no vendor model name appears anywhere in this catalog.
          Every plan gets one shared token pool spendable on any alias the plan
          includes.
        </>
      }
    >
      <div className="min-w-0 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
          <caption className="sr-only">
            The four Zaino model tiers with their rates per million tokens, the
            plans that include each one, and the workloads each is best for.
          </caption>
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th scope="col" className="px-4 py-3 text-[0.6875rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                Alias
              </th>
              <th scope="col" className="px-4 py-3 text-[0.6875rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                Input
              </th>
              <th scope="col" className="px-4 py-3 text-[0.6875rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                Output
              </th>
              <th scope="col" className="px-4 py-3 text-[0.6875rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                Cache read
              </th>
              <th scope="col" className="px-4 py-3 text-[0.6875rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                Included in
              </th>
              <th scope="col" className="px-4 py-3 text-[0.6875rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                Best for
              </th>
            </tr>
          </thead>
          <tbody>
            {TIERS.map((tier) => (
              <tr
                key={tier.alias}
                className="border-b border-border transition-colors last:border-0 hover:bg-muted/30"
              >
                <th scope="row" className="px-4 py-4 align-top">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <code className="font-mono text-base font-semibold tracking-[-0.01em] text-foreground">
                      {tier.alias}
                    </code>
                    {/* The badge is the tier's position in the ladder, which is
                        the one thing a name like "fast" does not say. */}
                    <span className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground">
                      {tier.badge}
                    </span>
                  </span>
                  <span className="mt-1.5 block max-w-[26ch] text-xs leading-relaxed text-muted-foreground">
                    {tier.tagline}
                  </span>
                </th>
                <RateCell value={tier.inputPerMtok} />
                <RateCell value={tier.outputPerMtok} />
                <RateCell value={tier.cacheReadPerMtok} />
                <td className="px-4 py-4 align-top text-[0.8125rem] text-foreground">
                  {tier.plans}
                </td>
                <td className="px-4 py-4 align-top">
                  <ul className="flex flex-wrap gap-1.5">
                    {tier.bestFor.map((use) => (
                      <li
                        key={use}
                        className="rounded-full border border-border px-2.5 py-1 text-[0.6875rem] leading-none text-muted-foreground"
                      >
                        {use}
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The footnote is prose, so it keeps the reading measure and loses the
          tinted box it used to sit in — a box here competed with the table it
          was annotating, which is backwards. */}
      <p className="max-w-[68ch] text-xs leading-relaxed text-muted-foreground">
        Rates are per 1M blended tokens, listed on the alias. Your plan&apos;s
        multiplier (Starter ×1.30, Pro ×1.25) applies on top. Cache reads are
        billed separately at the rate shown. Every alias serves 1M context and
        64k max output. Failed requests are never billed.
      </p>
    </Section>
  );
}

/**
 * A rate, right-aligned on tabular figures.
 *
 * `tabular-nums` is not decoration: four rows of prices are read as a column,
 * and proportional digits make the same magnitude render at different widths,
 * so the decimal points do not line up and the column cannot be scanned.
 */
function RateCell({ value }: { value: string }) {
  return (
    <td className="px-4 py-4 align-top">
      <span className="font-mono text-[0.9375rem] font-medium tabular-nums text-foreground">
        {value}
      </span>
      <span className="mt-0.5 block text-[0.6875rem] text-muted-foreground">per 1M</span>
    </td>
  );
}
