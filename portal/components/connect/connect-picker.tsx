"use client";

import * as React from "react";
import { Check, ChevronRight, KeyRound, TriangleAlert } from "lucide-react";

import { CodeBlock } from "@/components/docs/code-block";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  TOOLS,
  TOOL_GROUPS,
  snippetFor,
  type ToolId,
  type ToolGroup,
} from "@/lib/connect/tools";

/**
 * ConnectPicker — three steps, one output.
 *
 * The whole page is a function of two inputs (tool, tier) and one optional
 * one (the customer's key). That is deliberate: competitors who ask for an
 * account before showing a snippet lose the developer who just wants to
 * read the three lines. Everything below is rendered client-side so the
 * snippet updates instantly as the picks change.
 *
 * ALIAS NOTE. The tier list here is the four aliases, and a tier that the
 * visitor's plan does not include is not hidden — the gateway answers 403
 * for it and the docs say so. Hiding it would make the page disagree with
 * `GET /v1/models`.
 */
const TIERS = [
  { alias: "fast", blurb: "Cheapest. Drafts, classification, bulk work.", plans: "Starter · Pro" },
  { alias: "smart", blurb: "The default for most integrations.", plans: "Starter · Pro" },
  { alias: "frontier", blurb: "Deepest reasoning.", plans: "Pro" },
  { alias: "fable", blurb: "Long-horizon agent runs.", plans: "Pro" },
] as const;

type Tier = (typeof TIERS)[number]["alias"];

export function ConnectPicker({
  initialKey = "",
  signedIn = false,
}: {
  /** Pre-fills the key field when the page is rendered for a signed-in user. */
  initialKey?: string;
  signedIn?: boolean;
}) {
  const [tool, setTool] = React.useState<ToolId>("claude-code");
  const [tier, setTier] = React.useState<Tier>("smart");
  const [key, setKey] = React.useState(initialKey);
  const [showKey, setShowKey] = React.useState(false);

  const selected = TOOLS.find((t) => t.id === tool)!;
  const snippet = React.useMemo(() => snippetFor(tool, tier, key.trim()), [tool, tier, key]);
  const hasSecret = key.trim().length > 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:gap-12">
      {/* ── Steps ─────────────────────────────────────────────────── */}
      <div className="grid gap-8 lg:sticky lg:top-24 lg:self-start">
        <Step n={1} label="Pick your tool">
          <div className="grid gap-4">
            {TOOL_GROUPS.map((group: ToolGroup) => {
              const items = TOOLS.filter((t) => t.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group}>
                  <p className="mb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                    {group}
                  </p>
                  <div
                    role="group"
                    aria-label={group}
                    className="flex flex-wrap gap-1.5"
                  >
                    {items.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTool(t.id)}
                        aria-pressed={tool === t.id}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                          tool === t.id
                            ? "border-foreground bg-foreground text-background"
                            : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                        )}
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Step>

        <Step n={2} label="Pick a tier">
          <div role="group" aria-label="Model tier" className="grid gap-2">
            {TIERS.map((t) => (
              <button
                key={t.alias}
                type="button"
                onClick={() => setTier(t.alias)}
                aria-pressed={tier === t.alias}
                className={cn(
                  "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  tier === t.alias
                    ? "border-foreground/40 bg-muted/60"
                    : "border-border hover:border-foreground/20",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                    tier === t.alias
                      ? "border-foreground bg-foreground text-background"
                      : "border-border",
                  )}
                  aria-hidden
                >
                  {tier === t.alias ? <Check className="size-2.5" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block font-mono text-sm font-semibold text-foreground">
                    {t.alias}
                  </span>
                  <span className="block text-xs leading-snug text-muted-foreground">
                    {t.blurb}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground/80">
                    {t.plans}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Step>

        <Step n={3} label="Add your key (optional)">
          <label className="grid gap-2">
            <span className="sr-only">Your zn- API key</span>
            <div className="flex gap-2">
              <input
                type={showKey ? "text" : "password"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="zn-…"
                autoComplete="off"
                spellCheck={false}
                className="h-9 w-full min-w-0 rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowKey((v) => !v)}
                className="shrink-0"
              >
                {showKey ? "Hide" : "Show"}
              </Button>
            </div>
            <span className="text-xs leading-relaxed text-muted-foreground">
              {signedIn
                ? "Paste one of your zn- keys, or leave it blank to see the block with a placeholder."
                : "Leave blank to see the block with a zn-… placeholder. Create an account to mint a real key."}
            </span>
            {hasSecret ? (
              <span className="flex items-start gap-1.5 rounded-md bg-warning/10 px-2 py-1.5 text-[11px] leading-snug text-foreground">
                <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                This block now contains a live secret. Do not paste it into a
                shared gist, a screenshot or a public repo.
              </span>
            ) : null}
          </label>
          {!signedIn ? (
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<a href="/sign-up" />}
              className="mt-2 w-full"
            >
              <KeyRound className="size-3.5" aria-hidden />
              Create an account
            </Button>
          ) : null}
        </Step>
      </div>

      {/* ── Output ────────────────────────────────────────────────── */}
      <div className="min-w-0">
        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                Your block
              </p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
                {selected.name} · <span className="font-mono text-base">{tier}</span>
              </h2>
            </div>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {selected.blurb}
          </p>

          <div className="mt-5 grid gap-3">
            <CodeBlock
              language={snippet.language}
              filename={snippet.filename}
              code={snippet.code}
            />
            {snippet.also ? (
              <CodeBlock
                language={snippet.also.language}
                filename={snippet.also.filename}
                code={snippet.also.code}
              />
            ) : null}
          </div>

          {snippet.trap ? (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <p className="text-xs leading-relaxed text-foreground/90">
                <span className="font-medium">The trap: </span>
                {snippet.trap}
              </p>
            </div>
          ) : null}

          <div className="mt-6 border-t border-border pt-5">
            <p className="text-sm font-medium text-foreground">
              Now prove it works
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Copy this and expect a <code className="font-mono">200</code> with{" "}
              <code className="font-mono">ok</code> in the body. A 401 means the
              key is wrong; a 403 means the tier is not in your plan.
            </p>
            <div className="mt-3">
              <CodeBlock language="bash" filename="test.sh" code={snippet.test} />
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Fact label="Base URL" value="api.zaino.soon.it/v1" />
          <Fact label="Anthropic format" value="api.zaino.soon.it" />
          <Fact label="Auth" value="Bearer zn-…" />
        </div>

        <div className="mt-6 rounded-xl border border-border bg-muted/40 px-4 py-3.5">
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">One shared pool. </span>
            Your plan gives you 50M blended tokens per month, spendable on any
            model it includes, in any proportion. Usage is summed over the
            billing period — not per day, and not per model. Failed requests are
            never billed.{" "}
            <a
              href="/docs#keys"
              className="font-medium text-foreground underline underline-offset-4"
            >
              Full limits
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

function Step({
  n,
  label,
  children,
}: {
  n: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`connect-step-${n}`}>
      <h2
        id={`connect-step-${n}`}
        className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"
      >
        <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">
          {n}
        </span>
        {label}
      </h2>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <p className="text-[10px] tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 font-mono text-[11px] break-all text-foreground">{value}</p>
    </div>
  );
}
