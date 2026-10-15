import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Section — the docs page's repeating rhythm: kicker, title, lede,
 * then interactive content. Anchors carry scroll-margin for both the
 * marketing page and the sticky dashboard header.
 */
export function Section({
  id,
  kicker,
  title,
  body,
  children,
  tone = "themed",
}: {
  id: string;
  kicker: string;
  title: string;
  body: ReactNode;
  children: ReactNode;
  tone?: "themed" | "light";
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <p
        className={cn(
          "text-sm font-medium",
          tone === "light" ? "text-gray-600" : "text-muted-foreground",
        )}
      >
        {kicker}
      </p>
      <h2
        id={`${id}-title`}
        className={cn(
          "mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-3xl",
          tone === "light" ? "text-black" : "text-foreground",
        )}
      >
        {title}
      </h2>
      <div
        className={cn(
          "mt-3 max-w-3xl leading-relaxed",
          tone === "light" ? "text-gray-600" : "text-muted-foreground",
        )}
      >
        {body}
      </div>
      <div className="mt-6 grid gap-4">{children}</div>
    </section>
  );
}
