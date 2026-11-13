"use client";

import Link from "next/link";
import { Check, Circle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * GettingStarted — the onboarding checklist on /dashboard.
 *
 * WHY IT EARNS ITS SPACE. "First 200 response" is the only activation event
 * that predicts revenue, and until now nothing in the product knew whether a
 * new account had reached it. A customer who signed up, minted a key and
 * never sent a request looked identical to one who was happily using the
 * gateway — on a dashboard that showed two stat cards and no next step.
 *
 * STATE-DRIVEN, NOT DISMISSIBLE. Each row is computed from real data
 * (`keys`, `recent` usage rows), so it cannot be ticked off without the
 * thing actually happening, and it cannot become a stale "you're done" that
 * hides a broken onboarding. When every row is done the whole card
 * disappears — it is an onboarding surface, not a permanent panel.
 *
 * The steps are ordered by dependency, not by ease: you cannot send a
 * request without a key, and you cannot make a key without a plan.
 */
export interface GettingStartedProps {
  /** A live plan exists (active, trialing, past_due…). */
  hasPlan: boolean;
  /** The plan is a trial, so the copy can name the allowance. */
  trial: { active: boolean; daysRemaining: number | null; tokens: string | null };
  /** Number of non-revoked keys on the org. */
  keyCount: number;
  /** Whether any gateway call has ever been recorded for this org. */
  hasAnyRequest: boolean;
  /** Most recent request time, for the "you're live" line. */
  lastRequestAt?: string | null;
}

export function GettingStarted({
  hasPlan,
  trial,
  keyCount,
  hasAnyRequest,
}: GettingStartedProps) {
  const steps = [
    {
      label: "Create your account",
      done: true,
      hint: null,
      href: null,
      cta: null,
    },
    {
      label: hasPlan
        ? trial.active && trial.daysRemaining != null
          ? `Trial active — ${trial.tokens ?? "your allowance"}, ${trial.daysRemaining} day${trial.daysRemaining === 1 ? "" : "s"} left`
          : "Plan active"
        : "Choose a plan",
      done: hasPlan,
      hint: hasPlan ? null : "Any plan opens the gateway. 3-day trial, no card.",
      href: hasPlan ? null : "/pricing",
      cta: hasPlan ? null : "See plans",
    },
    {
      label: "Create an API key",
      done: keyCount > 0,
      hint: keyCount > 0 ? null : "A zn- key is shown once, when you mint it.",
      href: keyCount > 0 ? null : "/dashboard/keys",
      cta: keyCount > 0 ? null : "Create key",
    },
    {
      label: "Send your first request",
      done: hasAnyRequest,
      hint: hasAnyRequest
        ? null
        : "Pick your tool on /connect and paste the block — it ends with a test that proves a 200.",
      href: hasAnyRequest ? null : "/connect",
      cta: hasAnyRequest ? null : "Open /connect",
    },
  ];

  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;

  return (
    <section
      aria-labelledby="getting-started-title"
      className="rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="getting-started-title"
          className="text-base font-semibold tracking-tight text-foreground"
        >
          Get to your first 200
        </h2>
        <p className="text-xs tabular-nums text-muted-foreground">
          {done} of {steps.length} done
        </p>
      </div>

      <ol className="mt-4 grid gap-1">
        {steps.map((s) => (
          <li
            key={s.label}
            className={cn(
              "flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg px-2 py-2.5",
              s.done ? "opacity-60" : "bg-muted/40",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
                s.done ? "bg-success text-success-foreground" : "text-muted-foreground",
              )}
              aria-hidden
            >
              {s.done ? <Check className="size-3" /> : <Circle className="size-3.5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block text-sm",
                  s.done ? "text-muted-foreground line-through" : "font-medium text-foreground",
                )}
              >
                {s.label}
              </span>
              {s.hint ? (
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  {s.hint}
                </span>
              ) : null}
            </span>
            {s.href && s.cta ? (
              <Link
                href={s.href}
                className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                {s.cta}
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
