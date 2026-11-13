import { Skeleton } from "@/components/ui/skeleton";

/**
 * Root loading boundary.
 *
 * Every route is server-rendered against Postgres, so a slow query showed a
 * blank white page with no sign anything was happening. This is the
 * cheapest possible shell: the page chrome stays put, the content area
 * reports "loading" to assistive tech, and the layout does not jump when
 * real content arrives.
 *
 * Deliberately generic. Route-specific skeletons (a table, a chart) belong
 * in that route's own loading.tsx; this one exists so no navigation is
 * ever silent.
 */
export default function RootLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading page"
      className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8"
    >
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-4 h-10 w-2/3" />
      <Skeleton className="mt-3 h-4 w-1/2" />
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
      <Skeleton className="mt-6 h-64 rounded-xl" />
    </div>
  );
}
