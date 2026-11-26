import { ShieldCheck } from "lucide-react";

import { Section } from "@/components/docs/docs-section";
import { CodeBlock } from "@/components/docs/code-block";
import { POOL_NOTE, POOL_PLANS } from "@/components/docs/docs-data";

/**
 * Keys & limits — the operational tail: where keys live, how auth behaves at
 * the edge, and what the gateway answers when a ceiling bites.
 *
 * LAYOUT. Both tables used to sit inside cards, inside a section that was
 * itself a card — and the plan table needed four columns it could not get at
 * that width, so `Spendable on` wrapped to three lines. The tables now take the
 * full content column, which is what lets the plan table be a table.
 */
export function KeysLimitsSection({ dashboard = false }: { dashboard?: boolean }) {
  return (
    <Section
      id="keys"
      kicker="Operate"
      title="Keys, headers, and limits"
      body={
        <>
          Keys are Bearer credentials with a{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">zn-</code>{" "}
          prefix, shown once at creation. The gateway rewrites the prefix at the
          edge and enforces budgets, rate limits, and plan tiers on every
          request.
        </>
      }
    >
      {/* Auth and the status codes are two answers to one question — "how does
          a request fail?" — so they share a row on wide screens. */}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            <ShieldCheck className="size-3.5" aria-hidden />
            Auth headers
          </h3>
          <CodeBlock
            className="mt-2.5"
            language="bash"
            filename="auth"
            code={`Authorization: Bearer zn-…   # preferred\nx-api-key: zn-…              # equivalent`}
          />
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Both styles authenticate. Never log, commit, or embed a key in
            client-side code.
          </p>
        </div>

        <div className="min-w-0">
          <h3 className="text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            When a call is refused
          </h3>
          <table className="mt-1 w-full border-collapse text-left text-sm">
            <caption className="sr-only">Gateway status codes and what each one means</caption>
            <tbody>
              {[
                ["401", "Missing, revoked, or wrong-door key"],
                ["403", "Tier outside your plan"],
                ["429", "Budget, RPM, or TPM ceiling hit"],
                ["402", "No live subscription (dashboard)"],
              ].map(([code, meaning]) => (
                <tr key={code} className="border-b border-border last:border-0">
                  <th scope="row" className="w-16 py-2.5 align-top">
                    <code className="font-mono text-[13px] font-semibold text-foreground">{code}</code>
                  </th>
                  <td className="py-2.5 align-top text-[0.8125rem] leading-relaxed text-muted-foreground">
                    {meaning}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* The pool. Its own block, not a card: it is a definition followed by
          the evidence for it, and a border around both would separate them
          from each other less clearly than the rule above already does. */}
      <div className="min-w-0 border-t border-border pt-6">
        <h3 className="text-sm font-medium text-foreground">One shared token pool</h3>
        <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">{POOL_NOTE}</p>

        <div className="mt-4 min-w-0 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
            <caption className="sr-only">
              Each plan&apos;s monthly token pool, the models it can be spent on,
              and how many API keys the plan allows.
            </caption>
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th scope="col" className="px-4 py-2.5 text-[0.6875rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                  Plan
                </th>
                <th scope="col" className="px-4 py-2.5 text-[0.6875rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                  Pool / month
                </th>
                <th scope="col" className="px-4 py-2.5 text-[0.6875rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                  Spendable on
                </th>
                <th scope="col" className="px-4 py-2.5 text-right text-[0.6875rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                  Keys
                </th>
              </tr>
            </thead>
            <tbody>
              {POOL_PLANS.map((plan) => (
                <tr key={plan.code} className="border-b border-border last:border-0">
                  <th scope="row" className="px-4 py-3 align-middle font-medium text-foreground">
                    {plan.label}
                  </th>
                  <td className="px-4 py-3 align-middle font-mono text-[13px] tabular-nums text-foreground">
                    {plan.tokensLabel}
                  </td>
                  <td className="px-4 py-3 align-middle text-[0.8125rem] text-muted-foreground">
                    {/* `·`-joined in a table cell wraps mid-token at narrow
                        widths, so each alias is its own inline block. */}
                    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                      {plan.models.map((model) => (
                        <code key={model} className="font-mono text-[13px] text-foreground">
                          {model}
                        </code>
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-middle text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                    {plan.maxKeys}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 max-w-[68ch] text-xs leading-relaxed text-muted-foreground">
          Usage is summed over the billing period, not per day, and not per
          model. Cache reads and writes count toward the same pool. Failed
          requests are never billed.
        </p>
      </div>
    </Section>
  );
}
