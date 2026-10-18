/**
 * Formatters for the dashboard UI.
 *
 * Money exists in two units in this system and they must not be mixed:
 *   - `*_cents` columns (plan price, included spend, hard cap) are INTEGERS
 *     of cents — see db/schema.ts;
 *   - `cost_*_usd` ledger columns are USD amounts exposed as numbers by
 *     /api/subscription — see lib/billing/service.ts.
 * These helpers keep that boundary explicit at every call site.
 */

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** Integer cents → "$19.00". */
export function centsUsd(cents: number): string {
  return usdFormatter.format(cents / 100);
}

/** USD number → "$0.36" (4 decimals under a dollar: ledger costs are tiny). */
export function usd(amount: number): string {
  if (amount > 0 && amount < 1) {
    return usdFormatter.format(amount).replace(/\.(\d)\b/, ".$10");
  }
  return usdFormatter.format(amount);
}

/** USD number, always 2+ decimals — rows where tiny values must stay exact. */
export function usdPrecise(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

/** 412300 → "412.3k" — token counts, requests, anything in the thousands. */
export function compact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** Tokens per second → "1.2k tok/s"-style unit helper. Unused units stay honest. */
export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.round((part / whole) * 100));
}

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const dayTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/** "Sep 13" — chart axes, day buckets. */
export function shortDate(iso: string): string {
  return dayFormatter.format(new Date(iso));
}

/** "Sep 13, 14:02" — ledger rows. */
export function dateTime(iso: string): string {
  return dayTimeFormatter.format(new Date(iso));
}

/** "3m ago" / "2h ago" / "Oct 3" — last-used columns. */
export function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Never";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return shortDate(iso);
}

/**
 * "Oct 1 → Oct 31" — a chart window label from two ISO bounds.
 *
 * Uses the WINDOW the server resolved, not the first/last point that
 * happened to arrive, so a quiet range still reads as the range the
 * customer selected rather than collapsing to nothing.
 */
export function rangeLabel(from?: string | null, to?: string | null): string | null {
  if (!from || !to) return null;
  return `${shortDate(from)} → ${shortDate(to)}`;
}

/**
 * Avatar initials for a person, not an org.
 *
 * First letters of the first two name words ("Ada Lovelace" → "AL"), and
 * the email local part when there is no name yet ("zaino" → "ZA"). Never
 * blank: "?" beats an empty circle. One function so the header, the
 * sidebar, and the settings page cannot disagree on who you are.
 */
export function initialsFor(name?: string | null, email?: string | null): string {
  const fromName = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  if (fromName) return fromName.toUpperCase();
  const local = (email ?? "").split("@")[0] ?? "";
  const cleaned = local.replace(/[^a-zA-Z0-9]/g, "");
  if (cleaned.length >= 2) return cleaned.slice(0, 2).toUpperCase();
  if (cleaned.length === 1) return cleaned.toUpperCase();
  return "?";
}

/** D17 rate for client-side DT display (matches server D17_USD_TND_RATE default). */
const D17_RATE = 3.1;

/** Integer USD cents → "50 DT" (Tunisian Dinars, no decimals for plan prices). */
export function centsDt(cents: number): string {
  const dt = Math.round((cents / 100) * D17_RATE);
  return `${dt} DT`;
}
