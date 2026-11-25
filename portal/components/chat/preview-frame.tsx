"use client";

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PREVIEW_SANDBOX,
  isTooLarge,
  previewTitle,
  srcdocFor,
} from "@/lib/chat/preview-template";

/**
 * The sandboxed frame a preview runs in. Plan §4.
 *
 * THE TWO CONTROLS, and why both:
 *
 *   1. `sandbox={PREVIEW_SANDBOX}` — never `allow-same-origin`, so the
 *      document is an opaque origin: no cookies, no access to our
 *      localStorage, no reach into `window.parent`.
 *   2. the CSP inside `srcdoc` — `connect-src 'none'`, so even though the
 *      script runs, it cannot make a network request and therefore cannot
 *      send anything anywhere.
 *
 * The sandbox alone would leave a script able to attempt a request (a GET
 * with no preflight is not stopped by CORS). The CSP alone would leave the
 * document same-origin and able to read our storage. Each covers the other.
 *
 * WHY THE SANDBOX VALUE IS A CONSTANT AND NOT A LITERAL HERE. A second
 * literal is a second place to regress, and `allow-same-origin` is one word
 * away. `tests/preview-template.test.ts` asserts this file contains no
 * inline sandbox string.
 */

export type PreviewState = "streaming" | "ready" | "error";

export interface PreviewFrameProps {
  html: string;
  /** For the accessible name. The frame is real content, never aria-hidden. */
  title: string;
  state: PreviewState;
  /** Message from inside the frame, when it reported one. */
  errorMessage?: string | null;
  className?: string;
}

export function PreviewFrame({
  html,
  title,
  state,
  errorMessage,
  className,
}: PreviewFrameProps) {
  // Rebuilt only when the DOCUMENT changes, and swapping `srcDoc` does not
  // remount the element — so scroll position and CSS animations survive an
  // update. That is what makes the panel live rather than flickering.
  const doc = React.useMemo(() => srcdocFor(html), [html]);

  if (isTooLarge(html)) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center",
          className,
        )}
      >
        <AlertTriangle className="size-5 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">Too large to preview</p>
        <p className="max-w-[36ch] text-xs text-muted-foreground">
          This block is {Math.round(html.length / 1024)} KB. The preview limit is
          512 KB — read it as text in the transcript instead.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      {state === "streaming" ? (
        // A thin bar, not an overlay: the document stays readable while it
        // grows, and covering it would defeat the point of a live preview.
        <div
          role="status"
          aria-live="polite"
          className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-muted/40 px-3.5 py-2 text-[12px] text-muted-foreground"
        >
          <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
          Building…
        </div>
      ) : null}

      {state === "error" ? (
        <div
          role="alert"
          className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {errorMessage ?? "The preview reported an error."}
        </div>
      ) : null}

      {/*
        No `key`. React reuses the element and swaps `srcDoc`, which keeps
        the frame's scroll position; a keyed element would remount on every
        update and restart the document.
      */}
      <iframe
        srcDoc={doc}
        sandbox={PREVIEW_SANDBOX}
        referrerPolicy="no-referrer"
        title={previewTitle(title)}
        className="min-h-0 w-full flex-1 border-0 bg-background"
        // Untrusted content: deny every permission the embedder could pass.
        allow=""
      />
    </div>
  );
}
