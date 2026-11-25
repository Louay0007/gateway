/**
 * Formatting for the /models catalog.
 *
 * WHY THIS IS ITS OWN MODULE. These were exported from `ModelCard`
 * (components/models/model-card.tsx), which is `"use client"`. The page
 * that renders the catalog is a server component, and a function exported
 * from a client module is only a client reference there — calling it
 * during the server render throws, which took the whole public /models
 * page down behind the generic error boundary. Nothing here touches a
 * browser API or React, so it belongs on the server side of the boundary
 * and is imported by both.
 *
 * NOT in lib/models/catalog.ts: that module opens a database connection,
 * and the client card imports these helpers.
 */

/** 1048576 → "1M" */
export function formatContext(n: number): string {
  if (n >= 1_048_576) return "1M";
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** Raw token count → a short human figure. 0 stays "0". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}
