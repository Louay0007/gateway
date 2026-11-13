"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Error boundary for the signed-in app shell.
 *
 * Root `app/error.tsx` catches anything, but it renders OUTSIDE the shell —
 * a customer who hits a render bug in /dashboard loses the sidebar and has
 * to use the browser back button. This one renders inside the shell, so
 * the navigation stays and the failure is local to one screen.
 *
 * Same copy discipline as the root boundary: say it is our bug, say nothing
 * was charged, give a way forward.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("app route error", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="rounded-xl border border-border bg-card p-8">
      <span className="inline-flex size-10 items-center justify-center rounded-full bg-destructive/10">
        <TriangleAlert className="size-5 text-destructive" aria-hidden />
      </span>
      <h2 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
        This screen failed to load
      </h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
        Your account, keys and usage are untouched, and nothing was charged.
        The navigation still works if you need a different page.
      </p>
      {error.digest ? (
        <p className="mt-3 font-mono text-xs text-muted-foreground">
          Reference: {error.digest}
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={reset}>
          <RefreshCw className="size-4" aria-hidden />
          Try again
        </Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/dashboard" />}>
          Dashboard overview
        </Button>
      </div>
    </div>
  );
}
