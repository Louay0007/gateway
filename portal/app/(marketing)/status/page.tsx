import type { Metadata } from "next";
import Link from "next/link";

import SiteNav from "@/components/marketing/site-nav";
import ZainoFooter from "@/components/marketing/zaino-footer";
import { overall, probeAll, type ComponentState } from "@/lib/status/probe";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Status | Zaino AI",
  description:
    "Live reachability and round-trip latency for the Zaino API gateway, portal and credential edge.",
  alternates: { canonical: "/status" },
};

/**
 * /status — checked on every request, not a snapshot.
 *
 * Competitors host a status page off-site with 90-day history. That is the
 * right end state and it needs Prometheus running (see
 * `docker-compose.monitoring.yml`). This page is the honest first step: it
 * probes the real endpoints each time you load it and says so, rather than
 * displaying a green dot somebody last updated by hand.
 *
 * `force-dynamic` is load-bearing — a prerendered status page is a lie.
 */
export const dynamic = "force-dynamic";

const COPY: Record<ComponentState, { label: string; tone: string; dot: string }> = {
  operational: {
    label: "Operational",
    tone: "text-success",
    dot: "bg-success",
  },
  degraded: {
    label: "Degraded",
    tone: "text-warning",
    dot: "bg-warning",
  },
  down: {
    label: "Down",
    tone: "text-destructive",
    dot: "bg-destructive",
  },
  unknown: {
    label: "Unknown",
    tone: "text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

export default async function StatusPage() {
  const components = await probeAll();
  const state = overall(components);
  const headline = COPY[state];

  return (
    <>
      <SiteNav active="Status" />
      <main className="pt-16">
        <section className="border-b border-border bg-background py-14 sm:py-20">
          <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8">
            <p className="text-sm font-medium text-muted-foreground">Status</p>
            <h1 className="mt-3 flex flex-wrap items-center gap-3 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              <span
                className={cn("inline-block size-3 rounded-full", headline.dot)}
                aria-hidden
              />
              {state === "operational" ? "All systems operational" : headline.label}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
              Measured when this page loaded — eight probes per component, plus
              a latency median. Nothing here is a hand-updated badge.
            </p>
          </div>
        </section>

        <section className="bg-background py-10 sm:py-14">
          <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8">
            <ul className="grid gap-3">
              {components.map((c) => {
                const copy = COPY[c.state];
                return (
                  <li
                    key={c.id}
                    className="rounded-xl border border-border bg-card p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{c.name}</p>
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {c.what}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {c.latencyMs != null ? `${c.latencyMs} ms` : "—"}
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 text-xs font-medium",
                            copy.tone,
                          )}
                        >
                          <span className={cn("inline-block size-2 rounded-full", copy.dot)} aria-hidden />
                          {copy.label}
                        </span>
                      </div>
                    </div>

                    {/* Ten-check strip: a flat colour for each probe. Wide
                        enough to show a blip, small enough to read at a
                        glance. */}
                    <div
                      className="mt-3 flex gap-1"
                      role="img"
                      aria-label={`${c.history.filter((h) => h.ok).length} of ${c.history.length} recent checks succeeded`}
                    >
                      {c.history.map((h, i) => (
                        <span
                          key={i}
                          className={cn(
                            "h-1.5 flex-1 rounded-full",
                            h.ok ? "bg-success/70" : "bg-destructive/70",
                          )}
                        />
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>

            <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
              Seeing a failure that this page calls operational?{" "}
              <Link href="/contact" className="font-medium text-foreground underline underline-offset-4">
                Tell us
              </Link>{" "}
              — a per-request failure can exist while the service as a whole is
              reachable. Historical uptime and incident history are the next
              step; this page reports the live state only.
            </p>
          </div>
        </section>
      </main>
      <ZainoFooter />
    </>
  );
}
