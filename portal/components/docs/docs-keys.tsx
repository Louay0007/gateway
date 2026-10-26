import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Section } from "@/components/docs/docs-section";
import { CodeBlock } from "@/components/docs/code-block";

/**
 * Keys & limits — the operational tail: where keys live, how auth
 * behaves at the edge, and what the gateway answers when a ceiling
 * bites. Ends with the single CTA the whole page funnels to.
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
          prefix, shown once at creation. The gateway rewrites the prefix at
          the edge and enforces budgets, rate limits, and plan tiers on every
          request.
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4" aria-hidden />
            Auth headers
          </p>
          <CodeBlock
            className="mt-3"
            language="bash"
            filename="auth"
            code={`Authorization: Bearer zn-…   # preferred
x-api-key: zn-…              # equivalent`}
          />
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Both styles authenticate. Never log, commit, or embed a key in
            client-side code.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="px-4 py-2 font-medium">Gateway answer</th>
                <th className="px-4 py-2 font-medium">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["401", "Missing, revoked, or wrong-door key"],
                ["403", "Tier outside your plan"],
                ["429", "Budget, RPM, or TPM ceiling hit"],
                ["402", "No live subscription (dashboard)"],
              ].map(([c, m]) => (
                <tr key={c} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-mono text-[13px] font-semibold">{c}</td>
                  <td className="px-4 py-2 text-muted-foreground">{m}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-6 sm:flex-row sm:items-center sm:p-8">
        <div>
          <p className="text-xl font-semibold tracking-tight text-white">
            Ready to make your first call?
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            {dashboard
              ? "Mint a key below — it inherits your plan's tiers and limits."
              : "Create an account, pick Starter or Pro, pay by D17 — your first key is seconds away."}
          </p>
        </div>
        <Button
          size="lg"
          nativeButton={false}
          render={<Link href={dashboard ? "/dashboard/keys" : "/sign-up"} />}
          className="shrink-0 rounded-full bg-white dark:bg-gray-800 text-black dark:text-white hover:bg-zinc-200 dark:hover:bg-gray-700"
        >
          {dashboard ? "Manage keys" : "Get an API key"}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </Section>
  );
}
