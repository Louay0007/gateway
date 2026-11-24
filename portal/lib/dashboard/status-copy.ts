/**
 * The words the status strip says, derived from one bundle.
 *
 * WHY THIS IS NOT INSIDE THE COMPONENT. The strip's whole value is that a
 * customer reads one sentence and knows whether they are in trouble. That
 * sentence is logic — thresholds, pluralisation, dates, the difference
 * between "resets" and "paused until renewal" — and logic hidden inside a
 * client component can only be checked by rendering it. Kept pure, every
 * tone is asserted in `dashboard-status-copy.test.ts` with no DOM, no
 * network and no fixtures beyond a bundle-shaped object.
 */
import { compact } from "@/lib/dashboard/format";
import { quotaPercent, quotaTone, type QuotaTone } from "@/lib/dashboard/quota-tone";

export interface StatusCopyInput {
  poolTokens: number | null | undefined;
  poolUsedTokens: number;
  /** Period end, already formatted for display ("15 December") or null. */
  resets: string | null;
  /** Days left at the current average rate, or null when unknowable. */
  daysLeft: number | null;
  noPlan?: boolean;
}

export interface StatusCopy {
  tone: QuotaTone;
  percent: number;
  headline: string;
  detail: string | null;
  cta: { label: string; href: string } | null;
}

export function statusCopy({
  poolTokens,
  poolUsedTokens,
  resets,
  daysLeft,
  noPlan = false,
}: StatusCopyInput): StatusCopy {
  const tone: QuotaTone = noPlan ? "blocked" : quotaTone(poolUsedTokens, poolTokens);
  const percent = quotaPercent(poolUsedTokens, poolTokens);
  const limit =
    typeof poolTokens === "number" && Number.isFinite(poolTokens) && poolTokens > 0
      ? poolTokens
      : null;
  const remaining = limit !== null ? Math.max(0, limit - poolUsedTokens) : null;

  let headline: string;
  let detail: string | null;

  if (noPlan) {
    headline = "No active plan";
    detail = "Pick a plan to mint a key and send your first request.";
  } else if (tone === "unlimited") {
    headline = "No token cap on this plan";
    detail = resets ? `Billing period ends ${resets}.` : null;
  } else if (tone === "blocked") {
    headline = "Out of tokens for this period";
    detail = resets
      ? `Every model is paused until renewal on ${resets}.`
      : "Every model is paused until renewal.";
  } else if (tone === "warning" || tone === "watching") {
    headline = `${percent}% used — ${compact(remaining ?? 0)} left`;
    detail =
      daysLeft !== null && daysLeft > 0
        ? `about ${daysLeft} day${daysLeft === 1 ? "" : "s"} left at this rate`
        : resets
          ? `resets ${resets}`
          : null;
  } else {
    headline = `${compact(remaining ?? 0)} of ${compact(limit ?? 0)} left`;
    detail = resets ? `resets ${resets}` : null;
  }

  const cta =
    tone === "blocked" || tone === "warning" || noPlan
      ? { label: "Upgrade", href: "/dashboard/billing" }
      : tone === "watching"
        ? { label: "Add tokens", href: "/dashboard/billing" }
        : null;

  return { tone, percent, headline, detail, cta };
}
