import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state for the signed-in shell.
 *
 * Mirrors the dashboard's real shape — a row of stat cards over a large
 * panel — so the layout does not reflow when content lands. The shell
 * (sidebar + header) is owned by the layout above this boundary, so it
 * stays visible while the segment loads.
 */
export default function AppLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="grid gap-6"
    >
      <span className="sr-only">Loading…</span>
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
