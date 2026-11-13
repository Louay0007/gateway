"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The root error boundary.
 *
 * Without this, ANY thrown error in ANY route renders Next's bare
 * "Application error" page — no navigation, no way back, and in production
 * no detail at all. A gateway customer who hits a render bug should still
 * have a way to reach their keys and their usage.
 *
 * `reset()` re-renders the segment; the "try again" button uses it rather
 * than `window.location.reload()`, so a transient render error recovers
 * without a full round trip. The dashboard link is the escape hatch for an
 * error that is not transient.
 *
 * `digest` is the only error identity Next exposes in production; logging
 * it is what lets an operator find the matching server trace.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server already logged the trace; this ties the client report to
    // it. console.error is deliberate: there is no client log sink yet, and
    // a silent boundary is how a bug survives for weeks.
    console.error("route error", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-24">
      <div className="w-full max-w-lg">
        <span className="inline-flex size-11 items-center justify-center rounded-full bg-destructive/10">
          <TriangleAlert className="size-5 text-destructive" aria-hidden />
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground">
          Something went wrong on this page
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          This is our bug, not yours. Your account, keys and usage are
          unaffected — nothing was charged and no request was lost.
        </p>
        {error.digest ? (
          <p className="mt-4 font-mono text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        ) : null}
        <div className="mt-8 flex flex-wrap gap-3">
          <Button size="lg" onClick={reset}>
            <RefreshCw className="size-4" aria-hidden />
            Try again
          </Button>
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<Link href="/dashboard" />}
          >
            Go to dashboard
          </Button>
        </div>
        <p className="mt-8 text-sm text-muted-foreground">
          Still stuck?{" "}
          <a
            href="mailto:contact.zaino.ai@gmail.com"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Tell us the reference
          </a>{" "}
          and we will find it in the logs.
        </p>
      </div>
    </main>
  );
}
