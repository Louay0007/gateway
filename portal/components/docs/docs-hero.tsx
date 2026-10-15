import Link from "next/link";
import { ArrowRight, BookOpen, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Docs hero + table of contents — shared by public /docs and
 * /dashboard/docs. Copy is identical on both; only the CTA target
 * and canvas tone adapt (light marketing vs themed dashboard).
 */
export function DocsHero({ dashboard = false }: { dashboard?: boolean }) {
  return (
    <section
      className={cn(
        "relative overflow-hidden border-b",
        dashboard
          ? "border-border bg-gradient-to-b from-primary/[0.07] via-background to-background"
          : "border-gray-200/60 bg-white",
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_20%_0%,rgba(0,0,0,0.06),transparent_70%)]"
      />
      <div className="relative mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
        <Badge variant="outline" className="rounded-full">
          <BookOpen className="size-3" />
          Documentation
        </Badge>
        <h1
          className={cn(
            "mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl",
            dashboard ? "text-foreground" : "text-black",
          )}
        >
          One API for every model. First call in two minutes.
        </h1>
        <p
          className={cn(
            "mt-4 max-w-2xl text-lg",
            dashboard ? "text-muted-foreground" : "text-gray-600",
          )}
        >
          {dashboard ? (
            <>
              Your key, your plan&apos;s tiers, and the exact configs for
              Codex and Claude Code — everything below works with the keys
              on your{" "}
              <Link href="/dashboard/keys" className="font-medium underline underline-offset-4 hover:opacity-80">
                keys page
              </Link>
              .
            </>
          ) : (
            <>
              A single OpenAI- and Anthropic-compatible endpoint, three
              model tiers, and hard spend ceilings. Grab a key, paste one
              snippet, and you&apos;re calling.
            </>
          )}
        </p>
        <div className="mt-8">
          <ol className="flex flex-wrap items-center gap-2" aria-label="Three steps">
            {["Get a key", "Pick a tier", "Send a request"].map((s, i, a) => (
              <li key={s} className="flex items-center gap-2">
                <span className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm">
                  <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                    {i + 1}
                  </span>
                  {s}
                </span>
                {i < a.length - 1 ? (
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                ) : null}
              </li>
            ))}
          </ol>
        </div>
        <dl className="mt-10 grid max-w-3xl gap-3 sm:grid-cols-3">
          <HeroFact label="Base URL" value="api…sslip.io/v1" mono />
          <HeroFact label="Auth" value="Bearer zn-…" mono />
          <HeroFact label="Models" value="fast · smart · frontier" />
        </dl>
      </div>
    </section>
  );
}

function HeroFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 text-sm font-medium", mono && "font-mono")}>{value}</dd>
    </div>
  );
}

const TOC = [
  "quickstart",
  "models",
  "openai",
  "anthropic",
  "codex",
  "claude-code",
  "keys",
];

export function DocsToc() {
  const labels: Record<string, string> = {
    quickstart: "Quickstart",
    models: "Models",
    openai: "OpenAI",
    anthropic: "Anthropic",
    codex: "Codex",
    "claude-code": "Claude Code",
    keys: "Keys & limits",
  };
  return (
    <nav aria-label="On this page" className="hidden lg:block">
      <div className="sticky top-24 grid gap-1">
        <p className="px-3 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          On this page
        </p>
        {TOC.map((id) => (
          <a
            key={id}
            href={`#${id}`}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {labels[id]}
          </a>
        ))}
        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium">Need a key?</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Keys are minted in seconds and shown once. Plans start at $19/mo.
          </p>
          <Button size="sm" className="mt-3 w-full rounded-full" nativeButton={false} render={<Link href="/sign-up" />}>
            Get an API key
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </nav>
  );
}
