import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * The 404, as product surface.
 *
 * Next ships a default "This page could not be found" that is serialized
 * into EVERY route's RSC payload (which is why a grep of any page's HTML
 * finds that string). Replacing it here does two things: it gives a lost
 * visitor a route forward instead of a dead end, and it stops the default
 * 404 markup from riding along in every response.
 *
 * Root-level on purpose. A not-found under `(marketing)` or `(app)` would
 * only catch that group; a mistyped URL can land anywhere.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-24">
      <div className="w-full max-w-lg">
        <p className="font-mono text-sm tracking-widest text-muted-foreground uppercase">
          404
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          That page does not exist
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          The link may be old, or the page may have moved. Nothing is broken
          on your account — your keys and usage are unaffected.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button size="lg" nativeButton={false} render={<Link href="/" />}>
            Back to home
          </Button>
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<Link href="/docs" />}
          >
            Read the docs
          </Button>
        </div>
        <p className="mt-8 text-sm text-muted-foreground">
          Looking for your keys or usage?{" "}
          <Link
            href="/dashboard"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Open your dashboard
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
