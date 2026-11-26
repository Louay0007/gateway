"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { promoView } from "@/lib/billing/promo";
import { formatPlanPrice } from "@/lib/dashboard/format";

/**
 * DocsRail — the sticky left rail on /docs.
 *
 * WHY THIS REPLACED A PLAIN TOC. The old nav was `hidden lg:block` with seven
 * anchors and no state: at 4000px into the page it still said "Quickstart" as
 * though nothing had been read. A reader's real question is "where am I and
 * how much is left", so the rail now answers it — the active section is marked
 * from scroll position, and a hairline under the list shows progress through
 * the document.
 *
 * IT IS ALSO THE ONLY PERSISTENT CTA. The old TOC put "Get an API key" at the
 * bottom of the list, below the fold on a laptop. Here the CTA is pinned to the
 * rail's foot, visible for the entire read.
 */

export interface DocsRailItem {
  id: string;
  label: string;
}

/**
 * The rail's list.
 *
 * `readonly DocsRailItem[]` rather than `DocsRailItem[]`: the caller's list is
 * `as const` so a typo in an anchor id is a type error at the source, and
 * accepting a mutable array here would have forced that guarantee to be
 * dropped for the component's convenience.
 */
export function DocsRail({
  items,
  dashboard = false,
}: {
  items: readonly DocsRailItem[];
  dashboard?: boolean;
}) {
  const [active, setActive] = React.useState<string>(items[0]?.id ?? "");
  const [progress, setProgress] = React.useState(0);

  /**
   * Mark the section occupying the reading line.
   *
   * `rootMargin` pushes the observation band to the top third of the viewport:
   * a heading that has just entered the top edge is the section being read,
   * not the one still filling the bottom. Without it the marker lags a full
   * screen behind the eye.
   *
   * Guarded: `IntersectionObserver` is absent in older test DOMs, and a rail
   * that throws takes the whole page down with it.
   */
  React.useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const nodes = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    if (nodes.length === 0) return;

    const seen = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          seen.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        // The section with the largest visible share wins; ties resolve to the
        // document order above, so the marker never flickers between two.
        let best = active;
        let bestRatio = 0;
        for (const [id, ratio] of seen) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = id;
          }
        }
        if (bestRatio > 0) setActive(best);
      },
      { rootMargin: "0px 0px -60% 0px", threshold: [0, 0.25, 0.5, 1] },
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
    // `active` is intentionally not a dependency: it is the fallback, and
    // re-subscribing on every marked section would tear down the observer
    // exactly when it is doing its job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  /** Progress through the article, as a 0..1 fraction of scrollable height. */
  React.useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      setProgress(scrollable > 0 ? Math.min(1, Math.max(0, doc.scrollTop / scrollable)) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <nav aria-label="On this page" className="hidden lg:block">
      {/* `top-16` clears the marketing navbar, which is `fixed` at h-16. */}
      <div className="sticky top-16 flex max-h-[calc(100dvh-6rem)] flex-col gap-6">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            On this page
          </p>

          <ol className="mt-3 grid gap-px">
            {items.map((item, i) => {
              const current = item.id === active;
              return (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    aria-current={current ? "true" : undefined}
                    className="group/nav flex items-baseline gap-2.5 rounded-md py-1.5 text-sm transition-colors"
                  >
                    {/* The numeral is the page's own structure — the sections
                        are a sequence a reader works through — so it is set in
                        tabular mono and dimmed rather than removed. */}
                    <span
                      className={
                        current
                          ? "font-mono text-[0.6875rem] tabular-nums text-foreground"
                          : "font-mono text-[0.6875rem] tabular-nums text-muted-foreground/50"
                      }
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={
                        current
                          ? "font-medium text-foreground"
                          : "text-muted-foreground transition-colors group-hover/nav:text-foreground"
                      }
                    >
                      {item.label}
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>

          {/* Progress: a hairline, not a progress ring. It answers "how much
              is left" in one pixel of ink and cannot be mistaken for content. */}
          <div className="mt-4 h-px w-full bg-border" aria-hidden>
            <div
              className="h-px bg-foreground transition-[width] duration-150 ease-out"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium text-foreground">
            {dashboard ? "Your keys" : "Need a key?"}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {dashboard ? (
              "Mint one on the keys page — it inherits your plan's tiers and limits."
            ) : (
              <>
                Minted in seconds, shown once. Plans start at {starterPrice()}/mo
                — 50M shared tokens, 3 API keys.
              </>
            )}
          </p>
          <Button
            size="sm"
            className="mt-3 w-full rounded-lg"
            nativeButton={false}
            render={<Link href={dashboard ? "/dashboard/keys" : "/sign-up"} />}
          >
            {dashboard ? "Manage keys" : "Get an API key"}
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </nav>
  );
}

/**
 * Starter's price, read through the same promotion module the checkout
 * charges with — so the rail can never advertise a price the D17 page will
 * not ask for. 1500/50000 are Starter's two list prices (USD cents / exact
 * dinar millimes) since migration 0037; neither is derived from the other.
 *
 * Called during render rather than hoisted to a constant: the promotion window
 * closes on its own, and a module-level read would freeze it at build time.
 */
function starterPrice(): string {
  const promo = promoView(1500);
  return formatPlanPrice(promo?.priceCents ?? 1500, 50000);
}
