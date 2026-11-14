"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PRICING_FAQ } from "@/lib/pricing/facts";

/**
 * PricingFaq — the nine questions under pricing.
 *
 * These do trust work, not decoration. An aggregator's buyer always asks the
 * same three things — do you mark up, do you bill failures, what happens at
 * the ceiling — and every competitor answers them at the point of sale. A
 * pricing page that stays silent on them sends the buyer to Google, where
 * the answer is somebody else's opinion of us.
 *
 * Native <details>-less accordion on purpose: one item open at a time, so a
 * reader scanning the list is not scrolled past the price by an expanding
 * answer.
 */
export function PricingFaq() {
  const [open, setOpen] = React.useState<number | null>(0);

  return (
    <section aria-labelledby="pricing-faq-title">
      <h2
        id="pricing-faq-title"
        className="text-2xl font-semibold tracking-tight text-foreground"
      >
        Questions about pricing
      </h2>

      <div className="mt-6 divide-y divide-border rounded-xl border border-border">
        {PRICING_FAQ.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={item.q}>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                aria-controls={`pricing-faq-${i}`}
                className="w-full justify-between rounded-none px-5 py-4 text-left"
              >
                <span className="text-sm font-medium text-foreground">{item.q}</span>
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform",
                    isOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </Button>
              <div
                id={`pricing-faq-${i}`}
                hidden={!isOpen}
                className="px-5 pb-4 text-sm leading-relaxed text-muted-foreground"
              >
                {item.a}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
