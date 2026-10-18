/**
 * AdminStat — the one stat tile the console uses.
 *
 * Built to make a NULL visibly different from a ZERO, which is the whole
 * point of several numbers on these screens:
 *
 *   `grossMarginPct` is null when there is no revenue in the window.
 *   Rendering that as "0%" would say "you made nothing and kept none of
 *   it", which is a different and alarming claim than "there was no
 *   revenue to have a margin on".
 *
 *   `effectiveRateBps` is null when upstream cost is zero. The same
 *   conflation applies.
 *
 * So `value === null` renders an em dash and the muted "no data yet"
 * treatment, never a zero. Callers pass the number they actually have;
 * this decides how absence is drawn.
 *
 * `tone` is for meaning, not decoration: `danger` means a human should
 * look at it now (over cap, failed sync, stale ledger). `positive` means
 * the business is healthy. Neutral is the default precisely so a
 * healthy screen has no colour at all — colour on a dashboard should be
 * rare or it stops being read.
 */

import { cn } from "@/lib/utils";

type Tone = "neutral" | "positive" | "warning" | "danger";

const TONE_RING: Record<Tone, string> = {
  neutral: "",
  positive: "border-emerald-500/40",
  warning: "border-amber-500/40",
  danger: "border-destructive/50",
};

const TONE_TEXT: Record<Tone, string> = {
  neutral: "",
  positive: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-destructive",
};

export function AdminStat({
  label,
  value,
  hint,
  tone = "neutral",
  className,
}: {
  label: string;
  value: string | number | null;
  hint?: string;
  tone?: Tone;
  className?: string;
}) {
  const absent = value === null || value === undefined;

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-4",
        TONE_RING[tone],
        className,
      )}
    >
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          absent ? "text-muted-foreground" : TONE_TEXT[tone],
        )}
      >
        {absent ? "—" : value}
        {absent ? (
          <span className="ml-2 align-middle text-xs font-normal text-muted-foreground">
            no data
          </span>
        ) : null}
      </dd>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Section heading + optional description, used by every console page.
 *
 * `description` exists because most of what these screens show needs a
 * sentence of context to be read correctly — "collected" and "recognised"
 * are different numbers and the difference is not self-evident.
 */
export function AdminSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
          {description ? (
            <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Page header, so the nine console pages are visually consistent. */
export function AdminHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}